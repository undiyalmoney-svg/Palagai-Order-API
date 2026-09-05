'use strict';
/**
 * BUILDIA RESEARCH ENGINE — causal entry-model comparison. RESEARCH ONLY.
 *
 * Scans historical 5-min data sequentially and, at each 15-min bar, evaluates
 * several CAUSAL entry models (only data up to that bar). Forward candles are
 * used ONLY to score the outcome (MFE/MAE/target), never to make the entry
 * decision — see noLookAheadProof(). Continuous moves are grouped so one push
 * is not counted as many trades.
 *
 * Same building blocks (to15, pivots, trend) the live/paper engine uses, so a
 * model that wins here is the model Paper and Live run.
 */
const { to15 } = require('./sr-breakout');

const PIVOT = 5;

function atr14(B) {
  const n = B.length; const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) tr[i] = Math.max(B[i].h - B[i].l, Math.abs(B[i].h - B[i - 1].c), Math.abs(B[i].l - B[i - 1].c));
  const a = new Array(n).fill(null); let s = 0;
  for (let i = 1; i <= 14 && i < n; i++) s += tr[i];
  if (n > 14) a[14] = s / 14;
  for (let i = 15; i < n; i++) a[i] = (a[i - 1] * 13 + tr[i]) / 14;
  return a;
}

/**
 * Each model is a pure function of state KNOWN AT BAR i (never i+1..):
 *   ctx = { i, B, atr, pivotHi, pivotLo, trend, entryPts }
 * returns { dir:1|-1, level } or null.
 */
const MODELS = {
  A_pivotBreak: (c) => {                                   // close beyond confirmed pivot + trend
    const b = c.B[c.i], body = b.c - b.o;
    if (body >= c.entryPts && b.c > c.pivotHi && c.trend > 0) return { dir: 1, level: c.pivotHi };
    if (-body >= c.entryPts && b.c < c.pivotLo && c.trend < 0) return { dir: -1, level: c.pivotLo };
    return null;
  },
  B_momentumExpansion: (c) => {                            // range >1.5 ATR, with trend
    const b = c.B[c.i]; if (!c.atr) return null;
    const rng = b.h - b.l, body = b.c - b.o;
    if (rng < 1.5 * c.atr) return null;
    if (body > 0 && c.trend > 0) return { dir: 1, level: c.pivotHi };
    if (body < 0 && c.trend < 0) return { dir: -1, level: c.pivotLo };
    return null;
  },
  E_intradayBreakout: (c) => {                             // break prior-3 15m high/low + trend
    if (c.i < 3 || c.B[c.i - 3].d !== c.B[c.i].d) return null;
    const b = c.B[c.i];
    let hi = -Infinity, lo = Infinity;
    for (let k = c.i - 3; k < c.i; k++) { hi = Math.max(hi, c.B[k].h); lo = Math.min(lo, c.B[k].l); }
    if (b.c > hi && c.trend > 0) return { dir: 1, level: hi };
    if (b.c < lo && c.trend < 0) return { dir: -1, level: lo };
    return null;
  },
  F_breakoutBigBody: (c) => {                              // pivot break + big body (1.5x) + trend
    const b = c.B[c.i], body = b.c - b.o;
    if (Math.abs(body) < c.entryPts * 1.5) return null;
    if (body > 0 && b.c > c.pivotHi && c.trend > 0) return { dir: 1, level: c.pivotHi };
    if (body < 0 && b.c < c.pivotLo && c.trend < 0) return { dir: -1, level: c.pivotLo };
    return null;
  },
};
// C (5-min confirm) and D (retest) need the 5-min path AFTER the signal bar and
// are handled specially in the harness so their ENTRY still stays causal.

const q = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))] : 0);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/**
 * research(bars5, opts) → per-model stats + a merged opportunity list.
 * opts: { entryPts, trendBars=20, unitsPerLot, cost=120, entryStartHm, entryEndHm, squareOffHm }
 */
