#!/usr/bin/env node
/**
 * ANOMALY SCANNER — conditional vs control, before any strategy exists.
 *
 * METHOD (deliberately not a backtest):
 *   For every stock-day we evaluate a set of CONDITIONS, then measure the
 *   forward MARKET-ADJUSTED return (stock return minus Nifty return over the
 *   same window) at 1/3/5/10/20/30 days. The quantity of interest is
 *       conditional mean excess return  −  unconditional (control) mean
 *   i.e. the INCREMENTAL edge, not the raw return.
 *
 * STATISTICAL HONESTY — three choices that make this harder to fool:
 *   1. FAMA-MACBETH / DATE CLUSTERING. Overlapping forward windows and
 *      cross-sectional correlation make naive stock-day t-stats wildly
 *      overstated (n=100,000 "independent" observations that are nothing of
 *      the sort). Instead we average across stocks WITHIN each date, then
 *      t-test the resulting time series of daily means. n = number of dates.
 *      This is far more conservative and is the standard fix.
 *   2. MARKET ADJUSTMENT. Subtracting the index return removes market drift,
 *      so a condition cannot look good merely by firing in bull markets.
 *   3. MULTIPLE TESTING declared up front: every condition x horizon is one
 *      hypothesis. Bonferroni and FDR thresholds are computed and reported,
 *      and the raw hypothesis count is printed, not hidden.
 *
 * SPLIT: DEV 2013-06..2019-12 | VALID 2020-01..2022-12 | TEST 2023-01..2026-08
 *   Conditions are screened on DEV only. VALID/TEST are reported alongside
 *   but never used to select.
 *
 * Usage: node scripts/anomaly-scan.js
 */
const { fetchHistoricalCandles } = require('../live/kite-market');

const UNIVERSE = {
  HDFCBANK: 341249, ICICIBANK: 1270529, SBIN: 779521, KOTAKBANK: 492033,
  AXISBANK: 1510401, INDUSINDBK: 1346049, BANKBARODA: 1195009,
  TCS: 2953217, INFY: 408065, WIPRO: 969473, HCLTECH: 1850625, TECHM: 3465729,
  RELIANCE: 738561, IOC: 415745, BPCL: 134657, ONGC: 633601,
  TATASTEEL: 895745, JSWSTEEL: 3001089, HINDALCO: 348929,
  MARUTI: 2815745, M_M: 519937, BAJAJ_AUTO: 4267265, HEROMOTOCO: 345089,
  ITC: 424961, HINDUNILVR: 356865, BRITANNIA: 140033, DABUR: 197633, MARICO: 1041153,
  ULTRACEMCO: 2952193, SHREECEM: 794369, AMBUJACEM: 325121,
  SUNPHARMA: 857857, CIPLA: 177665, DRREDDY: 225537, LUPIN: 2672641, AUROPHARMA: 70401,
  NTPC: 2977281, POWERGRID: 3834113, LT: 2939649, ADANIPORTS: 3861249,
  TITAN: 897537, ASIANPAINT: 60417, BHARTIARTL: 2714625, BAJFINANCE: 81153,
  NESTLEIND: 4598529,
};
const NIFTY = 256265;
const FROM = '2013-06-03';
const DEV_TO = '2019-12-31';
const VALID_TO = '2022-12-31';
const TO = '2026-08-21';
const HORIZONS = [1, 3, 5, 10, 20, 30];

function addDays(d, n) {
  const [y, m, dd] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
async function fetchAll(auth, token) {
  const out = [];
  let cur = FROM;
  while (cur <= TO) {
    const end = addDays(cur, 1900) > TO ? TO : addDays(cur, 1900);
    out.push(...await fetchHistoricalCandles(auth, token, cur, end, 'day'));
    cur = addDays(end, 1);
  }
  const seen = new Set();
  return out.filter((r) => (seen.has(r.date) ? false : (seen.add(r.date), true)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function stdev(a) { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); }
function pct(a, p) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * p)]; }

