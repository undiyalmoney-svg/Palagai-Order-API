#!/usr/bin/env node
/**
 * GAP-FILL — genuinely untested in this session, and structurally the most
 * promising remaining category.
 *
 * Why it deserves a test after 28 failures:
 *   Every directional mechanism died because edge (~0.1-0.3%) was smaller
 *   than cost (~0.2-0.4%). A gap is a 0.5-2% dislocation. If gaps fill even
 *   55% of the time, the edge is 3-10x the cost floor — the same favourable
 *   ratio that made pairs cost-robust, but applied to a pattern that (unlike
 *   the pair spread) may actually have a real behavioural driver: overnight
 *   news overreaction being corrected once continuous trading resumes.
 *
 * Mechanism (deliberately simple — no indicator stack to overfit):
 *   At 09:15 open, measure gap% = (open - prevClose) / prevClose.
 *   Gap DOWN beyond threshold -> BUY at open, betting price rises to fill.
 *   Gap UP   beyond threshold -> SELL at open, betting price falls to fill.
 *   Target = previous close (the gap fully filled).
 *   Stop   = STOP_MULT x the gap size, beyond the open (gap keeps running).
 *   Else exit at 15:15 close. Intraday only -> intraday equity charges,
 *   no overnight risk, no delivery STT/DP.
 *
 * Discipline unchanged: threshold chosen on TRAIN only, verified untouched
 * on holdout, slippage swept before anything is called a win.
 *
 * Usage: node scripts/gap-fill-backtest.js
 */
const { fetchHistoricalCandles } = require('../live/kite-market');
const { estimateEquityRoundTripCharges } = require('../live/equity-charges');

const UNIVERSE = {
  HDFCBANK: 341249, ICICIBANK: 1270529, SBIN: 779521, KOTAKBANK: 492033,
  AXISBANK: 1510401, INDUSINDBK: 1346049, BANKBARODA: 1195009,
  TCS: 2953217, INFY: 408065, WIPRO: 969473, HCLTECH: 1850625,
  RELIANCE: 738561, IOC: 415745, BPCL: 134657, ONGC: 633601,
  TATASTEEL: 895745, JSWSTEEL: 3001089, HINDALCO: 348929,
  MARUTI: 2815745, M_M: 519937, BAJAJ_AUTO: 4267265, HEROMOTOCO: 345089,
  ITC: 424961, HINDUNILVR: 356865, BRITANNIA: 140033,
  ULTRACEMCO: 2952193, SUNPHARMA: 857857, CIPLA: 177665, DRREDDY: 225537,
  NTPC: 2977281, POWERGRID: 3834113, LT: 2939649, ADANIPORTS: 3861249,
  TITAN: 897537, ASIANPAINT: 60417, BHARTIARTL: 2714625, BAJFINANCE: 81153,
};

const TRAIN_FROM = '2021-08-22';
const TRAIN_TO = '2024-12-31';
const HOLD_TO = '2026-08-21';
const CAPITAL_PER_TRADE = 20000;
const MAX_KITE_DAYS = 90;
const STOP_MULT = 1.0; // stop at 1x gap size beyond the open