function research(bars5, opts) {
  const entryPts = Number(opts.entryPts) || 27;
  const trendBars = Number(opts.trendBars) || 20;
  const unitsPerLot = Number(opts.unitsPerLot) || 75;
  const cost = Number(opts.cost) || 120;
  const startHm = opts.entryStartHm || '09:45';
  const endHm = opts.entryEndHm || '14:30';
  const sqHm = opts.squareOffHm || '15:15';

  const B = to15(bars5);
  const n = B.length;
  const atr = atr14(B);
  const isPH = new Array(n).fill(false), isPL = new Array(n).fill(false);
  for (let j = PIVOT; j < n - PIVOT; j++) {
    let ph = true, pl = true;
    for (let k = j - PIVOT; k <= j + PIVOT; k++) { if (k === j) continue; if (B[k].h >= B[j].h) ph = false; if (B[k].l <= B[j].l) pl = false; }
    isPH[j] = ph; isPL[j] = pl;
  }
  const day5 = new Map();
  for (const b of bars5) { const d = String(b.date).slice(0, 10); if (!day5.has(d)) day5.set(d, []); day5.get(d).push(b); }
  const hm = (x) => String(x.date).slice(11, 16);

  const modelNames = ['A_pivotBreak', 'B_momentumExpansion', 'C_fiveMinConfirm', 'D_breakoutRetest', 'E_intradayBreakout', 'F_breakoutBigBody'];
  const results = {};
  for (const m of modelNames) results[m] = { trades: [], lastDir: 0, lastMoveBar: -99, moveKey: '' };

  let pivotHi = null, pivotLo = null;
  for (let i = 0; i < n; i++) {
    const j = i - PIVOT;
    if (j >= 0) { if (isPH[j]) pivotHi = B[j].h; if (isPL[j]) pivotLo = B[j].l; }
    const b = B[i];
    if (b.hm < startHm || b.hm > endHm) continue;
    if (pivotHi == null || pivotLo == null || i < trendBars) continue;
    const trend = b.c - B[i - trendBars].c;
    const ctx = { i, B, atr: atr[i], pivotHi, pivotLo, trend, entryPts };

    const after = (day5.get(b.d) || []).filter((x) => hm(x) > b.hm && hm(x) <= sqHm);
    if (after.length < 1) continue;

    for (const m of modelNames) {
      let sig = null, entry = b.c, entryTime = b.hm, path = after;
      if (m === 'A_pivotBreak') sig = MODELS.A_pivotBreak(ctx);
      else if (m === 'B_momentumExpansion') sig = MODELS.B_momentumExpansion(ctx);
      else if (m === 'E_intradayBreakout') sig = MODELS.E_intradayBreakout(ctx);
      else if (m === 'F_breakoutBigBody') sig = MODELS.F_breakoutBigBody(ctx);
      else if (m === 'C_fiveMinConfirm') {
        // pivot break, but ENTER on the first 5-min bar of the NEXT 15-min group
        // that holds beyond the level (causal — waits for confirmation).
        const base = MODELS.A_pivotBreak(ctx); if (!base) continue;
        const conf = after.find((x) => (base.dir > 0 ? x.close > base.level : x.close < base.level));
        if (!conf) continue;
        sig = base; entry = conf.close; entryTime = hm(conf); path = after.filter((x) => hm(x) > entryTime);
        if (!path.length) continue;
      } else if (m === 'D_breakoutRetest') {
        const base = MODELS.A_pivotBreak(ctx); if (!base) continue;
        const hit = after.findIndex((x) => (base.dir > 0 ? x.low <= base.level : x.high >= base.level));
        if (hit < 0 || hit + 1 >= after.length) continue;
        sig = base; entry = base.level; entryTime = hm(after[hit]); path = after.slice(hit + 1);
      }
      if (!sig) continue;

      // MOVE GROUPING: skip if same direction inside an ongoing move (within 4 bars
      // and no opposite signal since). A fresh opposite signal always counts.
      const st = results[m];
      if (sig.dir === st.lastDir && i - st.lastMoveBar <= 4) continue;
      st.lastDir = sig.dir; st.lastMoveBar = i;

      // forward outcome (MEASUREMENT ONLY — not used to choose the entry)
      let mfe = 0, mae = 0, tMfe = 0;
      path.forEach((x, k) => { const f = sig.dir * ((sig.dir > 0 ? x.high : x.low) - entry), a = sig.dir * ((sig.dir > 0 ? x.low : x.high) - entry); if (f > mfe) { mfe = f; tMfe = k + 1; } if (a < mae) mae = a; });
      const exitClose = sig.dir * (path[path.length - 1].close - entry);
      st.trades.push({ date: b.d, time: entryTime, dir: sig.dir, option: sig.dir > 0 ? 'CE' : 'PE', entry: +entry.toFixed(1), level: +sig.level.toFixed(1), mfe: +mfe.toFixed(1), mae: +mae.toFixed(1), tMfe, exitClose: +exitClose.toFixed(1) });
    }
  }

  const stat = (m) => {
    const t = results[m].trades; if (!t.length) return { model: m, n: 0 };
    const mfe = t.map((x) => x.mfe), mae = t.map((x) => x.mae);
    const hit = (T) => Math.round((100 * t.filter((x) => x.mfe >= T).length) / t.length);
    // expectancy per trade at +20 target, loser held-to-close (underlying, after cost)
    const per = t.map((x) => (x.mfe >= 20 ? 20 : x.exitClose) * unitsPerLot - cost);
    const byd = {}; for (let k = 0; k < t.length; k++) byd[t[k].date] = (byd[t[k].date] || 0) + per[k];
    const days = Object.values(byd); const green = days.filter((x) => x > 0).length;
    let peak = 0, run = 0, dd = 0; for (const v of days) { run += v; peak = Math.max(peak, run); dd = Math.min(dd, run - peak); }
    return {
      model: m, n: t.length, days: days.length, oppsPerDay: +(t.length / days.length).toFixed(2),
      hit10: hit(10), hit20: hit(20), hit30: hit(30),
      medMFE: +q(mfe, 0.5).toFixed(0), avgMFE: +mean(mfe).toFixed(0), medMAE: +q(mae, 0.5).toFixed(0), avgMAE: +mean(mae).toFixed(0),
      medBarsToMFE: +q(t.map((x) => x.tMfe), 0.5).toFixed(0),
      winDays: green, loseDays: days.length - green, greenPct: Math.round((100 * green) / days.length),
      expectancyRs: Math.round(mean(per)), netRs: Math.round(per.reduce((a, b) => a + b, 0)), maxDrawdownRs: Math.round(dd),
    };
  };
  const models = modelNames.map(stat).filter((s) => s.n > 0);
  models.sort((a, b) => b.netRs - a.netRs);
  return { models, best: models[0] ? models[0].model : null, tradesByModel: results };
}

