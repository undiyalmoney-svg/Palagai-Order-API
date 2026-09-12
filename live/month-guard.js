'use strict';
/**
 * Red days are allowed. A red calendar month is not.
 *
 * After the month is green, today's 1R budget cannot exceed month-to-date
 * profit — a full stop-out leaves the month flat, not red.
 * If the month is already red, only a small recovery trade is allowed.
 * If the month has been green and is back to ₹0, lock — no new risk.
 *
 * A red first day can still happen (red day). Recovery tries to flatten
 * before month-end. If 1-lot risk is larger than the recovery cap, the
 * month can stay red — that is the leftover hole, not a profit promise.
 */

function monthStartIso(iso) {
  const s = String(iso || '').slice(0, 10);
  if (s.length < 10) return s;
  return `${s.slice(0, 8)}01`;
}

function monthKey(iso) {
  return String(iso || '').slice(0, 7);
}

function roundMtd(n) {
  const x = Math.round(Number(n) || 0);
  return Math.abs(x) < 1 ? 0 : x;
}

function nextDayCap({
  mtdRs = 0,
  hadTrade = false,
  dayBudgetRs = 0,
  riskPerTradeRs = 0,
  targetR = 1.5,
} = {}) {
  const mtd = roundMtd(mtdRs);
  const dayBudget = Math.max(0, Number(dayBudgetRs) || 0);
  const perTrade = Math.max(0, Number(riskPerTradeRs) || 0);
  if (hadTrade && mtd === 0) {
    return { capRs: 0, mode: 'month-locked', maxTrades: 0 };
  }
  if (mtd > 0) {
    return { capRs: Math.min(dayBudget, mtd), mode: 'protect-green', maxTrades: 6 };
  }
  if (mtd < 0) {
    const recover = Math.abs(mtd) / Math.max(1, Number(targetR) || 1.5);
    return {
      capRs: Math.max(0, Math.min(perTrade, recover)),
      mode: 'recover-red',
      maxTrades: 1,
    };
  }
  return { capRs: dayBudget, mode: 'month-open', maxTrades: 6 };
}

module.exports = {
  monthStartIso,
  monthKey,
  roundMtd,
  nextDayCap,
};
