'use strict';
const fs = require('fs');
const { runSrBreakout } = require('./sr-breakout');
const { compactSessionBars } = require('./sr-structure');
const { exitOptsFor, MAX_TRADES_PER_DAY } = require('./sr-strategy-config');

function hmStr(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}
function sessionBars(iso, priceAt) {
  const out = [];
  for (let min = 9 * 60 + 15; min <= 15 * 60 + 25; min += 5) {
    const px = priceAt(min);
    out.push({ date: `${iso}T${hmStr(min)}:00+05:30`, open: px.o, high: px.h, low: px.l, close: px.c });
  }
  return out;
}
const warmup = [];
for (let d = 1; d <= 8; d++) {
  let px = 24000;
  warmup.push(...sessionBars(`2026-08-${String(d).padStart(2, '0')}`, () => {
    const o = px; const c = px + 0.2; px = c;
    return { o, c, h: Math.max(o, c) + 0.5, l: Math.min(o, c) - 0.5 };
  }));
}
const iso = '2026-08-11';
function structurePx(min) {
  if (min < 10 * 60 + 45) {
    const lo = 24000 + (min % 10) * 0.2;
    return { o: lo + 10, c: lo + 12, h: 24080, l: 24000 };
  }
  if (min === 10 * 60 + 45) return { o: 24070, c: 24120, h: 24125, l: 24068 };
  if (min === 10 * 60 + 50) return { o: 24118, c: 24090, h: 24120, l: 24080 };
  if (min === 10 * 60 + 55) return { o: 24090, c: 24110, h: 24115, l: 24085 };
  if (min === 11 * 60) return { o: 24110, c: 24140, h: 24145, l: 24105 };
  if (min === 11 * 60 + 5) return { o: 24140, c: 24170, h: 24180, l: 24135 };
  return { o: 24170, c: 24190, h: 24200, l: 24160 };
}
const day = warmup.concat(sessionBars(iso, structurePx));
const run = runSrBreakout(day, {
  entryPts: 27, trendBars: 20, gapLo: 0, gapHi: 1e9,
  maxTradesPerDay: MAX_TRADES_PER_DAY, reportFromDate: iso,
  entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15',
  ...exitOptsFor('nifty'),
});
const t = run.trades[0];
const bars = compactSessionBars(day, iso).filter((b) => String(b.t).slice(11, 16) >= '09:45' && String(b.t).slice(11, 16) <= '12:00');
const s = t.structure;
const w = 900, h = 360, padL = 56, padR = 16, padT = 28, padB = 28;
const lows = bars.map((b) => b.l).concat([s.pink.lo, s.teal.lo, s.wall]);
const highs = bars.map((b) => b.h).concat([s.pink.hi, s.teal.hi, s.wall]);
let min = Math.min(...lows), max = Math.max(...highs);
const span = (max - min) || 1;
min -= span * 0.08; max += span * 0.08;
const plotW = w - padL - padR, plotH = h - padT - padB;
const yOf = (px) => padT + ((max - px) / (max - min)) * plotH;
const xOf = (i) => padL + ((i + 0.5) / bars.length) * plotW;
const idxHm = (hm) => bars.findIndex((b) => String(b.t).slice(11, 16) >= hm);
const band = (box, fill) => {
  const i0 = Math.max(0, idxHm(box.fromHm));
  let i1 = idxHm(box.toHm); if (i1 < 0) i1 = bars.length - 1;
  const x0 = padL + (i0 / bars.length) * plotW;
  const x1 = padL + ((i1 + 1) / bars.length) * plotW;
  const y0 = yOf(box.hi), y1 = yOf(box.lo);
  return `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(y1 - y0).toFixed(1)}" fill="${fill}"/>`;
};
let candles = '';
for (let i = 0; i < bars.length; i++) {
  const b = bars[i];
  const x = xOf(i);
  const up = b.c >= b.o;
  const col = up ? '#15803d' : '#b91c1c';
  candles += `<line x1="${x}" x2="${x}" y1="${yOf(b.h)}" y2="${yOf(b.l)}" stroke="${col}" stroke-width="1"/>`;
  const top = yOf(Math.max(b.o, b.c)), bot = yOf(Math.min(b.o, b.c));
  candles += `<rect x="${x - 3}" y="${top}" width="6" height="${Math.max(1, bot - top)}" fill="${col}"/>`;
}
const ie = idxHm(s.entry.hm);
const xe = xOf(ie);
const ye = yOf(s.entry.price);
const ix = idxHm(s.exit.hm);
const xx = xOf(ix);
const yx = yOf(s.exit.price);
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#fff"/>
  <text x="16" y="20" font-size="14" font-family="ui-sans-serif,system-ui" fill="#0f172a">Palagai S/R box · wall ${s.wall} · ${t.option} · ${t.exitReason}</text>
  ${band(s.pink, 'rgba(244,114,182,0.28)')}
  ${band(s.teal, 'rgba(45,212,191,0.28)')}
  <line x1="${padL}" x2="${padL + plotW}" y1="${yOf(s.wall)}" y2="${yOf(s.wall)}" stroke="#0f172a" stroke-width="1.5"/>
  ${candles}
  <circle cx="${xe}" cy="${ye}" r="5" fill="#2563eb"/>
  <text x="${xe + 8}" y="${ye - 8}" font-size="11" fill="#0f172a">In</text>
  <circle cx="${xx}" cy="${yx}" r="5" fill="#7c3aed"/>
  <text x="${xx + 8}" y="${yx - 8}" font-size="11" fill="#0f172a">${t.exitReason}</text>
</svg>`;
const dest = process.argv[2] || '/tmp/sr_box_synthetic.svg';
fs.writeFileSync(dest, svg);
console.log(JSON.stringify({ dest, reason: t.exitReason, wall: s.wall, height: s.height, bars: bars.length }));
