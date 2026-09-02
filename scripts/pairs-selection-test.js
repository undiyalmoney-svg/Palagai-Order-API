#!/usr/bin/env node
/**
 * Pairs stat-arb, round 2 — fixing the ACTUAL failure mode found in round 1.
 *
 * Round 1 result (scripts/pairs-statarb-backtest.js):
 *   Train PF 4.02 / holdout PF 0.97, BUT slippage barely mattered (train net
 *   fell only 30% going from 0% to 0.30% slippage, where every directional
 *   strategy this session INVERTED to a large loss at 0.05%). Conclusion:
 *   the cost-structure problem is genuinely solved by the pairs structure;
 *   what failed was PAIR SELECTION — top-15-by-train-P&L out of 165
 *   train-profitable candidates is textbook overfitting (picking the luckiest).
 *
 * This script tests selection rules that do NOT look at past P&L at all.
 * A pair's mean-reversion tendency is a STRUCTURAL property (cointegration
 * strength, half-life, correlation stability); selecting on that is a priori
 * far more likely to generalize than selecting on realized returns.
 *
 * Rules compared (all decided on TRAIN data only, verified on holdout):
 *   A. ALL cointegrated candidates, equally weighted  <- no selection at all
 *   B. Highest correlation
 *   C. Shortest half-life (fastest, most reliable reversion)
 *   D. Correlation STABILITY (corr holds up across both halves of train)
 *   E. Top-by-train-P&L                                <- round 1's rule, as control
 *
 * Honest guard: comparing 5 rules on the same holdout is itself a multiple-
 * comparison risk. So the a-priori favourite (D — stability, the only rule
 * that directly measures "does this relationship PERSIST") is named BEFORE
 * seeing results, and any other winner is treated as suggestive, not proven.
 *
 * Usage: node scripts/pairs-selection-test.js
 */
const { fetchHistoricalCandles } = require('../live/kite-market');

const UNIVERSE = {
  HDFCBANK: 341249, ICICIBANK: 1270529, SBIN: 779521, KOTAKBANK: 492033,
  AXISBANK: 1510401, INDUSINDBK: 1346049, BANKBARODA: 1195009, PNB: 2730497,
  FEDERALBNK: 261889, IDFCFIRSTB: 2863105,
  TCS: 2953217, INFY: 408065, WIPRO: 969473, HCLTECH: 1850625, TECHM: 3465729,
  RELIANCE: 738561, IOC: 415745, BPCL: 134657, ONGC: 633601,
  TATASTEEL: 895745, JSWSTEEL: 3001089, HINDALCO: 348929, SAIL: 758529,
  MARUTI: 2815745, M_M: 519937, BAJAJ_AUTO: 4267265, HEROMOTOCO: 345089,
  ITC: 424961, HINDUNILVR: 356865, BRITANNIA: 140033, DABUR: 197633,
  MARICO: 1041153, NESTLEIND: 4598529,
  ULTRACEMCO: 2952193, SHREECEM: 794369, AMBUJACEM: 325121,
  SUNPHARMA: 857857, CIPLA: 177665, DRREDDY: 225537, LUPIN: 2672641, AUROPHARMA: 70401,
  NTPC: 2977281, POWERGRID: 3834113, LT: 2939649, ADANIPORTS: 3861249,
};

const TRAIN_FROM = '2021-08-22';
const TRAIN_TO = '2024-12-31';
const HOLD_TO = '2026-08-21';

const ZSCORE_WINDOW = 60;
const ENTRY_Z = 2.0;
const EXIT_Z = 0.5;
const STOP_Z = 3.5;
const MAX_HOLD_DAYS = 30;
const CAPITAL_PER_LEG = 20000;
const N_SELECT = 15;

