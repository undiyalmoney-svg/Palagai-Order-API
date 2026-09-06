/** PHASE 51 — find the BEST CONFIRMED ENTRY at S/R. Tests break vs bounce,
 *  with-trend vs against, on confirmed pivot S/R (pivotLen 5). Forward outcome:
 *  win held-to-close and reach of the min-safe target. Full history for stats;
 *  last-3-weeks slice reported too. Instrument passed as arg. */
const fs = require('fs');
const P = 5;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const FILE = process.argv[2], ENTRY = +process.argv[3], TARGET = +process.argv[4], TREND_N = 20;
const eEnd = process.argv[5] || '14:30', sqOff = process.argv[6] || '15:15', eStart = '09:45';
const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const b5 = raw.map(r => Array.isArray(r) ? { d: r[0].slice(0, 10), hm: r[0].slice(11, 16), o: r[1], h: r[2], l: r[3], c: r[4] } : { d: r.t.slice(0, 10), hm: r.t.slice(11, 16), o: r.o, h: r.h, l: r.l, c: r.c });
const by = new Map();
for (const b of b5) { const [H, M] = b.hm.split(':').map(Number); const mm = H * 60 + Math.floor(M / 15) * 15; const k = b.d + '|' + mm; let g = by.get(k); if (!g) { g = { d: b.d, mm, hm: String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0'), o: b.o, h: b.h, l: b.l, c: b.c }; by.set(k, g); } else { g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); g.c = b.c; } }
const B = [...by.values()].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.mm - b.mm);
const day5 = new Map(); for (const b of b5) { if (!day5.has(b.d)) day5.set(b.d, []); day5.get(b.d).push(b); }
const isPH = Array(B.length).fill(0), isPL = Array(B.length).fill(0);
for (let j = P; j < B.length - P; j++) { let ph = 1, pl = 1; for (let k = j - P; k <= j + P; k++) { if (k === j) continue; if (B[k].h >= B[j].h) ph = 0; if (B[k].l <= B[j].l) pl = 0; } isPH[j] = ph; isPL[j] = pl; }

// collect signals with type/dir/trend + forward outcome
const ev = [];
let res = null, sup = null;
for (let i = 0; i < B.length; i++) {
  const j = i - P; if (j >= 0) { if (isPH[j]) res = B[j].h; if (isPL[j]) sup = B[j].l; }
  const b = B[i];
  if (b.hm < eStart || b.hm > eEnd || res == null || sup == null) continue;
  if (i < TREND_N) continue;
  const body = b.c - b.o, rng = b.h - b.l; if (rng <= 0) continue;
  const tol = 0.0008 * b.c;
  const trend = b.c - B[i - TREND_N].c;                 // >0 up, <0 down
  // classify entry
  let type = null, dir = 0;
  if (body >= ENTRY && b.c > res) { type = 'BREAK'; dir = 1; }
  else if (-body >= ENTRY && b.c < sup) { type = 'BREAK'; dir = -1; }
  else if (b.l <= sup + tol && b.c > sup && b.c > b.o) { type = 'BOUNCE'; dir = 1; }
  else if (b.h >= res - tol && b.c < res && b.c < b.o) { type = 'BOUNCE'; dir = -1; }
  if (!type) continue;
  const withTrend = (dir > 0 && trend > 0) || (dir < 0 && trend < 0);
  // forward outcome
  const after = (day5.get(b.d) || []).filter(x => x.hm > b.hm && x.hm <= sqOff);
  if (after.length < 2) continue;
  const entry = b.c; let hitTgt = false;
  for (const x of after) { if (dir * ((dir > 0 ? x.h : x.l) - entry) >= TARGET) { hitTgt = true; break; } }
  const eod = dir * (after[after.length - 1].c - entry);
  ev.push({ d: b.d, type, dir, withTrend, hitTgt, eod });
}

function stat(s) {
  if (!s.length) return null;
  return { n: s.length, tgt: 100 * s.filter(e => e.hitTgt).length / s.length, winClose: 100 * s.filter(e => e.eod > 0).length / s.length, avgEod: mean(s.map(e => e.eod)) };
}
const name = FILE.split('/').pop().replace('5m.json', '').replace('.json', '');
console.log(`\n===== ${name}  entry>=${ENTRY}  target=${TARGET}  (${ev.length} signals) =====`);
console.log('  ENTRY TYPE               n     hit-target   win@close   avgMove');
for (const [lbl, f] of [
  ['BREAK  with-trend', e => e.type === 'BREAK' && e.withTrend],
  ['BREAK  against', e => e.type === 'BREAK' && !e.withTrend],
  ['BOUNCE with-trend', e => e.type === 'BOUNCE' && e.withTrend],
  ['BOUNCE against', e => e.type === 'BOUNCE' && !e.withTrend],
]) {
  const s = stat(ev.filter(f)); if (!s) { console.log('  ' + lbl.padEnd(22) + ' none'); continue; }
  console.log(`  ${lbl.padEnd(22)} ${String(s.n).padStart(5)}   ${s.tgt.toFixed(0).padStart(5)}%       ${s.winClose.toFixed(0).padStart(3)}%       ${s.avgEod.toFixed(1)}`);
}
// last 3 weeks slice
const cut = '2026-08-13';
const wk = ev.filter(e => e.d >= cut);
console.log(`  --- last 3 weeks (${wk.length} signals) best type by win@close: ---`);
const types = [['BREAK w-trend', e => e.type === 'BREAK' && e.withTrend], ['BOUNCE w-trend', e => e.type === 'BOUNCE' && e.withTrend]];
for (const [lbl, f] of types) { const s = stat(wk.filter(f)); if (s) console.log(`    ${lbl.padEnd(16)} n=${s.n}  hit-tgt ${s.tgt.toFixed(0)}%  win ${s.winClose.toFixed(0)}%`); }
