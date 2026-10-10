'use strict';

const { ema, adx } = require('../indicators');
const { completed, last, bracket, pack } = require('./common');

const meta = {
  strategyId: 'ema-trend',
  name: 'EMA trend following',
  version: 1,
};

function evaluate(ctx) {
  const params = { ...meta, ...ctx.strategy };
  const p = { ...ctx.params, ...(ctx.strategy?.parameters || {}) };
  const bars = completed(ctx.candles);
  const slowN = p.emaSlow || 21;
  if (bars.length < Math.max(slowN, (p.adxPeriod || 14) * 2)) return null;
  const closes = bars.map((c) => c.close);
  const fast = ema(closes, p.emaFast || 9);
  const slow = ema(closes, slowN);
  const trend = adx(bars, p.adxPeriod || 14);
  const i = bars.length - 1;
  const bar = last(bars);
  if (fast[i] == null || slow[i] == null || trend.adx[i] == null) return null;
  if (trend.adx[i] < (p.adxMin || p.adxTrend || 22)) return null;
  let direction = null;
  if (fast[i] > slow[i] && bar.close > fast[i]) direction = 'LONG';
  else if (fast[i] < slow[i] && bar.close < fast[i]) direction = 'SHORT';
  if (!direction) return null;
  const levels = bracket(direction, bar.close, bars, p);
  if (!levels) return null;
  return pack(params, ctx.symbol, direction, levels, `EMA alignment with ADX ${trend.adx[i].toFixed(1)}`, {
    quality: 0.6,
    metadata: { emaFast: fast[i], emaSlow: slow[i], adx: trend.adx[i] },
  });
}

module.exports = { meta, evaluate };
