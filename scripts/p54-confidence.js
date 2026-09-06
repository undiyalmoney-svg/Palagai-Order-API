/** PHASE 54 — CONFIDENCE METER. For each break entry, score the setup 0-3 from
 *  features that predict continuation (big body / with-trend / mid-gap), then
 *  measure how often each score reaches +10/+20/+30/+50 (underlying MFE).
 *  A higher score = higher confidence of a bigger target. args: FILE ENTRY eEnd sqOff */
const fs = require('fs');
const P = 5, TREND_N = 20;
const FILE = process.argv[2], ENTRY = +process.argv[3], eEnd = process.argv[4] || '14:30', sqOff = process.argv[5] || '15:15';
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const b5 = raw.map(r => Array.isArray(r) ? { d: r[0].slice(0, 10), hm: r[0].slice(11, 16), o: r[1], h: r[2], l: r[3], c: r[4] } : { d: r.t.slice(0, 10), hm: r.t.slice(11, 16), o: r.o, h: r.h, l: r.l, c: r.c });
const by = new Map();
for (const b of b5) { const [H, M] = b.hm.split(':').map(Number); const mm = H * 60 + Math.floor(M / 15) * 15; const k = b.d + '|' + mm; let g = by.get(k); if (!g) { g = { d: b.d, mm, hm: String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0'), o: b.o, h: b.h, l: b.l, c: b.c }; by.set(k, g); } else { g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); g.c = b.c; } }
const B = [...by.values()].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.mm - b.mm);
const day5 = new Map(); for (const b of b5) { if (!day5.has(b.d)) day5.set(b.d, []); day5.get(b.d).push(b); }
const isPH = Array(B.length).fill(0), isPL = Array(B.length).fill(0);
for (let j = P; j < B.length - P; j++) { let ph = 1, pl = 1; for (let k = j - P; k <= j + P; k++) { if (k === j) continue; if (B[k].h >= B[j].h) ph = 0; if (B[k].l <= B[j].l) pl = 0; } isPH[j] = ph; isPL[j] = pl; }

// pass 1: collect signals with raw features + MFE
const ev = [];
let res = null, sup = null;
for (let i = 0; i < B.length; i++) {
  const j = i - P; if (j >= 0) { if (isPH[j]) res = B[j].h; if (isPL[j]) sup = B[j].l; }
  const b = B[i];
  if (b.hm < '09:45' || b.hm > eEnd || res == null || sup == null || i < TREND_N) continue;
  const body = b.c - b.o, trend = b.c - B[i - TREND_N].c, gap = res - sup;
  let dir = 0; if (body >= ENTRY && b.c > res) dir = 1; else if (-body >= ENTRY && b.c < sup) dir = -1;
  if (!dir) continue;
  const after = (day5.get(b.d) || []).filter(x => x.hm > b.hm && x.hm <= sqOff);
  if (after.length < 2) continue;
  let mfe = 0; for (const x of after) mfe = Math.max(mfe, dir * ((dir > 0 ? x.h : x.l) - b.c));
  ev.push({ body: Math.abs(body), withTrend: (dir > 0 && trend > 0) || (dir < 0 && trend < 0), gap, mfe });
}
// thresholds for scoring
const bodMed = pctl(ev.map(e => e.body), 0.5);
const gaps = ev.map(e => e.gap).sort((a, b) => a - b); const gLo = gaps[Math.floor(gaps.length / 3)], gHi = gaps[Math.floor(2 * gaps.length / 3)];
for (const e of ev) {
  e.score = (e.body >= bodMed ? 1 : 0) + (e.withTrend ? 1 : 0) + (e.gap >= gLo && e.gap < gHi ? 1 : 0);
}
const name = FILE.split('/').pop().replace('5m.json', '').replace('.json', '');
const Ts = name.includes('bank') ? [20, 40, 60, 100] : [10, 20, 30, 50];
console.log(`\n===== ${name}  CONFIDENCE METER  (${ev.length} breaks) =====`);
console.log('  score = big-body + with-trend + mid-gap (each 0/1)');
console.log('  score   n      reach ' + Ts.map(t => '+' + t).join('    reach ') + '     medMFE');
for (let sc = 0; sc <= 3; sc++) {
  const s = ev.filter(e => e.score === sc); if (!s.length) continue;
  let line = `  ${sc}     ${String(s.length).padStart(5)}   `;
  for (const T of Ts) line += `${(100 * s.filter(e => e.mfe >= T).length / s.length).toFixed(0).padStart(3)}%    `;
  line += `   ${pctl(s.map(e => e.mfe), 0.5).toFixed(0)}`;
  console.log(line);
}
console.log('  → read the score at entry: pick the biggest target still reached ~80%+.');
