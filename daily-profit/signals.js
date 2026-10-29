'use strict';

/**
 * Strategy families that emit knowable-at-print signals from 5-minute bars.
 * No family uses same-day P/L to decide direction or rank.
 */
const { toMin, aggregate15, dayCrowdFromCrosses, runOrbBacktest, clampConfig } = require('../orb-backtest/engine');

function barAt(bars, t) {
  return (bars || []).find((b) => b.t === t) || null;
}

function barsUntil(bars, t) {
  return (bars || []).filter((b) => toMin(b.t) <= toMin(t));
}

function sessionVwap(bars, untilT) {
  let pv = 0;
  let vv = 0;
  for (const b of barsUntil(bars, untilT)) {
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * (b.v || 1);
    vv += b.v || 1;
  }
  return vv > 0 ? pv / vv : null;
}

function emaSeries(bars, n) {
  const k = 2 / (n + 1);
  let e = null;
  const out = [];
  for (const b of bars || []) {
    e = e == null ? b.c : e + k * (b.c - e);
    out.push({ t: b.t, v: e });
  }
  return out;
}

function first15(bars15) {
  return (bars15 || []).find((b) => b.t === '09:15') || null;
}

function first30HighLow(bars5) {
  const slice = (bars5 || []).filter((b) => toMin(b.t) >= toMin('09:15') && toMin(b.t) < toMin('09:45'));
  if (slice.length < 4) return null;
  return {
    h: Math.max(...slice.map((b) => b.h)),
    l: Math.min(...slice.map((b) => b.l)),
    o: slice[0].o,
    c: slice[slice.length - 1].c,
  };
}

function prevClose(barsByDay, day) {
  const days = Object.keys(barsByDay || {}).sort();
  const i = days.indexOf(day);
  if (i <= 0) return null;
  const prev = barsByDay[days[i - 1]] || [];
  const last = prev[prev.length - 1];
  return last ? last.c : null;
}

function prevDayRange(barsByDay, day) {
  const days = Object.keys(barsByDay || {}).sort();
  const i = days.indexOf(day);
  if (i <= 0) return null;
  const prev = barsByDay[days[i - 1]] || [];
  if (!prev.length) return null;
  return { h: Math.max(...prev.map((b) => b.h)), l: Math.min(...prev.map((b) => b.l)), c: prev[prev.length - 1].c };
}

function orCrosses(symbolBars) {
  const crosses = [];
  for (const [symbol, byDay] of Object.entries(symbolBars || {})) {
    for (const [day, raw] of Object.entries(byDay || {})) {
      const bars15 = aggregate15(raw);
      const first = first15(bars15);
      if (!first || !(first.h > first.l)) continue;
      for (const b of bars15.slice(1)) {
        if (b.t !== '09:30') continue;
        if (b.c > first.h) crosses.push({ symbol, day, side: 'L', t: '09:45' });
        else if (b.c < first.l) crosses.push({ symbol, day, side: 'S', t: '09:45' });
        break;
      }
    }
  }
  return dayCrowdFromCrosses(crosses);
}

function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function collectSignals(symbolBars, candidate) {
  const family = candidate.family;
  if (family === 'orb_two_low' || family === 'orb_winner' || family === 'orb_original') return [];
  const out = [];
  let n = 0;
  for (const [symbol, byDay] of Object.entries(symbolBars || {})) {
    for (const [day, raw] of Object.entries(byDay || {})) {
      const bars5 = [...(raw || [])].sort((a, b) => a.t.localeCompare(b.t));
      if (bars5.length < 12) continue;
      const bars15 = aggregate15(bars5);
      const sigs = emitFamily(family, { symbol, day, bars5, bars15, byDay, candidate });
      if (sigs) out.push(...(Array.isArray(sigs) ? sigs : [sigs]).filter(Boolean));
      n += 1;
      if (n % 25 === 0) await yieldEventLoop();
    }
  }
  return out;
}

