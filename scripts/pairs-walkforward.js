#!/usr/bin/env node
/**
 * Pairs stat-arb, round 3 — WALK-FORWARD. The decisive test.
 *
 * Rounds 1-2 established two things:
 *   (a) The cost problem IS solved by the pairs structure. Going from 0% to
 *       0.30% slippage cut train profit by only ~30%, where every directional
 *       strategy this session INVERTED into a large loss at 0.05%. That is a
 *       real, structural finding: ~15-day holds on spread-sized moves give an
 *       edge/cost ratio roughly 10x better than any intraday mechanism.
 *   (b) The 2021-24 -> 2025-26 single split showed holdout PF 0.84-0.99 under
 *       EVERY selection rule including "no selection", so the failure was NOT
 *       selection overfitting — the spread edge itself was absent in 2025-26.
 *
 * Open question this answers: is the pairs edge DEAD, or REGIME-DEPENDENT?
 * A single holdout window cannot distinguish "never worked" from "worked
 * until 2025". Walk-forward can: re-estimate beta and pair set on each
 * trailing window, trade the next window out-of-sample, repeat. Every trade
 * counted is out-of-sample by construction.
 *
 * No selection on P&L anywhere — all cointegrated candidates are traded, so
 * there is no cherry-picking left to explain a result either way.
 *
 * Usage: node scripts/pairs-walkforward.js
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

const FROM = '2021-08-22';
const TO = '2026-08-21';
const FORMATION_DAYS = 250; // ~1 year trailing to fit beta + screen cointegration
const TRADING_DAYS = 125;   // ~6 months traded out-of-sample, then re-fit
const ZSCORE_WINDOW = 60;
const ENTRY_Z = 2.0;
const EXIT_Z = 0.5;
const STOP_Z = 3.5;
const MAX_HOLD_DAYS = 30;
const CAPITAL_PER_LEG = 20000;
const SLIP = 0.001; // 0.10% per leg — pessimistic

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

/**
 * Trade one pair across [startIdx, endIdx). Rolling z-stats are seeded from
 * the ZSCORE_WINDOW bars immediately BEFORE startIdx (formation period data,
 * already known at that point) — no future information is used.
 */
function simulateWindow(dates, pxA, pxB, beta, startIdx, endIdx) {
  const trades = [];
  let open = null;
  const spreadAt = (i) => pxA[i] - beta * pxB[i];
  for (let i = startIdx; i < endIdx; i += 1) {
    const win = [];
    for (let k = i - ZSCORE_WINDOW; k < i; k += 1) win.push(spreadAt(k));
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length);
    if (!(sd > 0)) continue;
    const z = (spreadAt(i) - mean) / sd;

    if (open) {
      const held = i - open.i;
      const forceClose = i === endIdx - 1; // flatten at window end
      if (Math.abs(z) <= EXIT_Z || Math.abs(z) >= STOP_Z || held >= MAX_HOLD_DAYS || forceClose) {
        const aExit = open.dir === 1 ? pxA[i] * (1 - SLIP) : pxA[i] * (1 + SLIP);
        const bExit = open.dir === 1 ? pxB[i] * (1 + SLIP) : pxB[i] * (1 - SLIP);
        const pnlA = open.dir === 1 ? (aExit - open.aEntry) * open.qtyA : (open.aEntry - aExit) * open.qtyA;
        const pnlB = open.dir === 1 ? (open.bEntry - bExit) * open.qtyB : (bExit - open.bEntry) * open.qtyB;
        const gross = pnlA + pnlB;
        const charges = pairRoundTripCharges(open.aEntry * open.qtyA, open.bEntry * open.qtyB);
        trades.push({ date: dates[i], heldDays: held, gross, net: gross - charges });
        open = null;
      }
      continue;
    }
    if (i === endIdx - 1) continue; // don't open on the last bar
    if (Math.abs(z) >= ENTRY_Z) {
      const dir = z >= ENTRY_Z ? -1 : 1;
      const aEntry = dir === 1 ? pxA[i] * (1 + SLIP) : pxA[i] * (1 - SLIP);
      const bEntry = dir === 1 ? pxB[i] * (1 - SLIP) : pxB[i] * (1 + SLIP);
      const qtyA = Math.floor(CAPITAL_PER_LEG / aEntry);
      const qtyB = Math.floor(CAPITAL_PER_LEG / bEntry);
      if (qtyA < 1 || qtyB < 1) continue;
      open = { i, dir, aEntry, bEntry, qtyA, qtyB };
    }
  }
  return trades;
}

