'use strict';

const { daysBetween } = require('../utils/dates');
const { round } = require('../utils/math');

/**
 * Pure portfolio ledger maths shared by the backtester, the paper broker and
 * the database-backed portfolio service. No I/O: given a position and a fill,
 * it returns the new position and the realised result. Cash moves only through
 * fills, so a position can never exist without an executed fill behind it.
 */

function newPosition({ symbol, qty, price, cost, date, initialStop, stopPrice, signalId = null }) {
  return {
    symbol,
    qty,
    avgPrice: price,
    entryDate: date,
    initialStop: initialStop ?? null,
    stopPrice: stopPrice ?? initialStop ?? null,
    peakClose: price,
    partials: {},
    buyCosts: cost,
    investedTotal: qty * price,
    realizedPnl: 0,
    entrySignalId: signalId,
  };
}

/** Add shares to a position (or open it). Returns a new position object. */
function applyBuy(pos, fill) {
  if (!pos) return newPosition(fill);
  const qty = pos.qty + fill.qty;
  const avgPrice = (pos.avgPrice * pos.qty + fill.price * fill.qty) / qty;
  return {
    ...pos,
    qty,
    avgPrice,
    buyCosts: pos.buyCosts + fill.cost,
    investedTotal: pos.investedTotal + fill.qty * fill.price,
    peakClose: Math.max(pos.peakClose || 0, fill.price),
    stopPrice: fill.stopPrice != null && pos.stopPrice != null ? Math.max(pos.stopPrice, fill.stopPrice) : pos.stopPrice ?? fill.stopPrice ?? null,
  };
}

/**
 * Sell shares. Realised P&L = proceeds - cost of the shares sold - sell cost -
 * the pro-rata share of buy-side costs.
 */
function applySell(pos, fill) {
  if (!pos) throw new Error(`No position in ${fill.symbol} to sell`);
  const qty = Math.min(fill.qty, pos.qty);
  const buyCostShare = pos.buyCosts * (qty / pos.qty);
  const gross = (fill.price - pos.avgPrice) * qty;
  const pnl = gross - fill.cost - buyCostShare;
  const basis = pos.avgPrice * qty + buyCostShare;
  const remainingQty = pos.qty - qty;
  const holdingDays = daysBetween(pos.entryDate, fill.date);
  const closed = remainingQty <= 0;
  const next = closed
    ? null
    : {
        ...pos,
        qty: remainingQty,
        buyCosts: pos.buyCosts - buyCostShare,
        investedTotal: pos.investedTotal * (remainingQty / pos.qty),
        realizedPnl: pos.realizedPnl + pnl,
        partials: { ...pos.partials, reduced: true },
      };
  return {
    position: next,
    qty,
    pnl: round(pnl, 2),
    pnlPct: basis > 0 ? round(pnl / basis, 4) : 0,
    holdingDays,
    closed,
    lifecyclePnl: round(pos.realizedPnl + pnl, 2),
    lifecycleInvested: pos.investedTotal,
  };
}

function cashDelta(side, price, qty, cost) {
  return side === 'BUY' ? -(price * qty + cost) : price * qty - cost;
}

function markToMarket(cash, positions, priceOf) {
  let invested = 0;
  for (const p of positions) invested += (priceOf(p.symbol) ?? p.avgPrice) * p.qty;
  return { equity: cash + invested, invested };
}

module.exports = { newPosition, applyBuy, applySell, cashDelta, markToMarket };