function emitFamily(family, ctx) {
  switch (family) {
    case 'or30_break':
      return or30Break(ctx);
    case 'gap_continue':
      return gapContinue(ctx);
    case 'gap_fade':
      return gapFade(ctx);
    case 'vwap_reclaim':
      return vwapReclaim(ctx);
    case 'pdh_break':
      return pdhBreak(ctx);
    case 'morning_thrust':
      return morningThrust(ctx);
    case 'open_fade':
      return openFade(ctx);
    case 'ema_cross':
      return emaCross(ctx);
    case 'nr30_break':
      return nr30Break(ctx);
    default:
      return null;
  }
}

function or30Break({ symbol, day, bars5, candidate }) {
  const rng = first30HighLow(bars5);
  if (!rng || !(rng.h > rng.l)) return null;
  const minW = candidate.minOrPct == null ? 0.002 : candidate.minOrPct;
  const maxW = candidate.maxOrPct == null ? 0.04 : candidate.maxOrPct;
  const w = (rng.h - rng.l) / rng.h;
  if (w < minW || w > maxW) return null;
  for (const b of bars5) {
    if (toMin(b.t) < toMin('09:45') || toMin(b.t) > toMin(candidate.entryEnd || '14:30')) continue;
    if (b.c > rng.h) {
      return {
        symbol,
        day,
        side: 'L',
        family: 'or30_break',
        signalT: b.t,
        entryPx: b.h,
        stopPx: rng.l,
        reason: 'First 30-minute range, later 5-minute close above the high',
        rankScore: rankValue(candidate.rankBy, { w, stopPct: (b.h - rng.l) / b.h, t: b.t, move: (b.c - rng.h) / rng.h }),
      };
    }
    if (b.c < rng.l) {
      return {
        symbol,
        day,
        side: 'S',
        family: 'or30_break',
        signalT: b.t,
        entryPx: b.l,
        stopPx: rng.h,
        reason: 'First 30-minute range, later 5-minute close below the low',
        rankScore: rankValue(candidate.rankBy, { w, stopPct: (rng.h - b.l) / b.l, t: b.t, move: (rng.l - b.c) / rng.l }),
      };
    }
  }
  return null;
}

function gapContinue({ symbol, day, bars5, bars15, byDay, candidate }) {
  const first = first15(bars15);
  const prev = prevClose(byDay, day);
  if (!first || !prev) return null;
  const gap = (first.o - prev) / prev;
  const minGap = candidate.minGap == null ? 0.004 : candidate.minGap;
  if (Math.abs(gap) < minGap) return null;
  const side = gap > 0 ? 'L' : 'S';
  const continued = side === 'L' ? first.c >= first.o : first.c <= first.o;
  if (!continued) return null;
  return {
    symbol,
    day,
    side,
    family: 'gap_continue',
    signalT: '09:30',
    entryPx: side === 'L' ? first.h : first.l,
    stopPx: side === 'L' ? first.l : first.h,
    reason: `Gap ${((gap * 100).toFixed(2))}% vs prior close, first 15 continued`,
    rankScore: rankValue(candidate.rankBy, { w: (first.h - first.l) / first.h, stopPct: Math.abs(first.h - first.l) / first.h, t: '09:30', move: Math.abs(gap) }),
  };
}

function gapFade({ symbol, day, bars15, byDay, candidate }) {
  const first = first15(bars15);
  const prev = prevClose(byDay, day);
  if (!first || !prev) return null;
  const gap = (first.o - prev) / prev;
  const minGap = candidate.minGap == null ? 0.008 : candidate.minGap;
  if (Math.abs(gap) < minGap) return null;
  const faded = gap > 0 ? first.c < first.o : first.c > first.o;
  if (!faded) return null;
  const side = gap > 0 ? 'S' : 'L';
  return {
    symbol,
    day,
    side,
    family: 'gap_fade',
    signalT: '09:30',
    entryPx: side === 'L' ? first.h : first.l,
    stopPx: side === 'L' ? first.l : first.h,
    reason: `Gap ${((gap * 100).toFixed(2))}% faded back through the open in the first 15`,
    rankScore: rankValue(candidate.rankBy, { w: (first.h - first.l) / first.h, stopPct: Math.abs(first.h - first.l) / first.h, t: '09:30', move: Math.abs(gap) }),
  };
}

