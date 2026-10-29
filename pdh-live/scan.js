/**
 * Prior-day live scan — every closed 5-minute bar from 09:45 through 14:30.
 * Forming candles are dropped. The 09:45 crowd is used only as a side filter;
 * names may qualify at 11:20, not only near 09:50.
 */
'use strict';

const { toMin } = require('../orb-backtest/engine');
const { minutesOfDay, sessionDate } = require('../research/time');
const { orCrosses, pdhSignalsForDay } = require('../daily-profit/signals');
const { filterCrowd, pickDay } = require('../daily-profit/portfolio');
const { sizeQty, RISK_FRACTION, BUY_POWER_MULT } = require('../daily-profit/simulate');
const { pdhFollowCandidate, LIVE_MAX_NAMES, LIVE_TARGET_R } = require('../orb-backtest/pdh-desk');

const ENTRY_START = '09:45';
const ENTRY_END = '14:30';
const TIME_EXIT = '15:15';
const CROWD_READY = '09:45';

function closedBars(bars5, now) {
  const nowMin = minutesOfDay(now);
  return (bars5 || []).filter((b) => toMin(b.t) + 5 <= nowMin);
}

function closeUniverse(symbolBars, day, now) {
  const out = {};
  for (const [symbol, byDay] of Object.entries(symbolBars || {})) {
    const closed = {};
    for (const [d, bars] of Object.entries(byDay || {})) {
      closed[d] = d === day ? closedBars(bars, now) : bars;
    }
    out[symbol] = closed;
  }
  return out;
}

function inEntryWindow(now) {
  const m = minutesOfDay(now);
  return m >= toMin(ENTRY_START) && m <= toMin(ENTRY_END);
}

function pastTimeExit(now) {
  return minutesOfDay(now) >= toMin(TIME_EXIT);
}

function crowdReady(now) {
  return minutesOfDay(now) >= toMin(CROWD_READY);
}

function subsequentResolved(bars, { side, fillPx, stopPx, targetR = LIVE_TARGET_R, timeExit = TIME_EXIT }, afterT) {
  const riskPx = side === 'L' ? fillPx - stopPx : stopPx - fillPx;
  if (!(riskPx > 0)) return 'INVALID';
  const tgtPx = side === 'L' ? fillPx + riskPx * Number(targetR) : fillPx - riskPx * Number(targetR);
  for (const b of bars || []) {
    if (toMin(b.t) <= toMin(afterT)) continue;
    if (toMin(b.t) > toMin(timeExit)) break;
    const slHit = side === 'L' ? b.l <= stopPx : b.h >= stopPx;
    const tgtHit = side === 'L' ? b.h >= tgtPx : b.l <= tgtPx;
    if (slHit) return 'SL';
    if (tgtHit) return 'TARGET';
    if (b.t === timeExit) return 'EOD';
  }
  return 'OPEN';
}

function barAt(bars, t) {
  return (bars || []).find((b) => b.t === t) || null;
}

function liveQty({ side, fill, stopPx, capital }) {
  return sizeQty({
    side,
    fill,
    stopPx,
    capital,
    maxStocksPerDay: LIVE_MAX_NAMES,
    sizing: 'risk',
    buyPower: capital * BUY_POWER_MULT,
  });
}

function liveLevels(side, fillPx, stopPx) {
  const riskPx = side === 'L' ? fillPx - stopPx : stopPx - fillPx;
  if (!(riskPx > 0)) return null;
  const target = side === 'L' ? fillPx + riskPx * LIVE_TARGET_R : fillPx - riskPx * LIVE_TARGET_R;
  return { riskPx, target, riskRsFraction: RISK_FRACTION };
}

function ltpBeyond(ltp, prev, crowd) {
  if (!(ltp > 0) || !prev) return null;
  if (crowd === 'L' || crowd === 'M' || !crowd) {
    if (ltp > prev.h) return 'L';
  }
  if (crowd === 'S' || crowd === 'M' || !crowd) {
    if (ltp < prev.l) return 'S';
  }
  return null;
}

function eligibleFromBars(symbolBars, { day, now, capital, crowdDay = null, taken = [] } = {}) {
  const session = day || sessionDate(now);
  if (!inEntryWindow(now)) {
    return {
      crowd: crowdDay,
      signals: [],
      picks: [],
      picked: null,
      skipped: [],
      reason: crowdReady(now) ? 'outside-entry' : 'before-crowd',
    };
  }
  const closed = closeUniverse(symbolBars, session, now);
  const candidate = pdhFollowCandidate(capital || 1, { liveLock: true });
  const crowdMap = orCrosses(closed);
  const crowd = crowdMap[session] || crowdDay || null;
  if (!crowd) {
    return { crowd: null, signals: [], picks: [], picked: null, skipped: [], reason: 'crowd-pending' };
  }
  const takenSet = new Set((taken || []).map((s) => String(s || '').trim().toUpperCase()).filter(Boolean));
  const slots = Math.max(0, LIVE_MAX_NAMES - takenSet.size);
  const raw = pdhSignalsForDay(closed, session, candidate);
  const filtered = filterCrowd(raw, { [session]: crowd }, candidate.crowdFilter);
  const open = [];
  const skipped = [];
  for (const sig of filtered) {
    const bars = (closed[sig.symbol] && closed[sig.symbol][session]) || [];
    const print = barAt(bars, sig.signalT);
    const fillPx = print && print.c > 0 ? print.c : sig.entryPx;
    const symbol = String(sig.symbol || '').trim().toUpperCase();
    if (takenSet.has(symbol)) {
      skipped.push({ ...sig, fillPx, resolved: 'TAKEN' });
      continue;
    }
    const resolved = subsequentResolved(bars, { side: sig.side, fillPx, stopPx: sig.stopPx }, sig.signalT);
    if (resolved !== 'OPEN') {
      skipped.push({ ...sig, fillPx, resolved });
      continue;
    }
    const levels = liveLevels(sig.side, fillPx, sig.stopPx);
    if (!levels) {
      skipped.push({ ...sig, fillPx, resolved: 'INVALID' });
      continue;
    }
    const qty = liveQty({ side: sig.side, fill: fillPx, stopPx: sig.stopPx, capital: capital || 1 });
    if (!qty) {
      skipped.push({ ...sig, fillPx, resolved: 'NO_QTY' });
      continue;
    }
    open.push({
      ...sig,
      fillPx,
      qty,
      targetPx: levels.target,
      riskPx: levels.riskPx,
      resolved: 'OPEN',
    });
  }
  const picks = slots > 0 ? pickDay(open, slots) : [];
  const picked = picks[0] || null;
  return {
    crowd,
    signals: open,
    picks,
    picked,
    skipped,
    reason: picks.length ? 'entry' : open.length ? 'ranked' : filtered.length ? 'resolved' : 'waiting',
  };
}

function quoteKeys(symbols) {
  return (symbols || []).map((s) => `NSE:${String(s).trim().toUpperCase()}`);
}

function chunk(list, size) {
  const out = [];
  const n = Math.max(1, size);
  for (let i = 0; i < (list || []).length; i += n) out.push(list.slice(i, i + n));
  return out;
}

module.exports = {
  ENTRY_START,
  ENTRY_END,
  TIME_EXIT,
  closedBars,
  closeUniverse,
  inEntryWindow,
  pastTimeExit,
  crowdReady,
  subsequentResolved,
  pdhSignalsForDay,
  liveQty,
  liveLevels,
  ltpBeyond,
  eligibleFromBars,
  quoteKeys,
  chunk,
};