function pairRoundTripCharges(nA, nB) {
  let total = 0;
  for (const n of [nA, nB]) {
    const brokerage = Math.min(20, n * 0.0003) * 2;
    const stt = n * 0.0002;
    const exch = n * 2 * 0.0000345;
    const stamp = n * 0.00002;
    total += brokerage + stt + exch + stamp + (brokerage + exch) * 0.18;
  }
  return total;
}

function ols(x, y) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i += 1) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  return { beta: den === 0 ? 0 : num / den };
}

function halfLife(spread) {
  const lagged = spread.slice(0, -1);
  const delta = [];
  for (let i = 1; i < spread.length; i += 1) delta.push(spread[i] - spread[i - 1]);
  const { beta: lambda } = ols(lagged, delta);
  return lambda >= 0 ? Infinity : -Math.LN2 / lambda;
}

function corr(x, y) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i += 1) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy);
}

function simulatePair(dates, pxA, pxB, beta, slipPct) {
  const trades = [];
  const spread = pxA.map((a, i) => a - beta * pxB[i]);
  let open = null;
  for (let i = ZSCORE_WINDOW; i < spread.length; i += 1) {
    const win = spread.slice(i - ZSCORE_WINDOW, i);
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length);
    if (!(sd > 0)) continue;
    const z = (spread[i] - mean) / sd;
    if (open) {
      const held = i - open.i;
      if (Math.abs(z) <= EXIT_Z || Math.abs(z) >= STOP_Z || held >= MAX_HOLD_DAYS) {
        const aExit = open.dir === 1 ? pxA[i] * (1 - slipPct) : pxA[i] * (1 + slipPct);
        const bExit = open.dir === 1 ? pxB[i] * (1 + slipPct) : pxB[i] * (1 - slipPct);
        const pnlA = open.dir === 1 ? (aExit - open.aEntry) * open.qtyA : (open.aEntry - aExit) * open.qtyA;
        const pnlB = open.dir === 1 ? (open.bEntry - bExit) * open.qtyB : (bExit - open.bEntry) * open.qtyB;
        const gross = pnlA + pnlB;
        const charges = pairRoundTripCharges(open.aEntry * open.qtyA, open.bEntry * open.qtyB);
        trades.push({ entryDate: open.date, heldDays: held, gross, net: gross - charges });
        open = null;
      }
      continue;
    }
    if (Math.abs(z) >= ENTRY_Z) {
      const dir = z >= ENTRY_Z ? -1 : 1;
      const aEntry = dir === 1 ? pxA[i] * (1 + slipPct) : pxA[i] * (1 - slipPct);
      const bEntry = dir === 1 ? pxB[i] * (1 - slipPct) : pxB[i] * (1 + slipPct);
      const qtyA = Math.floor(CAPITAL_PER_LEG / aEntry);
      const qtyB = Math.floor(CAPITAL_PER_LEG / bEntry);
      if (qtyA < 1 || qtyB < 1) continue;
      open = { i, date: dates[i], dir, aEntry, bEntry, qtyA, qtyB };
    }
  }
  return trades;
}

function stats(trades) {
  if (!trades.length) return { n: 0, net: 0, pf: 0, winPct: 0, avgHeld: 0 };
  const wins = trades.filter((t) => t.net > 0);
  const gw = wins.reduce((a, t) => a + t.net, 0);
  const gl = Math.abs(trades.filter((t) => t.net <= 0).reduce((a, t) => a + t.net, 0));
  return {
    n: trades.length,
    net: trades.reduce((a, t) => a + t.net, 0),
    pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    winPct: (100 * wins.length) / trades.length,
    avgHeld: trades.reduce((a, t) => a + t.heldDays, 0) / trades.length,
  };
}