function vwapReclaim({ symbol, day, bars5, candidate }) {
  const start = candidate.entryStart || '10:00';
  let seenBelow = false;
  let seenAbove = false;
  for (const b of bars5) {
    if (toMin(b.t) < toMin('09:15') || toMin(b.t) > toMin(candidate.entryEnd || '14:30')) continue;
    const vwap = sessionVwap(bars5, b.t);
    if (!(vwap > 0)) continue;
    if (b.c < vwap) seenBelow = true;
    if (b.c > vwap) seenAbove = true;
    if (toMin(b.t) < toMin(start)) continue;
    if (seenBelow && b.c > vwap && b.c > b.o) {
      return {
        symbol,
        day,
        side: 'L',
        family: 'vwap_reclaim',
        signalT: b.t,
        entryPx: b.h,
        stopPx: Math.min(vwap, b.l),
        reason: 'Session VWAP reclaim after trading below it',
        rankScore: rankValue(candidate.rankBy, { w: (b.h - b.l) / b.h, stopPct: (b.h - Math.min(vwap, b.l)) / b.h, t: b.t, move: (b.c - vwap) / vwap }),
      };
    }
    if (seenAbove && b.c < vwap && b.c < b.o) {
      return {
        symbol,
        day,
        side: 'S',
        family: 'vwap_reclaim',
        signalT: b.t,
        entryPx: b.l,
        stopPx: Math.max(vwap, b.h),
        reason: 'Session VWAP lose after trading above it',
        rankScore: rankValue(candidate.rankBy, { w: (b.h - b.l) / b.h, stopPct: (Math.max(vwap, b.h) - b.l) / b.l, t: b.t, move: (vwap - b.c) / vwap }),
      };
    }
  }
  return null;
}

function pdhBreak({ symbol, day, bars5, byDay, candidate }) {
  const prev = prevDayRange(byDay, day);
  if (!prev) return null;
  for (const b of bars5) {
    if (toMin(b.t) < toMin('09:45') || toMin(b.t) > toMin(candidate.entryEnd || '14:30')) continue;
    if (b.c > prev.h) {
      return {
        symbol,
        day,
        side: 'L',
        family: 'pdh_break',
        signalT: b.t,
        entryPx: b.h,
        stopPx: prev.h,
        reason: '5-minute close above the prior-day high',
        rankScore: rankValue(candidate.rankBy, { w: (b.h - prev.h) / prev.h, stopPct: (b.h - prev.h) / b.h, t: b.t, move: (b.c - prev.h) / prev.h }),
      };
    }
    if (b.c < prev.l) {
      return {
        symbol,
        day,
        side: 'S',
        family: 'pdh_break',
        signalT: b.t,
        entryPx: b.l,
        stopPx: prev.l,
        reason: '5-minute close below the prior-day low',
        rankScore: rankValue(candidate.rankBy, { w: (prev.l - b.l) / prev.l, stopPct: (prev.l - b.l) / b.l, t: b.t, move: (prev.l - b.c) / prev.l }),
      };
    }
  }
  return null;
}

function morningThrust({ symbol, day, bars5, candidate }) {
  const slice = bars5.filter((b) => toMin(b.t) >= toMin('09:15') && toMin(b.t) < toMin('10:00'));
  if (slice.length < 6) return null;
  const open = slice[0].o;
  const last = slice[slice.length - 1];
  const ret = (last.c - open) / open;
  const minRet = candidate.minRet == null ? 0.007 : candidate.minRet;
  if (Math.abs(ret) < minRet) return null;
  const side = ret > 0 ? 'L' : 'S';
  const hi = Math.max(...slice.map((b) => b.h));
  const lo = Math.min(...slice.map((b) => b.l));
  return {
    symbol,
    day,
    side,
    family: 'morning_thrust',
    signalT: '10:00',
    entryPx: side === 'L' ? last.h : last.l,
    stopPx: side === 'L' ? lo : hi,
    reason: `09:15–10:00 move ${((ret * 100).toFixed(2))}%`,
    rankScore: rankValue(candidate.rankBy, { w: (hi - lo) / hi, stopPct: Math.abs((side === 'L' ? last.h : last.l) - (side === 'L' ? lo : hi)) / last.c, t: '10:00', move: Math.abs(ret) }),
  };
}

