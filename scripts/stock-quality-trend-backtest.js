#!/usr/bin/env node
/**
 * Donchian-channel trend-following (identical mechanics to
 * stock-trend-backtest.js — entry/exit unchanged) applied to a DIFFERENT
 * stock universe and selection philosophy: 10 large-caps screened on
 * fundamentals (PEG ratio, debt-to-equity < 0.5, 5Y avg ROE > 0) from a
 * Tickertape "top swing trade stocks" screener snapshot (2025-05-28), not
 * the 4 bank stocks used everywhere else this session.
 *
 * Why trend-following specifically, not another mechanism: this basket was
 * selected for quality/growth characteristics (low debt, durable ROE,
 * reasonable growth-adjusted valuation) — Bharat Electronics, DMart, Trent,
 * DLF, SBI Life, HDFC Life, Varun Beverages, Godrej Consumer, Max
 * Healthcare, Tata Consumer. That is exactly the profile "ride the winner"
 * trend-following is built for, unlike the more cyclical/mean-reverting
 * bank-stock basket where the same mechanism was the WORST performer of
 * everything tried (PF 0.45-0.47). Testing it here isolates whether the
 * mechanism failed on banks specifically, or trend-following itself doesn't
 * hold up on this data/timeframe regardless of stock selection.
 *
 * Same train/holdout split, same real Kite daily data, same delivery/CNC
 * equity charges as every other test this session.
 *
 * Usage: node scripts/stock-quality-trend-backtest.js <fromDate> <toDate> [capitalRs]
 * Env:   KITE_API_KEY, KITE_ACCESS_TOKEN
 */
const { fetchHistoricalCandles } = require('../live/kite-market');
const { estimateDeliveryRoundTripCharges } = require('../live/equity-charges');

const STOCKS = {
  BEL: { token: 98049, label: 'Bharat Electronics' },
  DMART: { token: 5097729, label: 'Avenue Supermarts (DMart)' },
  TRENT: { token: 502785, label: 'Trent' },
  DLF: { token: 3771393, label: 'DLF' },
  SBILIFE: { token: 5582849, label: 'SBI Life Insurance' },
  HDFCLIFE: { token: 119553, label: 'HDFC Life Insurance' },
  VBL: { token: 4843777, label: 'Varun Beverages' },
  GODREJCP: { token: 2585345, label: 'Godrej Consumer Products' },
  MAXHEALTH: { token: 5728513, label: 'Max Healthcare' },
  TATACONSUM: { token: 878593, label: 'Tata Consumer Products' },
};

const MAX_KITE_DAYS_PER_REQUEST = 1900;
const ENTRY_LOOKBACK = 20;
const EXIT_LOOKBACK = 10;
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
  const warmFrom = addDaysIso(fromDate, -220);
  const candles = await fetchChunked(authorization, meta.token, warmFrom, toDate);
  if (candles.length < 150) return { symbol, trades: [] };

  let startIndex = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].date.slice(0, 10) >= fromDate) {
      startIndex = Math.max(i, ENTRY_LOOKBACK + 5);
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
    console.error('Usage: node scripts/stock-quality-trend-backtest.js <fromDate> <toDate> [capitalRs]');
    process.exit(1);
  }
  if (!apiKey || !accessToken) {
    console.error('Set KITE_API_KEY and KITE_ACCESS_TOKEN');
    process.exit(1);
  }
  const totalCapital = Math.max(50000, Number(capitalArg) || 200000);
  const symbols = Object.keys(STOCKS);
  const allocatedPerStock = totalCapital / symbols.length;
  const authorization = `token ${apiKey}:${accessToken}`;

  console.error(
    `QUALITY-TREND backtest: ${symbols.join(', ')} · Rs${totalCapital} total · daily bars · ` +
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
  console.error('QUALITY_TREND_BACKTEST_ERROR:', err.message, err.stack);
  process.exit(1);
});
