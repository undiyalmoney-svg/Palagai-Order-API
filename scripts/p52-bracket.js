/** PHASE 52 — BEST ENTRY + target/stop bracket. Entry = BREAK with-trend on
 *  confirmed pivot S/R. Exit: +TARGET or -STOP (stop wins on tie, conservative),
 *  else square-off. Measures which hits first, win%, net points. All 3, last-3wk
 *  + full history. args: FILE ENTRY TARGET STOP eEnd sqOff */
const fs = require('fs');
const P = 5, TREND_N = 20;
const FILE = process.argv[2], ENTRY = +process.argv[3], TARGET = +process.argv[4], STOP = +process.argv[5];
const eEnd = process.argv[6] || '14:30', sqOff = process.argv[7] || '15:15', eStart = '09:45';
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const b5 = raw.map(r => Array.isArray(r) ? { d: r[0].slice(0, 10), hm: r[0].slice(11, 16), o: r[1], h: r[2], l: r[3], c: r[4] } : { d: r.t.slice(0, 10), hm: r.t.slice(11, 16), o: r.o, h: r.h, l: r.l, c: r.c });
const by = new Map();
for (const b of b5) { const [H, M] = b.hm.split(':').map(Number); const mm = H * 60 + Math.floor(M / 15) * 15; const k = b.d + '|' + mm; let g = by.get(k); if (!g) { g = { d: b.d, mm, hm: String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0'), o: b.o, h: b.h, l: b.l, c: b.c }; by.set(k, g); } else { g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); g.c = b.c; } }
const B = [...by.values()].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.mm - b.mm);
const day5 = new Map(); for (const b of b5) { if (!day5.has(b.d)) day5.set(b.d, []); day5.get(b.d).push(b); }
const isPH = Array(B.length).fill(0), isPL = Array(B.length).fill(0);
for (let j = P; j < B.length - P; j++) { let ph = 1, pl = 1; for (let k = j - P; k <= j + P; k++) { if (k === j) continue; if (B[k].h >= B[j].h) ph = 0; if (B[k].l <= B[j].l) pl = 0; } isPH[j] = ph; isPL[j] = pl; }

const T = [];
let res = null, sup = null;
for (let i = 0; i < B.length; i++) {
  const j = i - P; if (j >= 0) { if (isPH[j]) res = B[j].h; if (isPL[j]) sup = B[j].l; }
  const b = B[i];
  if (b.hm < eStart || b.hm > eEnd || res == null || sup == null || i < TREND_N) continue;
  const body = b.c - b.o;
  const trend = b.c - B[i - TREND_N].c;
  let dir = 0;
  if (body >= ENTRY && b.c > res) dir = 1; else if (-body >= ENTRY && b.c < sup) dir = -1;
  if (!dir) continue;
  if (!((dir > 0 && trend > 0) || (dir < 0 && trend < 0))) continue;   // with-trend only
  const entry = b.c;
  const after = (day5.get(b.d) || []).filter(x => x.hm > b.hm && x.hm <= sqOff);
  if (!after.length) continue;
  let pts = null, reason = null;
  for (const x of after) {
    const adv = dir * ((dir > 0 ? x.l : x.h) - entry);   // worst
    const fav = dir * ((dir > 0 ? x.h : x.l) - entry);   // best
    if (adv <= -STOP) { pts = -STOP; reason = 'STOP'; break; }   // stop wins on tie
    if (fav >= TARGET) { pts = TARGET; reason = 'TARGET'; break; }
  }
  if (pts == null) { pts = dir * (after[after.length - 1].c - entry); reason = 'CLOSE'; }
  T.push({ d: b.d, pts, reason });
}
function rpt(s) {
  if (!s.length) return null;
  const w = s.filter(x => x.pts > 0);
  return { n: s.length, win: 100 * w.length / s.length, net: s.reduce((a, x) => a + x.pts, 0), perTr: mean(s.map(x => x.pts)),
    tgt: 100 * s.filter(x => x.reason === 'TARGET').length / s.length, stop: 100 * s.filter(x => x.reason === 'STOP').length / s.length };
}
const name = FILE.split('/').pop().replace('5m.json', '').replace('.json', '');
const be = 100 * STOP / (TARGET + STOP);
console.log(`\n===== ${name}  BREAK w-trend + tgt ${TARGET}/stop ${STOP}  (breakeven win ${be.toFixed(0)}%) =====`);
for (const [lbl, s] of [['FULL history', T], ['last 3 weeks', T.filter(x => x.d >= '2026-08-13')]]) {
  const r = rpt(s); if (!r) { console.log('  ' + lbl + ': none'); continue; }
  console.log(`  ${lbl.padEnd(14)} n=${String(r.n).padStart(4)}  win ${r.win.toFixed(0)}%  net ${r.net.toFixed(0)}pt  (${r.perTr.toFixed(1)}/trade)  [tgt ${r.tgt.toFixed(0)}% / stop ${r.stop.toFixed(0)}%]`);
}
