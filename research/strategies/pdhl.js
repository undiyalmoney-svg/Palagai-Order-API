'use strict';

const { sessionDate } = require('../time');
const { onDate, previousDay, last, median, bracket, pack } = require('./common');

const meta = {
  strategyId: 'pdhl-retest',
  name: 'Previous-day-level retest',
  version: 1,
};

function evaluate(ctx) {
  const params = { ...meta, ...ctx.strategy };
  const p = { ...ctx.params, ...(ctx.strategy?.parameters || {}) };
  const day = sessionDate(ctx.now);
  const prevDay = previousDay(ctx.candles, day);
  if (!prevDay) return null;
  const prev = onDate(ctx.candles, prevDay);
  const today = onDate(ctx.candles, day);
  if (prev.length < 1 || today.length < 2) return null;
  const pdh = Math.max(...prev.map((c) => c.high));
  const pdl = Math.min(...prev.map((c) => c.low));
  const bar = last(today);
  const earlier = today.slice(0, -1);
  const brokeHigh = earlier.some((c) => c.close > pdh);
  const brokeLow = earlier.some((c) => c.close < pdl);
  const volOk = bar.volume >= median(today.map((c) => c.volume));
  if (!volOk) return null;
  let direction = null;
  if (brokeHigh && bar.low <= pdh && bar.close > pdh) direction = 'LONG';
  else if (brokeLow && bar.high >= pdl && bar.close < pdl) direction = 'SHORT';
  if (!direction) return null;
  const levels = bracket(direction, bar.close, ctx.candles, p);
  if (!levels) return null;
  return pack(params, ctx.symbol, direction, levels, `Retest of previous day ${direction === 'LONG' ? 'high' : 'low'} after a break`, {
    quality: 0.6,
    metadata: { pdh, pdl },
  });
}

module.exports = { meta, evaluate };
