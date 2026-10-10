'use strict';

const { rsi, adx, vwap } = require('../indicators');
const { onDate, last, bracket, pack } = require('./common');
const { sessionDate } = require('../time');

const meta = {
  strategyId: 'rsi-reversion',
  name: 'RSI mean reversion',
  version: 1,
};

function evaluate(ctx) {
  const params = { ...meta, ...ctx.strategy };
  const p = { ...ctx.params, ...(ctx.strategy?.parameters || {}) };
  const today = onDate(ctx.candles, sessionDate(ctx.now));
  const period = p.rsiPeriod || 14;
  if (today.length <= period) return null;
  const closes = today.map((c) => c.close);
  const series = rsi(closes, period);
  const trend = adx(today, p.adxPeriod || 14);
  const bar = last(today);
  const r = series[series.length - 1];
  const a = trend.adx[trend.adx.length - 1];
  const level = vwap(today);
  if (r == null || a == null || level == null) return null;
  if (a >= (p.adxMax || p.adxRange || 20)) return null;
  const prev = today[today.length - 2];
  let direction = null;
  if (r <= (p.rsiOversold || 30) && bar.close < level && bar.close > bar.open && prev.close <= prev.open) direction = 'LONG';
  else if (r >= (p.rsiOverbought || 70) && bar.close > level && bar.close < bar.open && prev.close >= prev.open) direction = 'SHORT';
  if (!direction) return null;
  const levels = bracket(direction, bar.close, ctx.candles, p);
  if (!levels) return null;
  return pack(params, ctx.symbol, direction, levels, `RSI ${r.toFixed(1)} reversal while ADX shows a range`, {
    quality: 0.55,
    metadata: { rsi: r, adx: a, vwap: level },
  });
}

module.exports = { meta, evaluate };
