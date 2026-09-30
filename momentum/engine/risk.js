'use strict';

const { round, inr } = require('../utils/math');
const { legCost } = require('../execution/costs');

/**
 * Risk manager. Used twice: by the decision engine while planning (so it never
 * proposes a trade the limits forbid) and by the execution engine right before
 * an order is submitted (the state may have changed since the signal).
 */

function portfolioStats(positions, priceOf, sectorOf, equity) {
  const sectorValue = new Map();
  let invested = 0;
  let openRisk = 0;
  for (const p of positions) {
    const px = priceOf(p.symbol) ?? p.avgPrice;
    const value = px * p.qty;
    invested += value;
    const sec = sectorOf(p.symbol);
    sectorValue.set(sec, (sectorValue.get(sec) || 0) + value);
    const stop = Number.isFinite(p.stopPrice) ? p.stopPrice : p.initialStop;
    if (Number.isFinite(stop)) openRisk += Math.max(0, px - stop) * p.qty;
  }
  return {
    invested,
    sectorValue,
    openRisk,
    openRiskPct: equity > 0 ? openRisk / equity : 0,
    positionsCount: positions.length,
  };
}

/**
 * Clip a proposed BUY so it respects every limit. Returns the adjusted quantity
 * and the human-readable reasons for any clipping or rejection.
 */
function checkBuy({ symbol, sector, price, qty, riskPerShare, equity, cash, positions, priceOf, sectorOf, params, policy, costs, slippageBps = 0, advValue, pendingBuyValue = 0 }) {
  const reasons = [];
  let q = Math.max(0, Math.floor(qty));
  const stats = portfolioStats(positions, priceOf, sectorOf, equity);
  const held = positions.find((p) => p.symbol === symbol);
  const effPrice = price * (1 + slippageBps / 10_000);

  const cashReserve = equity * Math.max(params.minCashPct, policy.minCashPct);
  const spendable = Math.max(0, cash - pendingBuyValue - cashReserve);
  const unitCost = (n) => effPrice * n + legCost({ side: 'BUY', price: effPrice, qty: n, costs }).total;
  if (q > 0 && unitCost(q) > spendable) {
    let lo = 0;
    let hi = q;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (unitCost(mid) <= spendable) lo = mid;
      else hi = mid - 1;
    }
    if (lo < q) reasons.push(`Clipped ${q} -> ${lo} shares: only ${inr(spendable)} spendable after ${Math.round((cashReserve / equity) * 100)}% cash reserve and costs`);
    q = lo;
  }

  const posCap = equity * params.maxPositionPct;
  const existingValue = held ? held.qty * price : 0;
  if (q > 0 && existingValue + q * price > posCap * 1.0001) {
    const room = Math.max(0, Math.floor((posCap - existingValue) / price));
    if (room < q) reasons.push(`Clipped ${q} -> ${room} shares: max position size ${Math.round(params.maxPositionPct * 100)}% of portfolio (${inr(posCap)})`);
    q = Math.min(q, room);
  }

  const secCap = equity * params.maxSectorPct;
  const secVal = stats.sectorValue.get(sector) || 0;
  if (q > 0 && secVal + q * price > secCap * 1.0001) {
    const room = Math.max(0, Math.floor((secCap - secVal) / price));
    if (room < q) reasons.push(`Clipped ${q} -> ${room} shares: sector cap ${Math.round(params.maxSectorPct * 100)}% for ${sector}`);
    q = Math.min(q, room);
  }

  if (q > 0 && Number.isFinite(riskPerShare) && riskPerShare > 0) {
    const riskCap = equity * params.maxOpenRiskPct;
    const newRisk = riskPerShare * q;
    if (stats.openRisk + newRisk > riskCap * 1.0001) {
      const room = Math.max(0, Math.floor((riskCap - stats.openRisk) / riskPerShare));
      if (room < q) reasons.push(`Clipped ${q} -> ${room} shares: portfolio open-risk cap ${round(params.maxOpenRiskPct * 100, 1)}% of equity`);
      q = Math.min(q, room);
    }
  }

  if (q > 0 && Number.isFinite(advValue)) {
    const liqCap = Math.floor((advValue * params.maxAdvParticipation) / price);
    if (liqCap < q + (held ? held.qty : 0)) {
      const room = Math.max(0, liqCap - (held ? held.qty : 0));
      reasons.push(`Clipped ${q} -> ${Math.min(q, room)} shares: liquidity cap (${round(params.maxAdvParticipation * 100, 1)}% of average daily traded value)`);
      q = Math.min(q, room);
    }
  }

  if (!held && positions.length >= params.maxPositions) {
    reasons.push(`Rejected: already holding the configured maximum of ${params.maxPositions} positions`);
    q = 0;
  }
  if (q > 0 && q * price < params.minTicketValue && !held) {
    reasons.push(`Rejected: order value ${inr(q * price)} below minimum ticket ${inr(params.minTicketValue)}`);
    q = 0;
  }
  return { ok: q > 0, qty: q, reasons };
}

module.exports = { portfolioStats, checkBuy };
