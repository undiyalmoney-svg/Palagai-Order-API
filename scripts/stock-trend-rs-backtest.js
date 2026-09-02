#!/usr/bin/env node
/**
 * Same Donchian-channel trend-following mechanism as stock-trend-backtest.js
 * (worst performer of everything tested this session, PF 0.45-0.47) — but
 * gated by RELATIVE STRENGTH vs Nifty 50, the one genuinely untested idea
 * pulled from the "how to select stocks" articles. Every prior stock test
 * traded a fixed basket unconditionally; none checked whether a stock was
 * CURRENTLY outperforming the index before taking a signal.
 *
 * Added gate only — entry/exit mechanics are otherwise identical to
 * stock-trend-backtest.js so this isolates the effect of the RS filter:
 *   Long breakout taken only if the stock's RS_LOOKBACK-day return exceeds
 *   Nifty 50's return over the same window (stock is leading).
 *   Short breakdown taken only if the stock's return is BELOW Nifty's
 *   (stock is lagging/relatively weak) — symmetric extension for shorts.
 *
 * This can only ever narrow the trade set of the underlying mechanism, not
 * fix a structurally weak one — flagged explicitly in the report, not just
 * in this comment.
 *
 * Usage: node scripts/stock-trend-rs-backtest.js <fromDate> <toDate> [capitalRs]
 * Env:   KITE_API_KEY, KITE_ACCESS_TOKEN
 */
const { fetchHistoricalCandles } = require('../live/kite-market');
const { estimateDeliveryRoundTripCharges } = require('../live/equity-charges');

const STOCKS = {
  HDFCBANK: { token: 341249, label: 'HDFC Bank' },
  ICICIBANK: { token: 1270529, label: 'ICICI Bank' },
  SBIN: { token: 779521, label: 'SBI' },
  KOTAKBANK: { token: 492033, label: 'Kotak Mahindra' },
};
const NIFTY_TOKEN = 256265;

const MAX_KITE_DAYS_PER_REQUEST = 1900;
const ENTRY_LOOKBACK = 20;
const EXIT_LOOKBACK = 10;
const TREND_EMA_LEN = 100;
const ATR_STOP_MULT = 3.0;
const RS_LOOKBACK = 20;