function openFade({ symbol, day, bars5, bars15, candidate }) {
  const first = first15(bars15);
  if (!first || !(first.h > first.l)) return null;
  const w = (first.h - first.l) / first.h;
  const minOr = candidate.minOrPct == null ? 0.012 : candidate.minOrPct;
  if (w < minOr) return null;
  const side = first.c > first.o ? 'S' : 'L';
  let reverse = 0;
  for (const b of bars5) {
    if (toMin(b.t) < toMin('09:30') || toMin(b.t) > toMin(candidate.entryEnd || '14:30')) continue;
    const against = side === 'S' ? b.c > b.o : b.c < b.o;
    if (against) reverse += 1;
    else reverse = 0;
    if (reverse < (candidate.pullbacksNeeded || 2)) continue;
    return {
      symbol,
      day,
      side,
      family: 'open_fade',
      signalT: b.t,
      entryPx: side === 'L' ? b.h : b.l,
      stopPx: side === 'L' ? b.l : b.h,
      reason: `Wide first 15 (${(w * 100).toFixed(2)}%), fade toward the open after reverse candles`,
      rankScore: rankValue(candidate.rankBy, { w, stopPct: Math.abs(b.h - b.l) / b.c, t: b.t, move: w }),
    };
  }
  return null;
}

function emaCross({ symbol, day, bars5, candidate }) {
  const fast = emaSeries(bars5, 9);
  const slow = emaSeries(bars5, 21);
  const start = candidate.entryStart || '10:00';
  for (let i = 1; i < bars5.length; i += 1) {
    const t = bars5[i].t;
    if (toMin(t) < toMin(start) || toMin(t) > toMin(candidate.entryEnd || '14:30')) continue;
    const prevUp = fast[i - 1].v > slow[i - 1].v;
    const nowUp = fast[i].v > slow[i].v;
    if (prevUp === nowUp) continue;
    const side = nowUp ? 'L' : 'S';
    const window = bars5.slice(Math.max(0, i - 3), i + 1);
    const stop = side === 'L' ? Math.min(...window.map((b) => b.l)) : Math.max(...window.map((b) => b.h));
    const b = bars5[i];
    return {
      symbol,
      day,
      side,
      family: 'ema_cross',
      signalT: t,
      entryPx: side === 'L' ? b.h : b.l,
      stopPx: stop,
      reason: '5-minute EMA 9/21 cross after 10:00',
      rankScore: rankValue(candidate.rankBy, { w: Math.abs(fast[i].v - slow[i].v) / b.c, stopPct: Math.abs(b.c - stop) / b.c, t, move: Math.abs(fast[i].v - slow[i].v) / b.c }),
    };
  }
  return null;
}

function nr30Break(ctx) {
  return or30Break({ ...ctx, candidate: { ...ctx.candidate, maxOrPct: ctx.candidate.maxOrPct == null ? 0.008 : ctx.candidate.maxOrPct } });
}

function rankValue(rankBy, { w, stopPct, t, move }) {
  if (rankBy === 'time') return 1000 - toMin(t);
  if (rankBy === 'orWidth' || rankBy === 'rangePct') return w || 0;
  if (rankBy === 'move') return move || 0;
  return stopPct || 0;
}

function orbTrades(symbolBars, candidate, capital) {
  const cfg = clampConfig({
    capital,
    maxStocksPerDay: candidate.maxStocksPerDay,
    rankBy: candidate.rankBy || 'time',
    crowdFilter: candidate.crowdFilter || null,
    entryEnd: candidate.entryEnd || '14:30',
    timeExit: candidate.timeExit || '15:15',
    targetR: candidate.targetR,
    sizing: candidate.sizing || 'risk',
    pullbacksNeeded: candidate.pullbacksNeeded || 2,
    preset: candidate.family === 'orb_winner' ? 'winner' : undefined,
  });
  const out = runOrbBacktest({ symbolBars, config: cfg });
  return (out.trades || []).map((t) => ({
    ...t,
    family: candidate.family,
    reason: t.reason || candidate.rules.entry,
    allocatedRs: t.notionalRs,
  }));
}

module.exports = {
  collectSignals,
  orCrosses,
  orbTrades,
  first30HighLow,
  prevClose,
  prevDayRange,
  pdhBreak,
  sessionVwap,
};
