/** PHASE 58 — PULLBACK vs BREAKOUT, head to head, same instruments/targets/stops.
 *
 *  BREAKOUT (what we shipped): 15-min body >= entry closing BEYOND the level,
 *    WITH the trend. CE above resistance / PE below support.
 *  PULLBACK (the Smart Pull back PRO idea): price pulls back INTO a level inside
 *    the range and resumes in the EMA-50 trend direction:
 *      - up-trend (close>EMA50): low dips within zoneWidth of SUPPORT, candle
 *        closes green & back above support -> BUY (CE).
 *      - down-trend (close<EMA50): high pokes within zoneWidth of RESISTANCE,
 *        candle closes red & back below resistance -> SELL (PE).
 *  Both: causal pivots (len 5) on 15-min, confidence 1-3 -> target-by-score,
 *  hold losers to session square-off (option premium is the real loss cap),
 *  daily stops (max 3 trades, +/- Rs3500), futures-equivalent rupees.
 *
 *  Usage: node scripts/p58-pullback-vs-breakout.js
 */
'use strict';
const fs = require('fs');
const P = 5, TREND_N = 20, EMA_N = 50;

const INSTR = {
  Nifty: { f: 'research-data/intraday/nifty5m.json', unitsPerLot: 75, entry: 27, zone: 12, gapLo: 100, gapHi: 175, tgt: { 1: 20, 2: 25, 3: 30 }, eEnd: '14:30', sq: '15:15' },
  Bank: { f: 'research-data/indexintra/banknifty5m.json', unitsPerLot: 35, entry: 60, zone: 30, gapLo: 275, gapHi: 465, tgt: { 1: 40, 2: 50, 3: 60 }, eEnd: '14:30', sq: '15:15' },
  Crude: { f: 'research-data/indexintra/crudemini5m.json', unitsPerLot: 10, entry: 27, zone: 12, gapLo: 78, gapHi: 130, tgt: { 1: 20, 2: 25, 3: 30 }, eEnd: '20:00', sq: '23:20' },
};

const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8')).map((r) => Array.isArray(r)
  ? { d: r[0].slice(0, 10), hm: r[0].slice(11, 16), o: r[1], h: r[2], l: r[3], c: r[4] }
  : { d: r.t.slice(0, 10), hm: r.t.slice(11, 16), o: r.o, h: r.h, l: r.l, c: r.c });

function to15(b5) {
  const by = new Map();
  for (const b of b5) {
    const [H, M] = b.hm.split(':').map(Number); const mm = H * 60 + Math.floor(M / 15) * 15;
    const k = b.d + '|' + mm; let g = by.get(k);
    if (!g) { g = { d: b.d, mm, hm: String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0'), o: b.o, h: b.h, l: b.l, c: b.c }; by.set(k, g); }
    else { g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); g.c = b.c; }
  }
  return [...by.values()].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.mm - b.mm);
}

