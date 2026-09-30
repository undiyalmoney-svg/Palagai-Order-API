'use strict';

const { round } = require('../utils/math');

/**
 * Transaction costs for NSE equity DELIVERY (CNC) trades, per leg.
 *
 * Rates follow the Zerodha delivery schedule (brokerage free; STT 0.1% both
 * sides; exchange 0.00297%; SEBI Rs10/crore; stamp 0.015% on buy; DP charge
 * Rs13.5 + 18% GST once per scrip on the sell side; GST 18% on
 * brokerage+exchange+SEBI). Rates change - treat as estimates and override
 * `extraBps` / use the broker's contract notes for exact numbers.
 */

const DEFAULT_COSTS = {
  model: 'zerodha_delivery',
  flatBps: 10,
  brokerageBps: 0,
  extraBps: 0,
};

function normalizeCosts(input) {
  const c = { ...DEFAULT_COSTS, ...(input || {}) };
  c.flatBps = Math.max(0, Number(c.flatBps) || 0);
  c.brokerageBps = Math.max(0, Number(c.brokerageBps) || 0);
  c.extraBps = Math.max(0, Number(c.extraBps) || 0);
  if (!['zerodha_delivery', 'flat_bps', 'none'].includes(c.model)) c.model = 'zerodha_delivery';
  return c;
}

function legCost({ side, price, qty, costs }) {
  const c = normalizeCosts(costs);
  const turnover = price * qty;
  if (turnover <= 0 || c.model === 'none') return { total: 0, breakdown: {} };
  if (c.model === 'flat_bps') {
    const total = (turnover * (c.flatBps + c.extraBps)) / 10_000;
    return { total: round(total, 2), breakdown: { flat: round(total, 2) } };
  }
  const brokerage = (turnover * c.brokerageBps) / 10_000;
  const stt = turnover * 0.001;
  const exchange = turnover * 0.0000297;
  const sebi = turnover * 0.000001;
  const stamp = side === 'BUY' ? turnover * 0.00015 : 0;
  const dp = side === 'SELL' ? 13.5 * 1.18 : 0;
  const gst = (brokerage + exchange + sebi) * 0.18;
  const extra = (turnover * c.extraBps) / 10_000;
  const total = brokerage + stt + exchange + sebi + stamp + dp + gst + extra;
  return {
    total: round(total, 2),
    breakdown: {
      brokerage: round(brokerage, 2),
      stt: round(stt, 2),
      exchange: round(exchange, 2),
      sebi: round(sebi, 2),
      stamp: round(stamp, 2),
      dp: round(dp, 2),
      gst: round(gst, 2),
      extra: round(extra, 2),
    },
  };
}

/** Approximate round-trip cost as a fraction of position value (for replacement maths). */
function roundTripCostPct({ price, qty, costs, slippageBps = 0 }) {
  const v = price * qty;
  if (v <= 0) return 0;
  const buy = legCost({ side: 'BUY', price, qty, costs }).total;
  const sell = legCost({ side: 'SELL', price, qty, costs }).total;
  return (buy + sell) / v + (2 * slippageBps) / 10_000;
}

module.exports = { DEFAULT_COSTS, normalizeCosts, legCost, roundTripCostPct };
