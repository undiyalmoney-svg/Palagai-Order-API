#!/usr/bin/env node
/**
 * A structurally DIFFERENT bet from everything tested this session so far.
 * Every prior mechanism (Trap V2, ensemble, Donchian, crossovers, RSI,
 * Fibonacci — 14 combinations total, on Nifty options and on stocks) was
 * DIRECTIONAL: buy/sell and hope price moves far enough, fast enough, to
 * outrun theta decay and costs. All 14 lost money or reversed sign.
 *
 * This is premium SELLING, not buying: a weekly Nifty iron condor —
 * sell an OTM call spread + sell an OTM put spread every week, collect the
 * combined credit, defined-risk (the long legs cap the loss on either side).
 * The edge this is testing for is the volatility risk premium (index
 * options' implied vol has historically averaged higher than what actually
 * realizes) — a real, documented, non-technical-pattern source of edge,
 * structurally unrelated to anything tried before.
 *
 * Mechanics:
 *   - Each calendar week: enter on the week's first trading day, expiry =
 *     week's last trading day (approximates the real NSE weekly Nifty
 *     expiry without hardcoding a holiday calendar).
 *   - Short strikes chosen by BS delta (~0.16 = classic "1 SD" weekly
 *     premium-selling strike), long strikes SPREAD_WIDTH points further OTM
 *     to cap max loss (fits small capital — see margin note at the end).
 *   - Entry priced via Black-Scholes using REALIZED volatility (21d) as the
 *     IV proxy — this is a real limitation: actual market IV usually runs
 *     above realized vol (the very premium this strategy is trying to
 *     harvest), so a realized-vol-priced backtest is a CONSERVATIVE proxy,
 *     not an optimistic one. Real weekly credit collected would likely be
 *     higher than what's computed here.
 *   - Exit is UNMANAGED — held to expiry every time, settled at the real
 *     Nifty close (no synthetic pricing needed for the exit side). No
 *     intra-week stop-loss or rolling. This is deliberate: it isolates the
 *     raw premium-selling edge before layering on any risk-management
 *     parameter that could be curve-fit. A real desk would manage this
 *     more actively; that would very likely change the numbers.
 *
 * Usage: node scripts/nifty-theta-backtest.js <fromDate> <toDate>
 * Env:   KITE_API_KEY, KITE_ACCESS_TOKEN
 */
const { fetchHistoricalCandles } = require('../live/kite-market');
const { blackScholesPrice, realizedVolAnnualized, normalCdf } = require('../live/bs-option-pricer');

const NIFTY_TOKEN = 256265;
const MAX_KITE_DAYS_PER_REQUEST = 1900;
const STRIKE_STEP = 50;
const TARGET_SHORT_DELTA = 0.16;
const SPREAD_WIDTH = 100;
const LOT_SIZE = 65; // matches bs-backtest.js precedent used elsewhere this session
const RISK_FREE_RATE = 0.065;
const CHARGE_PER_LEG_ROUNDTRIP_RS = 80; // user-provided real F&O estimate, used throughout this session
const LEGS_PER_CONDOR = 4; // sell call, buy call, sell put, buy put

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

function isoWeekKey(dateStr) {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00Z');
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function bsDelta(spot, strike, tYears, vol, r, type) {
  if (!(tYears > 0)) {
    if (type === 'CE') return spot > strike ? 1 : 0;
    return spot < strike ? -1 : 0;
  }
  const d1 = (Math.log(spot / strike) + (r + 0.5 * vol * vol) * tYears) / (vol * Math.sqrt(tYears));
  return type === 'CE' ? normalCdf(d1) : normalCdf(d1) - 1;
}

function nearestStrike(x) {
  return Math.round(x / STRIKE_STEP) * STRIKE_STEP;
}

function pickShortStrike(spot, tYears, vol, type) {
  // Scan candidate strikes outward from spot, pick the one whose |delta| is
  // closest to TARGET_SHORT_DELTA (classic "sell the X-delta strike").
  let best = null;
  let bestDiff = Infinity;
  for (let k = 1; k <= 60; k += 1) {
    const strike = type === 'CE' ? nearestStrike(spot) + k * STRIKE_STEP : nearestStrike(spot) - k * STRIKE_STEP;
    const delta = Math.abs(bsDelta(spot, strike, tYears, vol, RISK_FREE_RATE, type));
    const diff = Math.abs(delta - TARGET_SHORT_DELTA);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = strike;
    }
    if (delta < TARGET_SHORT_DELTA * 0.5) break; // gone far enough OTM, delta only shrinks further
  }
  return best;
}

