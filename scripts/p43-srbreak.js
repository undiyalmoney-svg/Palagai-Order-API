/** PHASE 43 — S/R BREAKOUT + MOMENTUM-CLUB EXIT (user's recipe), tested on NIFTY.
 *  Rules (frozen per user):
 *   - S/R = last CONFIRMED pivot high/low (pivotLen 5) on 15-min candles (causal).
 *   - Entry (15-min): body (close-open) >= ENTRY_PTS in the break direction AND
 *       close beyond the level.  close>resistance -> BUY ; close<support -> SELL.
 *       Enter at that 15-min candle's close.
 *   - Exit (5-min clubs of 3): each club = sum of the 3 five-min bodies, signed in
 *       trade direction. Sum <= CLUB_PTS -> exit at club end; else hold. 15:15 sq-off.
 *  Reports gross points and net after a conservative NIFTY-futures round-trip. */
const fs = require('fs');
const ENTRY_PTS = +(process.env.ENTRY_PTS || 27);
const CLUB_PTS = +(process.env.CLUB_PTS || 12);
const PIVOT = 5;
const COST_PTS = +(process.env.COST_PTS || 5);   // ~1 NIFTY-fut round trip
const FILE = process.env.FILE || 'research-data/intraday/nifty5m.json';
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sd = a => { const m = mean(a); return a.length < 2 ? 0 : Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const sum = a => a.reduce((x, y) => x + y, 0);

// load 5-min bars
const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const bars5 = raw.map(r => Array.isArray(r)
  ? { t: r[0], d: r[0].slice(0, 10), hm: r[0].slice(11, 16), o: r[1], h: r[2], l: r[3], c: r[4] }
  : { t: r.t, d: r.t.slice(0, 10), hm: r.t.slice(11, 16), o: r.o, h: r.h, l: r.l, c: r.c });
bars5.sort((a, b) => a.t < b.t ? -1 : 1);

// group 5-min -> 15-min per day (buckets :00/:15/:30/:45)
function bucket15(hm) { const [H, M] = hm.split(':').map(Number); const m15 = Math.floor(M / 15) * 15; return H * 60 + m15; }
const by15 = new Map();               // key d|minute -> {o,h,l,c,d,hm,start}
for (const b of bars5) {
  const key = b.d + '|' + bucket15(b.hm);
  let g = by15.get(key);
  if (!g) { const mm = bucket15(b.hm); g = { d: b.d, min: mm, hm: String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0'), o: b.o, h: b.h, l: b.l, c: b.c }; by15.set(key, g); }
  else { g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); g.c = b.c; }
}
const bars15 = [...by15.values()].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.min - b.min);

// 5-min index for exits: per day array
const day5 = new Map();
for (const b of bars5) { if (!day5.has(b.d)) day5.set(b.d, []); day5.get(b.d).push(b); }

// causal pivots on the continuous 15-min series
// pivot high at j (highest high in [j-5, j+5]); known only at j+5
const isPH = new Array(bars15.length).fill(false);
const isPL = new Array(bars15.length).fill(false);
for (let j = PIVOT; j < bars15.length - PIVOT; j++) {
  let ph = true, pl = true;
  for (let k = j - PIVOT; k <= j + PIVOT; k++) { if (k === j) continue; if (bars15[k].h >= bars15[j].h) ph = false; if (bars15[k].l <= bars15[j].l) pl = false; }
  isPH[j] = ph; isPL[j] = pl;
}

// walk bars15, track last CONFIRMED resistance/support (confirmed 5 bars later), take entries
const trades = [];
let lastRes = null, lastSup = null;
let confPH = -1, confPL = -1;         // last confirmed pivot indices
for (let i = 0; i < bars15.length; i++) {
  // confirm any pivot whose +5 window has now completed (j = i-5)
  const j = i - PIVOT;
  if (j >= 0) { if (isPH[j]) { lastRes = bars15[j].h; confPH = j; } if (isPL[j]) { lastSup = bars15[j].l; confPL = j; } }

  const b = bars15[i];
  if (b.hm < '09:45' || b.hm > '14:30') continue;   // room for pivots + exit
  if (lastRes == null && lastSup == null) continue;
  const body = b.c - b.o;
  let dir = 0;
  if (body >= ENTRY_PTS && lastRes != null && b.c > lastRes) dir = 1;       // bullish break of resistance
  else if (-body >= ENTRY_PTS && lastSup != null && b.c < lastSup) dir = -1; // bearish break of support
  if (!dir) continue;

  // ENTRY at this 15-min close; manage exit on 5-min clubs
  const entry = b.c;
  const d5 = day5.get(b.d) || [];
  // 5-min candles strictly AFTER the 15-min close time
  const after = d5.filter(x => x.hm > b.hm);
  let exit = null, exitHm = null, reason = null;
  for (let k = 0; k + 2 < after.length; k += 3) {
    const c1 = after[k], c2 = after[k + 1], c3 = after[k + 2];
    if (c3.hm >= '15:15') break;
    const cdir = process.env.FADE==="1" ? -dir : dir;
    const clubSum = cdir * ((c1.c - c1.o) + (c2.c - c2.o) + (c3.c - c3.o));
    if (clubSum <= CLUB_PTS) { exit = c3.c; exitHm = c3.hm; reason = 'CLUB'; break; }
  }
  if (exit == null) {                      // squared off at/after 15:15
    const last = d5.filter(x => x.hm <= '15:15').pop() || after[after.length - 1] || b;
    exit = last.c; exitHm = last.hm; reason = 'EOD';
  }
  const tdir = process.env.FADE==="1" ? -dir : dir;
  const gross = tdir * (exit - entry);
  trades.push({ d: b.d, hm: b.hm, dir, entry, exit, gross, net: gross - COST_PTS, reason });
}

const seg = (lo, hi) => trades.filter(t => t.d >= lo && t.d <= hi);
const st = T => {
  if (!T.length) return null;
  const g = sum(T.map(x => x.gross)), n = sum(T.map(x => x.net));
  const w = T.filter(x => x.net > 0);
  const byD = new Map(); for (const t of T) byD.set(t.d, (byD.get(t.d) || 0) + t.net);
  const dn = [...byD.values()];
  return { nT: T.length, gross: g, net: n, gpt: g / T.length, npt: n / T.length, win: 100 * w.length / T.length, t: mean(dn) / (sd(dn) / Math.sqrt(dn.length)) };
};
console.log(`PHASE 43 - S/R BREAK + CLUB EXIT  (entry>=${ENTRY_PTS}pt body, club>${CLUB_PTS}pt, cost ${COST_PTS}pt/trade)`);
console.log(`  file ${FILE.split('/').pop()}  ·  15-min bars ${bars15.length}  ·  ${bars15[0].d} -> ${bars15[bars15.length - 1].d}\n`);
console.log('  window          trades   gross pt   net pt   pt/trade   win%     t');
for (const [l, lo, hi] of [['DEV   2015-2019', '2015-01-01', '2019-12-31'], ['VALID 2020-2022', '2020-01-01', '2022-12-31'], ['TEST  2023-2026', '2023-01-01', '2099'], ['ALL           ', '2000', '2099']]) {
  const s = st(seg(lo, hi)); if (!s) { console.log('  ' + l + '   no trades'); continue; }
  console.log(`  ${l}  ${String(s.nT).padStart(6)}  ${s.gross.toFixed(0).padStart(8)}  ${s.net.toFixed(0).padStart(7)}  ${s.npt.toFixed(2).padStart(8)}   ${s.win.toFixed(0).padStart(3)}%  ${s.t.toFixed(2).padStart(5)}`);
}
const all = st(trades);
console.log(`\n  frequency: ${trades.length} trades over ${new Set(trades.map(t => t.d)).size} trading days`);
console.log(`  exit mix: CLUB ${trades.filter(t => t.reason === 'CLUB').length}  EOD ${trades.filter(t => t.reason === 'EOD').length}`);
console.log(`  gross ${all.gross.toFixed(0)} pt  ·  net after cost ${all.net.toFixed(0)} pt  ·  ${all.npt.toFixed(2)} pt/trade`);
const yr = {}; for (const t of trades) { const y = t.d.slice(0, 4); yr[y] = (yr[y] || 0) + t.net; }
console.log('  net pt by year: ' + Object.keys(yr).sort().map(y => y + ' ' + yr[y].toFixed(0)).join('  '));
