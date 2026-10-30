/**
 * Crude Mini weekly-bank scalp.
 *
 * Hunt (CRUDEOILM 5m 2026-05-21 → 2026-10-30, ₹50/RT, 1 lot ₹10/pt):
 *   TP 30 · scratch 8 · first-bar smell · day lock 20 · week lock 40
 *   Clock: skip 09:00 IST chop. 10:00–23:00 · ₹365/week vs ₹305 all-session.
 * Not a guaranteed profit.
 */
'use strict';

const DNA = {
  profileId: 'weekly-bank-sc8',
  entryStart: '10:00',
  entryEnd: '23:00',
  flatten: '23:10',
  stopPts: 20,
  scratchPts: 8,
  smellFirstBar: true,
  targetPts: 30,
  dayLockPts: 20,
  dayLossPts: 40,
  maxTrades: 2,
  firstWin: true,
  confirm: true,
  emaFilter: false,
  maxPrevDayRangePts: 400,
  weekLockPts: 40,
  weekLossPts: 0,
  sitAfterRedDay: false,
  rupeesPerPoint: 10,
  chargeRs: 50,
  qty: 1,
  tickSize: 1,
};

const ENGINE_VERSION = '1.3.170-win-clock';

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
  confirmDir,
  adversePts,
  shouldScratch,
  smellAgainst,
  dayShouldStandDown,
};