async function backtest(authorization, fromDate, toDate) {
  const warmFrom = addDaysIso(fromDate, -40);
  const candles = await fetchChunked(authorization, NIFTY_TOKEN, warmFrom, toDate);
  const closes = candles.map((c) => c.close);

  let startIndex = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].date.slice(0, 10) >= fromDate) {
      startIndex = i;
      break;
    }
  }

  // Group trading days in range into ISO weeks.
  const weeks = new Map();
  for (let i = startIndex; i < candles.length; i += 1) {
    const day = candles[i].date.slice(0, 10);
    if (day > toDate) break;
    const key = isoWeekKey(day);
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key).push(i);
  }

  const trades = [];
  for (const [weekKey, idxs] of weeks) {
    if (idxs.length < 2) continue; // holiday-shortened single-day week, skip
    const entryIdx = idxs[0];
    const expiryIdx = idxs[idxs.length - 1];
    const entrySpot = candles[entryIdx].close;
    const expirySpot = candles[expiryIdx].close;
    const entryDate = candles[entryIdx].date;
    const expiryDate = candles[expiryIdx].date;
    const calendarDays = (new Date(expiryDate) - new Date(entryDate)) / 86400000;
    const tYears = Math.max(0.5 / 365, calendarDays / 365);
    const vol = realizedVolAnnualized(closes, entryIdx, 21);

    const shortCallStrike = pickShortStrike(entrySpot, tYears, vol, 'CE');
    const shortPutStrike = pickShortStrike(entrySpot, tYears, vol, 'PE');
    const longCallStrike = shortCallStrike + SPREAD_WIDTH;
    const longPutStrike = shortPutStrike - SPREAD_WIDTH;

    const shortCallPx = blackScholesPrice(entrySpot, shortCallStrike, tYears, vol, RISK_FREE_RATE, 'CE');
    const longCallPx = blackScholesPrice(entrySpot, longCallStrike, tYears, vol, RISK_FREE_RATE, 'CE');
    const shortPutPx = blackScholesPrice(entrySpot, shortPutStrike, tYears, vol, RISK_FREE_RATE, 'PE');
    const longPutPx = blackScholesPrice(entrySpot, longPutStrike, tYears, vol, RISK_FREE_RATE, 'PE');

    const creditCall = shortCallPx - longCallPx;
    const creditPut = shortPutPx - longPutPx;
    const totalCreditPts = creditCall + creditPut;

    const callSpreadPayoutPts = -Math.max(0, expirySpot - shortCallStrike) + Math.max(0, expirySpot - longCallStrike);
    const putSpreadPayoutPts = -Math.max(0, shortPutStrike - expirySpot) + Math.max(0, longPutStrike - expirySpot);

    const netPts = totalCreditPts + callSpreadPayoutPts + putSpreadPayoutPts;
    const grossRs = netPts * LOT_SIZE;
    const chargesRs = LEGS_PER_CONDOR * CHARGE_PER_LEG_ROUNDTRIP_RS;
    const netRs = Math.round((grossRs - chargesRs) * 100) / 100;

    const maxLossPts = SPREAD_WIDTH - totalCreditPts;

    trades.push({
      weekKey,
      entryDate,
      expiryDate,
      entrySpot,
      expirySpot,
      shortCallStrike,
      longCallStrike,
      shortPutStrike,
      longPutStrike,
      creditPts: Math.round(totalCreditPts * 100) / 100,
      netPts: Math.round(netPts * 100) / 100,
      grossRs: Math.round(grossRs * 100) / 100,
      chargesRs,
      netRs,
      maxLossRs: Math.round(maxLossPts * LOT_SIZE * 100) / 100,
      vol: Math.round(vol * 1000) / 1000,
    });
  }

  return trades;
}

async function main() {
  const [, , fromDate, toDate] = process.argv;
  const apiKey = process.env.KITE_API_KEY;
  const accessToken = process.env.KITE_ACCESS_TOKEN;
  if (!fromDate || !toDate) {
    console.error('Usage: node scripts/nifty-theta-backtest.js <fromDate> <toDate>');
    process.exit(1);
  }
  if (!apiKey || !accessToken) {
    console.error('Set KITE_API_KEY and KITE_ACCESS_TOKEN');
    process.exit(1);
  }
  const authorization = `token ${apiKey}:${accessToken}`;

  console.error(
    `Nifty weekly iron-condor (theta/premium-selling) backtest · target short delta ${TARGET_SHORT_DELTA} · ` +
      `spread width ${SPREAD_WIDTH}pts · lot ${LOT_SIZE}`,
  );
  console.error('Fetching Nifty 50 index (daily)...');
  const trades = await backtest(authorization, fromDate, toDate);
  console.error(`${trades.length} weekly condors`);

  console.log(JSON.stringify({ fromDate, toDate, lotSize: LOT_SIZE, spreadWidth: SPREAD_WIDTH, trades }, null, 2));
}

main().catch((err) => {
  console.error('NIFTY_THETA_BACKTEST_ERROR:', err.message, err.stack);
  process.exit(1);
});
