#!/usr/bin/env node
/**
 * Daily-bar trend-following on the 4 bank stocks — deliberately NOT another
 * variant of the kingdom voting ensemble. Five straight attempts on that
 * skeleton (intraday breakout, intraday soldiers-only, intraday S/R-bounce,
 * hourly swing, hourly swing + stricter entry) all converged to profit
 * factor 0.54-0.71. That convergence is itself evidence the ensemble design
 * doesn't have edge on these stocks - so this is a genuinely different,
 * much simpler, well-established method: classic Donchian-channel breakout
 * with ATR risk sizing (Turtle-style dual-channel trend following).
 *
 * Mechanism:
 *   Entry (long):  today's close > highest close of the last ENTRY_LOOKBACK
 *                  days, AND close > TREND_EMA (only take breakouts that
 *                  agree with the underlying trend).
 *   Entry (short):  mirror, below the low channel and below trend EMA.
 *   Initial stop:  ATR_STOP_MULT x daily ATR from entry (real protection
 *                  before the trail channel is close enough to matter).
 *   Trailing exit: once price closes back through the shorter EXIT_LOOKBACK
 *                  channel (e.g. a 10-day low for a long), exit at that
 *                  close. No fixed target - a real trend is ridden until it
 *                  actually reverses, which is the "bulk return" ask.
 *
 * Daily bars mean multi-day/multi-week holds are the norm, not the
 * exception - real overnight/weekend gap risk applies and is not modeled
 * (a backtest cannot see a gap that happens while markets are closed).
 *
 * Usage: node scripts/stock-trend-backtest.js <fromDate> <toDate> [capitalRs]
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

const MAX_KITE_DAYS_PER_REQUEST = 1900;
const ENTRY_LOOKBACK = 20; // Donchian entry channel
const EXIT_LOOKBACK = 10; // tighter Donchian exit/trail channel
const TREND_EMA_LEN = 100;
const ATR_STOP_MULT = 3.0;

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

async function backtestStock(authorization, symbol, meta, fromDate, toDate, allocatedCapital) {
  const warmFrom = addDaysIso(fromDate, -220); // enough for EMA100 + 20d channel to settle
  const candles = await fetchChunked(authorization, meta.token, warmFrom, toDate);
  if (candles.length < 150) return { symbol, trades: [] };

  let startIndex = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].date.slice(0, 10) >= fromDate) {
      startIndex = Math.max(i, ENTRY_LOOKBACK + 5);
      break;
    }
  }

  // Causal EMA100 + ATR14, updated incrementally
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
  let open = null; // {direction, entry, stop, shares, entryTime, entryIdx}

  for (let i = startIndex; i < candles.length; i += 1) {
    const c = candles[i];
    const prev = candles[i - 1];
    ema = ema == null ? c.close : c.close * k + ema * (1 - k);
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    atr = atr == null ? tr : (atr * 13 + tr) / 14;

    const day = c.date.slice(0, 10);
    if (day > toDate) break;

    // Channels computed from bars strictly BEFORE today (causal — today's own
    // high/low must never be in its own breakout reference).
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

    if (c.close > entryHigh && c.close > ema) {
      const stop = c.close - atr * ATR_STOP_MULT;
      const shares = Math.max(1, Math.floor(allocatedCapital / c.close));
      open = { direction: 'long', entry: c.close, stop, shares, entryTime: c.date, entryIdx: i };
    } else if (c.close < entryLow && c.close < ema) {
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
    console.error('Usage: node scripts/stock-trend-backtest.js <fromDate> <toDate> [capitalRs]');
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
    `TREND backtest: ${symbols.join(', ')} · Rs${totalCapital} total · daily bars · ` +
      `${ENTRY_LOOKBACK}d entry / ${EXIT_LOOKBACK}d exit channel · EMA${TREND_EMA_LEN} filter`,
  );

  const results = [];
  for (const sym of symbols) {
    console.error(`Fetching ${STOCKS[sym].label} (daily)...`);
    const r = await backtestStock(authorization, sym, STOCKS[sym], fromDate, toDate, allocatedPerStock);
    console.error(`  ${sym}: ${r.trades.length} trades`);
    results.push(r);
  }

  const allTrades = results.flatMap((r) => r.trades);
  console.log(JSON.stringify({ fromDate, toDate, totalCapital, trades: allTrades }, null, 2));
}

main().catch((err) => {
  console.error('TREND_BACKTEST_ERROR:', err.message, err.stack);
  process.exit(1);
});
