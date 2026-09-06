/** PHASE 55 — which instrument gives DAILY profit? break with-trend + target,
 *  hold losers to close. Aggregate by day: how many trading days actually trade,
 *  green-day %, avg daily points. args: FILE ENTRY TARGET eEnd sqOff */
const fs = require('fs');
const P = 5, TREND_N = 20;
const FILE = process.argv[2], ENTRY = +process.argv[3], TARGET = +process.argv[4], eEnd = process.argv[5] || '14:30', sqOff = process.argv[6] || '15:15';
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const b5 = raw.map(r => Array.isArray(r) ? { d: r[0].slice(0, 10), hm: r[0].slice(11, 16), o: r[1], h: r[2], l: r[3], c: r[4] } : { d: r.t.slice(0, 10), hm: r.t.slice(11, 16), o: r.o, h: r.h, l: r.l, c: r.c });
const by = new Map();
for (const b of b5) { const [H, M] = b.hm.split(':').map(Number); const mm = H * 60 + Math.floor(M / 15) * 15; const k = b.d + '|' + mm; let g = by.get(k); if (!g) { g = { d: b.d, mm, hm: String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0'), o: b.o, h: b.h, l: b.l, c: b.c }; by.set(k, g); } else { g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); g.c = b.c; } }
const B = [...by.values()].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.mm - b.mm);
const allDays = new Set(B.map(x => x.d));
const day5 = new Map(); for (const b of b5) { if (!day5.has(b.d)) day5.set(b.d, []); day5.get(b.d).push(b); }
const isPH = Array(B.length).fill(0), isPL = Array(B.length).fill(0);
for (let j = P; j < B.length - P; j++) { let ph = 1, pl = 1; for (let k = j - P; k <= j + P; k++) { if (k === j) continue; if (B[k].h >= B[j].h) ph = 0; if (B[k].l <= B[j].l) pl = 0; } isPH[j] = ph; isPL[j] = pl; }
const dayNet = new Map();
let res = null, sup = null;
for (let i = 0; i < B.length; i++) {
  const j = i - P; if (j >= 0) { if (isPH[j]) res = B[j].h; if (isPL[j]) sup = B[j].l; }
  const b = B[i];
  if (b.hm < '09:45' || b.hm > eEnd || res == null || sup == null || i < TREND_N) continue;
  const body = b.c - b.o, trend = b.c - B[i - TREND_N].c;
  let dir = 0; if (body >= ENTRY && b.c > res) dir = 1; else if (-body >= ENTRY && b.c < sup) dir = -1;
  if (!dir || !((dir > 0 && trend > 0) || (dir < 0 && trend < 0))) continue;
  const after = (day5.get(b.d) || []).filter(x => x.hm > b.hm && x.hm <= sqOff);
  if (!after.length) continue;
  let pts = null; for (const x of after) { if (dir * ((dir > 0 ? x.h : x.l) - b.c) >= TARGET) { pts = TARGET; break; } }
  if (pts == null) pts = dir * (after[after.length - 1].c - b.c);
  dayNet.set(b.d, (dayNet.get(b.d) || 0) + pts);
}
const traded = [...dayNet.keys()];
const green = traded.filter(d => dayNet.get(d) > 0).length;
const name = FILE.split('/').pop().replace('5m.json', '').replace('.json', '');
console.log(`  ${name.padEnd(11)}  trades on ${String(traded.length).padStart(4)}/${allDays.size} days (${(100 * traded.length / allDays.size).toFixed(0)}% of days)  ·  green ${green}/${traded.length} traded days (${(100 * green / traded.length).toFixed(0)}%)  ·  avg ${mean([...dayNet.values()]).toFixed(1)} pt/trading-day  ·  total ${[...dayNet.values()].reduce((a, x) => a + x, 0).toFixed(0)} pt`);
