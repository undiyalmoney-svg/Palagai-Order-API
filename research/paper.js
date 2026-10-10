'use strict';

const { roundTripCharges } = require('./costs');

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Adverse slippage. Longs pay more; shorts receive less. */
function applySlippage(price, direction, bps, side) {
  const slip = (Number(bps) || 0) / 10_000;
  const adverseUp = (direction === 'LONG' && side === 'entry') || (direction === 'SHORT' && side === 'exit');
  return price * (adverseUp ? 1 + slip : 1 - slip);
}

/**
 * Stop vs target inside one candle.
 * If both could have traded and the path is unknown, the stop is assumed first
 * and the result is flagged ambiguous. A gap through the stop fills at the open,
 * not at the more favourable stop price.
 */
function resolveExit(position, candle) {
  const long = position.direction === 'LONG';
  const stop = position.stopPrice;
  const target = position.targetPrice;
  const stopHit = long ? candle.low <= stop : candle.high >= stop;
  const targetHit = long ? candle.high >= target : candle.low <= target;
  if (!stopHit && !targetHit) return null;
  if (stopHit) {
    const gapped = long ? candle.open < stop : candle.open > stop;
    return {
      reason: 'STOP',
      price: round2(gapped ? candle.open : stop),
      ambiguous: stopHit && targetHit,
      gapped,
    };
  }
  return { reason: 'TARGET', price: round2(target), ambiguous: false, gapped: false };
}

function slippageRupees(reference, fill, quantity) {
  return round2(Math.abs(fill - reference) * quantity);
}

function closeEconomics(position, exitPrice) {
  const qty = position.quantity;
  const entry = position.actualSimulatedEntryPrice;
  const gross = position.direction === 'LONG' ? (exitPrice - entry) * qty : (entry - exitPrice) * qty;
  const fees = roundTripCharges(entry, exitPrice, qty);
  const slip = (Number(position.entrySlippage) || 0) + slippageRupees(
    position.direction === 'LONG' ? Math.max(position.stopPrice, exitPrice) : exitPrice,
    exitPrice,
    0,
  );
  return {
    grossPnl: round2(gross),
    fees: fees.totalRs,
    feeBreakdown: fees,
    slippage: round2(position.entrySlippage || 0),
    netPnl: round2(gross - fees.totalRs),
  };
}

/**
 * Cash ledger.
 * Long entry spends cash. Short entry adds proceeds (cash equity, intraday only).
 * Exit reverses the cash leg and subtracts the full round-trip charge.
 */
function cashDelta(direction, side, price, quantity, fees = 0) {
  const notion = price * quantity;
  if (direction === 'LONG') {
    return side === 'entry' ? -notion : notion - fees;
  }
  return side === 'entry' ? notion : -notion - fees;
}

module.exports = {
  round2,
  applySlippage,
  resolveExit,
  slippageRupees,
  closeEconomics,
  cashDelta,
};
