/** PHASE 42 — PULLBACK CONTINUATION (buy the dip in an uptrend, sell the rip in
 *  a downtrend). Trend = price vs session VWAP + a rising/falling 20-bar slope.
 *  Pullback = price returns to VWAP and forms a reversal candle in trend
 *  direction; enter next bar, ride the continuation; stop beyond the pullback
 *  extreme, exit 15:15. Compare CONTINUATION vs its inverse (control).
 *  Mid-cap 5-min, no look-ahead, DEV/VALID/TEST, real cost 0.05%/side. */
const fs = require('fs'), path = require('path');
const { estimateEquityRoundTripCharges: MIS } = require('../live/equity-charges.js');
const DIR = 'research-data/midintra', SLIP = 0.05, PER = 250000;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sd = a => { const m = mean(a); return a.length < 2 ? 0 : Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const sum = a => a.reduce((x, y) => x + y, 0);
const S = new Map();
for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.json'))) {
  const bs = new Map();
  for (const r of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))) {
    const d = r[0].slice(0, 10); if (!bs.has(d)) bs.set(d, []);
    bs.get(d).push({ hm: r[0].slice(11, 16), o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] || 0 });
  }
  S.set(f.replace('.json', ''), bs);
}
const dates = [...new Set([].concat(...[...S.values()].map(m => [...m.keys()])))].sort();
function atr(a, i) { let t = 0, n = 0; for (let j = Math.max(1, i - 13); j <= i; j++) { t += Math.max(a[j].h - a[j].l, Math.abs(a[j].h - a[j - 1].c), Math.abs(a[j].l - a[j - 1].c)); n++; } return n ? t / n : 0; }
/** first pullback-continuation setup of the day for one symbol */
function setup(a) {
  let pv = 0, vv = 0; const vwap = [];
  for (let i = 0; i < a.length; i++) { pv += ((a[i].h + a[i].l + a[i].c) / 3) * a[i].v; vv += a[i].v; vwap[i] = vv > 0 ? pv / vv : a[i].c; }
  for (let i = 25; i < a.length - 1; i++) {
    if (a[i].hm < '10:15' || a[i].hm > '14:30') continue;
    const at = atr(a, i); if (at <= 0) continue;
    const slope = a[i].c - a[i - 20].c;                       // trend over ~100 min
    const b = a[i], rng = b.h - b.l; if (rng <= 0) continue;
    const body = Math.abs(b.c - b.o), dnW = Math.min(b.o, b.c) - b.l, upW = b.h - Math.max(b.o, b.c);
    // UPTREND pullback: above VWAP overall, slope up, this bar dipped to/below VWAP
    // then closed back up (bullish reversal candle) = dip bought
    const upTrend = a[i].c > vwap[i] && slope > 0.5 * at;
    const dippedUp = b.l <= vwap[i] * 1.001 && b.c > b.o && (dnW >= body || b.c > vwap[i]);
    if (upTrend && dippedUp) return { i, dir: 1, at, stop: Math.min(b.l, vwap[i]) };
    const dnTrend = a[i].c < vwap[i] && slope < -0.5 * at;
    const rippedDn = b.h >= vwap[i] * 0.999 && b.c < b.o && (upW >= body || b.c < vwap[i]);
    if (dnTrend && rippedDn) return { i, dir: -1, at, stop: Math.max(b.h, vwap[i]) };
  }
  return null;
}
let seed = 99; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function run(FADE) {
  seed = 99; const D = [];
  for (const d of dates) {
    const cands = [];
    for (const [sym, bs] of S) { const a = bs.get(d); if (a && a.length >= 45) { const s = setup(a); if (s) { s.a = a; cands.push(s); } } }
    if (!cands.length) continue;
    for (let k = cands.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [cands[k], cands[j]] = [cands[j], cands[k]]; }
    const c = cands[0], a = c.a, e = c.i + 1; if (e >= a.length - 1) continue;
    const dir = FADE ? -c.dir : c.dir;
    const fill = a[e].o * (1 + dir * SLIP / 100); const qty = Math.floor(PER / fill); if (qty < 1) continue;
    const stopD = 2 * c.at;
    let px = null;
    for (let j = e; j < a.length; j++) { const bar = a[j]; const adv = dir * ((dir > 0 ? bar.l : bar.h) - fill); if (bar.hm >= '15:15') { px = bar.c; break; } if (adv <= -stopD) { px = fill - dir * stopD; break; } if (j === a.length - 1) px = bar.c; }
    const ex = px * (1 - dir * SLIP / 100);
    const net = dir * (ex - fill) * qty - MIS({ entryPrice: fill, exitPrice: ex, quantity: qty }).totalRs;
    D.push({ d, net, gross: dir * (ex - fill) * qty, notional: fill * qty });
  }
  return D;
}
const seg = (D, lo, hi) => D.filter(x => x.d >= lo && x.d <= hi);
const st = D => D.length ? { net: sum(D.map(x => x.net)), n: D.length, gR: 100 * sum(D.map(x => x.gross)) / sum(D.map(x => x.notional)), win: 100 * D.filter(x => x.net > 0).length / D.length, t: (() => { const dm = new Map(); for (const x of D) dm.set(x.d, (dm.get(x.d) || 0) + x.net); const dn = [...dm.values()]; return mean(dn) / (sd(dn) / Math.sqrt(dn.length)); })() } : null;
console.log('PHASE 42 - PULLBACK CONTINUATION vs FADE control (Rs250k, 0.05%/side)\n');
for (const [lbl, fade] of [['CONTINUATION', false], ['FADE (control)', true]]) {
  const D = run(fade);
  const A = st(seg(D, '2018-01-01', '2019-12-31')), B = st(seg(D, '2020-01-01', '2022-12-31')), Z = st(seg(D, '2023-01-01', '2099')), ALL = st(D);
  console.log('  ' + lbl);
  for (const [w, x] of [['DEV  ', A], ['VALID', B], ['TEST ', Z], ['ALL  ', ALL]]) if (x) console.log(`    ${w}  n=${String(x.n).padStart(4)}  net Rs${x.net.toFixed(0).padStart(8)}  gross ${x.gR.toFixed(3)}%  win ${x.win.toFixed(0)}%  t=${x.t.toFixed(2)}`);
  console.log('');
}
