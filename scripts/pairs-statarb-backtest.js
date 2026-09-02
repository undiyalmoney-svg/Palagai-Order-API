#!/usr/bin/env node
/**
 * STATISTICAL ARBITRAGE / PAIRS TRADING — the one strategy class genuinely
 * untested in this entire session, and the only one with a STRUCTURAL reason
 * to clear the cost floor that killed all 25 prior attempts.
 *
 * The math of why everything else failed:
 *   Every directional mechanism tested produced an average gross edge of
 *   ~0.12-0.3% per trade. Round-trip cost (charges + realistic spread) is
 *   ~0.2-0.4%. Edge < cost => guaranteed loser, no matter the indicator.
 *
 * Why pairs could be different:
 *   A pairs trade doesn't bet on direction — it bets that the SPREAD between
 *   two cointegrated stocks reverts to its mean. A 2-sigma spread divergence
 *   on a genuinely cointegrated pair is typically a 2-5% move, held for days
 *   to weeks. Edge/cost ratio becomes ~10x instead of ~0.7x. That is the
 *   only structural way out of the trap, and it is arithmetic, not hope.
 *
 * Discipline (unchanged from every other test this session):
 *   - Hedge ratio (beta) fitted on TRAIN data only, then FROZEN for holdout.
 *   - Pair SELECTION made on TRAIN only (ranked by mean-reversion quality),
 *     then those same pairs verified untouched on holdout.
 *   - Z-score uses a CAUSAL rolling window — never full-sample stats.
 *   - Real charges + a slippage sweep, computed before anything is called a win.
 *
 * KNOWN IMPLEMENTATION CONSTRAINT (flagged up front, not buried):
 *   Indian retail cannot short cash equity overnight (no easy stock borrow).
 *   A live version needs stock futures on both legs, which carry their own
 *   margin requirements. This backtest measures whether the EDGE exists at
 *   all; if it doesn't, implementation is moot. If it does, that constraint
 *   gets solved next and is reported honestly.
 *
 * Usage: node scripts/pairs-statarb-backtest.js
 * Env:   KITE_API_KEY, KITE_ACCESS_TOKEN
 */
const { fetchHistoricalCandles } = require('../live/kite-market');

const UNIVERSE = {
  // Banks / financials — economically linked, the classic cointegration pool.
  HDFCBANK: 341249,
  ICICIBANK: 1270529,
  SBIN: 779521,
  KOTAKBANK: 492033,
  AXISBANK: 1510401,
  INDUSINDBK: 1346049,
  BANKBARODA: 1195009,
  PNB: 2730497,
  FEDERALBNK: 261889,
  IDFCFIRSTB: 2863105,
  // IT — highly cointegrated sector pair candidates.
  TCS: 2953217,
  INFY: 408065,
  WIPRO: 969473,
  HCLTECH: 1850625,
  TECHM: 3465729,
  // Energy / metals — commodity-linked co-movement.
  RELIANCE: 738561,
  IOC: 415745,
  BPCL: 134657,
  ONGC: 633601,
  TATASTEEL: 895745,
  JSWSTEEL: 3001089,
  HINDALCO: 348929,
  SAIL: 758529,
  // Autos.
  MARUTI: 2815745,
  M_M: 519937,
  BAJAJ_AUTO: 4267265,
  HEROMOTOCO: 345089,
  // FMCG / consumer — defensives that track each other.
  ITC: 424961,
  HINDUNILVR: 356865,
  BRITANNIA: 140033,
  DABUR: 197633,
  MARICO: 1041153,
  NESTLEIND: 4598529,
  // Cement.
  ULTRACEMCO: 2952193,
  SHREECEM: 794369,
  AMBUJACEM: 325121,
  // Pharma.
  SUNPHARMA: 857857,
  CIPLA: 177665,
  DRREDDY: 225537,
  LUPIN: 2672641,
  AUROPHARMA: 70401,
  // Power / infra.
  NTPC: 2977281,
  POWERGRID: 3834113,
  LT: 2939649,
  ADANIPORTS: 3861249,
};