function addDaysIso(dateIso, delta) {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

async function fetchChunked(authorization, token, fromDate, toDate) {
  const out = [];
  let cursor = fromDate;
  while (cursor <= toDate) {
    const chunkEnd = addDaysIso(cursor, MAX_KITE_DAYS_PER_REQUEST - 1);
    const end = chunkEnd > toDate ? toDate : chunkEnd;
    const rows = await fetchHistoricalCandles(authorization, token, cursor, end, 'day');
    out.push(...rows);
    cursor = addDaysIso(end, 1);
  }
  const seen = new Set();
  const deduped = [];
  for (const r of out) {
    if (seen.has(r.date)) continue;
    seen.add(r.date);
    deduped.push(r);
  }
  deduped.sort((a, b) => a.date.localeCompare(b.date));
  return deduped;
}

// Binary search for the last nifty close on or before dateStr.
function niftyCloseAsOf(niftyDates, niftyCloses, dateStr) {
  let lo = 0;
  let hi = niftyDates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (niftyDates[mid] <= dateStr) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 ? niftyCloses[ans] : null;
}

async function backtestStock(authorization, symbol, meta, fromDate, toDate, allocatedCapital, niftyDates, niftyCloses) {
  const warmFrom = addDaysIso(fromDate, -220);
  const candles = await fetchChunked(authorization, meta.token, warmFrom, toDate);
  if (candles.length < 150) return { symbol, trades: [] };

  let startIndex = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].date.slice(0, 10) >= fromDate) {
      startIndex = Math.max(i, ENTRY_LOOKBACK + RS_LOOKBACK + 5);
      break;
    }
  }

  let ema = null;
  let atr = null;
  const k = 2 / (TREND_EMA_LEN + 1);
  for (let i = 1; i < startIndex; i += 1) {
    const c = candles[i];
    const prev = candles[i - 1];
    ema = ema == null ? c.close : c.close * k + ema * (1 - k);
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    atr = atr == null ? tr : (atr * 13 + tr) / 14;
  }

  const trades = [];
  let open = null;

  for (let i = startIndex; i < candles.length; i += 1) {
    const c = candles[i];
    const prev = candles[i - 1];
    ema = ema == null ? c.close : c.close * k + ema * (1 - k);
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    atr = atr == null ? tr : (atr * 13 + tr) / 14;

    const day = c.date.slice(0, 10);
    if (day > toDate) break;

    const entryWindow = candles.slice(Math.max(0, i - ENTRY_LOOKBACK), i);
    const exitWindow = candles.slice(Math.max(0, i - EXIT_LOOKBACK), i);
    const entryHigh = Math.max(...entryWindow.map((b) => b.high));
    const entryLow = Math.min(...entryWindow.map((b) => b.low));
    const exitHigh = Math.max(...exitWindow.map((b) => b.high));
    const exitLow = Math.min(...exitWindow.map((b) => b.low));

    if (open) {
      let exitPrice = null;
      let reason = null;
      if (open.direction === 'long') {
        if (c.low <= open.stop) {
          exitPrice = open.stop;
          reason = 'Initial stop hit';
        } else if (c.close <= exitLow) {
          exitPrice = c.close;
          reason = `Closed below ${EXIT_LOOKBACK}d low — trail exit`;
        }
      } else {
        if (c.high >= open.stop) {
          exitPrice = open.stop;
          reason = 'Initial stop hit';
        } else if (c.close >= exitHigh) {
          exitPrice = c.close;
          reason = `Closed above ${EXIT_LOOKBACK}d high — trail exit`;
        }
      }
      if (exitPrice) {
        const gross =
          open.direction === 'long'
            ? (exitPrice - open.entry) * open.shares
            : (open.entry - exitPrice) * open.shares;
        const charges = estimateDeliveryRoundTripCharges({
          entryPrice: open.direction === 'long' ? open.entry : exitPrice,
          exitPrice: open.direction === 'long' ? exitPrice : open.entry,
          quantity: open.shares,
        });
        const net = Math.round((gross - charges.totalRs) * 100) / 100;
        trades.push({
          symbol,
          direction: open.direction,
          entryTime: open.entryTime,
          exitTime: c.date,
          entryPrice: open.entry,
          exitPrice,
          shares: open.shares,
          holdDays: i - open.entryIdx,
          grossRs: Math.round(gross * 100) / 100,
          chargesRs: charges.totalRs,
          netRs: net,
          reason,
        });
        open = null;
      }
      continue;
    }

    if (entryWindow.length < ENTRY_LOOKBACK) continue;

    // Relative-strength gate.
    const stockRef = candles[Math.max(0, i - RS_LOOKBACK)].close;
    const stockReturn = stockRef > 0 ? c.close / stockRef - 1 : 0;
    const niftyNow = niftyCloseAsOf(niftyDates, niftyCloses, day);
    const niftyThen = niftyCloseAsOf(niftyDates, niftyCloses, candles[Math.max(0, i - RS_LOOKBACK)].date.slice(0, 10));
    const niftyReturn = niftyNow && niftyThen && niftyThen > 0 ? niftyNow / niftyThen - 1 : null;
    const rsOk = niftyReturn != null;
    const outperforming = rsOk && stockReturn > niftyReturn;
    const underperforming = rsOk && stockReturn < niftyReturn;

    if (c.close > entryHigh && c.close > ema && outperforming) {
      const stop = c.close - atr * ATR_STOP_MULT;
      const shares = Math.max(1, Math.floor(allocatedCapital / c.close));
      open = { direction: 'long', entry: c.close, stop, shares, entryTime: c.date, entryIdx: i };
    } else if (c.close < entryLow && c.close < ema && underperforming) {
      const stop = c.close + atr * ATR_STOP_MULT;
      const shares = Math.max(1, Math.floor(allocatedCapital / c.close));
      open = { direction: 'short', entry: c.close, stop, shares, entryTime: c.date, entryIdx: i };
    }
  }

  return { symbol, trades };
}

async function main() {
  const [, , fromDate, toDate, capitalArg] = process.argv;
  const apiKey = process.env.KITE_API_KEY;
  const accessToken = process.env.KITE_ACCESS_TOKEN;
  if (!fromDate || !toDate) {
    console.error('Usage: node scripts/stock-trend-rs-backtest.js <fromDate> <toDate> [capitalRs]');
    process.exit(1);
  }
  if (!apiKey || !accessToken) {
    console.error('Set KITE_API_KEY and KITE_ACCESS_TOKEN');
    process.exit(1);
  }
  const totalCapital = Math.max(10000, Number(capitalArg) || 40000);
  const symbols = Object.keys(STOCKS);
  const allocatedPerStock = totalCapital / symbols.length;
  const authorization = `token ${apiKey}:${accessToken}`;

  console.error(
    `TREND+RS backtest: ${symbols.join(', ')} · Rs${totalCapital} total · daily bars · ` +
      `RS vs Nifty50 over ${RS_LOOKBACK}d`,
  );

  console.error('Fetching Nifty 50 index (daily)...');
  const niftyWarmFrom = addDaysIso(fromDate, -30);
  const niftyCandles = await fetchChunked(authorization, NIFTY_TOKEN, niftyWarmFrom, toDate);
  const niftyDates = niftyCandles.map((r) => r.date.slice(0, 10));
  const niftyCloses = niftyCandles.map((r) => r.close);

  const results = [];
  for (const sym of symbols) {
    console.error(`Fetching ${STOCKS[sym].label} (daily)...`);
    const r = await backtestStock(authorization, sym, STOCKS[sym], fromDate, toDate, allocatedPerStock, niftyDates, niftyCloses);
    console.error(`  ${sym}: ${r.trades.length} trades`);
    results.push(r);
  }

  const allTrades = results.flatMap((r) => r.trades);
  console.log(JSON.stringify({ fromDate, toDate, totalCapital, trades: allTrades }, null, 2));
}

main().catch((err) => {
  console.error('TREND_RS_BACKTEST_ERROR:', err.message, err.stack);
  process.exit(1);
});
