/** PHASE 41 — CONFLUENCE HUNT. Reversal candles + volume + OFI proxy + S/R.
 *  Does stacking confirmations raise the forward edge (and clear cost)?
 *  Score each reversal setup by how many factors align; measure forward return
 *  by score on DEV, validate the top bucket on VALID/TEST with cost.
 *  Mid-cap 5-min data. No look-ahead: features from bars<=i, entry next bar
 *  open, exit 15:15 or 2xATR stop. */
const fs = require('fs'), path = require('path');
const { estimateEquityRoundTripCharges: MIS } = require('../live/equity-charges.js');
const DIR = 'research-data/midintra', SLIP = 0.05;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sd = a => { const m = mean(a); return a.length < 2 ? 0 : Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const S = new Map();
for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.json'))) {
  const bs = new Map();
  for (const r of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))) {
    const d = r[0].slice(0, 10); if (!bs.has(d)) bs.set(d, []);
    bs.get(d).push({ hm: r[0].slice(11, 16), o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] || 0 });
  }
  S.set(f.replace('.json', ''), bs);
}
const PD = new Map();
for (const [sym, bs] of S) {
  const days = [...bs.keys()].sort(); const m = new Map();
  for (let i = 1; i < days.length; i++) { const p = bs.get(days[i - 1]); m.set(days[i], { pdh: Math.max(...p.map(x => x.h)), pdl: Math.min(...p.map(x => x.l)) }); }
  PD.set(sym, m);
}
const dates = [...new Set([].concat(...[...S.values()].map(m => [...m.keys()])))].sort();
function atr(a, i) { let t = 0, n = 0; for (let j = Math.max(1, i - 13); j <= i; j++) { t += Math.max(a[j].h - a[j].l, Math.abs(a[j].h - a[j - 1].c), Math.abs(a[j].l - a[j - 1].c)); n++; } return n ? t / n : 0; }
function setup(a, i, pd) {
  if (i < 25) return null;
  const b = a[i], rng = b.h - b.l; if (rng <= 0) return null;
  const body = Math.abs(b.c - b.o), upW = b.h - Math.max(b.o, b.c), dnW = Math.min(b.o, b.c) - b.l;
  const at = atr(a, i); if (at <= 0) return null;
  const av = mean(a.slice(i - 20, i).map(x => x.v)); if (av <= 0) return null;
  const volx = b.v / av;
  const run = (b.c - a[i - 6].c) / a[i - 6].c * 100;
  const ofi = (b.c - b.l) / rng;
  const hammer = dnW >= 2 * body && upW <= body && body > 0;
  const star = upW >= 2 * body && dnW <= body && body > 0;
  const doji = body <= 0.1 * rng;
  let sessLo = 1e9, sessHi = -1e9; for (let k = 0; k < i; k++) { sessLo = Math.min(sessLo, a[k].l); sessHi = Math.max(sessHi, a[k].h); }
  const nearSupp = pd && (Math.abs(b.l - pd.pdl) <= 0.3 * at || Math.abs(b.l - sessLo) <= 0.3 * at);
  const nearRes = pd && (Math.abs(b.h - pd.pdh) <= 0.3 * at || Math.abs(b.h - sessHi) <= 0.3 * at);
  if ((hammer || doji) && run <= -1.0) {
    let sc = 0;
    if (hammer) sc++; if (doji) sc++;
    if (nearSupp) sc++;
    if (volx >= 2) sc++;
    if (ofi >= 0.6) sc++;
    return { dir: 1, score: sc, at };
  }
  if ((star || doji) && run >= 1.0) {
    let sc = 0;
    if (star) sc++; if (doji) sc++;
    if (nearRes) sc++;
    if (volx >= 2) sc++;
    if ((1 - ofi) >= 0.6) sc++;
    return { dir: -1, score: sc, at };
  }
  return null;
}
function collect() {
  const rows = [];
  for (const [sym, bs] of S) {
    const pdm = PD.get(sym);
    for (const [d, a] of bs) {
      if (a.length < 45) continue; const pd = pdm && pdm.get(d);
      let best = null;
      for (let i = 25; i < a.length - 1; i++) {
        if (a[i].hm < '10:00' || a[i].hm > '14:30') continue;
        const s = setup(a, i, pd); if (s && (!best || s.score > best.score)) best = { ...s, i };
      }
      if (!best) continue;
      const e = best.i + 1; if (e >= a.length - 1) continue;
      const fill = a[e].o * (1 + best.dir * SLIP / 100); const stopD = 2 * best.at;
      let px = null;
      for (let j = e; j < a.length; j++) { const bar = a[j]; const adv = best.dir * ((best.dir > 0 ? bar.l : bar.h) - fill); if (bar.hm >= '15:15') { px = bar.c; break; } if (adv <= -stopD) { px = fill - best.dir * stopD; break; } if (j === a.length - 1) px = bar.c; }
      const ex = px * (1 - best.dir * SLIP / 100);
      rows.push({ d, sym, score: best.score, dir: best.dir, retPct: best.dir * (ex - fill) / fill * 100 });
    }
  }
  return rows;
}
const rows = collect();
const win = r => r.d <= '2019-12-31' ? 'DEV' : r.d <= '2022-12-31' ? 'VALID' : 'TEST';
console.log('PHASE 41 - CONFLUENCE HUNT (reversal candle + vol + OFI + S/R)\n');
console.log('  setups: ' + rows.length + '  (' + (rows.length / dates.length).toFixed(1) + '/day)\n');
console.log('  FORWARD RETURN % BY CONFLUENCE SCORE (gross, cost to beat ~0.106% / 0.054%):');
console.log('  score |    DEV n   ret%  |   VALID n   ret%  |    TEST n   ret%');
for (let sc = 1; sc <= 5; sc++) {
  const cells = ['DEV', 'VALID', 'TEST'].map(w => rows.filter(r => r.score === sc && win(r) === w));
  let line = '  ' + sc + '     |';
  for (const c of cells) line += ` ${String(c.length).padStart(6)}  ${mean(c.map(x => x.retPct)).toFixed(3).padStart(6)}  |`;
  console.log(line);
}
const st = X => { if (!X.length) return null; const t = X.map(x => x.retPct); return { n: X.length, ret: mean(t), tstat: mean(t) / (sd(t) / Math.sqrt(t.length)), win: 100 * t.filter(x => x > 0).length / t.length }; };
console.log('\n  TOP CONFLUENCE (score>=4):');
for (const w of ['DEV', 'VALID', 'TEST']) { const s = st(rows.filter(r => r.score >= 4 && win(r) === w)); if (s) console.log('    ' + w.padEnd(6) + ' n=' + String(s.n).padStart(4) + '  gross ' + s.ret.toFixed(3) + '%  t=' + s.tstat.toFixed(2) + '  win ' + s.win.toFixed(0) + '%'); }
