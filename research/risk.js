'use strict';

const { minutesOfDay } = require('./time');

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Quantity is the lower of risk, notional, and cash constraints.
 * Risk rupees = equity * riskPerTrade. Stop distance is the price risk per share.
 */
function sizePosition({ equity, cash, entry, stop, direction, riskPerTrade, maxNotionalPct }) {
  const dist = Math.abs(entry - stop);
  if (!(entry > 0) || !(dist > 0) || !(equity > 0)) {
    return { qty: 0, reason: 'Stop distance or price is not usable' };
  }
  if (direction === 'LONG' && stop >= entry) return { qty: 0, reason: 'Long stop must be below entry' };
  if (direction === 'SHORT' && stop <= entry) return { qty: 0, reason: 'Short stop must be above entry' };
  const qtyRisk = Math.floor((equity * riskPerTrade) / dist);
  const qtyNotional = Math.floor((equity * maxNotionalPct) / entry);
  const qtyCash = Math.floor(cash / entry);
  const qty = Math.min(qtyRisk, qtyNotional, qtyCash);
  if (qty < 1) {
    return {
      qty: 0,
      reason: qtyCash < 1 ? 'Insufficient capital' : 'Risk or notional limit allows no share',
      qtyRisk,
      qtyNotional,
      qtyCash,
    };
  }
  return {
    qty,
    qtyRisk,
    qtyNotional,
    qtyCash,
    rupeeRisk: round2(qty * dist),
    notional: round2(qty * entry),
  };
}

function rewardRisk(direction, entry, stop, target) {
  const risk = Math.abs(entry - stop);
  const reward = direction === 'LONG' ? target - entry : entry - target;
  if (!(risk > 0) || !(reward > 0)) return 0;
  return reward / risk;
}

function assessEntry({ account, signal, positions, tradesToday, config, now, quoteFresh, feedOk, tickSize = 0.05 }) {
  if (!feedOk) return { ok: false, reason: 'Market feed is down' };
  if (!quoteFresh) return { ok: false, reason: 'Quote is stale' };
  const minute = minutesOfDay(now);
  if (minute < config.sessionOpenMin || minute >= config.entryCutoffMin) {
    return { ok: false, reason: 'Outside the entry window' };
  }
  const sod = account.startOfDayEquity || account.initialCapital;
  const dailyPnl = account.currentEquity - sod;
  if (dailyPnl <= -config.maxDailyLoss * sod) {
    return { ok: false, reason: 'Daily loss limit reached' };
  }
  const open = positions.filter((p) => p.status === 'OPEN' && p.accountId === account.accountId);
  if (open.length >= config.maxOpenPositions) return { ok: false, reason: 'Maximum open positions' };
  if (tradesToday >= config.maxTradesPerDay) return { ok: false, reason: 'Maximum new trades for the day' };
  if (open.some((p) => p.symbol === signal.symbol)) return { ok: false, reason: 'Already in this symbol' };
  const sectorCount = open.filter((p) => p.sector && p.sector === signal.sector).length;
  if (signal.sector && sectorCount >= config.maxPositionsPerSector) {
    return { ok: false, reason: 'Sector exposure limit' };
  }
  const rr = rewardRisk(signal.direction, signal.referencePrice, signal.stopPrice, signal.targetPrice);
  if (rr + 1e-9 < config.minRewardRisk) return { ok: false, reason: `Reward/risk ${rr.toFixed(2)} is below ${config.minRewardRisk}` };

  const sized = sizePosition({
    equity: account.currentEquity,
    cash: account.cashBalance,
    entry: signal.referencePrice,
    stop: signal.stopPrice,
    direction: signal.direction,
    riskPerTrade: config.riskPerTrade,
    maxNotionalPct: config.maxNotionalPct,
  });
  if (sized.qty < 1) return { ok: false, reason: sized.reason, sizing: sized };

  const openRisk = open.reduce((sum, p) => sum + Math.abs(p.actualSimulatedEntryPrice - p.stopPrice) * p.quantity, 0);
  if (openRisk + sized.rupeeRisk > config.maxAggregateRiskPct * account.currentEquity) {
    return { ok: false, reason: 'Aggregate open risk limit' };
  }
  const snapped = Math.round(sized.qty);
  if (tickSize <= 0) return { ok: false, reason: 'Tick size missing' };
  return { ok: true, quantity: snapped, sizing: sized, rewardRisk: round2(rr) };
}

module.exports = { sizePosition, rewardRisk, assessEntry, round2 };