function sim(cfg, mode) {
  const b5 = load(cfg.f);
  const B = to15(b5);
  const day5 = new Map(); for (const b of b5) { if (!day5.has(b.d)) day5.set(b.d, []); day5.get(b.d).push(b); }
  const n = B.length;
  // EMA-50 on 15-min close
  const ema = new Array(n).fill(null); const kk = 2 / (EMA_N + 1);
  for (let i = 0; i < n; i++) ema[i] = i === 0 ? B[0].c : B[i].c * kk + ema[i - 1] * (1 - kk);
  const isPH = new Array(n).fill(0), isPL = new Array(n).fill(0);
  for (let j = P; j < n - P; j++) { let ph = 1, pl = 1; for (let k = j - P; k <= j + P; k++) { if (k === j) continue; if (B[k].h >= B[j].h) ph = 0; if (B[k].l <= B[j].l) pl = 0; } isPH[j] = ph; isPL[j] = pl; }

  const trades = []; let res = null, sup = null; const dayState = new Map();
  for (let i = 0; i < n; i++) {
    const j = i - P; if (j >= 0) { if (isPH[j]) res = B[j].h; if (isPL[j]) sup = B[j].l; }
    const b = B[i];
    if (b.hm < '09:45' || b.hm > cfg.eEnd || res == null || sup == null || i < TREND_N) continue;
    let st = dayState.get(b.d); if (!st) { st = { t: 0, pnl: 0, stop: false }; dayState.set(b.d, st); }
    if (st.stop || st.t >= 3) continue;
    const body = b.c - b.o, trend = b.c - B[i - TREND_N].c, gap = res - sup;
    let dir = 0;
    if (mode === 'breakout') {
      if (body >= cfg.entry && b.c > res && trend > 0) dir = 1;
      else if (-body >= cfg.entry && b.c < sup && trend < 0) dir = -1;
    } else { // pullback: dip into a level and resume with EMA-50 trend
      const up = b.c > ema[i], dn = b.c < ema[i];
      const touchedSup = b.l <= sup + cfg.zone && b.l >= sup - cfg.zone;
      const touchedRes = b.h >= res - cfg.zone && b.h <= res + cfg.zone;
      if (up && touchedSup && b.c > b.o && b.c > sup) dir = 1;         // bounce off support
      else if (dn && touchedRes && b.c < b.o && b.c < res) dir = -1;   // reject at resistance
    }
    if (!dir) continue;
    // confidence: +1 big body, +1 mid gap (with-trend already required)
    let score = 1;
    if (Math.abs(body) >= cfg.entry * 1.5) score++;
    if (gap >= cfg.gapLo && gap < cfg.gapHi) score++;
    const target = cfg.tgt[score] || 0;
    const entry = b.c;
    const after = (day5.get(b.d) || []).filter((x) => x.hm > b.hm && x.hm <= cfg.sq);
    if (!after.length) continue;
    let exit = after[after.length - 1].c, reason = 'CLOSE';
    if (target > 0) for (const x of after) { if (dir * ((dir > 0 ? x.h : x.l) - entry) >= target) { exit = entry + dir * target; reason = 'TARGET'; break; } }
    const pts = dir * (exit - entry);
    st.t++; st.pnl += pts;
    trades.push({ d: b.d, dir, score, pts, reason });
    const stopPts = 3500 / cfg.unitsPerLot;
    if (st.pnl <= -stopPts) st.stop = true;
    if (st.pnl >= stopPts) st.stop = true;
  }
  const byd = {}; for (const t of trades) byd[t.d] = (byd[t.d] || 0) + t.pts;
  const days = Object.values(byd); const green = days.filter((x) => x > 0).length;
  const net = trades.reduce((a, t) => a + t.pts, 0);
  const win = trades.filter((t) => t.pts > 0).length;
  return {
    trades: trades.length, days: days.length,
    winPct: trades.length ? Math.round(100 * win / trades.length) : 0,
    greenPct: days.length ? Math.round(100 * green / days.length) : 0,
    netRs: Math.round(net * cfg.unitsPerLot),
    perDayRs: days.length ? Math.round(net * cfg.unitsPerLot / days.length) : 0,
  };
}

console.log('PULLBACK vs BREAKOUT — full history, 1 lot, Rs3500 daily stops, futures-equivalent\n');
console.log('instrument  mode      trades  days  win%  green%     netRs        Rs/day');
for (const [name, cfg] of Object.entries(INSTR)) {
  for (const mode of ['breakout', 'pullback']) {
    const r = sim(cfg, mode);
    console.log('  ' + name.padEnd(9) + mode.padEnd(10) + String(r.trades).padStart(5) + String(r.days).padStart(6) + String(r.winPct).padStart(6) + String(r.greenPct).padStart(7) + '   ' + ('Rs' + r.netRs.toLocaleString('en-IN')).padStart(12) + ('Rs' + r.perDayRs).padStart(10));
  }
  console.log();
}
