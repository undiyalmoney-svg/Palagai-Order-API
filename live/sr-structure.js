'use strict';
/**
 * S/R box geometry — the same wall Paper and Live trade, drawn as:
 *   wall line, pink (against the break), teal (measured continuation).
 * Not a UI fake: runSrBreakout attaches this object to every trade.
 */

function round2(x) {
  return Math.round((Number(x) || 0) * 100) / 100;
}

function hhmm(d) {
  return String(d).slice(11, 16);
}

function ymd(d) {
  return String(d).slice(0, 10);
}

/**
 * @param {object} args
 * @param {1|-1} args.dir
 * @param {number} args.level broken wall
 * @param {number} args.wallHi
 * @param {number} args.wallLo
 * @param {number} [args.breakLow] 15m breakout low
 * @param {number} [args.breakHigh] 15m breakout high
 */
function structureOf(args) {
  const dir = args.dir > 0 ? 1 : -1;
  const wall = Number(args.level);
  const wallHi = Number(args.wallHi);
  const wallLo = Number(args.wallLo);
  if (!Number.isFinite(wall) || !Number.isFinite(wallHi) || !Number.isFinite(wallLo)) return null;
  const breakLow = Number(args.breakLow);
  const breakHigh = Number(args.breakHigh);
  const adverse = dir > 0
    ? Math.min(wallLo, Number.isFinite(breakLow) ? breakLow : wallLo)
    : Math.max(wallHi, Number.isFinite(breakHigh) ? breakHigh : wallHi);
  const height = dir > 0 ? wall - adverse : adverse - wall;
  if (!(height > 0) || !Number.isFinite(adverse)) return null;
  const measured = wall + dir * height;
  const entryHm = args.entryTime || null;
  const exitHm = args.exitTime || null;
  const breakoutTime = args.breakoutTime || entryHm;
  return {
    wall: round2(wall),
    wallHi: round2(wallHi),
    wallLo: round2(wallLo),
    dir,
    height: round2(height),
    adverseExtreme: round2(adverse),
    measuredMove: round2(measured),
    pink: {
      lo: round2(dir > 0 ? adverse : wall),
      hi: round2(dir > 0 ? wall : adverse),
      fromHm: args.lookFromHm || null,
      toHm: entryHm || breakoutTime,
    },
    teal: {
      lo: round2(dir > 0 ? wall : measured),
      hi: round2(dir > 0 ? measured : wall),
      fromHm: entryHm || breakoutTime,
      toHm: exitHm,
    },
    entry: { hm: entryHm, price: round2(args.entryPrice) },
    exit: args.openAtFill
      ? null
      : { hm: exitHm, price: round2(args.exitPrice), reason: args.exitReason || null },
  };
}

function compactSessionBars(bars5, day, fromHm = '09:15', toHm = '15:30') {
  return (bars5 || [])
    .filter((b) => ymd(b.date) === day && hhmm(b.date) >= fromHm && hhmm(b.date) <= toHm)
    .map((b) => ({
      t: b.date,
      o: round2(b.open),
      h: round2(b.high),
      l: round2(b.low),
      c: round2(b.close),
    }));
}

function chartPayload(candles, trades, meta = {}) {
  const days = {};
  const list = trades || [];
  const seen = new Set();
  for (const t of list) {
    const d = t.date || String(t.entryTime || '').slice(0, 10);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    days[d] = compactSessionBars(candles, d, meta.fromHm || '09:15', meta.toHm || '15:30');
  }
  return {
    id: meta.id || null,
    label: meta.label || meta.name || null,
    days,
  };
}

module.exports = { structureOf, compactSessionBars, chartPayload, round2, hhmm, ymd };
