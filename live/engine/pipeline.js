'use strict';
/**
 * S/R Live execution pipeline — order of operations, nothing else:
 *   1. confirmDirection  (CE vs PE from the index signal)
 *   2. selectTradeExpiry (never the contract that expires today)
 *   3. Kite BUY + resting SL          (LiveBroker.placeEntry)
 *   4. on leave: cancel SL, then exit (LiveBroker.placeExit)
 */

function confirmDirection(trade) {
  const side = trade && String(trade.side || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  const optionType = side === 'SELL' ? 'PE' : 'CE';
  return {
    side,
    optionType,
    transaction: 'BUY',
  };
}

/** First expiry strictly after `today`. Same-day (expiry day) is skipped. */
function selectTradeExpiry(expiries, today) {
  const day = String(today || '').slice(0, 10);
  if (!day) return null;
  const sorted = [...new Set((expiries || []).map((e) => String(e || '').slice(0, 10)).filter(Boolean))].sort();
  return sorted.find((e) => e > day) || null;
}

function liveTransactionType(spec, trade) {
  if (spec && spec.vehicle === 'fut') {
    return trade && String(trade.side || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  }
  return confirmDirection(trade).transaction;
}

module.exports = { confirmDirection, selectTradeExpiry, liveTransactionType };