const TRAIN_FROM = '2021-08-22';
const TRAIN_TO = '2024-12-31';
const HOLD_FROM = '2025-01-01';
const HOLD_TO = '2026-08-21';

const ZSCORE_WINDOW = 60; // causal rolling window for spread mean/std
const ENTRY_Z = 2.0;
const EXIT_Z = 0.5;
const STOP_Z = 3.5;
const MAX_HOLD_DAYS = 30;
const CAPITAL_PER_LEG = 20000; // Rs per leg, so Rs40k gross exposure per pair trade
const MIN_HALFLIFE = 2;
const MAX_HALFLIFE = 40;
const TOP_PAIRS = 15;

// Futures-style round-trip cost assumption for a two-leg trade.
// Stock futures: no STT on buy, 0.02% on sell, ~0.003% exchange, brokerage
// Rs20/leg (Zerodha flat), GST 18%. Deliberately generous-to-reality:
// this OVERSTATES cost slightly rather than understating it.
function pairRoundTripCharges(notionalA, notionalB) {
  const legs = [notionalA, notionalB];
  let total = 0;
  for (const n of legs) {
    const brokerage = Math.min(20, n * 0.0003) * 2; // entry + exit
    const stt = n * 0.0002; // sell side only
    const exch = n * 2 * 0.0000345;
    const stamp = n * 0.00002;
    const gst = (brokerage + exch) * 0.18;
    total += brokerage + stt + exch + stamp + gst;
  }
  return total;
}

async function fetchDaily(auth, token, from, to) {
  return fetchHistoricalCandles(auth, token, from, to, 'day');
}

/** OLS slope of y on x (through origin-free, with intercept). */
function ols(x, y) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) * (x[i] - mx);
  }
  const beta = den === 0 ? 0 : num / den;
  return { beta, alpha: my - beta * mx };
}

/**
 * Half-life of mean reversion via AR(1) on the spread:
 *   d(spread)_t = lambda * spread_{t-1} + eps
 *   halflife = -ln(2)/lambda   (only meaningful when lambda < 0)
 * A short, finite half-life is the practical signature of cointegration —
 * simpler and more robust here than a full ADF implementation.
 */
function halfLife(spread) {
  const lagged = spread.slice(0, -1);
  const delta = [];
  for (let i = 1; i < spread.length; i += 1) delta.push(spread[i] - spread[i - 1]);
  const { beta: lambda } = ols(lagged, delta);
  if (lambda >= 0) return Infinity;
  return -Math.LN2 / lambda;
}

function corr(x, y) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

/**
 * Run the pair through a window. beta is FROZEN (fitted on train only).
 * Returns realized trades.
 */
