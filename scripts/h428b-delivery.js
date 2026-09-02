#!/usr/bin/env node
/**
 * H-428-B — DELIVERY-PERCENTAGE CONVICTION
 * Specification frozen before any result was examined (see chat freeze block).
 *
 * PRIMARY: Signal D (z-score of delivery% vs own trailing-60) at horizon 5.
 * Everything else is SECONDARY and cannot rescue a failed primary.
 *
 * LIQUIDITY NEUTRALISATION is the core control: delivery quintiles are formed
 * WITHIN each liquidity quintile then pooled, so "high delivery" cannot
 * degenerate into an illiquidity bet — the audit showed 100%-delivery names
 * are typically illiquid, which is an artifact, not conviction.
 *
 * NO SAME-DAY ENTRY: MTO publishes post-close, so entry is next session OPEN.
 *
 * Usage: node h428b-delivery.js <DATADIR>
 */
const fs = require('fs');
const path = require('path');

const TRAIL = 60, MIN_TV = 1e7, MIN_PX = 10, HZ = [1, 3, 5, 10, 20];
const PRIMARY_SIG = 'D', PRIMARY_HZ = 5;
const ETF_RE = /BEES|ETF|GOLD|LIQUID|NIFTY|SENSEX|INAV|SILVER/i;
const DP_RS = 15 * 1.18;

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const med = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function clusteredT(rows) {
  const n = rows.length; if (n < 20) return 0;
  const m = mean(rows.map((r) => r.v));
  const by = new Map();
  for (const r of rows) by.set(r.sym, (by.get(r.sym) || 0) + (r.v - m));
  let meat = 0; for (const [, s] of by) meat += s * s;
  const se = Math.sqrt(meat) / n;
  return se > 0 ? m / se : 0;
}
function pFromT(t) {
  const z = Math.abs(t); const b = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
  const c = 0.39894228 * Math.exp(-z * z / 2), tt = 1 / (1 + 0.2316419 * z);
  return 2 * c * tt * (b[0] + tt * (b[1] + tt * (b[2] + tt * (b[3] + tt * b[4]))));
}
function boot(a, it = 2000) {
  if (a.length < 20) return [NaN, NaN];
  const m = [];
  for (let i = 0; i < it; i++) { let s = 0; for (let k = 0; k < a.length; k++) s += a[(Math.random() * a.length) | 0]; m.push(s / a.length); }
  m.sort((x, y) => x - y); return [m[(it * 0.025) | 0], m[(it * 0.975) | 0]];
}
function parseMto(t) {
  const o = [];
  for (const l of t.split(/\r?\n/)) {
    if (!l.startsWith('20,')) continue;
    const c = l.split(',');
    if (c.length < 7 || (c[3] || '').trim() !== 'EQ') continue;
    const sym = (c[2] || '').trim(), qty = +c[4], pct = +c[6];
    if (!sym || !(qty > 0) || !Number.isFinite(pct)) continue;
    o.push({ sym, pct });
  }
  return o;
}
function parseLegacy(t) {
  const o = []; const L = t.split(/\r?\n/);
  for (let i = 1; i < L.length; i++) { const c = L[i].split(',');
    if (c.length < 13 || (c[1] || '').trim() !== 'EQ') continue;
    o.push({ sym: c[0].trim(), op: +c[2], cl: +c[5], val: +c[9] }); }
  return o;
}
function parseNew(t) {
  const L = t.split(/\r?\n/); if (!L.length) return [];
  const h = L[0].split(',').map((s) => s.trim()); const ix = (n) => h.indexOf(n);
  const a = ix('TckrSymb'), b = ix('SctySrs'), o1 = ix('OpnPric'), d = ix('ClsPric'), v = ix('TtlTrfVal'), f = ix('FinInstrmTp');
  const o = [];
  for (let i = 1; i < L.length; i++) { const c = L[i].split(',');
    if (c.length < h.length - 4) continue;
    if (f >= 0 && (c[f] || '').trim() !== 'STK') continue;
    if ((c[b] || '').trim() !== 'EQ') continue;
    o.push({ sym: (c[a] || '').trim(), op: +c[o1], cl: +c[d], val: +c[v] }); }
  return o;
}