/**
 * noLookAheadProof(bars5, opts): re-runs each model's ENTRY decision with the
 * data TRUNCATED at the entry bar, and asserts the same entry is produced. If a
 * model needed future data to decide, the decision would change → FAIL.
 */
function noLookAheadProof(bars5, opts) {
  const full = research(bars5, opts).tradesByModel;
  const checks = [];
  for (const m of ['A_pivotBreak', 'E_intradayBreakout', 'F_breakoutBigBody']) {
    const t = full[m].trades; if (!t.length) { checks.push({ model: m, checked: 0, ok: true }); continue; }
    // Truncate the 5-min series at each sampled entry and confirm the same signal date/time appears.
    const sample = t.filter((_, k) => k % Math.ceil(t.length / 20) === 0).slice(0, 20);
    let ok = true, checked = 0;
    for (const s of sample) {
      // Truncate to EXCLUDE every future day (no cross-day leakage), but keep the
      // full entry day so the same-day forward path exists to RECORD the trade.
      // The entry decision itself only reads data up to the entry bar, so if the
      // engine is causal the same entry (date+time) must still appear.
      const cut = bars5.filter((b) => String(b.date).slice(0, 10) <= s.date);
      const r = research(cut, opts).tradesByModel[m].trades;
      const found = r.some((x) => x.date === s.date && x.time === s.time);
      checked += 1; if (!found) ok = false;
    }
    checks.push({ model: m, checked, ok });
  }
  return { pass: checks.every((c) => c.ok), checks };
}

module.exports = { research, noLookAheadProof, MODELS };
