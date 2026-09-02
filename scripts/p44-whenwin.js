/** PHASE 44 — WHEN DOES THE BREAKOUT WIN? Excursion + condition analysis on the
 *  user's entry: a big 15-min candle (body >= ENTRY_PTS) closing beyond the last
 *  pivot S/R. For each entry, measure how far the UNDERLYING runs FOR (MFE) and
 *  AGAINST (MAE) after entry, the move at fixed horizons, and split winners vs
 *  losers by time-of-day, breakout size, and distance beyond the level.
 *  This tells the right exit and the conditions where CE/PE actually pays.
 *  No look-ahead; entry at the 15-min close; excursions from 5-min bars after. */
const fs = require('fs');
const ENTRY_PTS = +(process.env.ENTRY_PTS || 90);
const PIVOT = 5;
const FILE = process.env.FILE || 'research-data/indexintra/banknifty5m.json';
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const bars5 = raw.map(r => Array.isArray(r)
  ? { t: r[0], d: r[0].slice(0, 10), hm: r[0].slice(11, 16), o: r[1], h: r[2], l: r[3], c: r[4] }
  : { t: r.t, d: r.t.slice(0, 10), hm: r.t.slice(11, 16), o: r.o, h: r.h, l: r.l, c: r.c });
bars5.sort((a, b) => a.t < b.t ? -1 : 1);
function bucket15(hm) { const [H, M] = hm.split(':').map(Number); return H * 60 + Math.floor(M / 15) * 15; }
const by15 = new Map();
for (const b of bars5) { const key = b.d + '|' + bucket15(b.hm); let g = by15.get(key); if (!g) { const mm = bucket15(b.hm); g = { d: b.d, min: mm, hm: String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0'), o: b.o, h: b.h, l: b.l, c: b.c }; by15.set(key, g); } else { g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); g.c = b.c; } }
const bars15 = [...by15.values()].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.min - b.min);
const day5 = new Map(); for (const b of bars5) { if (!day5.has(b.d)) day5.set(b.d, []); day5.get(b.d).push(b); }
const isPH = new Array(bars15.length).fill(false), isPL = new Array(bars15.length).fill(false);
for (let j = PIVOT; j < bars15.length - PIVOT; j++) { let ph = true, pl = true; for (let k = j - PIVOT; k <= j + PIVOT; k++) { if (k === j) continue; if (bars15[k].h >= bars15[j].h) ph = false; if (bars15[k].l <= bars15[j].l) pl = false; } isPH[j] = ph; isPL[j] = pl; }

const ev = [];
let lastRes = null, lastSup = null;
for (let i = 0; i < bars15.length; i++) {
  const j = i - PIVOT;
  if (j >= 0) { if (isPH[j]) lastRes = bars15[j].h; if (isPL[j]) lastSup = bars15[j].l; }
  const b = bars15[i];
  if (b.hm < '09:45' || b.hm > '14:30') continue;
  const body = b.c - b.o;
  let dir = 0, lvl = null;
  if (body >= ENTRY_PTS && lastRes != null && b.c > lastRes) { dir = 1; lvl = lastRes; }
  else if (-body >= ENTRY_PTS && lastSup != null && b.c < lastSup) { dir = -1; lvl = lastSup; }
  if (!dir) continue;
  const entry = b.c;
  const after = (day5.get(b.d) || []).filter(x => x.hm > b.hm && x.hm <= '15:15');
  if (after.length < 3) continue;
  let mfe = 0, mae = 0;
  const atH = {};
  for (let k = 0; k < after.length; k++) {
    const fav = dir * (after[k].h - entry), favL = dir * (after[k].l - entry);
    mfe = Math.max(mfe, fav); mae = Math.min(mae, favL);
    const mins = (k + 1) * 5;
    if ([15, 30, 45, 60].includes(mins)) atH[mins] = dir * (after[k].c - entry);
  }
  const eod = dir * (after[after.length - 1].c - entry);
  ev.push({ d: b.d, hm: b.hm, dir, body: Math.abs(body), beyond: dir * (b.c - lvl), mfe, mae, eod,
    h15: atH[15], h30: atH[30], h45: atH[45], h60: atH[60] });
}

console.log(`PHASE 44 - WHEN DOES THE BREAKOUT WIN?  ${FILE.split('/').pop()}  entry>=${ENTRY_PTS}pt`);
console.log(`  ${ev.length} breakout entries\n`);

console.log('  HOW FAR IT RUNS after entry (points, underlying):');
console.log(`    MFE (best in favour):  median ${pct(ev.map(e => e.mfe), .5).toFixed(0)}   p75 ${pct(ev.map(e => e.mfe), .75).toFixed(0)}   p90 ${pct(ev.map(e => e.mfe), .9).toFixed(0)}`);
console.log(`    MAE (worst against) :  median ${pct(ev.map(e => e.mae), .5).toFixed(0)}   p25 ${pct(ev.map(e => e.mae), .25).toFixed(0)}   p10 ${pct(ev.map(e => e.mae), .10).toFixed(0)}`);
console.log(`    move held to close  :  mean ${mean(ev.map(e => e.eod)).toFixed(1)}   median ${pct(ev.map(e => e.eod), .5).toFixed(0)}   win ${(100 * ev.filter(e => e.eod > 0).length / ev.length).toFixed(0)}%`);
console.log('  move at fixed horizons (mean points in trade direction):');
for (const h of [15, 30, 45, 60]) { const a = ev.map(e => e['h' + h]).filter(x => x != null); console.log(`    +${h}min: mean ${mean(a).toFixed(1)}   win ${(100 * a.filter(x => x > 0).length / a.length).toFixed(0)}%`); }

// continuation: how many reach various favourable targets vs get stopped first
console.log('\n  DOES IT CONTINUE? reach target T (in favour) BEFORE giving back T (against):');
for (const T of [30, 50, 80, 120]) {
  let cont = 0, fail = 0;
  for (const e of ev) { if (e.mfe >= T && -e.mae < T) cont++; else if (-e.mae >= T) fail++; }
  console.log(`    T=${T}pt: continues ${cont} (${(100 * cont / ev.length).toFixed(0)}%)  fails-first ${fail} (${(100 * fail / ev.length).toFixed(0)}%)`);
}

const wr = (arr) => arr.length ? (100 * arr.filter(e => e.eod > 0).length / arr.length) : 0;
const seg = (fn) => ev.filter(fn);
console.log('\n  WHEN WINNING OCCURS — EOD win% + mean move by condition:');
console.log('  by TIME OF DAY:');
for (const [lbl, lo, hi] of [['09:45-11:00', '09:45', '11:00'], ['11:00-12:30', '11:00', '12:30'], ['12:30-14:30', '12:30', '14:30']]) {
  const s = seg(e => e.hm >= lo && e.hm < hi); console.log(`    ${lbl}  n=${String(s.length).padStart(4)}  win ${wr(s).toFixed(0)}%  mean ${mean(s.map(e => e.eod)).toFixed(1)}pt`);
}
console.log('  by BREAKOUT BODY size:');
const bodies = ev.map(e => e.body).sort((a, b) => a - b); const q1 = bodies[Math.floor(bodies.length / 3)], q2 = bodies[Math.floor(2 * bodies.length / 3)];
for (const [lbl, fn] of [[`small (<${q1.toFixed(0)})`, e => e.body < q1], [`mid`, e => e.body >= q1 && e.body < q2], [`big (>=${q2.toFixed(0)})`, e => e.body >= q2]]) {
  const s = seg(fn); console.log(`    ${lbl.padEnd(14)} n=${String(s.length).padStart(4)}  win ${wr(s).toFixed(0)}%  mean ${mean(s.map(e => e.eod)).toFixed(1)}pt`);
}
console.log('  by DIRECTION:');
for (const [lbl, d] of [['BUY (break res)', 1], ['SELL (break sup)', -1]]) { const s = seg(e => e.dir === d); console.log(`    ${lbl.padEnd(16)} n=${String(s.length).padStart(4)}  win ${wr(s).toFixed(0)}%  mean ${mean(s.map(e => e.eod)).toFixed(1)}pt`); }
