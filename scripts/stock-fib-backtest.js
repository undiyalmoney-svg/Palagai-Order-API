#!/usr/bin/env node
/**
 * Fibonacci-retracement bounce — buy a pullback into the 50-61.8% "golden
 * zone" of the most recent confirmed swing leg, instead of Trap V2's
 * observed swing-high/low S/R level. Different anchor (a fixed ratio of the
 * move, not a price level the market itself printed), same "buy the bounce"
 * family — genuinely untested this session.
 *
 * Mechanism:
 *   1. Confirmed pivots (PIVOT_LB bars either side, so detection lags by
 *      PIVOT_LB bars — no lookahead) define swing highs/lows.
 *   2. An up-leg (swing low -> swing high) sets the retracement zone for
 *      LONGS: 50-61.8% back down from the high. A bullish reversal bar
 *      closing back inside that zone, with price still above a rising
 *      EMA50 (overall uptrend context, same filter family as the other
 *      scripts), triggers entry.
 *   3. Mirror for SHORTS off a down-leg (swing high -> swing low), 50-61.8%
 *      bounce back up, bearish reversal bar, price below falling EMA50.
 *   4. Stop: the 78.6% retracement level (deeper pullback invalidates the
 *      setup) is the classic placement. Target: retest the swing extreme
 *      (100% retracement) — first target, no extension leg.
 *   5. Time-stop: MAX_HOLD_DAYS bars with no resolution exits at market
 *      close (real capital shouldn't sit in a chop indefinitely).
 *
 * Daily bars, multi-day holds, delivery/CNC equity charges.
 *
 * Usage: node scripts/stock-fib-backtest.js <fromDate> <toDate> [capitalRs]
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
const PIVOT_LB = 5;
const EMA_LEN = 50;
const FIB_ZONE_LO = 0.5;
const FIB_ZONE_HI = 0.618;
const FIB_STOP = 0.786;
const MAX_HOLD_DAYS = 15;
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
  if (candles.length < 80) return { symbol, trades: [] };

  let startIndex = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].date.slice(0, 10) >= fromDate) {
      startIndex = Math.max(i, PIVOT_LB * 2 + 5);
      break;
    }
  }

  let ema = null;
  for (let i = 0; i < startIndex; i += 1) ema = emaStep(ema, candles[i].close, EMA_LEN);

  // Confirmed swing pivots (lag PIVOT_LB bars behind the current bar).
  let lastPivotLow = null; // {price, idx}
  let lastPivotHigh = null;
  function isPivotHigh(idx) {
    const c = candles[idx];
    for (let k = idx - PIVOT_LB; k <= idx + PIVOT_LB; k += 1) {
      if (k === idx || k < 0 || k >= candles.length) continue;
      if (candles[k].high >= c.high) return false;
    }
    return true;
  }
  function isPivotLow(idx) {
    const c = candles[idx];
    for (let k = idx - PIVOT_LB; k <= idx + PIVOT_LB; k += 1) {
      if (k === idx || k < 0 || k >= candles.length) continue;
      if (candles[k].low <= c.low) return false;
    }
    return true;
  }
  // Seed pivot state up to startIndex using bars confirmable by then.
  for (let i = PIVOT_LB; i < startIndex - PIVOT_LB; i += 1) {
    if (isPivotHigh(i)) lastPivotHigh = { price: candles[i].high, idx: i };
    if (isPivotLow(i)) lastPivotLow = { price: candles[i].low, idx: i };
  }

  const trades = [];
  let open = null;

  for (let i = startIndex; i < candles.length; i += 1) {
    const c = candles[i];
    ema = emaStep(ema, c.close, EMA_LEN);
    const day = c.date.slice(0, 10);
    if (day > toDate) break;

    // Confirm any pivot that becomes final PIVOT_LB bars ago.
    const confirmIdx = i - PIVOT_LB;
    if (confirmIdx >= 0) {
      if (isPivotHigh(confirmIdx)) lastPivotHigh = { price: candles[confirmIdx].high, idx: confirmIdx };
      if (isPivotLow(confirmIdx)) lastPivotLow = { price: candles[confirmIdx].low, idx: confirmIdx };
    }

    if (open) {
      let exitPrice = null;
      let reason = null;
      const heldBars = i - open.entryIdx;
      if (open.direction === 'long') {
        if (c.low <= open.stop) {
          exitPrice = open.stop;
          reason = '78.6% stop hit';
        } else if (c.high >= open.target) {
          exitPrice = open.target;
          reason = 'Retest swing high — target hit';
        } else if (heldBars >= MAX_HOLD_DAYS) {
          exitPrice = c.close;
          reason = `Time stop (${MAX_HOLD_DAYS}d)`;
        }
      } else {
        if (c.high >= open.stop) {
          exitPrice = open.stop;
          reason = '78.6% stop hit';
        } else if (c.low <= open.target) {
          exitPrice = open.target;
          reason = 'Retest swing low — target hit';
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
      continue;
    }

    if (!lastPivotLow || !lastPivotHigh) continue;

    const bullishBar = c.close > c.open && c.close > candles[i - 1].close;
    const bearishBar = c.close < c.open && c.close < candles[i - 1].close;

    // Up-leg: low occurred before high -> retracement zone measured DOWN from the high.
    if (lastPivotLow.idx < lastPivotHigh.idx && c.close > ema) {
      const legRange = lastPivotHigh.price - lastPivotLow.price;
      if (legRange > 0) {
        const zoneHi = lastPivotHigh.price - legRange * FIB_ZONE_LO;
        const zoneLo = lastPivotHigh.price - legRange * FIB_ZONE_HI;
        const stopLevel = lastPivotHigh.price - legRange * FIB_STOP;
        if (bullishBar && c.close >= zoneLo && c.close <= zoneHi && c.low > stopLevel) {
          const shares = Math.max(1, Math.floor(allocatedCapital / c.close));
          open = {
            direction: 'long',
            entry: c.close,
            stop: stopLevel,
            target: lastPivotHigh.price,
            shares,
            entryTime: c.date,
            entryIdx: i,
          };
          continue;
        }
      }
    }

    // Down-leg: high occurred before low -> retracement zone measured UP from the low.
    if (lastPivotHigh.idx < lastPivotLow.idx && c.close < ema) {
      const legRange = lastPivotHigh.price - lastPivotLow.price;
      if (legRange > 0) {
        const zoneLo = lastPivotLow.price + legRange * FIB_ZONE_LO;
        const zoneHi = lastPivotLow.price + legRange * FIB_ZONE_HI;
        const stopLevel = lastPivotLow.price + legRange * FIB_STOP;
        if (bearishBar && c.close >= zoneLo && c.close <= zoneHi && c.high < stopLevel) {
          const shares = Math.max(1, Math.floor(allocatedCapital / c.close));
          open = {
            direction: 'short',
            entry: c.close,
            stop: stopLevel,
            target: lastPivotLow.price,
            shares,
            entryTime: c.date,
            entryIdx: i,
          };
          continue;
        }
      }
    }
  }

  return { symbol, trades };
}

async function main() {
  const [, , fromDate, toDate, capitalArg] = process.argv;
  const apiKey = process.env.KITE_API_KEY;
  const accessToken = process.env.KITE_ACCESS_TOKEN;
  if (!fromDate || !toDate) {
    console.error('Usage: node scripts/stock-fib-backtest.js <fromDate> <toDate> [capitalRs]');
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

  console.error(`Fibonacci retracement backtest: ${symbols.join(', ')} · Rs${totalCapital} total · daily bars`);

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
  console.error('FIB_BACKTEST_ERROR:', err.message, err.stack);
  process.exit(1);
});