async function main() {
  const auth = `token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}`;
  const symbols = Object.keys(UNIVERSE);
  const data = {};
  console.error('Fetching...');
  for (const sym of symbols) {
    try {
      const rows = await fetchHistoricalCandles(auth, UNIVERSE[sym], TRAIN_FROM, HOLD_TO, 'day');
      if (rows.length > 500) data[sym] = rows;
    } catch (e) { /* skip */ }
  }
  const good = Object.keys(data);
  const dateSets = good.map((s) => new Set(data[s].map((r) => r.date.slice(0, 10))));
  const dates = [...dateSets[0]].filter((d) => dateSets.every((s) => s.has(d))).sort();
  const px = {};
  for (const s of good) {
    const m = new Map(data[s].map((r) => [r.date.slice(0, 10), r.close]));
    px[s] = dates.map((d) => m.get(d));
  }
  const trainIdx = dates.filter((d) => d <= TRAIN_TO).length;
  const half = Math.floor(trainIdx / 2);

  // Build candidates using TRAIN data only.
  const cands = [];
  for (let i = 0; i < good.length; i += 1) {
    for (let j = i + 1; j < good.length; j += 1) {
      const A = good[i], B = good[j];
      const aT = px[A].slice(0, trainIdx), bT = px[B].slice(0, trainIdx);
      const c = corr(aT, bT);
      if (Math.abs(c) < 0.7) continue;
      const { beta } = ols(bT, aT);
      if (!(beta > 0)) continue;
      const hl = halfLife(aT.map((a, k) => a - beta * bT[k]));
      if (!(hl >= 2 && hl <= 40)) continue;
      // Correlation stability: does the relationship hold in BOTH halves of train?
      const c1 = corr(aT.slice(0, half), bT.slice(0, half));
      const c2 = corr(aT.slice(half), bT.slice(half));
      const stability = Math.min(c1, c2); // weakest half governs
      const trainStats = stats(simulatePair(dates.slice(0, trainIdx), aT, bT, beta, 0));
      cands.push({ A, B, beta, corr: c, halfLife: hl, stability, trainStats });
    }
  }
  console.error(`${cands.length} candidates.\n`);

  const rules = {
    'A. ALL (no selection)': [...cands],
    'B. Highest correlation': [...cands].sort((a, b) => b.corr - a.corr).slice(0, N_SELECT),
    'C. Shortest half-life': [...cands].sort((a, b) => a.halfLife - b.halfLife).slice(0, N_SELECT),
    'D. Corr stability (a-priori pick)': [...cands].sort((a, b) => b.stability - a.stability).slice(0, N_SELECT),
    'E. Top train P&L (round-1 control)': [...cands].sort((a, b) => b.trainStats.net - a.trainStats.net).slice(0, N_SELECT),
  };

  console.log('Selection rule                        nPairs |  TRAIN net    PF   |  HOLDOUT net    PF   trades  win%  avgHeld');
  console.log('-'.repeat(112));
  for (const [name, sel] of Object.entries(rules)) {
    const trainAll = [], holdAll = [];
    for (const c of sel) {
      trainAll.push(...simulatePair(dates.slice(0, trainIdx), px[c.A].slice(0, trainIdx), px[c.B].slice(0, trainIdx), c.beta, 0.001));
      const st = trainIdx - ZSCORE_WINDOW;
      holdAll.push(...simulatePair(dates.slice(st), px[c.A].slice(st), px[c.B].slice(st), c.beta, 0.001).filter((t) => t.entryDate > TRAIN_TO));
    }
    const ts = stats(trainAll), hs = stats(holdAll);
    console.log(
      name.padEnd(36),
      String(sel.length).padStart(6),
      ' |',
      `Rs${ts.net.toFixed(0)}`.padStart(11),
      ts.pf.toFixed(2).padStart(6),
      ' |',
      `Rs${hs.net.toFixed(0)}`.padStart(12),
      hs.pf.toFixed(2).padStart(6),
      String(hs.n).padStart(7),
      hs.winPct.toFixed(0).padStart(5),
      hs.avgHeld.toFixed(1).padStart(8),
    );
  }
  console.log('\n(all figures at 0.10% slippage per leg — deliberately pessimistic)');
}

main().catch((e) => { console.error('ERR:', e.message, e.stack); process.exit(1); });
