#!/usr/bin/env node
/**
 * Same overnight-anomaly test as run on Nifty (buy at close, sell at next
 * open, every trading day) — applied to real individual low-priced NSE
 * stocks instead of the index. Two open questions this answers honestly:
 *   1. Do these stocks even have a real overnight edge, and is it bigger
 *      than Nifty's (0.073%/trade — smaller than the 0.20% round-trip STT
 *      that killed the index version)?
 *   2. Does a lower share PRICE change the economics at all? (It shouldn't,
 *      mechanically — STT is a % of notional, DP is flat per scrip
 *      regardless of price, so a "cheap" stock doesn't dodge either cost.
 *      Only a genuinely BIGGER raw overnight edge would help.)
 *
 * Uses each stock's own real historical OHLC (no synthetic construction
 * needed here — unlike the Nifty ETF, individual stocks' own open/close
 * prints are real, liquid trades, not thin opening-auction noise).
 *
 * Usage: node scripts/overnight-cheap-stocks.js <fromDate> <toDate> [capitalRs]
 * Env:   KITE_API_KEY, KITE_ACCESS_TOKEN
 */
const { fetchHistoricalCandles } = require('../live/kite-market');
const { estimateDeliveryRoundTripCharges } = require('../live/equity-charges');

const STOCKS = {
  PNB: { token: 2730497, label: 'Punjab National Bank' },
  IDFCFIRSTB: { token: 2863105, label: 'IDFC First Bank' },
  YESBANK: { token: 3050241, label: 'Yes Bank' },
  SUZLON: { token: 3076609, label: 'Suzlon Energy' },
  IDEA: { token: 3677697, label: 'Vodafone Idea' },
  TATASTEEL: { token: 895745, label: 'Tata Steel' },
  NHPC: { token: 4454401, label: 'NHPC' },
  IRFC: { token: 519425, label: 'Indian Railway Finance Corp' },
  IOC: { token: 415745, label: 'Indian Oil Corp' },
  BHEL: { token: 112129, label: 'BHEL' },
  SAIL: { token: 758529, label: 'Steel Authority of India' },
  RVNL: { token: 2445313, label: 'Rail Vikas Nigam' },
};

const MAX_KITE_DAYS_PER_REQUEST = 1900;

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

async function analyzeStock(authorization, symbol, meta, fromDate, toDate, capital) {
  const candles = await fetchChunked(authorization, meta.token, fromDate, toDate);
  if (candles.length < 30) return null;

  const trades = [];
  for (let i = 1; i < candles.length; i += 1) {
    trades.push({ buy: candles[i - 1].close, sell: candles[i].open });
  }

  const rawReturns = trades.map((t) => t.sell / t.buy - 1);
  const meanRaw = rawReturns.reduce((a, b) => a + b, 0) / rawReturns.length;
  const winPct = (100 * rawReturns.filter((r) => r > 0).length) / rawReturns.length;

  let overnightCompound = 1;
  for (const r of rawReturns) overnightCompound *= 1 + r;

  // Fixed-notional (non-compounding) realistic P&L at the given capital.
  let totalGross = 0;
  let totalCharges = 0;
  let tradedDays = 0;
  for (const t of trades) {
    const shares = Math.floor(capital / t.buy);
    if (shares < 1) continue;
    tradedDays += 1;
    const gross = (t.sell - t.buy) * shares;
    const charges = estimateDeliveryRoundTripCharges({ entryPrice: t.buy, exitPrice: t.sell, quantity: shares });
    totalGross += gross;
    totalCharges += charges.totalRs;
  }
  const totalNet = totalGross - totalCharges;
  const years = (new Date(candles[candles.length - 1].date) - new Date(candles[0].date)) / (365.25 * 86400000);

  return {
    symbol,
    label: meta.label,
    lastPrice: candles[candles.length - 1].close,
    tradedDays,
    totalTradingDays: trades.length,
    meanRawPct: meanRaw * 100,
    winPct,
    overnightCompoundPct: (overnightCompound - 1) * 100,
    totalGross: Math.round(totalGross),
    totalCharges: Math.round(totalCharges),
    totalNet: Math.round(totalNet),
    annualPctOnCapital: (100 * totalNet) / capital / years,
  };
}

async function main() {
  const [, , fromDate, toDate, capitalArg] = process.argv;
  const apiKey = process.env.KITE_API_KEY;
  const accessToken = process.env.KITE_ACCESS_TOKEN;
  if (!fromDate || !toDate) {
    console.error('Usage: node scripts/overnight-cheap-stocks.js <fromDate> <toDate> [capitalRs]');
    process.exit(1);
  }
  const capital = Math.max(5000, Number(capitalArg) || 40000);
  const authorization = `token ${apiKey}:${accessToken}`;

  const results = [];
  for (const [sym, meta] of Object.entries(STOCKS)) {
    console.error(`Fetching ${meta.label}...`);
    const r = await analyzeStock(authorization, sym, meta, fromDate, toDate, capital);
    if (r) results.push(r);
  }

  results.sort((a, b) => b.meanRawPct - a.meanRawPct);
  console.log(
    'Symbol'.padEnd(12),
    'Price'.padStart(8),
    'MeanRaw%'.padStart(9),
    'Win%'.padStart(6),
    'CompoundedRawReturn%'.padStart(20),
    'RealNet(Rs)'.padStart(12),
    'Real%/yr'.padStart(9),
  );
  for (const r of results) {
    console.log(
      r.symbol.padEnd(12),
      r.lastPrice.toFixed(0).padStart(8),
      r.meanRawPct.toFixed(4).padStart(9),
      r.winPct.toFixed(1).padStart(6),
      r.overnightCompoundPct.toFixed(1).padStart(20),
      r.totalNet.toFixed(0).padStart(12),
      r.annualPctOnCapital.toFixed(1).padStart(9),
    );
  }
  console.log('\n(STT alone is 0.20% round-trip, fixed — MeanRaw% must clear that just to break even before other costs)');
}

main().catch((err) => {
  console.error('OVERNIGHT_CHEAP_ERROR:', err.message, err.stack);
  process.exit(1);
});
