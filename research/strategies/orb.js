'use strict';

const { sessionDate, minutesOfDay } = require('../time');
const { onDate, last, bracket, pack, minute } = require('./common');

const meta = {
  strategyId: 'opening-range',
  name: 'Opening-range breakout',
  version: 1,
};

function evaluate(ctx) {
  const params = { ...meta, ...ctx.strategy };
  const p = { ...ctx.params, ...(ctx.strategy?.parameters || {}) };
  const rangeMin = p.openingRangeMinutes || p.openingRange || 15;
  const open = p.sessionOpenMin || 9 * 60 + 15;
  const readyAt = open + rangeMin;
  if (minutesOfDay(ctx.now) < readyAt) return null;
  const today = onDate(ctx.candles, sessionDate(ctx.now));
  const opening = today.filter((c) => minute(c) >= open && minute(c) < readyAt);
  if (!opening.length) return null;
  const orHigh = Math.max(...opening.map((c) => c.high));
  const orLow = Math.min(...opening.map((c) => c.low));
  const after = today.filter((c) => minute(c) >= readyAt);
  const bar = last(after);
  if (!bar) return null;
  const avgVol = opening.reduce((s, c) => s + (c.volume || 0), 0) / opening.length;
  if (!(bar.volume > avgVol)) return null;
  let direction = null;
  if (bar.close > orHigh) direction = 'LONG';
  else if (bar.close < orLow) direction = 'SHORT';
  if (!direction) return null;
  const levels = bracket(direction, bar.close, ctx.candles, p);
  if (!levels) return null;
  if (direction === 'LONG') levels.stopPrice = Math.min(levels.stopPrice, orLow);
  else levels.stopPrice = Math.max(levels.stopPrice, orHigh);
  return pack(params, ctx.symbol, direction, levels, `Close ${direction === 'LONG' ? 'above' : 'below'} the ${rangeMin}m opening range`, {
    quality: 0.65,
    metadata: { orHigh, orLow, openingRangeComplete: true },
  });
}

module.exports = { meta, evaluate };