function main() {
  const DATA = process.argv[2];
  const BRAW = path.join(DATA, 'full', 'raw'), MRAW = path.join(DATA, 'mto', 'raw');
  const bFiles = fs.readdirSync(BRAW).filter((f) => f.endsWith('.csv') && fs.statSync(path.join(BRAW, f)).isFile()).sort();
  const dates = bFiles.map((f) => f.replace('.csv', ''));
  const T = dates.length;

  // ---- load panels ----
  const px = new Map();      // sym -> Map(i -> {op,cl,val})
  const dl = new Map();      // sym -> Map(i -> pct)
  for (let i = 0; i < T; i++) {
    const d = dates[i];
    for (const r of (d > '2024-06-30' ? parseNew : parseLegacy)(fs.readFileSync(path.join(BRAW, `${d}.csv`), 'utf8'))) {
      if (!r.sym || !(r.cl > 0)) continue;
      if (!px.has(r.sym)) px.set(r.sym, new Map());
      px.get(r.sym).set(i, r);
    }
    const mp = path.join(MRAW, `${d}.dat`);
    if (fs.existsSync(mp)) for (const r of parseMto(fs.readFileSync(mp, 'utf8'))) {
      if (!dl.has(r.sym)) dl.set(r.sym, new Map());
      dl.get(r.sym).set(i, r.pct);
    }
  }
  console.log('='.repeat(120));
  console.log('H-428-B — DELIVERY-PERCENTAGE CONVICTION  [spec frozen before any result examined]');
  console.log('='.repeat(120));
  console.log(`sessions ${T}  price symbols ${px.size}  delivery symbols ${dl.size}`);

  // ---- build observations ----
  const obs = [];
  let skipETF = 0, skipLiq = 0, skipHist = 0;
  for (let i = TRAIL; i < T - 21; i++) {
    const rows = [];
    for (const [sym, dm] of dl) {
      if (ETF_RE.test(sym)) { skipETF++; continue; }
      const pm = px.get(sym); if (!pm) continue;
      const cur = pm.get(i); if (!cur || !(cur.cl >= MIN_PX)) continue;
      const todayPct = dm.get(i); if (todayPct == null) continue;
      // trailing stats from PRIOR sessions only
      const hist = [];
      const tv = [];
      for (let k = i - TRAIL; k < i; k++) {
        const p = dm.get(k); if (p != null) hist.push(p);
        const b = pm.get(k); if (b) tv.push(b.val || 0);
      }
      if (hist.length < TRAIL * 0.7 || tv.length < TRAIL * 0.7) { skipHist++; continue; }
      const mtv = med(tv);
      if (!(mtv >= MIN_TV)) { skipLiq++; continue; }
      const hm = mean(hist), hs = sd(hist);
      const below = hist.filter((x) => x <= todayPct).length;
      let persist = 0;
      for (let k = i; k > i - 20; k--) { const p = dm.get(k); if (p != null && p > hm) persist++; else break; }
      rows.push({
        sym, i, mtv,
        A: todayPct,
        B: 100 * below / hist.length,
        C: todayPct - hm,
        D: hs > 0 ? (todayPct - hm) / hs : null,
        E: persist,
      });
    }
    if (rows.length < 100) continue;
    // liquidity quintiles on THIS session
    rows.sort((a, b) => a.mtv - b.mtv);
    rows.forEach((r, k) => { r.lq = Math.min(4, Math.floor(5 * k / rows.length)); });
    // delivery quintiles WITHIN each liquidity quintile  <-- the neutralisation
    for (let L = 0; L < 5; L++) {
      const grp = rows.filter((r) => r.lq === L);
      for (const S of ['A', 'B', 'C', 'D', 'E']) {
        const valid = grp.filter((r) => r[S] != null).sort((a, b) => a[S] - b[S]);
        if (valid.length < 10) continue;
        valid.forEach((r, k) => { r[`q${S}`] = Math.min(4, Math.floor(5 * k / valid.length)); });
      }
    }
    for (const r of rows) obs.push(r);
  }
  console.log(`observations: ${obs.length.toLocaleString()}  (skipped ETF ${skipETF.toLocaleString()}, illiquid ${skipLiq.toLocaleString()}, short-history ${skipHist.toLocaleString()})`);

  // ---- forward abnormal returns: vs equal-weight same-liquidity-bucket mean ----
  // precompute per (session, lq) mean forward return for each horizon
  const bucketRet = new Map();  // `${i}|${lq}|${h}` -> mean
  const fwd = (sym, i, h) => {
    const pm = px.get(sym); if (!pm) return null;
    const a = pm.get(i + 1), b = pm.get(i + 1 + h);
    if (!a || !b || !(a.op > 0) || !(b.cl > 0)) return null;
    return (b.cl / a.op - 1) * 100;               // ENTRY = NEXT SESSION OPEN
  };
  {
    const acc = new Map();
    for (const r of obs) for (const h of HZ) {
      const v = fwd(r.sym, r.i, h); if (v == null) continue;
      const k = `${r.i}|${r.lq}|${h}`;
      if (!acc.has(k)) acc.set(k, []);
      acc.get(k).push(v);
    }
    for (const [k, arr] of acc) if (arr.length >= 5) bucketRet.set(k, mean(arr));
  }
  for (const r of obs) {
    r.ret = {}; r.ab = {};
    for (const h of HZ) {
      const v = fwd(r.sym, r.i, h);
      r.ret[h] = v;
      const bm = bucketRet.get(`${r.i}|${r.lq}|${h}`);
      r.ab[h] = (v != null && bm != null) ? v - bm : null;
    }
  }

  const winOf = (i) => dates[i] <= '2018-12-31' ? 'DEV' : dates[i] <= '2022-12-31' ? 'VALID' : 'TEST';
  for (const r of obs) r.win = winOf(r.i);
  const WINS = ['DEV', 'VALID', 'TEST'];

  // ---- PRIMARY ----
  console.log('\n' + '='.repeat(120));
  console.log(`PRIMARY TEST — Signal ${PRIMARY_SIG} (z-score vs own trailing-60), horizon ${PRIMARY_HZ} sessions`);
  console.log('liquidity-neutralised: delivery quintiles formed WITHIN liquidity quintiles');
  console.log('='.repeat(120));
  console.log('Win     nQ5     nQ1    Q5 abn%   Q1 abn%   SPREAD%   Q5 clustT   p        Q5 med%  Q5 win%  uniqCos');
  const primary = {};
  for (const w of WINS) {
    const q5 = obs.filter((r) => r.win === w && r[`q${PRIMARY_SIG}`] === 4 && r.ab[PRIMARY_HZ] != null);
    const q1 = obs.filter((r) => r.win === w && r[`q${PRIMARY_SIG}`] === 0 && r.ab[PRIMARY_HZ] != null);
    if (q5.length < 200 || q1.length < 200) { console.log(`${w}: INSUFFICIENT (${q5.length}/${q1.length})`); continue; }
    const v5 = q5.map((r) => r.ab[PRIMARY_HZ]), v1 = q1.map((r) => r.ab[PRIMARY_HZ]);
    const t5 = clusteredT(q5.map((r) => ({ sym: r.sym, v: r.ab[PRIMARY_HZ] })));
    primary[w] = { spread: mean(v5) - mean(v1), q5: mean(v5), t5 };
    console.log(`${w.padEnd(6)} ${String(v5.length).padStart(7)} ${String(v1.length).padStart(7)} ` +
      `${mean(v5).toFixed(4).padStart(9)} ${mean(v1).toFixed(4).padStart(9)} ${(mean(v5) - mean(v1)).toFixed(4).padStart(9)} ` +
      `${t5.toFixed(2).padStart(10)} ${pFromT(t5).toExponential(1).padStart(9)} ${med(v5).toFixed(4).padStart(8)} ` +
      `${(100 * v5.filter((x) => x > 0).length / v5.length).toFixed(0).padStart(7)} ${String(new Set(q5.map((r) => r.sym)).size).padStart(8)}`);
  }

  // ---- quintile monotonicity (primary signal & horizon) ----
  console.log(`\nMONOTONICITY — Signal ${PRIMARY_SIG}, h=${PRIMARY_HZ}, abnormal %`);
  console.log('Win      Q1        Q2        Q3        Q4        Q5    |  Q5-Q1');
  for (const w of WINS) {
    const row = [];
    for (let q = 0; q < 5; q++) {
      const v = obs.filter((r) => r.win === w && r[`q${PRIMARY_SIG}`] === q && r.ab[PRIMARY_HZ] != null).map((r) => r.ab[PRIMARY_HZ]);
      row.push(v.length > 100 ? mean(v) : NaN);
    }
    console.log(w.padEnd(7) + row.map((x) => isNaN(x) ? '     n/a ' : x.toFixed(4).padStart(9)).join(' ') + '  |  ' + (row[4] - row[0]).toFixed(4));
  }

  // ---- SIGN CONSISTENCY = stop rule ----
  console.log('\nSTOP RULE — primary DEV->VALID sign consistency');
  if (primary.DEV && primary.VALID) {
    const okSpread = primary.DEV.spread > 0 && primary.VALID.spread > 0;
    const okLong = primary.DEV.q5 > 0 && primary.VALID.q5 > 0;
    console.log(`  spread   DEV ${primary.DEV.spread.toFixed(4)}%  VALID ${primary.VALID.spread.toFixed(4)}%  -> ${okSpread ? 'CONSISTENT' : 'FAILS'}`);
    console.log(`  Q5 long  DEV ${primary.DEV.q5.toFixed(4)}%  VALID ${primary.VALID.q5.toFixed(4)}%  -> ${okLong ? 'CONSISTENT' : 'FAILS'}`);
    console.log(`  Q5 long-only positive in both is REQUIRED (no overnight shorting available).`);
  }

  // ---- SECONDARY family (reported, cannot rescue primary) ----
  console.log('\n' + '='.repeat(120));
  console.log('SECONDARY FAMILY — all 5 signals x 5 horizons (DEV/VALID Q5 long-only abnormal %)');
  console.log('cannot rescue a failed primary; shown for completeness and multiple-testing accounting');
  console.log('='.repeat(120));
  console.log('Sig  Hz     DEV Q5%   VALID Q5%   DEV spr%  VALID spr%   signOK');
  let famCount = 0;
  for (const S of ['A', 'B', 'C', 'D', 'E']) {
    for (const h of HZ) {
      famCount += 2;
      const g = (w, q) => obs.filter((r) => r.win === w && r[`q${S}`] === q && r.ab[h] != null).map((r) => r.ab[h]);
      const d5 = g('DEV', 4), v5 = g('VALID', 4), d1 = g('DEV', 0), v1 = g('VALID', 0);
      if (d5.length < 200 || v5.length < 200) continue;
      const ds = mean(d5) - mean(d1), vs = mean(v5) - mean(v1);
      const ok = mean(d5) > 0 && mean(v5) > 0;
      console.log(`${S}    ${String(h).padStart(2)}  ${mean(d5).toFixed(4).padStart(10)} ${mean(v5).toFixed(4).padStart(11)} ${ds.toFixed(4).padStart(10)} ${vs.toFixed(4).padStart(11)}   ${ok ? 'YES' : 'no'}`);
    }
  }
  console.log(`\nDeclared family size: ${famCount} tests. Bonferroni p<${(0.05 / famCount).toFixed(5)}`);
  fs.writeFileSync(path.join(DATA, 'h428b_obs.json'), JSON.stringify(obs.map((r) => ({ sym: r.sym, i: r.i, win: r.win, lq: r.lq, qD: r.qD, ab5: r.ab[5], ret5: r.ret[5] }))));
}
main();
