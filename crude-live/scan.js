/**
 * All-session Crude Mini PDHL scan on closed 5-minute bars.
 * Signal in 10:00–23:00, next-bar confirm, flatten 23:10.
 */
'use strict';

const { minutesOfDay, sessionDate } = require('../research/time');
const {
  DNA,
  toMin,
  skipWildPrevDay,
  pdhlDir,
  confirmDir,
  weekShouldStandDown,
  dayShouldStandDown,
  shouldScratch,
  smellAgainst,
} = require('./dna');

function barClock(iso) {
  const m = minutesOfDay(iso);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function barsFromKite(rows) {
  return (rows || [])
    .map((r) => ({
      t: barClock(r.date),
      day: sessionDate(r.date),
      o: Number(r.open),
      h: Number(r.high),
      l: Number(r.low),
      c: Number(r.close),
      v: Number(r.volume) || 0,
    }))
    .filter((b) => b.day && Number.isFinite(b.o) && Number.isFinite(b.c));
}

function closedBars(bars, now) {
  const nowMin = minutesOfDay(now);
  const day = sessionDate(now);
  return (bars || []).filter((b) => {
    if (b.day < day) return true;
    if (b.day > day) return false;
    return toMin(b.t) + 5 <= nowMin;
  });
}

function prevSessionHl(bars, day) {
  const days = [...new Set((bars || []).map((b) => b.day).filter((d) => d && d < day))].sort();
  const prev = days[days.length - 1];
  if (!prev) return null;
  const subset = bars.filter((b) => b.day === prev);
  if (!subset.length) return null;
  return {
    day: prev,
    high: Math.max(...subset.map((b) => b.h)),
    low: Math.min(...subset.map((b) => b.l)),
  };
}

function inEntryWindow(now) {
  const m = minutesOfDay(now);
  return m >= toMin(DNA.entryStart) && m <= toMin(DNA.entryEnd);
}

function pastFlatten(now) {
  return minutesOfDay(now) >= toMin(DNA.flatten);
}

function levels(side, fillPx) {
  const dir = side === 'S' ? -1 : 1;
  const fill = Number(fillPx);
  if (!(fill > 0)) return null;
  return {
    stopPx: fill - dir * DNA.stopPts,
    targetPx: fill + dir * DNA.targetPts,
    scratchPx: DNA.scratchPts > 0 ? fill - dir * DNA.scratchPts : null,
  };
}

function decideExit({ fill, lastPx, now, smellBar = null }) {
  if (!fill) return { action: 'flat' };
  if (pastFlatten(now)) return { action: 'flatten', reason: 'EOD' };
  const last = Number(lastPx);
  if (!(last > 0)) return { action: 'hold' };
  if (shouldScratch(fill.side, fill.entry, last)) {
    return { action: 'flatten', reason: 'SCRATCH' };
  }
  if (DNA.smellFirstBar && smellBar && smellAgainst(fill.side, fill.entry, smellBar.close)) {
    return { action: 'flatten', reason: 'SMELL' };
  }
  const stop = Number(fill.stop);
  const target = Number(fill.target);
  if (fill.side === 'S') {
    if (stop > 0 && last >= stop) return { action: 'flatten', reason: 'SL' };
    if (target > 0 && last <= target) return { action: 'flatten', reason: 'TARGET' };
  } else {
    if (stop > 0 && last <= stop) return { action: 'flatten', reason: 'SL' };
    if (target > 0 && last >= target) return { action: 'flatten', reason: 'TARGET' };
  }
  return { action: 'hold' };
}

/** First closed 5m bar whose clock is after the confirm/fill bar. */
function firstBarAfter(bars, day, confirmT) {
  if (!confirmT) return null;
  const start = toMin(confirmT);
  const same = (bars || []).filter((b) => b.day === day && toMin(b.t) > start);
  same.sort((a, b) => toMin(a.t) - toMin(b.t));
  return same[0] || null;
}

function nextAction({
  bars,
  now,
  pending = null,
  tradesToday = 0,
  dayNetPts = 0,
  weekNetPts = 0,
  fill = null,
} = {}) {
  if (fill) return { action: 'in-trade', message: 'Open fill — no new entry.' };
  if (weekShouldStandDown(weekNetPts)) {
    return { action: 'week-lock', message: `Week locked at +${DNA.weekLockPts} pts. Sitting out.` };
  }
  if (dayShouldStandDown(dayNetPts, tradesToday)) {
    return { action: 'day-cap', message: 'Day lock / loss / max 2 fills — no new entry.' };
  }
  if (pastFlatten(now)) {
    return { action: 'outside', message: `Flatten window ${DNA.flatten} IST.` };
  }

  const day = sessionDate(now);
  const closed = closedBars(bars, now).filter((b) => b.day === day);
  const hl = prevSessionHl(bars, day);
  if (!hl) return { action: 'no-prev', message: 'Waiting for yesterday’s high and low.' };
  if (skipWildPrevDay(hl.high, hl.low)) {
    return {
      action: 'wild-prev',
      message: `Yesterday range ${Math.round(hl.high - hl.low)} pts > ${DNA.maxPrevDayRangePts}. Sitting out.`,
      prev: hl,
    };
  }

  if (pending && pending.signalT) {
    const next = closed.find((b) => toMin(b.t) > toMin(pending.signalT));
    if (!next) {
      return { action: 'wait-confirm', pending, prev: hl, message: `Confirming ${pending.signalT} PDHL.` };
    }
    const dir = pending.dir === -1 || pending.dir === 'S' ? -1 : 1;
    if (!confirmDir(dir, pending.sig, next.o, next.c)) {
      return {
        action: 'reject-confirm',
        pending: null,
        prev: hl,
        message: `Confirm failed on ${next.t}.`,
      };
    }
    const side = dir === -1 ? 'S' : 'L';
    const fillPx = Number(next.o) > 0 ? Number(next.o) : Number(next.c);
    const lv = levels(side, fillPx);
    if (!lv) return { action: 'waiting', pending: null, prev: hl, message: 'Could not size the fill.' };
    return {
      action: 'enter',
      pending: null,
      side,
      fillPx,
      stopPx: lv.stopPx,
      targetPx: lv.targetPx,
      signalT: pending.signalT,
      confirmT: next.t,
      prev: hl,
      message: `Confirm ${next.t} · ${side === 'S' ? 'short' : 'long'} @ ${fillPx}`,
    };
  }

  if (!inEntryWindow(now) && !(closed.length && toMin(closed[closed.length - 1].t) >= toMin(DNA.entryStart))) {
    return { action: 'outside', prev: hl, message: `Armed. Entries ${DNA.entryStart}–${DNA.entryEnd} IST.` };
  }

  const last = closed.filter((b) => {
    const m = toMin(b.t);
    return m >= toMin(DNA.entryStart) && m <= toMin(DNA.entryEnd);
  }).pop();
  if (!last) return { action: 'waiting', prev: hl, message: 'Waiting for a closed 5-minute bar.' };

  const dir = pdhlDir(last.c, last.o, hl.high, hl.low);
  if (!dir) {
    return { action: 'waiting', prev: hl, lastT: last.t, message: `Watching ${last.t}. No PDHL close.` };
  }
  if (DNA.confirm) {
    return {
      action: 'pending',
      pending: { dir, sig: last.c, signalT: last.t },
      prev: hl,
      message: `PDHL ${dir === 1 ? 'long' : 'short'} at ${last.t} — waiting next bar confirm.`,
    };
  }
  const side = dir === -1 ? 'S' : 'L';
  const lv = levels(side, last.c);
  return {
    action: 'enter',
    side,
    fillPx: last.c,
    stopPx: lv.stopPx,
    targetPx: lv.targetPx,
    signalT: last.t,
    confirmT: last.t,
    prev: hl,
    message: `PDHL ${side === 'S' ? 'short' : 'long'} @ ${last.c}`,
  };
}

module.exports = {
  barsFromKite,
  closedBars,
  prevSessionHl,
  inEntryWindow,
  pastFlatten,
  levels,
  decideExit,
  firstBarAfter,
  nextAction,
};
