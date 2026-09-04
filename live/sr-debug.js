'use strict';
/**
 * S/R DEBUG / AUDIT — proves WHY each candle did or didn't produce a signal.
 *
 * Read-only. Does NOT change the strategy or thresholds. For a given day it
 * replays every completed 15-min candle CAUSALLY (only data available at that
 * candle's close) and reports the full gate trace + rejection reason, plus an
 * intrabar developing-state trace built from the 5-min sub-bars (so we can see
 * a big candle forming BEFORE it closes, without using any future information).
 *
 * Two timestamps are kept separate, as required:
 *   DEVELOPING_AT — first 5-min point the forming candle looked like a breakout.
 *   CONFIRMED_AT  — the 15-min close where the actual entry rule is satisfied.
 */
const { to15 } = require('./sr-breakout');

const PIVOT = 5;
const hm = (d) => String(d).slice(11, 16);
const ymd = (d) => String(d).slice(0, 10);

// Intrabar developing states.
const STATE = { WAITING: 'WAITING', BUILDING: 'BUILDING', APPROACHING_WALL: 'APPROACHING_WALL', BREAKOUT_DEVELOPING: 'BREAKOUT_DEVELOPING', CONFIRMED: 'CONFIRMED', FAILED: 'FAILED' };

/**
 * auditDay(bars5, spec, date)
 * spec: { entryPts, trendBars=20, entryStartHm, entryEndHm, squareOffHm }
 * Returns { date, candles:[…], summary:{…} }. bars5 must include warm-up days
 * before `date` so S/R + trend are primed.
 */
function auditDay(bars5, spec, date) {
  const entryPts = Number(spec.entryPts) || 27;
  const trendBars = Number(spec.trendBars) || 20;
  const entryStartHm = spec.entryStartHm || '09:45';
  const entryEndHm = spec.entryEndHm || '14:30';

  const B = to15(bars5);
  const n = B.length;
  // 5-min sub-bars grouped by 15-min bucket key (date|minuteOfDayBucket)
  const sub = new Map();
  for (const b of bars5) {
    const t = hm(b.date); const [H, M] = t.split(':').map(Number);
    const mm = H * 60 + Math.floor(M / 15) * 15;
    const key = ymd(b.date) + '|' + mm;
    if (!sub.has(key)) sub.set(key, []);
    sub.get(key).push({ hm: t, o: b.open, h: b.high, l: b.low, c: b.close });
  }

  // causal confirmed pivots
  const isPH = new Array(n).fill(false), isPL = new Array(n).fill(false);
  for (let j = PIVOT; j < n - PIVOT; j++) {
    let ph = true, pl = true;
    for (let k = j - PIVOT; k <= j + PIVOT; k++) { if (k === j) continue; if (B[k].h >= B[j].h) ph = false; if (B[k].l <= B[j].l) pl = false; }
    isPH[j] = ph; isPL[j] = pl;
  }

  const candles = [];
  const rej = {};
  let lastRes = null, lastSup = null, signals = 0, candidates = 0;
  for (let i = 0; i < n; i++) {
    const j = i - PIVOT;
    if (j >= 0) { if (isPH[j]) lastRes = B[j].h; if (isPL[j]) lastSup = B[j].l; }
    const b = B[i];
    if (b.d !== date) continue;
    if (b.hm < entryStartHm || b.hm > entryEndHm) continue;

    const body = +(b.c - b.o).toFixed(2);
    const range = +(b.h - b.l).toFixed(2);
    const trend = i >= trendBars ? +(b.c - B[i - trendBars].c).toFixed(2) : null;
    // intended direction = sign of the body; nearest wall in that direction
    const dir = body >= 0 ? 1 : -1;
    const wall = dir > 0 ? lastRes : lastSup;
    const wallType = dir > 0 ? 'resistance' : 'support';
    const distToWall = wall == null ? null : +(dir > 0 ? wall - b.c : b.c - wall).toFixed(2); // >0 = below wall (not broken)
    const reachedThreshold = Math.abs(body) >= entryPts;
    const brokeWall = wall != null && (dir > 0 ? b.c > lastRes : b.c < lastSup);
    const withTrend = trend != null && ((dir > 0 && trend > 0) || (dir < 0 && trend < 0));

    // rejection reason — first failed gate, in strategy order
    let rejection = null, signal = false, option = null;
    if (lastRes == null || lastSup == null) rejection = 'No confirmed S/R yet (warming up)';
    else if (trend == null) rejection = 'Trend not established (early bar)';
    else if (!reachedThreshold) rejection = `Body ${Math.abs(body)} < required ${entryPts}`;
    else if (!brokeWall) rejection = `Wall not broken (close ${b.c} did not clear ${wallType} ${wall})`;
    else if (!withTrend) rejection = 'Breakout against trend';
    else { signal = true; option = dir > 0 ? 'CE' : 'PE'; }
    if (reachedThreshold) candidates += 1;
    if (signal) signals += 1; else rej[rejection] = (rej[rejection] || 0) + 1;

    // intrabar developing trace (causal — each point uses only data up to it)
    const [H, M] = b.hm.split(':').map(Number);
    const key = date + '|' + (H * 60 + Math.floor(M / 15) * 15);
    const subs = sub.get(key) || [];
    const openP = subs.length ? subs[0].o : b.o;
    let cumH = -Infinity, cumL = Infinity, developingAt = null, thresholdCrossedAt = null;
    const trace = [];
    subs.forEach((s) => {
      cumH = Math.max(cumH, s.h); cumL = Math.min(cumL, s.l);
      const curBody = +(s.c - openP).toFixed(2);
      const d2 = wall == null ? null : (dir > 0 ? wall - s.c : s.c - wall);
      const broke = wall != null && (dir > 0 ? s.c > lastRes : s.c < lastSup);
      const near = d2 != null && d2 <= entryPts && d2 > -Infinity;
      let st = STATE.WAITING;
      if (Math.abs(curBody) >= entryPts && broke && withTrend) st = STATE.BREAKOUT_DEVELOPING;
      else if (near || broke) st = STATE.APPROACHING_WALL;
      else if (Math.abs(curBody) >= 0.4 * entryPts) st = STATE.BUILDING;
      if (thresholdCrossedAt == null && Math.abs(curBody) >= entryPts) thresholdCrossedAt = s.hm;
      if (developingAt == null && st === STATE.BREAKOUT_DEVELOPING) developingAt = s.hm;
      trace.push({ at: s.hm, price: s.c, body: curBody, distToWall: d2 == null ? null : +d2.toFixed(2), state: st });
    });
    const finalState = signal ? STATE.CONFIRMED : (reachedThreshold ? STATE.FAILED : (trace.length ? trace[trace.length - 1].state : STATE.WAITING));

    candles.push({
      time: `${b.hm}`, open: b.o, high: b.h, low: b.l, close: b.c,
      body, range, dir: dir > 0 ? 'up' : 'down', nearestWall: wall, wallType, distToWall,
      trend, threshold: entryPts, reachedThreshold, brokeWall, withTrend, signal, option, rejection,
      developing: { finalState, developingAt, thresholdCrossedAt, trace },
    });
  }

  return {
    date, entryPts,
    candles,
    summary: {
      completedCandles: candles.length,
      candidatesReachedThreshold: candidates,
      signals,
      rejected: candles.length - signals,
      rejectionReasons: rej,
      detectorRan: candles.length > 0,
    },
  };
}

module.exports = { auditDay, STATE };