function simulatePair(datesA, pxA, pxB, beta, slipPct) {
  const trades = [];
  const spread = pxA.map((a, i) => a - beta * pxB[i]);
  let open = null;

  for (let i = ZSCORE_WINDOW; i < spread.length; i += 1) {
    const win = spread.slice(i - ZSCORE_WINDOW, i); // strictly prior bars — causal
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length);
    if (!(sd > 0)) continue;
    const z = (spread[i] - mean) / sd;

    if (open) {
      const held = i - open.i;
      const hitExit = Math.abs(z) <= EXIT_Z;
      const hitStop = Math.abs(z) >= STOP_Z;
      const hitTime = held >= MAX_HOLD_DAYS;
      if (hitExit || hitStop || hitTime) {
        // Close both legs with adverse slippage on each.
        const aExit = open.dir === 1 ? pxA[i] * (1 - slipPct) : pxA[i] * (1 + slipPct);
        const bExit = open.dir === 1 ? pxB[i] * (1 + slipPct) : pxB[i] * (1 - slipPct);
        // dir=1 => long A, short B. dir=-1 => short A, long B.
        const pnlA = open.dir === 1 ? (aExit - open.aEntry) * open.qtyA : (open.aEntry - aExit) * open.qtyA;
        const pnlB = open.dir === 1 ? (open.bEntry - bExit) * open.qtyB : (bExit - open.bEntry) * open.qtyB;
        const gross = pnlA + pnlB;
        const charges = pairRoundTripCharges(open.aEntry * open.qtyA, open.bEntry * open.qtyB);
        trades.push({
          entryDate: open.date,
          exitDate: datesA[i],
          heldDays: held,
          dir: open.dir,
          entryZ: open.z,
          exitZ: z,
          gross,
          charges,
          net: gross - charges,
          reason: hitExit ? 'reverted' : hitStop ? 'stop' : 'time',
        });
        open = null;
      }
      continue;
    }

    if (Math.abs(z) >= ENTRY_Z) {
      // z high => spread too wide => short A, long B (dir=-1). z low => opposite.
      const dir = z >= ENTRY_Z ? -1 : 1;
      const aEntry = dir === 1 ? pxA[i] * (1 + slipPct) : pxA[i] * (1 - slipPct);
      const bEntry = dir === 1 ? pxB[i] * (1 - slipPct) : pxB[i] * (1 + slipPct);
      const qtyA = Math.floor(CAPITAL_PER_LEG / aEntry);
      const qtyB = Math.floor(CAPITAL_PER_LEG / bEntry);
      if (qtyA < 1 || qtyB < 1) continue;
      open = { i, date: datesA[i], dir, z, aEntry, bEntry, qtyA, qtyB };
    }
  }
  return trades;
}

function stats(trades) {
  if (!trades.length) return { n: 0, net: 0, pf: 0, winPct: 0, avgGross: 0 };
  const wins = trades.filter((t) => t.net > 0);
  const gw = wins.reduce((a, t) => a + t.net, 0);
  const gl = Math.abs(trades.filter((t) => t.net <= 0).reduce((a, t) => a + t.net, 0));
  return {
    n: trades.length,
    net: trades.reduce((a, t) => a + t.net, 0),
    pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    winPct: (100 * wins.length) / trades.length,
    avgGross: trades.reduce((a, t) => a + t.gross, 0) / trades.length,
    avgHeld: trades.reduce((a, t) => a + t.heldDays, 0) / trades.length,
  };
}

