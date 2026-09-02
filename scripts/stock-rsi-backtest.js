#!/usr/bin/env node
/**
 * RSI(14) oversold/overbought mean-reversion — the last genuinely untested
 * classic mechanism this session. Buy when RSI dips below 30 then turns
 * back up (oversold turning), sell/short the mirror at 70 turning down.
 * Exit on reversion to the RSI midline (50), an ATR stop, or a time-stop.
 *
 * Distinct in kind from everything else tried: every prior mechanism
 * (Trap V2, ensemble, Donchian, crossovers, Fibonacci) traded WITH momentum
 * or a breakout. This is the only pure mean-reversion oscillator test.
 *
 * Daily bars, multi-day holds, delivery/CNC equity charges.
 *
 * Usage: node scripts/stock-rsi-backtest.js <fromDate> <toDate> [capitalRs]
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
const RSI_LEN = 14;
const RSI_OVERSOLD = 30;
const RSI_OVERBOUGHT = 70;
const RSI_EXIT_MID = 50;
const ATR_STOP_MULT = 2.5;
const MAX_HOLD_DAYS = 15;
const WARMUP_DAYS = 90;

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

// Wilder's RSI, computed causally bar-by-bar (state carried in closures below).
function makeRsiTracker(period) {
  let avgGain = null;
  let avgLoss = null;
  let prevClose = null;
  return function step(close) {
    if (prevClose == null) {
      prevClose = close;
      return null;
    }
    const change = close - prevClose;
    prevClose = close;
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);
    if (avgGain == null) {
      avgGain = gain;
      avgLoss = loss;
      return null;
    }
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  };
}

async function backtestStock(authorization, symbol, meta, fromDate, toDate, allocatedCapital) {
  const warmFrom = addDaysIso(fromDate, -WARMUP_DAYS);
  const candles = await fetchChunked(authorization, meta.token, warmFrom, toDate);
  if (candles.length < 60) return { symbol, trades: [] };

  let startIndex = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].date.slice(0, 10) >= fromDate) {
      startIndex = Math.max(i, RSI_LEN + 20);
      break;
    }
  }

  const rsiStep = makeRsiTracker(RSI_LEN);
  let atr = null;
  let prevRsi = null;
  for (let i = 0; i < startIndex; i += 1) {
    const c = candles[i];
    const rsi = rsiStep(c.close);
    if (i > 0) {
      const prev = candles[i - 1];
      const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
      atr = atr == null ? tr : (atr * 13 + tr) / 14;
    }
    prevRsi = rsi;
  }

  const trades = [];
  let open = null;

  for (let i = startIndex; i < candles.length; i += 1) {
    const c = candles[i];
    const prev = candles[i - 1];
    const rsi = rsiStep(c.close);
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    atr = atr == null ? tr : (atr * 13 + tr) / 14;

    const day = c.date.slice(0, 10);
    if (day > toDate) break;

    const turningUpFromOversold = prevRsi != null && prevRsi < RSI_OVERSOLD && rsi != null && rsi > prevRsi;
    const turningDownFromOverbought = prevRsi != null && prevRsi > RSI_OVERBOUGHT && rsi != null && rsi < prevRsi;

    if (open) {
      let exitPrice = null;
      let reason = null;
      const heldBars = i - open.entryIdx;
      if (open.direction === 'long') {
        if (c.low <= open.stop) {
          exitPrice = open.stop;
          reason = `${ATR_STOP_MULT}x ATR stop hit`;
        } else if (rsi != null && rsi >= RSI_EXIT_MID) {
          exitPrice = c.close;
          reason = 'RSI reverted to midline — exit';
        } else if (heldBars >= MAX_HOLD_DAYS) {
          exitPrice = c.close;
          reason = `Time stop (${MAX_HOLD_DAYS}d)`;
        }
      } else {
        if (c.high >= open.stop) {
          exitPrice = open.stop;
          reason = `${ATR_STOP_MULT}x ATR stop hit`;
        } else if (rsi != null && rsi <= RSI_EXIT_MID) {
          exitPrice = c.close;
          reason = 'RSI reverted to midline — exit';
        } else if (heldBars >= MAX_HOLD_DAYS) {
          exitPrice = c.close;
          reason = `Time stop (${MAX_HOLD_DAYS}d)`;
        }
      }
      if (exitPrice != null) {
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
          holdDays: heldBars,
          grossRs: Math.round(gross * 100) / 100,
          chargesRs: charges.totalRs,
          netRs: net,
          reason,
        });
        open = null;
      }
      prevRsi = rsi;
      continue;
    }

    if (turningUpFromOversold) {
      const stop = c.close - atr * ATR_STOP_MULT;
      const shares = Math.max(1, Math.floor(allocatedCapital / c.close));
      open = { direction: 'long', entry: c.close, stop, shares, entryTime: c.date, entryIdx: i };
    } else if (turningDownFromOverbought) {
      const stop = c.close + atr * ATR_STOP_MULT;
      const shares = Math.max(1, Math.floor(allocatedCapital / c.close));
      open = { direction: 'short', entry: c.close, stop, shares, entryTime: c.date, entryIdx: i };
    }
    prevRsi = rsi;
  }

  return { symbol, trades };
}

async function main() {
  const [, , fromDate, toDate, capitalArg] = process.argv;
  const apiKey = process.env.KITE_API_KEY;
  const accessToken = process.env.KITE_ACCESS_TOKEN;
  if (!fromDate || !toDate) {
    console.error('Usage: node scripts/stock-rsi-backtest.js <fromDate> <toDate> [capitalRs]');
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

  console.error(`RSI(14) mean-reversion backtest: ${symbols.join(', ')} · Rs${totalCapital} total · daily bars`);

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
  console.error('RSI_BACKTEST_ERROR:', err.message, err.stack);
  process.exit(1);
});
