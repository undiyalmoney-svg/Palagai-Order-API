'use strict';

const { sessionDate, minutesOfDay } = require('../time');
const { atr, round } = require('../indicators');

function completed(candles) {
  return (candles || []).filter((c) => c.complete !== false);
}

function onDate(candles, day) {
  return completed(candles).filter((c) => sessionDate(c.startTime) === day);
}

function previousDay(candles, day) {
  const days = [...new Set(completed(candles).map((c) => sessionDate(c.startTime)))].sort();
  const idx = days.indexOf(day);
  if (idx <= 0) {
    const earlier = days.filter((d) => d < day);
    return earlier.length ? earlier[earlier.length - 1] : null;
  }
  return days[idx - 1];
}

function last(arr) {
  return arr.length ? arr[arr.length - 1] : null;
}

function median(values) {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function bracket(direction, price, candles, params) {
  const series = atr(completed(candles), params.atrPeriod || 14);
  const a = series[series.length - 1];
  if (!(a > 0) || !(price > 0)) return null;
  const dist = Math.max(a * (params.atrMult || 1.5), price * 0.002);
  const rr = params.rewardRisk || 2;
  if (direction === 'LONG') {
    return {
      referencePrice: round(price, 2),
      stopPrice: round(price - dist, 2),
      targetPrice: round(price + dist * rr, 2),
    };
  }
  return {
    referencePrice: round(price, 2),
    stopPrice: round(price + dist, 2),
    targetPrice: round(price - dist * rr, 2),
  };
}

function pack(strategy, symbol, direction, levels, reason, extra = {}) {
  return {
    strategyId: strategy.strategyId,
    strategyVersion: strategy.version,
    symbol,
    direction,
    ...levels,
    reason,
    quality: extra.quality ?? 0.5,
    metadata: extra.metadata || {},
  };
}

function minute(candle) {
  return minutesOfDay(candle.startTime);
}

module.exports = { completed, onDate, previousDay, last, median, bracket, pack, minute };
