'use strict';

const { inr, round } = require('../utils/math');

/**
 * Capital allocation.
 *
 * One routine handles both first-time deployment and "capital increased":
 * it never blindly adds to existing positions. Every rupee goes to the
 * highest-value use in this order:
 *
 *   1. NEW qualifying stocks while portfolio slots are open (diversification)
 *   2. TOP-UP of existing positions that are below target weight, still have a
 *      valid thesis and a currently actionable entry
 *   3. otherwise stay in CASH (the reserve)
 *
 * The outcome is labelled Option A (increase existing), B (buy new) or
 * C (combination), or CASH when nothing qualifies.
 */

function allocateCapital({ deployable, equity, newCandidates, topUps, slotsOpen, params, additionalCapital = null }) {
  let remaining = Math.max(0, deployable);
  const newBuys = [];
  const adds = [];
  const notes = [];
  let slots = slotsOpen;

  for (const c of newCandidates) {
    if (slots <= 0) {
      notes.push(`${c.symbol} qualifies but all ${slotsOpen} open slot(s) are used`);
      continue;
    }
    const amount = Math.min(c.targetValue, remaining);
    if (amount < Math.max(params.minPositionValue, c.price)) {
      notes.push(`${c.symbol}: ${inr(amount)} available is below the minimum position ${inr(params.minPositionValue)}`);
      continue;
    }
    newBuys.push({ ...c, allocation: amount });
    remaining -= amount;
    slots -= 1;
  }

  for (const e of topUps) {
    if (remaining < Math.max(params.minTicketValue, e.price)) break;
    const room = e.targetValue - e.currentValue;
    if (room < equity * params.addMinRoomPct) continue;
    const amount = Math.min(room, remaining);
    if (amount < Math.max(params.minTicketValue, e.price)) continue;
    adds.push({ ...e, allocation: amount, room });
    remaining -= amount;
  }

  let option = 'CASH';
  if (adds.length && newBuys.length) option = 'C';
  else if (adds.length) option = 'A';
  else if (newBuys.length) option = 'B';

  const parts = [];
  if (additionalCapital != null) parts.push(`Additional capital: ${inr(additionalCapital)}.`);
  const heldUnder = topUps.filter((e) => e.targetValue - e.currentValue >= equity * params.addMinRoomPct);
  if (option === 'CASH') {
    if (!topUps.length && !newCandidates.length) parts.push('No new stock qualifies and existing positions are not eligible for top-ups.');
    else parts.push('Nothing currently meets the entry, sizing and risk rules.');
  } else {
    if (adds.length) {
      parts.push(`Top-up ${adds.length} existing position${adds.length > 1 ? 's' : ''} that are below target weight: ${adds.map((a) => `${inr(a.allocation)} to ${a.symbol}`).join(', ')}.`);
    } else if (additionalCapital != null) {
      parts.push(heldUnder.length ? 'Existing positions with room are not eligible for top-ups (thesis/entry conditions).' : 'Existing positions remain within target allocation.');
    }
    if (newBuys.length) {
      parts.push(`${newBuys.length} new stock${newBuys.length > 1 ? 's' : ''} qualify${newBuys.length > 1 ? '' : 'es'}: allocate ${newBuys.map((b) => `${inr(b.allocation)} to ${b.symbol}`).join(', ')}.`);
    }
  }
  parts.push(`Keep ${inr(remaining)} as cash reserve.`);
  return {
    option,
    newBuys,
    adds,
    cashLeft: remaining,
    notes,
    explanation: parts.join(' '),
    optionLabel: {
      A: 'Option A - increase existing positions',
      B: 'Option B - buy additional qualifying stocks',
      C: 'Option C - combination (top-up + new stocks)',
      CASH: 'Keep capital in cash',
    }[option],
  };
}

/** Cover a withdrawal: use spare cash first, then trim the weakest positions. */
function planWithdrawal({ amount, cash, equity, positions, scoreOf, priceOf, params }) {
  const cashReserve = Math.max(0, equity - amount) * params.minCashPct;
  const spare = Math.max(0, cash - cashReserve);
  if (spare >= amount) {
    return {
      sells: [],
      fromCash: amount,
      fromPortfolio: 0,
      explanation: `Withdrawal of ${inr(amount)} is covered by spare cash (${inr(spare)} available above the reserve). No positions need to be sold.`,
    };
  }
  let shortfall = (amount - spare) * 1.004;
  const ranked = [...positions].sort((a, b) => (scoreOf(a.symbol) ?? 0) - (scoreOf(b.symbol) ?? 0));
  const sells = [];
  for (const p of ranked) {
    if (shortfall <= 0) break;
    const px = priceOf(p.symbol) ?? p.avgPrice;
    const value = px * p.qty;
    const take = Math.min(value, shortfall);
    let qty = Math.ceil(take / px);
    if ((p.qty - qty) * px < params.minTicketValue) qty = p.qty;
    qty = Math.min(qty, p.qty);
    sells.push({ symbol: p.symbol, qty, value: qty * px, full: qty >= p.qty, score: scoreOf(p.symbol) });
    shortfall -= qty * px;
  }
  const fromPortfolio = sells.reduce((a, s) => a + s.value, 0);
  return {
    sells,
    fromCash: spare,
    fromPortfolio,
    explanation: `Withdrawal of ${inr(amount)}: ${inr(spare)} from spare cash, ${inr(fromPortfolio)} from trimming the lowest-ranked positions (${sells
      .map((s) => `${s.symbol} ${s.full ? 'exit' : 'reduce'}`)
      .join(', ') || 'none available'}).`,
  };
}

module.exports = { allocateCapital, planWithdrawal, round };
