#!/usr/bin/env node
/**
 * MA-pullback trend continuation — buy a dip to the rising 20-day MA within
 * an established uptrend (price above a rising 50-day MA), instead of a
 * breakout (Donchian) or a Fibonacci-ratio retracement. The distinguishing
 * idea vs. everything else tried: enter ON the moving-average touch itself,
 * not a fixed price channel or a swing-based ratio.
 *
 * Mechanism:
 *   Trend context: close > EMA50, and EMA50 higher than EMA50 20 bars ago
 *   (genuinely rising, not just currently above a flat/falling line).
 *   Pullback trigger: today's low touches within PULLBACK_TOL of EMA20
 *   (dips to or slightly through it) while closing back above EMA20 and
 *   above today's open (bullish reversal bar) -> long.
 *   Mirror for shorts in a falling-EMA50 downtrend.
 *   Exit: 2.5x ATR14 initial stop, or a trailing exit on a close back
 *   through the EXIT_LOOKBACK-day low/high (same trailing style as the
 *   Donchian trend script, for a like-for-like exit comparison).
 *
 * Daily bars, multi-day holds, delivery/CNC equity charges.
 *
 * Usage: node scripts/stock-ma-pullback-backtest.js <fromDate> <toDate> [capitalRs]
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
const EMA_FAST = 20;
const EMA_TREND = 50;
const TREND_SLOPE_LOOKBACK = 20;
const PULLBACK_TOL = 0.01; // 1% touch tolerance around EMA20
const ATR_STOP_MULT = 2.5;
const EXIT_LOOKBACK = 10;
const WARMUP_DAYS = 150;

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

function emaStep(prev, value, period) {
  const k = 2 / (period + 1);
  return prev == null ? value : value * k + prev * (1 - k);
}

async function backtestStock(authorization, symbol, meta, fromDate, toDate, allocatedCapital) {
  const warmFrom = addDaysIso(fromDate, -WARMUP_DAYS);
  const candles = await fetchChunked(authorization, meta.token, warmFrom, toDate);
  if (candles.length < 90) return { symbol, trades: [] };

  let startIndex = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].date.slice(0, 10) >= fromDate) {
      startIndex = Math.max(i, EMA_TREND + TREND_SLOPE_LOOKBACK + 5);
      break;
    }
  }

  let ema20 = null;
  let ema50 = null;
  let atr = null;
  const ema50History = []; // for the slope check
  for (let i = 0; i < startIndex; i += 1) {
    const c = candles[i];
    ema20 = emaStep(ema20, c.close, EMA_FAST);
    ema50 = emaStep(ema50, c.close, EMA_TREND);
    ema50History.push(ema50);
    if (i > 0) {
      const prev = candles[i - 1];
      const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
      atr = atr == null ? tr : (atr * 13 + tr) / 14;
    }
  }

  const trades = [];
  let open = null;

  for (let i = startIndex; i < candles.length; i += 1) {
    const c = candles[i];
    const prev = candles[i - 1];
    ema20 = emaStep(ema20, c.close, EMA_FAST);
    ema50 = emaStep(ema50, c.close, EMA_TREND);
    ema50History.push(ema50);
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    atr = atr == null ? tr : (atr * 13 + tr) / 14;

    const day = c.date.slice(0, 10);
    if (day > toDate) break;

    const ema50Then = ema50History[ema50History.length - 1 - TREND_SLOPE_LOOKBACK];
    const risingTrend = ema50Then != null && ema50 > ema50Then;
    const fallingTrend = ema50Then != null && ema50 < ema50Then;

    const exitWindow = candles.slice(Math.max(0, i - EXIT_LOOKBACK), i);
    const exitHigh = exitWindow.length ? Math.max(...exitWindow.map((b) => b.high)) : null;
    const exitLow = exitWindow.length ? Math.min(...exitWindow.map((b) => b.low)) : null;

    if (open) {
      let exitPrice = null;
      let reason = null;
      if (open.direction === 'long') {
        if (c.low <= open.stop) {
          exitPrice = open.stop;
          reason = `${ATR_STOP_MULT}x ATR stop hit`;
        } else if (exitLow != null && c.close <= exitLow) {
          exitPrice = c.close;
          reason = `Closed below ${EXIT_LOOKBACK}d low — trail exit`;
        }
      } else {
        if (c.high >= open.stop) {
          exitPrice = open.stop;
          reason = `${ATR_STOP_MULT}x ATR stop hit`;
        } else if (exitHigh != null && c.close >= exitHigh) {
          exitPrice = c.close;
          reason = `Closed above ${EXIT_LOOKBACK}d high — trail exit`;
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

    const bullishBar = c.close > c.open && c.close > ema20;
    const bearishBar = c.close < c.open && c.close < ema20;
    const touchedFromAbove = c.low <= ema20 * (1 + PULLBACK_TOL) && c.high >= ema20 * (1 - PULLBACK_TOL);

    if (risingTrend && c.close > ema50 && bullishBar && touchedFromAbove) {
      const stop = c.close - atr * ATR_STOP_MULT;
      const shares = Math.max(1, Math.floor(allocatedCapital / c.close));
      open = { direction: 'long', entry: c.close, stop, shares, entryTime: c.date, entryIdx: i };
    } else if (fallingTrend && c.close < ema50 && bearishBar && touchedFromAbove) {
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
    console.error('Usage: node scripts/stock-ma-pullback-backtest.js <fromDate> <toDate> [capitalRs]');
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

  console.error(`MA-pullback backtest: ${symbols.join(', ')} · Rs${totalCapital} total · daily bars`);

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
  console.error('MA_PULLBACK_BACKTEST_ERROR:', err.message, err.stack);
  process.exit(1);
});