function stats(trades) {
  if (!trades.length) return { n: 0, net: 0, pf: 0, winPct: 0, gross: 0 };
  const wins = trades.filter((t) => t.net > 0);
  const gw = wins.reduce((a, t) => a + t.net, 0);
  const gl = Math.abs(trades.filter((t) => t.net <= 0).reduce((a, t) => a + t.net, 0));
  return {
    n: trades.length,
    net: trades.reduce((a, t) => a + t.net, 0),
    gross: trades.reduce((a, t) => a + t.gross, 0),
    pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    winPct: (100 * wins.length) / trades.length,
  };
}

async function main() {
  const auth = `token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}`;
  const symbols = Object.keys(UNIVERSE);
  const data = {};
  console.error('Fetching...');
  for (const sym of symbols) {
    try {
      const rows = await fetchHistoricalCandles(auth, UNIVERSE[sym], FROM, TO, 'day');
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
  console.error(`${good.length} symbols, ${dates.length} common days.\n`);

  console.log('WALK-FORWARD: refit every ' + TRADING_DAYS + 'd on trailing ' + FORMATION_DAYS + 'd. Every trade is out-of-sample.');
  console.log('(0.10%/leg slippage + real futures-style charges)\n');
  console.log('Trade window                    pairs  trades   grossRs      netRs     PF   win%');
  console.log('-'.repeat(80));

  const allTrades = [];
  let start = FORMATION_DAYS;
  while (start + 1 < dates.length) {
    const end = Math.min(start + TRADING_DAYS, dates.length);
    const fStart = start - FORMATION_DAYS;

    // Screen cointegrated pairs on the trailing formation window ONLY.
    const sel = [];
    for (let i = 0; i < good.length; i += 1) {
      for (let j = i + 1; j < good.length; j += 1) {
        const A = good[i], B = good[j];
        const aF = px[A].slice(fStart, start), bF = px[B].slice(fStart, start);
        const c = corr(aF, bF);
        if (Math.abs(c) < 0.7) continue;
        const { beta } = ols(bF, aF);
        if (!(beta > 0)) continue;
        const hl = halfLife(aF.map((a, k) => a - beta * bF[k]));
        if (!(hl >= 2 && hl <= 40)) continue;
        sel.push({ A, B, beta });
      }
    }

    const windowTrades = [];
    for (const c of sel) windowTrades.push(...simulateWindow(dates, px[c.A], px[c.B], c.beta, start, end));
    const s = stats(windowTrades);
    allTrades.push(...windowTrades);
    console.log(
      `${dates[start]} -> ${dates[end - 1]}`.padEnd(30),
      String(sel.length).padStart(5),
      String(s.n).padStart(7),
      `Rs${s.gross.toFixed(0)}`.padStart(10),
      `Rs${s.net.toFixed(0)}`.padStart(11),
      s.pf.toFixed(2).padStart(6),
      s.winPct.toFixed(0).padStart(5),
    );
    start = end;
  }

  const all = stats(allTrades);
  console.log('-'.repeat(80));
  console.log(
    'TOTAL (all out-of-sample)'.padEnd(30),
    ''.padStart(5),
    String(all.n).padStart(7),
    `Rs${all.gross.toFixed(0)}`.padStart(10),
    `Rs${all.net.toFixed(0)}`.padStart(11),
    all.pf.toFixed(2).padStart(6),
    all.winPct.toFixed(0).padStart(5),
  );

  // Was there positive GROSS edge (i.e. does the spread revert at all) even if
  // costs eat it? Different diagnosis from "no edge whatsoever".
  console.log(`\nGross P&L before costs: Rs${all.gross.toFixed(0)}  |  after costs: Rs${all.net.toFixed(0)}`);
  console.log(`Total cost drag: Rs${(all.gross - all.net).toFixed(0)} over ${all.n} trades (Rs${((all.gross - all.net) / Math.max(1, all.n)).toFixed(0)}/trade)`);
}

main().catch((e) => { console.error('ERR:', e.message, e.stack); process.exit(1); });
