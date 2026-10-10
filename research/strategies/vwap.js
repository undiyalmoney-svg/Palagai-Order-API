'use strict';

const { ema, vwap } = require('../indicators');
const { onDate, last, median, bracket, pack } = require('./common');
const { sessionDate } = require('../time');

const meta = {
  strategyId: 'vwap-trend',
  name: 'VWAP trend following',
  version: 1,
};

function evaluate(ctx) {
  const params = { ...meta, ...ctx.strategy, parameters: { ...(ctx.strategy?.parameters || {}), ...ctx.params } };
  const p = { ...ctx.params, ...(ctx.strategy?.parameters || {}) };
  const day = sessionDate(ctx.now);
  const today = onDate(ctx.candles, day);
  const bar = last(today);
  if (!bar || today.length < (p.emaSlow || 21)) return null;
  const level = vwap(today);
  if (level == null) return null;
  const closes = today.map((c) => c.close);
  const fast = ema(closes, p.emaFast || 9);
  const slow = ema(closes, p.emaSlow || 21);
  const f = fast[fast.length - 1];
  const s = slow[slow.length - 1];
  if (f == null || s == null) return null;
  const volOk = bar.volume >= median(today.map((c) => c.volume));
  if (!volOk) return null;
  let direction = null;
  if (bar.close > level && f > s) direction = 'LONG';
  else if (bar.close < level && f < s) direction = 'SHORT';
  if (!direction) return null;
  const levels = bracket(direction, bar.close, ctx.candles, p);
  if (!levels) return null;
  return pack(params, ctx.symbol, direction, levels, `${direction === 'LONG' ? 'Above' : 'Below'} VWAP with EMA alignment`, {
    quality: 0.7,
    metadata: { vwap: level, emaFast: f, emaSlow: s },
  });
}

module.exports = { meta, evaluate };
