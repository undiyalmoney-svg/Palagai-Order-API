/** PHASE 50 — S/R GAP + BREAKOUT CONTINUATION study, all 3 instruments.
 *  Answers: which S/R gap gives more opportunities; what confirms a break; does
 *  it continue; will it reach the opposite level; min safe profit to exit.
 *  Breakout = 15-min body >= ENTRY closing beyond a CONFIRMED pivot S/R
 *  (pivotLen 5). For each, measure the S/R gap it broke from, forward MFE/MAE,
 *  and target reach. Full history so S/R is established. */
const fs = require('fs');
const P = 5;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

function load(file, arr) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw.map(r => Array.isArray(r)
    ? { d: r[0].slice(0, 10), hm: r[0].slice(11, 16), o: r[1], h: r[2], l: r[3], c: r[4] }
    : { d: r.t.slice(0, 10), hm: r.t.slice(11, 16), o: r.o, h: r.h, l: r.l, c: r.c });
}
function build15(b5) {
  const by = new Map();
  for (const b of b5) { const [H, M] = b.hm.split(':').map(Number); const mm = H * 60 + Math.floor(M / 15) * 15; const k = b.d + '|' + mm;
    let g = by.get(k); if (!g) { g = { d: b.d, mm, hm: String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0'), o: b.o, h: b.h, l: b.l, c: b.c }; by.set(k, g); }
    else { g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); g.c = b.c; } }
  return [...by.values()].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.mm - b.mm);
}

function study(name, file, ENTRY, entryEndHm, squareOffHm) {
  const b5 = load(file);
  const B = build15(b5);
  const day5 = new Map(); for (const b of b5) { if (!day5.has(b.d)) day5.set(b.d, []); day5.get(b.d).push(b); }
  const isPH = Array(B.length).fill(0), isPL = Array(B.length).fill(0);
  for (let j = P; j < B.length - P; j++) { let ph = 1, pl = 1; for (let k = j - P; k <= j + P; k++) { if (k === j) continue; if (B[k].h >= B[j].h) ph = 0; if (B[k].l <= B[j].l) pl = 0; } isPH[j] = ph; isPL[j] = pl; }

  const ev = [];
  let res = null, sup = null;
  for (let i = 0; i < B.length; i++) {
    const j = i - P; if (j >= 0) { if (isPH[j]) res = B[j].h; if (isPL[j]) sup = B[j].l; }
    const b = B[i];
    if (b.hm < '09:45' || b.hm > entryEndHm) continue;
    if (res == null || sup == null) continue;
    const body = b.c - b.o;
    let dir = 0;
    if (body >= ENTRY && b.c > res) dir = 1;
    else if (-body >= ENTRY && b.c < sup) dir = -1;
    if (!dir) continue;
    const gap = res - sup;                       // the S/R gap it broke from
    // forward excursions on 5-min after entry
    const after = (day5.get(b.d) || []).filter(x => x.hm > b.hm && x.hm <= squareOffHm);
    if (after.length < 2) continue;
    const entry = b.c; let mfe = 0, mae = 0;
    for (const x of after) { mfe = Math.max(mfe, dir * (x.h - entry)); mae = Math.min(mae, dir * (x.l - entry)); }
    const eod = dir * (after[after.length - 1].c - entry);
    ev.push({ dir, gap, body: Math.abs(body), mfe, mae, eod, entry });
  }

  console.log(`\n===== ${name}  (${ev.length} breakouts, entry>=${ENTRY}) =====`);
  // Q: which S/R GAP gives more opportunities + better continuation?
  const gaps = ev.map(e => e.gap).sort((a, b) => a - b);
  const g33 = gaps[Math.floor(gaps.length / 3)], g66 = gaps[Math.floor(2 * gaps.length / 3)];
  console.log(`  S/R GAP buckets (gap = resistance − support at the break):`);
  console.log(`  gap band         n     medMFE  medMAE  MFE/MAE  win@close  reach 1.0×gap`);
  for (const [lbl, lo, hi] of [[`tight (<${g33.toFixed(0)})`, 0, g33], [`mid`, g33, g66], [`wide (>=${g66.toFixed(0)})`, g66, 1e9]]) {
    const s = ev.filter(e => e.gap >= lo && e.gap < hi);
    if (!s.length) continue;
    const reach = 100 * s.filter(e => e.mfe >= e.gap).length / s.length;   // does it run a full gap-height (measured move)?
    console.log(`  ${lbl.padEnd(16)} ${String(s.length).padStart(4)}   ${pct(s.map(e => e.mfe), .5).toFixed(0).padStart(5)}   ${pct(s.map(e => e.mae), .5).toFixed(0).padStart(5)}   ${(pct(s.map(e => e.mfe), .5) / Math.max(1, -pct(s.map(e => e.mae), .5))).toFixed(2).padStart(5)}    ${(100 * s.filter(e => e.eod > 0).length / s.length).toFixed(0)}%       ${reach.toFixed(0)}%`);
  }
  // Q: confirmation — does a BIGGER body continue better?
  console.log(`  BODY size (confirmation) vs continuation:`);
  const bodies = ev.map(e => e.body).sort((a, b) => a - b); const b50 = bodies[Math.floor(bodies.length / 2)];
  for (const [lbl, f] of [[`small body (<${b50.toFixed(0)})`, e => e.body < b50], [`big body (>=${b50.toFixed(0)})`, e => e.body >= b50]]) {
    const s = ev.filter(f); console.log(`    ${lbl.padEnd(20)} n=${String(s.length).padStart(4)}  medMFE ${pct(s.map(e => e.mfe), .5).toFixed(0)}  win ${(100 * s.filter(e => e.eod > 0).length / s.length).toFixed(0)}%`);
  }
  // Q: min safe profit — target reach rates
  console.log(`  TARGET reach (of all breakouts, % that reach +X points in favour):`);
  const Ts = name.includes('Bank') ? [30, 50, 80, 120, 150] : name.includes('Crude') ? [15, 25, 40, 60, 80] : [20, 30, 50, 70, 100];
  let line = '   ';
  for (const T of Ts) line += ` +${T}:${(100 * ev.filter(e => e.mfe >= T).length / ev.length).toFixed(0)}%`;
  console.log(line);
  console.log(`   → "min safe profit" = the biggest T still hit by ~70%+ of breakouts.`);
}

study('NIFTY 50', 'research-data/intraday/nifty5m.json', 40, '14:30', '15:15');
study('Bank Nifty', 'research-data/indexintra/banknifty5m.json', 90, '14:30', '15:15');
study('Crude Oil Mini', 'research-data/indexintra/crudemini5m.json', 27, '22:00', '23:20');