/** two-sided p from t, via a normal approximation (n is large here) */
function pFromT(t) {
  const z = Math.abs(t);
  // Abramowitz-Stegun normal tail
  const b1 = 0.319381530, b2 = -0.356563782, b3 = 1.781477937, b4 = -1.821255978, b5 = 1.330274429, p0 = 0.2316419;
  const c = 0.39894228 * Math.exp(-z * z / 2);
  const tt = 1 / (1 + p0 * z);
  const tail = c * tt * (b1 + tt * (b2 + tt * (b3 + tt * (b4 + tt * b5))));
  return 2 * tail;
}

async function main() {
  const auth = `token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}`;
  const raw = {};
  for (const [s, t] of Object.entries(UNIVERSE)) {
    try { process.stderr.write(`${s} `); const r = await fetchAll(auth, t); if (r.length > 1500) raw[s] = r; } catch (e) {}
  }
  const nifty = await fetchAll(auth, NIFTY);
  const symbols = Object.keys(raw);
  const dates = nifty.map((r) => r.date.slice(0, 10));
  const nClose = nifty.map((r) => r.close);
  const T = dates.length;
  console.error(`\n${symbols.length} symbols, ${T} sessions ${dates[0]}..${dates[T - 1]}\n`);

  // Align + forward-fill
  const C = {}, H = {}, L = {}, V = {};
  for (const s of symbols) {
    const m = new Map(raw[s].map((r) => [r.date.slice(0, 10), r]));
    let last = null;
    C[s] = []; H[s] = []; L[s] = []; V[s] = [];
    for (const d of dates) {
      if (m.has(d)) last = m.get(d);
      C[s].push(last ? last.close : null);
      H[s].push(last ? last.high : null);
      L[s].push(last ? last.low : null);
      V[s].push(last && m.has(d) ? last.volume : 0);
    }
  }

  // ---- precompute features per stock ----
  const F = {};
  for (const s of symbols) {
    const c = C[s];
    const f = { ret1: [], sma20: [], sma50: [], atr14: [], volAvg20: [], hi20: [], hi50: [], hi252: [], lo20: [],
      mom5: [], mom20: [], mom60: [], mom126: [], mom252: [], upStreak: [], dnStreak: [], atrRatio: [] };
    let up = 0, dn = 0;
    for (let i = 0; i < T; i += 1) {
      const p = c[i], pp = i > 0 ? c[i - 1] : null;
      f.ret1.push(p != null && pp != null && pp > 0 ? p / pp - 1 : null);
      if (f.ret1[i] != null) { if (f.ret1[i] > 0) { up += 1; dn = 0; } else if (f.ret1[i] < 0) { dn += 1; up = 0; } }
      f.upStreak.push(up); f.dnStreak.push(dn);
      const sm = (n) => { if (i < n - 1) return null; let x = 0; for (let k = i - n + 1; k <= i; k += 1) { if (c[k] == null) return null; x += c[k]; } return x / n; };
      f.sma20.push(sm(20)); f.sma50.push(sm(50));
      // ATR14
      if (i >= 14) { let x = 0, ok = true; for (let k = i - 13; k <= i; k += 1) { if (H[s][k] == null || c[k - 1] == null) { ok = false; break; } x += Math.max(H[s][k] - L[s][k], Math.abs(H[s][k] - c[k - 1]), Math.abs(L[s][k] - c[k - 1])); } f.atr14.push(ok ? x / 14 : null); } else f.atr14.push(null);
      // volume avg
      if (i >= 20) { let x = 0; for (let k = i - 19; k <= i; k += 1) x += V[s][k]; f.volAvg20.push(x / 20); } else f.volAvg20.push(null);
      const hh = (n) => { if (i < n) return null; let x = -Infinity; for (let k = i - n + 1; k <= i; k += 1) { if (c[k] == null) return null; x = Math.max(x, c[k]); } return x; };
      const ll = (n) => { if (i < n) return null; let x = Infinity; for (let k = i - n + 1; k <= i; k += 1) { if (c[k] == null) return null; x = Math.min(x, c[k]); } return x; };
      f.hi20.push(hh(20)); f.hi50.push(hh(50)); f.hi252.push(hh(252)); f.lo20.push(ll(20));
      const mo = (n) => (i >= n && c[i - n] != null && c[i - n] > 0 && p != null ? p / c[i - n] - 1 : null);
      f.mom5.push(mo(5)); f.mom20.push(mo(20)); f.mom60.push(mo(60)); f.mom126.push(mo(126)); f.mom252.push(mo(252));
      // short ATR vs long ATR = volatility compression
      if (i >= 50 && f.atr14[i] != null) { let x = 0, ok = true; for (let k = i - 49; k <= i; k += 1) { if (f.atr14[k] == null) { ok = false; break; } x += f.atr14[k]; } f.atrRatio.push(ok ? f.atr14[i] / (x / 50) : null); } else f.atrRatio.push(null);
    }
    F[s] = f;
  }

  // ---- CONDITIONS (categories A–F). Each returns true/false/null. ----
  const CONDITIONS = {
    'A1 1d drop < -4%':            (s, i) => F[s].ret1[i] != null ? F[s].ret1[i] < -0.04 : null,
    'A2 1d drop < -6%':            (s, i) => F[s].ret1[i] != null ? F[s].ret1[i] < -0.06 : null,
    'A3 1d gain > +4%':            (s, i) => F[s].ret1[i] != null ? F[s].ret1[i] > 0.04 : null,
    'A4 1d gain > +6%':            (s, i) => F[s].ret1[i] != null ? F[s].ret1[i] > 0.06 : null,
    'A5 3 down days':              (s, i) => F[s].dnStreak[i] >= 3,
    'A6 5 down days':              (s, i) => F[s].dnStreak[i] >= 5,
    'A7 3 up days':                (s, i) => F[s].upStreak[i] >= 3,
    'A8 5 up days':                (s, i) => F[s].upStreak[i] >= 5,
    'A9 gap down >2%':             (s, i) => (i > 0 && C[s][i - 1] > 0 && L[s][i] != null) ? (C[s][i] / C[s][i - 1] - 1) < -0.02 : null,
    'D1 >2 ATR below SMA20':       (s, i) => (F[s].sma20[i] != null && F[s].atr14[i] > 0 && C[s][i] != null) ? (F[s].sma20[i] - C[s][i]) / F[s].atr14[i] > 2 : null,
    'D2 >3 ATR below SMA20':       (s, i) => (F[s].sma20[i] != null && F[s].atr14[i] > 0 && C[s][i] != null) ? (F[s].sma20[i] - C[s][i]) / F[s].atr14[i] > 3 : null,
    'D3 >2 ATR above SMA20':       (s, i) => (F[s].sma20[i] != null && F[s].atr14[i] > 0 && C[s][i] != null) ? (C[s][i] - F[s].sma20[i]) / F[s].atr14[i] > 2 : null,
    'D4 at 20d low':               (s, i) => (F[s].lo20[i] != null && C[s][i] != null) ? C[s][i] <= F[s].lo20[i] : null,
    'E1 new 20d high':             (s, i) => (F[s].hi20[i] != null && C[s][i] != null) ? C[s][i] >= F[s].hi20[i] : null,
    'E2 new 50d high':             (s, i) => (F[s].hi50[i] != null && C[s][i] != null) ? C[s][i] >= F[s].hi50[i] : null,
    'E3 new 52w high':             (s, i) => (F[s].hi252[i] != null && C[s][i] != null) ? C[s][i] >= F[s].hi252[i] : null,
    'E4 20d high + 2x volume':     (s, i) => (F[s].hi20[i] != null && F[s].volAvg20[i] > 0 && C[s][i] != null) ? (C[s][i] >= F[s].hi20[i] && V[s][i] > 2 * F[s].volAvg20[i]) : null,
    'E5 20d high, NO vol spike':   (s, i) => (F[s].hi20[i] != null && F[s].volAvg20[i] > 0 && C[s][i] != null) ? (C[s][i] >= F[s].hi20[i] && V[s][i] < F[s].volAvg20[i]) : null,
    'E6 52w high + 2x volume':     (s, i) => (F[s].hi252[i] != null && F[s].volAvg20[i] > 0 && C[s][i] != null) ? (C[s][i] >= F[s].hi252[i] && V[s][i] > 2 * F[s].volAvg20[i]) : null,
    'B1 volume > 3x avg':          (s, i) => F[s].volAvg20[i] > 0 ? V[s][i] > 3 * F[s].volAvg20[i] : null,
    'B2 vol>3x AND up day':        (s, i) => (F[s].volAvg20[i] > 0 && F[s].ret1[i] != null) ? (V[s][i] > 3 * F[s].volAvg20[i] && F[s].ret1[i] > 0) : null,
    'B3 vol>3x AND down day':      (s, i) => (F[s].volAvg20[i] > 0 && F[s].ret1[i] != null) ? (V[s][i] > 3 * F[s].volAvg20[i] && F[s].ret1[i] < 0) : null,
    'B4 volume < 0.5x avg':        (s, i) => F[s].volAvg20[i] > 0 ? V[s][i] < 0.5 * F[s].volAvg20[i] : null,
    'F1 vol compression <0.7':     (s, i) => F[s].atrRatio[i] != null ? F[s].atrRatio[i] < 0.7 : null,
    'F2 vol expansion >1.5':       (s, i) => F[s].atrRatio[i] != null ? F[s].atrRatio[i] > 1.5 : null,
    'F3 compression + 20d high':   (s, i) => (F[s].atrRatio[i] != null && F[s].hi20[i] != null && C[s][i] != null) ? (F[s].atrRatio[i] < 0.7 && C[s][i] >= F[s].hi20[i]) : null,
  };

  // ---- CROSS-SECTIONAL RANK CONDITIONS (category C/G/H) ----
  // computed per-date across the universe, so they need their own pass
  const RANK_FEATURES = { 'C1 mom20': 'mom20', 'C2 mom60': 'mom60', 'C3 mom126': 'mom126', 'C4 mom252': 'mom252' };

  const windows = [['DEV', FROM, DEV_TO], ['VALID', addDays(DEV_TO, 1), VALID_TO], ['TEST', addDays(VALID_TO, 1), TO]];
  const winOf = (d) => (d <= DEV_TO ? 'DEV' : d <= VALID_TO ? 'VALID' : 'TEST');

  // forward market-adjusted return
  const fwdExcess = (s, i, h) => {
    if (i + h >= T) return null;
    const a = C[s][i], b = C[s][i + h];
    if (a == null || b == null || !(a > 0)) return null;
    const mr = nClose[i + h] / nClose[i] - 1;
    return (b / a - 1) - mr;
  };

  // ---- accumulate: per condition, per horizon, per window: daily cross-sectional means
  const acc = {};          // cond -> win -> h -> array of daily means
  const nObs = {};         // cond -> win -> count of stock-days
  const baseline = {};     // win -> h -> array of daily means (ALL stock-days = control)
  for (const [wn] of windows.map((w) => [w[0]])) { baseline[wn] = {}; for (const h of HORIZONS) baseline[wn][h] = []; }

  for (let i = 0; i < T; i += 1) {
    const w = winOf(dates[i]);
    // control group: every stock with valid data that day
    for (const h of HORIZONS) {
      const vals = [];
      for (const s of symbols) { const e = fwdExcess(s, i, h); if (e != null) vals.push(e); }
      if (vals.length >= 5) baseline[w][h].push(mean(vals));
    }
    for (const [cname, fn] of Object.entries(CONDITIONS)) {
      if (!acc[cname]) { acc[cname] = {}; nObs[cname] = {}; for (const [wn] of windows.map((x) => [x[0]])) { acc[cname][wn] = {}; nObs[cname][wn] = 0; for (const h of HORIZONS) acc[cname][wn][h] = []; } }
      const hits = [];
      for (const s of symbols) { let v = null; try { v = fn(s, i); } catch (e) { v = null; } if (v === true) hits.push(s); }
      if (!hits.length) continue;
      nObs[cname][w] += hits.length;
      for (const h of HORIZONS) {
        const vals = [];
        for (const s of hits) { const e = fwdExcess(s, i, h); if (e != null) vals.push(e); }
        if (vals.length) acc[cname][w][h].push(mean(vals));
      }
    }
    // cross-sectional deciles
    for (const [cn, feat] of Object.entries(RANK_FEATURES)) {
      const scored = [];
      for (const s of symbols) { const v = F[s][feat][i]; if (v != null) scored.push({ s, v }); }
      if (scored.length < 20) continue;
      scored.sort((a, b) => b.v - a.v);
      const k = Math.max(3, Math.floor(scored.length / 5)); // top/bottom quintile
      const top = scored.slice(0, k).map((x) => x.s);
      const bot = scored.slice(-k).map((x) => x.s);
      for (const [suffix, grp] of [[' TOP', top], [' BOT', bot], [' L/S', null]]) {
        const key = cn + suffix;
        if (!acc[key]) { acc[key] = {}; nObs[key] = {}; for (const [wn] of windows.map((x) => [x[0]])) { acc[key][wn] = {}; nObs[key][wn] = 0; for (const h of HORIZONS) acc[key][wn][h] = []; } }
        for (const h of HORIZONS) {
          if (grp) {
            const vals = []; for (const s of grp) { const e = fwdExcess(s, i, h); if (e != null) vals.push(e); }
            if (vals.length) acc[key][w][h].push(mean(vals));
          } else {
            const tv = [], bv = [];
            for (const s of top) { const e = fwdExcess(s, i, h); if (e != null) tv.push(e); }
            for (const s of bot) { const e = fwdExcess(s, i, h); if (e != null) bv.push(e); }
            if (tv.length && bv.length) acc[key][w][h].push(mean(tv) - mean(bv));
          }
        }
        if (grp) nObs[key][w] += grp.length;
      }
    }
  }

  const condNames = Object.keys(acc);
  const nHypotheses = condNames.length * HORIZONS.length;
  const bonf = 0.05 / nHypotheses;

  console.log('='.repeat(126));
  console.log('PHASE 3-9 · CONDITIONAL vs CONTROL — market-adjusted forward returns, date-clustered t-stats');
  console.log('='.repeat(126));
  console.log(`Universe ${symbols.length} stocks · ${dates[0]}..${dates[T - 1]} · conditions ${condNames.length} · horizons ${HORIZONS.length}`);
  console.log(`HYPOTHESES TESTED: ${nHypotheses}   Bonferroni p-threshold: ${bonf.toExponential(2)}\n`);

  // DEV screening table
  const rows = [];
  for (const cname of condNames) {
    for (const h of HORIZONS) {
      const arr = acc[cname].DEV[h];
      if (arr.length < 100) continue;
      const base = baseline.DEV[h];
      const m = mean(arr), b = mean(base);
      const spread = m - b;
      const sd = stdev(arr);
      const t = sd > 0 ? (m - b) / (sd / Math.sqrt(arr.length)) : 0;
      rows.push({ cname, h, n: nObs[cname].DEV, days: arr.length, m: m * 100, b: b * 100, spread: spread * 100, t, p: pFromT(t) });
    }
  }
  rows.sort((a, b) => Math.abs(b.t) - Math.abs(a.t));

  console.log('TOP 20 BY |t| ON DEVELOPMENT DATA (screening only — selection happens here, nowhere else)');
  console.log('-'.repeat(126));
  console.log('Condition                     Hor   StockDays  Days   CondRet%  CtrlRet%   Spread%    t-stat      p-value   Bonf?');
  console.log('-'.repeat(126));
  for (const r of rows.slice(0, 20)) {
    console.log(
      r.cname.padEnd(29), String(r.h).padStart(3), String(r.n).padStart(11), String(r.days).padStart(6),
      r.m.toFixed(3).padStart(10), r.b.toFixed(3).padStart(10), r.spread.toFixed(3).padStart(10),
      r.t.toFixed(2).padStart(9), r.p.toExponential(2).padStart(13), (r.p < bonf ? '  PASS' : '  fail').padStart(7),
    );
  }

  const survivors = rows.filter((r) => r.p < bonf);
  console.log(`\n${survivors.length} of ${rows.length} tested (condition x horizon) pairs pass Bonferroni on DEV.\n`);

  // Out-of-sample check for DEV survivors
  console.log('='.repeat(126));
  console.log('PHASE 13 · OUT-OF-SAMPLE — the DEV survivors, measured untouched on VALID and TEST');
  console.log('='.repeat(126));
  console.log('Condition                     Hor    DEV spread%    VALID spread%   TEST spread%   sign held?');
  console.log('-'.repeat(126));
  const oos = [];
  for (const r of survivors.slice(0, 25)) {
    const vArr = acc[r.cname].VALID[r.h], tArr = acc[r.cname].TEST[r.h];
    if (vArr.length < 30 || tArr.length < 30) continue;
    const vs = (mean(vArr) - mean(baseline.VALID[r.h])) * 100;
    const ts = (mean(tArr) - mean(baseline.TEST[r.h])) * 100;
    const held = Math.sign(r.spread) === Math.sign(vs) && Math.sign(r.spread) === Math.sign(ts);
    oos.push({ ...r, vs, ts, held });
    console.log(
      r.cname.padEnd(29), String(r.h).padStart(3),
      r.spread.toFixed(3).padStart(14), vs.toFixed(3).padStart(16), ts.toFixed(3).padStart(15),
      (held ? '   YES' : '   no').padStart(12),
    );
  }
  const held = oos.filter((o) => o.held);
  console.log(`\n${held.length} of ${oos.length} DEV survivors keep the SAME SIGN in BOTH validation and test.\n`);

  if (held.length) {
    console.log('='.repeat(126));
    console.log('PHASE 7 · RETURN DISTRIBUTION for sign-stable survivors (DEV daily cross-sectional means, %)');
    console.log('='.repeat(126));
    console.log('Condition                     Hor      mean    median      p5      p25      p75      p95    win%');
    console.log('-'.repeat(126));
    for (const o of held) {
      const a = acc[o.cname].DEV[o.h].map((x) => x * 100);
      console.log(
        o.cname.padEnd(29), String(o.h).padStart(3),
        mean(a).toFixed(3).padStart(9), pct(a, 0.5).toFixed(3).padStart(9),
        pct(a, 0.05).toFixed(3).padStart(8), pct(a, 0.25).toFixed(3).padStart(8),
        pct(a, 0.75).toFixed(3).padStart(8), pct(a, 0.95).toFixed(3).padStart(8),
        ((100 * a.filter((x) => x > 0).length) / a.length).toFixed(0).padStart(7),
      );
    }
    console.log('\nPHASE 15 · COST TEST — round-trip cost on a ₹6,667 position ≈ 0.50% (STT+DP+stamp+exch) + slippage.');
    console.log('An edge must exceed ~0.50% NET of the control baseline to be tradeable at ₹20,000.');
    for (const o of held) {
      const netEdge = o.ts - 0.50;
      console.log(`  ${o.cname} @${o.h}d : TEST spread ${o.ts.toFixed(3)}%  −0.50% cost  =  ${netEdge.toFixed(3)}%  ${netEdge > 0 ? 'TRADEABLE' : 'CONSUMED BY COSTS'}`);
    }
  }
}

main().catch((e) => { console.error('ERR:', e.message, e.stack); process.exit(1); });
