#!/usr/bin/env node
/**
 * Pure moving-average / MACD crossover as the ENTRY TRIGGER ITSELF — not a
 * filter layered on another mechanism, the way every prior stock test used
 * MA/EMA (Donchian's EMA100 trend filter, Trap V2's EMA bias check). This is
 * the plain textbook version: SMA(10) crossing SMA(20), or MACD(12,26,9)
 * line crossing its signal line, is the whole system.
 *
 * Exit: whichever comes first — the crossover reversing (classic
 * trend-following exit: ride until the signal that got you in un-fires), or
 * a 2x-ATR14 stop (protective floor; none of the source articles specify
 * one, but running with no stop at all is not a defensible real design).
 * No fixed target — a crossover system is meant to ride the move.
 *
 * Daily bars, multi-day holds (matches every "swing trading" article this
 * was sourced from describing 3-10+ day holds) — delivery/CNC equity
 * charges apply, not intraday.
 *
 * Usage: node scripts/stock-crossover-backtest.js <fromDate> <toDate> [capitalRs]
 * Env:   KITE_API_KEY, KITE_ACCESS_TOKEN, STRATEGY=sma|macd (default sma)
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
const STRATEGY = (process.env.STRATEGY || 'sma').toLowerCase(); // 'sma' | 'macd'
const SMA_FAST = 10;
const SMA_SLOW = 20;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const ATR_STOP_MULT = 2.0;
const WARMUP_DAYS = 220; // enough for MACD(26) + signal(9) or SMA20 to fully settle

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
  if (candles.length < 60) return { symbol, trades: [] };

  let startIndex = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].date.slice(0, 10) >= fromDate) {
      startIndex = Math.max(i, MACD_SLOW + MACD_SIGNAL + 5);
      break;
    }
  }

  // Causal SMA10/20, EMA12/26 + MACD signal EMA9, and ATR14 — all warmed up
  // to startIndex before the reporting window begins.
  let atr = null;
  let emaFast = null;
  let emaSlow = null;
  let macdSignal = null;
  let prevFastMinusSlow = null; // SMA10 - SMA20 last bar (for crossover detection)
  let prevMacdMinusSignal = null; // MACD - signal last bar

  function sma(period, uptoIndexInclusive) {
    let sum = 0;
    for (let k = uptoIndexInclusive - period + 1; k <= uptoIndexInclusive; k += 1) sum += candles[k].close;
    return sum / period;
  }

  for (let i = 1; i < startIndex; i += 1) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    atr = atr == null ? tr : (atr * 13 + tr) / 14;
    emaFast = emaStep(emaFast, c.close, MACD_FAST);
    emaSlow = emaStep(emaSlow, c.close, MACD_SLOW);
    if (i >= MACD_SLOW) {
      const macd = emaFast - emaSlow;
      macdSignal = emaStep(macdSignal, macd, MACD_SIGNAL);
    }
    if (i >= SMA_SLOW) {
      prevFastMinusSlow = sma(SMA_FAST, i) - sma(SMA_SLOW, i);
    }
    if (i >= MACD_SLOW && macdSignal != null) {
      prevMacdMinusSignal = emaFast - emaSlow - macdSignal;
    }
  }

  const trades = [];
  let open = null; // {direction, entry, stop, shares, entryTime, entryIdx}

  for (let i = startIndex; i < candles.length; i += 1) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    atr = atr == null ? tr : (atr * 13 + tr) / 14;
    emaFast = emaStep(emaFast, c.close, MACD_FAST);
    emaSlow = emaStep(emaSlow, c.close, MACD_SLOW);
    const macd = emaFast - emaSlow;
    macdSignal = emaStep(macdSignal, macd, MACD_SIGNAL);

    const day = c.date.slice(0, 10);
    if (day > toDate) break;

    const fastMinusSlow = sma(SMA_FAST, i) - sma(SMA_SLOW, i);
    const macdMinusSignal = macd - macdSignal;

    const smaCrossUp = prevFastMinusSlow != null && prevFastMinusSlow <= 0 && fastMinusSlow > 0;
    const smaCrossDown = prevFastMinusSlow != null && prevFastMinusSlow >= 0 && fastMinusSlow < 0;
    const macdCrossUp = prevMacdMinusSignal != null && prevMacdMinusSignal <= 0 && macdMinusSignal > 0;
    const macdCrossDown = prevMacdMinusSignal != null && prevMacdMinusSignal >= 0 && macdMinusSignal < 0;

    const crossUp = STRATEGY === 'macd' ? macdCrossUp : smaCrossUp;
    const crossDown = STRATEGY === 'macd' ? macdCrossDown : smaCrossDown;

    prevFastMinusSlow = fastMinusSlow;
    prevMacdMinusSignal = macdMinusSignal;

    if (open) {
      let exitPrice = null;
      let reason = null;
      if (open.direction === 'long') {
        if (c.low <= open.stop) {
          exitPrice = open.stop;
          reason = `${ATR_STOP_MULT}x ATR stop hit`;
        } else if (crossDown) {
          exitPrice = c.close;
          reason = `${STRATEGY === 'macd' ? 'MACD' : 'SMA'} crossed down — exit`;
        }
      } else {
        if (c.high >= open.stop) {
          exitPrice = open.stop;
          reason = `${ATR_STOP_MULT}x ATR stop hit`;
        } else if (crossUp) {
          exitPrice = c.close;
          reason = `${STRATEGY === 'macd' ? 'MACD' : 'SMA'} crossed up — exit`;
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

    if (crossUp) {
      const stop = c.close - atr * ATR_STOP_MULT;
      const shares = Math.max(1, Math.floor(allocatedCapital / c.close));
      open = { direction: 'long', entry: c.close, stop, shares, entryTime: c.date, entryIdx: i };
    } else if (crossDown) {
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
    console.error('Usage: node scripts/stock-crossover-backtest.js <fromDate> <toDate> [capitalRs]');
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
    `${STRATEGY.toUpperCase()} crossover backtest: ${symbols.join(', ')} · Rs${totalCapital} total · daily bars`,
  );

  const results = [];
  for (const sym of symbols) {
    console.error(`Fetching ${STOCKS[sym].label} (daily)...`);
    const r = await backtestStock(authorization, sym, STOCKS[sym], fromDate, toDate, allocatedPerStock);
    console.error(`  ${sym}: ${r.trades.length} trades`);
    results.push(r);
  }

  const allTrades = results.flatMap((r) => r.trades);
  console.log(JSON.stringify({ fromDate, toDate, totalCapital, strategy: STRATEGY, trades: allTrades }, null, 2));
}

main().catch((err) => {
  console.error('CROSSOVER_BACKTEST_ERROR:', err.message, err.stack);
  process.exit(1);
});