function addDays(d, n) {
  const [y, m, dd] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

async function fetch5m(auth, token, from, to) {
  const out = [];
  let cur = from;
  while (cur <= to) {
    const end = addDays(cur, MAX_KITE_DAYS - 1) > to ? to : addDays(cur, MAX_KITE_DAYS - 1);
    const rows = await fetchHistoricalCandles(auth, token, cur, end, '5minute');
    out.push(...rows);
    cur = addDays(end, 1);
  }
  return out;
}

/** Group 5-min bars into days. */
function groupDays(candles) {
  const days = new Map();
  for (const c of candles) {
    const d = c.date.slice(0, 10);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(c);
  }
  return [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function runStock(days, gapThreshold, slip) {
  const trades = [];
  for (let i = 1; i < days.length; i += 1) {
    const [date, bars] = days[i];
    const prevBars = days[i - 1][1];
    if (!bars.length || !prevBars.length) continue;
    const prevClose = prevBars[prevBars.length - 1].close;
    const open = bars[0].open;
    if (!(prevClose > 0) || !(open > 0)) continue;
    const gapPct = (open - prevClose) / prevClose;
    if (Math.abs(gapPct) < gapThreshold) continue;

    const dir = gapPct < 0 ? 1 : -1; // gap down -> buy; gap up -> sell
    const entry = dir === 1 ? open * (1 + slip) : open * (1 - slip);
    const target = prevClose; // fill the gap
    const gapSize = Math.abs(open - prevClose);
    const stop = dir === 1 ? open - gapSize * STOP_MULT : open + gapSize * STOP_MULT;
    const shares = Math.floor(CAPITAL_PER_TRADE / entry);
    if (shares < 1) continue;

    let exitPx = null;
    let reason = null;
    for (let b = 0; b < bars.length; b += 1) {
      const bar = bars[b];
      if (dir === 1) {
        if (bar.low <= stop) { exitPx = stop; reason = 'stop'; break; }
        if (bar.high >= target) { exitPx = target; reason = 'filled'; break; }
      } else {
        if (bar.high >= stop) { exitPx = stop; reason = 'stop'; break; }
        if (bar.low <= target) { exitPx = target; reason = 'filled'; break; }
      }
    }
    if (exitPx == null) { exitPx = bars[bars.length - 1].close; reason = 'eod'; }
    const exitAdj = dir === 1 ? exitPx * (1 - slip) : exitPx * (1 + slip);

    const gross = dir === 1 ? (exitAdj - entry) * shares : (entry - exitAdj) * shares;
    const charges = estimateEquityRoundTripCharges({
      entryPrice: dir === 1 ? entry : exitAdj,
      exitPrice: dir === 1 ? exitAdj : entry,
      quantity: shares,
    });
    trades.push({ date, gapPct, dir, gross, net: gross - charges.totalRs, reason });
  }
  return trades;
}

function stats(trades) {
  if (!trades.length) return { n: 0, net: 0, gross: 0, pf: 0, winPct: 0, fillPct: 0 };
  const wins = trades.filter((t) => t.net > 0);
  const gw = wins.reduce((a, t) => a + t.net, 0);
  const gl = Math.abs(trades.filter((t) => t.net <= 0).reduce((a, t) => a + t.net, 0));
  return {
    n: trades.length,
    net: trades.reduce((a, t) => a + t.net, 0),
    gross: trades.reduce((a, t) => a + t.gross, 0),
    pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    winPct: (100 * wins.length) / trades.length,
    fillPct: (100 * trades.filter((t) => t.reason === 'filled').length) / trades.length,
  };
}

async function main() {
  const auth = `token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}`;
  const symbols = Object.keys(UNIVERSE);
  const dayData = {};
  for (const sym of symbols) {
    try {
      console.error(`Fetching ${sym}...`);
      const c = await fetch5m(auth, UNIVERSE[sym], TRAIN_FROM, HOLD_TO);
      if (c.length > 1000) dayData[sym] = groupDays(c);
    } catch (e) { console.error(`  skip ${sym}: ${e.message}`); }
  }
  console.error(`\n${Object.keys(dayData).length} symbols loaded.\n`);

  const split = (days) => ({
    train: days.filter(([d]) => d <= TRAIN_TO),
    hold: days.filter(([d]) => d > TRAIN_TO),
  });

  console.log('THRESHOLD SCAN — chosen on TRAIN only (0.05% slippage/leg)\n');
  console.log('gap%    trainN  trainGross    trainNet   PF    win%  fill%');
  console.log('-'.repeat(64));
  const thresholds = [0.005, 0.0075, 0.01, 0.015, 0.02, 0.03];
  const trainResults = {};
  for (const th of thresholds) {
    const all = [];
    for (const sym of Object.keys(dayData)) all.push(...runStock(split(dayData[sym]).train, th, 0.0005));
    const s = stats(all);
    trainResults[th] = s;
    console.log(
      (th * 100).toFixed(2).padStart(5),
      String(s.n).padStart(8),
      `Rs${s.gross.toFixed(0)}`.padStart(11),
      `Rs${s.net.toFixed(0)}`.padStart(11),
      s.pf.toFixed(2).padStart(6),
      s.winPct.toFixed(0).padStart(6),
      s.fillPct.toFixed(0).padStart(6),
    );
  }

  // NOTE: every train threshold LOST money, so "best on train" only means
  // least-bad. Report ALL thresholds on holdout instead — that distinguishes a
  // systematic regime shift (all positive) from small-sample noise (one lucky row).
  console.log('HOLDOUT — ALL thresholds (0.05% slippage/leg)');
  console.log('gap%     holdN   holdGross     holdNet    PF    win%  fill%   trainPF');
  console.log('-'.repeat(74));
  for (const th of thresholds) {
    const all = [];
    for (const sym of Object.keys(dayData)) all.push(...runStock(split(dayData[sym]).hold, th, 0.0005));
    const s = stats(all);
    console.log(
      (th * 100).toFixed(2).padStart(5),
      String(s.n).padStart(8),
      `Rs${s.gross.toFixed(0)}`.padStart(11),
      `Rs${s.net.toFixed(0)}`.padStart(11),
      s.pf.toFixed(2).padStart(6),
      s.winPct.toFixed(0).padStart(6),
      s.fillPct.toFixed(0).padStart(6),
      trainResults[th].pf.toFixed(2).padStart(9),
    );
  }
}

main().catch((e) => { console.error('ERR:', e.message, e.stack); process.exit(1); });