async function main() {
  const apiKey = process.env.KITE_API_KEY;
  const accessToken = process.env.KITE_ACCESS_TOKEN;
  const auth = `token ${apiKey}:${accessToken}`;

  const symbols = Object.keys(UNIVERSE);
  console.error(`Fetching ${symbols.length} symbols (daily, full period)...`);
  const data = {};
  for (const sym of symbols) {
    try {
      const rows = await fetchDaily(auth, UNIVERSE[sym], TRAIN_FROM, HOLD_TO);
      if (rows.length > 500) data[sym] = rows;
    } catch (e) {
      console.error(`  skip ${sym}: ${e.message}`);
    }
  }
  const good = Object.keys(data);
  console.error(`Got ${good.length} usable symbols.`);

  // Align on common dates.
  const dateSets = good.map((s) => new Set(data[s].map((r) => r.date.slice(0, 10))));
  const commonDates = [...dateSets[0]].filter((d) => dateSets.every((set) => set.has(d))).sort();
  console.error(`${commonDates.length} common trading days.`);

  const px = {};
  for (const s of good) {
    const map = new Map(data[s].map((r) => [r.date.slice(0, 10), r.close]));
    px[s] = commonDates.map((d) => map.get(d));
  }

  const trainIdx = commonDates.filter((d) => d <= TRAIN_TO).length;
  console.error(`Train days: ${trainIdx}, Holdout days: ${commonDates.length - trainIdx}\n`);

  // ---- PAIR SELECTION: TRAIN DATA ONLY ----
  const candidates = [];
  for (let i = 0; i < good.length; i += 1) {
    for (let j = i + 1; j < good.length; j += 1) {
      const A = good[i];
      const B = good[j];
      const aTrain = px[A].slice(0, trainIdx);
      const bTrain = px[B].slice(0, trainIdx);
      const c = corr(aTrain, bTrain);
      if (Math.abs(c) < 0.7) continue;
      const { beta } = ols(bTrain, aTrain);
      if (!(beta > 0)) continue;
      const spread = aTrain.map((a, k) => a - beta * bTrain[k]);
      const hl = halfLife(spread);
      if (!(hl >= MIN_HALFLIFE && hl <= MAX_HALFLIFE)) continue;
      candidates.push({ A, B, beta, corr: c, halfLife: hl });
    }
  }
  console.error(`${candidates.length} cointegration candidates (|corr|>0.7, halflife ${MIN_HALFLIFE}-${MAX_HALFLIFE}d).`);

  // Rank by TRAIN performance only.
  for (const cand of candidates) {
    const t = simulatePair(
      commonDates.slice(0, trainIdx),
      px[cand.A].slice(0, trainIdx),
      px[cand.B].slice(0, trainIdx),
      cand.beta,
      0,
    );
    cand.trainStats = stats(t);
  }
  const ranked = candidates
    .filter((c) => c.trainStats.n >= 10 && c.trainStats.pf > 1.2)
    .sort((a, b) => b.trainStats.net - a.trainStats.net);

  console.error(`${ranked.length} pairs profitable on train (PF>1.2, >=10 trades). Taking top ${TOP_PAIRS}.\n`);
  const selected = ranked.slice(0, TOP_PAIRS);

  console.log('=== SELECTED PAIRS (chosen on TRAIN only) ===');
  for (const c of selected) {
    console.log(
      `${c.A}/${c.B}`.padEnd(24),
      `beta=${c.beta.toFixed(3)}`.padEnd(14),
      `corr=${c.corr.toFixed(2)}`.padEnd(12),
      `HL=${c.halfLife.toFixed(1)}d`.padEnd(10),
      `trainN=${c.trainStats.n}`.padEnd(11),
      `trainPF=${c.trainStats.pf.toFixed(2)}`.padEnd(13),
      `trainNet=Rs${c.trainStats.net.toFixed(0)}`,
    );
  }

  // ---- HOLDOUT VERIFICATION + SLIPPAGE SWEEP ----
  console.log('\n=== PORTFOLIO RESULTS (frozen beta, frozen pair list) ===');
  console.log('slip%    TRAIN net      PF     |  HOLDOUT net     PF    trades  avgHeld  avgGross');
  for (const slip of [0, 0.0005, 0.001, 0.002, 0.003]) {
    const trainAll = [];
    const holdAll = [];
    for (const c of selected) {
      trainAll.push(
        ...simulatePair(commonDates.slice(0, trainIdx), px[c.A].slice(0, trainIdx), px[c.B].slice(0, trainIdx), c.beta, slip),
      );
      // Holdout needs ZSCORE_WINDOW of prior bars to warm the rolling stats;
      // include them but only count trades that OPEN in the holdout window.
      const startIdx = trainIdx - ZSCORE_WINDOW;
      const hTrades = simulatePair(
        commonDates.slice(startIdx),
        px[c.A].slice(startIdx),
        px[c.B].slice(startIdx),
        c.beta,
        slip,
      ).filter((t) => t.entryDate > TRAIN_TO);
      holdAll.push(...hTrades);
    }
    const ts = stats(trainAll);
    const hs = stats(holdAll);
    console.log(
      (slip * 100).toFixed(2).padStart(5),
      `Rs${ts.net.toFixed(0)}`.padStart(12),
      ts.pf.toFixed(2).padStart(7),
      '  | ',
      `Rs${hs.net.toFixed(0)}`.padStart(12),
      hs.pf.toFixed(2).padStart(7),
      String(hs.n).padStart(7),
      (hs.avgHeld || 0).toFixed(1).padStart(8),
      `Rs${(hs.avgGross || 0).toFixed(0)}`.padStart(9),
    );
  }
}

main().catch((e) => {
  console.error('PAIRS_ERROR:', e.message, e.stack);
  process.exit(1);
});
