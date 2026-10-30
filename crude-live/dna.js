/**
 * Crude Mini daily-min scalp.
 *
 * Hunt (CRUDEOILM 5m 2026-05-21 → 2026-10-30, ₹50/RT, 1 lot ₹10/pt):
 *   PDHL + 10:00–11:00 OR fade + 6-bar trap. TP 25 · scratch 10 · first-bar smell.
 *   Day lock 20 / first win. Week lock off so every session can still hunt ₹150–200.
 *   Sample: 43/74 full-session days hit ₹150+ (58%). Not a guaranteed daily ₹150.
 */
'use strict';

const DNA = {
  profileId: 'daily-min-sc10',
  entryStart: '10:00',
  entryEnd: '23:00',
  flatten: '23:10',
  orStart: '10:00',
  orEnd: '11:00',
  stopPts: 20,
  scratchPts: 10,
  smellFirstBar: true,
  targetPts: 25,
  dayLockPts: 20,
  dayLossPts: 40,
  maxTrades: 2,
  firstWin: true,
  confirm: true,
  emaFilter: false,
  maxPrevDayRangePts: 400,
  weekLockPts: 0,
  weekLossPts: 0,
  sitAfterRedDay: false,
  trapPiercePts: 8,
  trapLookback: 6,
  orMinWidthPts: 12,
  orMaxWidthPts: 220,
  rupeesPerPoint: 10,
  chargeRs: 50,
  qty: 1,
  tickSize: 1,
};

const ENGINE_VERSION = '1.3.171-daily-min';

function toMin(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function weekMonday(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const wd = dt.getUTCDay();
  const back = wd === 0 ? 6 : wd - 1;
  dt.setUTCDate(dt.getUTCDate() - back);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function weekShouldStandDown(
  weekNetPts,
  lockPts = DNA.weekLockPts,
  lossPts = DNA.weekLossPts,
) {
  if (lockPts > 0 && weekNetPts >= lockPts) return true;
  if (lossPts > 0 && weekNetPts <= -lossPts) return true;
  return false;
}

function prevDayRangePts(high, low) {
  if (!(high > 0) || !(low > 0) || high < low) return 0;
  return high - low;
}

function skipWildPrevDay(high, low, maxRange = DNA.maxPrevDayRangePts) {
  return prevDayRangePts(high, low) > maxRange;
}

function pdhlDir(close, open, pdh, pdl) {
  if (close > pdh && close > open) return 1;
  if (close < pdl && close < open) return -1;
  return 0;
}

function orbFadeDir(
  close,
  open,
  high,
  low,
  orHigh,
  orLow,
  barMin,
  orEndMin = toMin(DNA.orEnd),
  minW = DNA.orMinWidthPts,
  maxW = DNA.orMaxWidthPts,
) {
  if (barMin <= orEndMin) return 0;
  const width = orHigh - orLow;
  if (!(width >= minW) || width > maxW) return 0;
  if (high > orHigh && close < orHigh && close < open) return -1;
  if (low < orLow && close > orLow && close > open) return 1;
  return 0;
}

function trapDir(close, open, high, low, swingHigh, swingLow, pierce = DNA.trapPiercePts) {
  if (!(swingHigh > 0) || !(swingLow > 0)) return 0;
  if (low < swingLow - pierce && close > swingLow && close > open) return 1;
  if (high > swingHigh + pierce && close < swingHigh && close < open) return -1;
  return 0;
}

function entryDir(close, open, high, low, pdh, pdl, orHigh, orLow, swingHigh, swingLow, barMin) {
  const pdhl = skipWildPrevDay(pdh, pdl) ? 0 : pdhlDir(close, open, pdh, pdl);
  return (
    pdhl ||
    orbFadeDir(close, open, high, low, orHigh, orLow, barMin) ||
    trapDir(close, open, high, low, swingHigh, swingLow)
  );
}

function confirmDir(dir, signalClose, nextOpen, nextClose) {
  if (dir === 1) return nextClose > nextOpen && nextClose > signalClose;
  return nextClose < nextOpen && nextClose < signalClose;
}

function adversePts(side, entry, last) {
  const e = Number(entry);
  const px = Number(last);
  if (!(e > 0) || !(px > 0)) return 0;
  return side === 'S' ? px - e : e - px;
}

function shouldScratch(side, entry, last, scratch = DNA.scratchPts) {
  return scratch > 0 && adversePts(side, entry, last) >= scratch;
}

function smellAgainst(side, entry, barClose) {
  const e = Number(entry);
  const cl = Number(barClose);
  if (!(e > 0) || !(cl > 0)) return false;
  return side === 'S' ? cl > e : cl < e;
}

function dayShouldStandDown(dayNetPts, tradesToday) {
  if (tradesToday >= DNA.maxTrades) return true;
  if (dayNetPts <= -DNA.dayLossPts) return true;
  if (DNA.dayLockPts > 0 && dayNetPts >= DNA.dayLockPts) return true;
  if (DNA.firstWin && dayNetPts > 0) return true;
  return false;
}

module.exports = {
  DNA,
  ENGINE_VERSION,
  toMin,
  weekMonday,
  weekShouldStandDown,
  prevDayRangePts,
  skipWildPrevDay,
  pdhlDir,
  orbFadeDir,
  trapDir,
  entryDir,
  confirmDir,
  adversePts,
  shouldScratch,
  smellAgainst,
  dayShouldStandDown,
};
