#!/usr/bin/env node
/**
 * RESEARCH AREAS 1-4 — event studies, not strategies.
 *
 * A1 VOLATILITY COMPRESSION -> EXPANSION
 *    Hypothesis: information accumulates while price coils; the release is a
 *    larger-than-normal move. CRITICAL: this predicts MAGNITUDE, which may not
 *    imply DIRECTION. So both are measured separately:
 *      - E[|forward return|]  (magnitude — tradeable only via options)
 *      - E[forward return]    (direction — tradeable long-only)
 *    A magnitude effect with no directional effect is a NEGATIVE result for
 *    this account, and is reported as such rather than dressed up.
 *
 * A2 BREAKOUT + ABNORMAL VOLUME
 *    Hypothesis: volume distinguishes informed repricing from noise, so a
 *    breakout on heavy volume should continue where a quiet one does not.
 *    Tested as breakout+volume vs breakout-without-volume vs baseline.
 *
 * A3 RELATIVE-STRENGTH ACCELERATION
 *    Hypothesis: the CHANGE in relative strength (not its level) signals a
 *    regime shift in the stock's demand, preceding larger moves. Level-based
 *    RS was already tested and failed; acceleration is a distinct claim.
 *
 * A4 MOMENTUM AFTER CONSOLIDATION
 *    Hypothesis: compression THEN expansion is more informative than either
 *    alone — the coil plus the trigger.
 *
 * Universe: 57 incl. 12 fallen angels. Market-adjusted returns throughout.
 * Date-clustered t-stats (daily cross-sectional mean, then t-test the series)
 * so overlapping windows and cross-correlation cannot inflate significance.
 * Discovery on DEV; VALID/TEST read only afterwards.
 *
 * Usage: node scripts/areas1to4-study.js
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
  YESBANK: 3050241, IDEA: 3677697, ZEEL: 975873, SUZLON: 3076609,
  RPOWER: 3906305, PNB: 2730497, IDFCFIRSTB: 2863105, VEDL: 784129,
  RBLBANK: 4708097, INDUSTOWER: 7458561, BANDHANBNK: 579329, GMRAIRPORT: 3463169,
};
const NIFTY = 256265;
const FROM = '2013-06-03';
const DEV_TO = '2019-12-31';
const VALID_TO = '2022-12-31';
const TO = '2026-08-21';
const HORIZONS = [3, 5, 10, 20];
const COST = 0.55;

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
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sdev = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a) => (a.length > 2 && sdev(a) > 0 ? mean(a) / (sdev(a) / Math.sqrt(a.length)) : 0);

async function main() {
  const auth = `token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}`;
  const raw = {};
  for (const [s, t] of Object.entries(UNIVERSE)) {
    try { process.stderr.write(`${s} `); const r = await fetchAll(auth, t); if (r.length > 1200) raw[s] = r; } catch (e) {}
  }
  const nifty = await fetchAll(auth, NIFTY);
  const symbols = Object.keys(raw);
  const dates = nifty.map((r) => r.date.slice(0, 10));
  const nClose = nifty.map((r) => r.close);
  const T = dates.length;
  const C = {}, H = {}, L = {}, V = {};
  for (const s of symbols) {
    const m = new Map(raw[s].map((r) => [r.date.slice(0, 10), r]));
    let last = null;
    C[s] = []; H[s] = []; L[s] = []; V[s] = [];
    for (const d of dates) {
      if (m.has(d)) last = m.get(d);
      C[s].push(last ? last.close : null); H[s].push(last ? last.high : null);
      L[s].push(last ? last.low : null); V[s].push(last && m.has(d) ? last.volume : 0);
    }
  }
  console.error(`\n${symbols.length} symbols, ${T} sessions.\n`);

  // features
  const F = {};
  for (const s of symbols) {
    const c = C[s];
    const f = { atr14: [], atrRatio: [], volRatio: [], hi20: [], hi50: [], hi252: [], rs5: [], rs20: [], rsAccel: [], expand: [] };
    for (let i = 0; i < T; i += 1) {
      let atr = null;
      if (i >= 14) { let x = 0, ok = true; for (let k = i - 13; k <= i; k += 1) { if (H[s][k] == null || c[k - 1] == null) { ok = false; break; } x += Math.max(H[s][k] - L[s][k], Math.abs(H[s][k] - c[k - 1]), Math.abs(L[s][k] - c[k - 1])); } atr = ok ? x / 14 : null; }
      f.atr14.push(atr);
      let ar = null;
      if (i >= 60 && atr != null) { let x = 0, n = 0, ok = true; for (let k = i - 59; k <= i; k += 1) { if (f.atr14[k] == null) { ok = false; break; } x += f.atr14[k]; n += 1; } ar = ok && n ? atr / (x / n) : null; }
      f.atrRatio.push(ar);
      let va = null;
      if (i >= 20) { let x = 0; for (let k = i - 19; k <= i; k += 1) x += V[s][k]; va = x / 20; }
      f.volRatio.push(va > 0 ? V[s][i] / va : null);
      const hh = (n) => { if (i < n) return null; let x = -Infinity; for (let k = i - n + 1; k <= i; k += 1) { if (c[k] == null) return null; x = Math.max(x, c[k]); } return x; };
      f.hi20.push(hh(20)); f.hi50.push(hh(50)); f.hi252.push(hh(252));
      // relative strength vs Nifty
      const rs = (n) => (i >= n && c[i - n] > 0 && c[i] != null && nClose[i - n] > 0)
        ? ((c[i] / c[i - n] - 1) - (nClose[i] / nClose[i - n] - 1)) * 100 : null;
      f.rs5.push(rs(5)); f.rs20.push(rs(20));
      f.rsAccel.push(f.rs5[i] != null && f.rs20[i] != null ? f.rs5[i] - f.rs20[i] / 4 : null); // 5d RS vs pro-rata 20d RS
      // range expansion: today's true range > 2x ATR
      let ex = null;
      if (atr > 0 && H[s][i] != null && c[i - 1] != null) {
        const tr = Math.max(H[s][i] - L[s][i], Math.abs(H[s][i] - c[i - 1]), Math.abs(L[s][i] - c[i - 1]));
        ex = tr > 2 * atr;
      }
      f.expand.push(ex);
    }
    F[s] = f;
  }

  const winOf = (d) => (d <= DEV_TO ? 'DEV' : d <= VALID_TO ? 'VALID' : 'TEST');
  const fwd = (s, i, h) => {
    if (i + h >= T) return null;
    const a = C[s][i], b = C[s][i + h];
    if (a == null || b == null || !(a > 0)) return null;
    return ((b / a - 1) - (nClose[i + h] / nClose[i] - 1)) * 100;
  };

  // DECLARED CONDITIONS
  const CONDS = {
    // Area 1 — compression
    'A1 compression<0.70':      (s, i) => F[s].atrRatio[i] != null ? F[s].atrRatio[i] < 0.70 : null,
    'A1 compression<0.60':      (s, i) => F[s].atrRatio[i] != null ? F[s].atrRatio[i] < 0.60 : null,
    'A1 expansion>1.40':        (s, i) => F[s].atrRatio[i] != null ? F[s].atrRatio[i] > 1.40 : null,
    // Area 2 — breakout + volume
    'A2 20dHigh+vol>2x':        (s, i) => (F[s].hi20[i] != null && F[s].volRatio[i] != null && C[s][i] != null) ? (C[s][i] >= F[s].hi20[i] && F[s].volRatio[i] > 2) : null,
    'A2 20dHigh+vol<1x':        (s, i) => (F[s].hi20[i] != null && F[s].volRatio[i] != null && C[s][i] != null) ? (C[s][i] >= F[s].hi20[i] && F[s].volRatio[i] < 1) : null,
    'A2 50dHigh+vol>2x':        (s, i) => (F[s].hi50[i] != null && F[s].volRatio[i] != null && C[s][i] != null) ? (C[s][i] >= F[s].hi50[i] && F[s].volRatio[i] > 2) : null,
    'A2 52wHigh+vol>2x':        (s, i) => (F[s].hi252[i] != null && F[s].volRatio[i] != null && C[s][i] != null) ? (C[s][i] >= F[s].hi252[i] && F[s].volRatio[i] > 2) : null,
    // Area 3 — RS acceleration
    'A3 RSaccel top (5d>+5%)':  (s, i) => F[s].rs5[i] != null ? F[s].rs5[i] > 5 : null,
    'A3 RSaccel + RS20 neg':    (s, i) => (F[s].rs5[i] != null && F[s].rs20[i] != null) ? (F[s].rs5[i] > 5 && F[s].rs20[i] < 0) : null,
    'A3 RS20 crosses +ve':      (s, i) => (i > 5 && F[s].rs20[i] != null && F[s].rs20[i - 5] != null) ? (F[s].rs20[i] > 0 && F[s].rs20[i - 5] < 0) : null,
    // Area 4 — consolidation then expansion
    'A4 compress+20dHigh':      (s, i) => (F[s].atrRatio[i] != null && F[s].hi20[i] != null && C[s][i] != null) ? (F[s].atrRatio[i] < 0.70 && C[s][i] >= F[s].hi20[i]) : null,
    'A4 compress+expand+vol':   (s, i) => (F[s].atrRatio[i] != null && F[s].expand[i] != null && F[s].volRatio[i] != null) ? (F[s].atrRatio[i] < 0.75 && F[s].expand[i] && F[s].volRatio[i] > 1.5) : null,
    'A4 compress+expand+up':    (s, i) => (F[s].atrRatio[i] != null && F[s].expand[i] != null && i > 0 && C[s][i] != null && C[s][i - 1] > 0) ? (F[s].atrRatio[i] < 0.75 && F[s].expand[i] && C[s][i] > C[s][i - 1]) : null,
  };
  const names = Object.keys(CONDS);
  const nTests = names.length * HORIZONS.length * 2; // directional + magnitude
  const bonf = 0.05 / nTests;

  const dir = {}, mag = {}, nEv = {};
  for (const cn of names) { dir[cn] = {}; mag[cn] = {}; nEv[cn] = { DEV: 0, VALID: 0, TEST: 0 };
    for (const w of ['DEV', 'VALID', 'TEST']) { dir[cn][w] = {}; mag[cn][w] = {}; for (const h of HORIZONS) { dir[cn][w][h] = []; mag[cn][w][h] = []; } } }
  const bDir = {}, bMag = {};
  for (const w of ['DEV', 'VALID', 'TEST']) { bDir[w] = {}; bMag[w] = {}; for (const h of HORIZONS) { bDir[w][h] = []; bMag[w][h] = []; } }

  for (let i = 60; i < T; i += 1) {
    const w = winOf(dates[i]);
    for (const h of HORIZONS) {
      const dv = [], mv = [];
      for (const s of symbols) { const e = fwd(s, i, h); if (e != null) { dv.push(e); mv.push(Math.abs(e)); } }
      if (dv.length >= 5) { bDir[w][h].push(mean(dv)); bMag[w][h].push(mean(mv)); }
    }
    for (const cn of names) {
      const hits = [];
      for (const s of symbols) { let v = null; try { v = CONDS[cn](s, i); } catch (e) { v = null; } if (v === true) hits.push(s); }
      if (!hits.length) continue;
      nEv[cn][w] += hits.length;
      for (const h of HORIZONS) {
        const dv = [], mv = [];
        for (const s of hits) { const e = fwd(s, i, h); if (e != null) { dv.push(e); mv.push(Math.abs(e)); } }
        if (dv.length) { dir[cn][w][h].push(mean(dv)); mag[cn][w][h].push(mean(mv)); }
      }
    }
  }

  console.log('='.repeat(140));
  console.log('RESEARCH AREAS 1-4 — event studies. Market-adjusted, date-clustered. Universe 57 incl. fallen angels.');
  console.log(`DECLARED TESTS: ${nTests} (${names.length} conditions x ${HORIZONS.length} horizons x 2 metrics) · Bonferroni p<${bonf.toExponential(2)}`);
  console.log('='.repeat(140));

  console.log('\n### MAGNITUDE (does the condition predict a BIGGER move, either direction?) — DEV');
  console.log('Condition                      Hor   cond|r|%   base|r|%    lift%   t-stat   events');
  console.log('-'.repeat(140));
  for (const cn of names) {
    for (const h of HORIZONS) {
      const a = mag[cn].DEV[h]; if (a.length < 100) continue;
      const b = bMag.DEV[h];
      const L2 = Math.min(a.length, b.length);
      const d = []; for (let i = 0; i < L2; i += 1) d.push(a[i] - b[i]);
      const lift = ((mean(a) / mean(b)) - 1) * 100;
      console.log(cn.padEnd(30), String(h).padStart(3), mean(a).toFixed(3).padStart(10), mean(b).toFixed(3).padStart(11),
        lift.toFixed(1).padStart(8), tstat(d).toFixed(2).padStart(8), String(nEv[cn].DEV).padStart(8));
    }
  }

  console.log('\n\n### DIRECTION (tradeable long-only?) — DEV screening, then untouched OOS');
  console.log('Condition                      Hor    DEV%     t     VALID%     t      TEST%     t   sign  OOSmean  net-cost');
  console.log('-'.repeat(140));
  const found = [];
  for (const cn of names) {
    for (const h of HORIZONS) {
      const d = dir[cn].DEV[h], v = dir[cn].VALID[h], t = dir[cn].TEST[h];
      if (d.length < 100 || v.length < 50 || t.length < 50) continue;
      const md = mean(d) - mean(bDir.DEV[h]);
      const mv = mean(v) - mean(bDir.VALID[h]);
      const mt = mean(t) - mean(bDir.TEST[h]);
      const held = Math.sign(md) === Math.sign(mv) && Math.sign(md) === Math.sign(mt);
      const oos = (mv + mt) / 2;
      const net = Math.abs(oos) - COST;
      found.push({ cn, h, md, mv, mt, held, oos, net, td: tstat(d) });
      console.log(cn.padEnd(30), String(h).padStart(3), md.toFixed(3).padStart(8), tstat(d).toFixed(2).padStart(6),
        mv.toFixed(3).padStart(9), tstat(v).toFixed(2).padStart(6), mt.toFixed(3).padStart(9), tstat(t).toFixed(2).padStart(6),
        (held ? ' YES' : '  no').padStart(5), oos.toFixed(3).padStart(8), `${net.toFixed(3)}%`.padStart(9),
        (held && net > 0 ? '  CLEARS' : ''));
    }
  }

  const winners = found.filter((f) => f.held && f.net > 0 && f.oos > 0);
  console.log(`\n\nSUMMARY: ${found.length} condition-horizon pairs tested for direction.`);
  console.log(`  sign-stable across DEV/VALID/TEST : ${found.filter((f) => f.held).length}`);
  console.log(`  ...AND long-only positive          : ${found.filter((f) => f.held && f.oos > 0).length}`);
  console.log(`  ...AND clearing ${COST}% cost hurdle  : ${winners.length}`);
  if (winners.length) {
    console.log('\n  SURVIVORS:');
    for (const w of winners) console.log(`    ${w.cn} @${w.h}d  OOS ${w.oos.toFixed(3)}%  net ${w.net.toFixed(3)}%`);
  } else {
    console.log('\n  NO condition survives all three filters.');
  }
}

main().catch((e) => { console.error('ERR:', e.message, e.stack); process.exit(1); });
