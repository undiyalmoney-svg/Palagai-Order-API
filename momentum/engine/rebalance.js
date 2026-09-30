'use strict';

const { isoWeekKey, monthKey, daysBetween } = require('../utils/dates');
const { inr, round } = require('../utils/math');
const { roundTripCostPct } = require('../execution/costs');

/**
 * Portfolio restructuring: when to review, what triggers a restructure, and
 * whether a candidate is *sufficiently* better than a holding (after costs).
 */

function periodKey(horizon, date) {
  if (!date) return null;
  if (horizon === 'DAILY') return date;
  if (horizon === 'WEEKLY') return isoWeekKey(date);
  return monthKey(date);
}

/** A review is due when the current period differs from the period of the last review. */
function isReviewDue({ horizon, asOf, lastReviewDate }) {
  if (!lastReviewDate) return true;
  return periodKey(horizon, asOf) !== periodKey(horizon, lastReviewDate);
}

function nextReviewLabel(horizon) {
  if (horizon === 'DAILY') return 'tomorrow\'s daily review';
  if (horizon === 'WEEKLY') return 'the next weekly review (first trading day of next week)';
  return 'the next monthly review (first trading day of next month)';
}

function detectTriggers({ horizon, asOf, lastReviewDate, regime, prevRegime, capitalEvent, exitsByTrigger, concentrated, riskBreach, drawdownHalt, forceReview }) {
  const triggers = [];
  const review = forceReview || isReviewDue({ horizon, asOf, lastReviewDate });
  if (review) {
    triggers.push({
      type: horizon === 'MONTHLY' ? 'SCHEDULED_MONTHLY' : horizon === 'WEEKLY' ? 'SCHEDULED_WEEKLY' : 'SCHEDULED_DAILY',
      detail: forceReview ? 'Review forced by scheduler/user' : `${horizon.toLowerCase()} review due (last review ${lastReviewDate || 'never'})`,
    });
  }
  if (prevRegime && prevRegime !== regime.regime) {
    triggers.push({ type: 'REGIME_CHANGE', detail: `Market regime changed ${prevRegime} -> ${regime.regime}` });
  }
  if (capitalEvent && capitalEvent.amount > 0) {
    triggers.push({ type: 'CAPITAL_INCREASE', detail: `Capital increased by ${inr(capitalEvent.amount)}` });
  }
  if (capitalEvent && capitalEvent.amount < 0) {
    triggers.push({ type: 'CAPITAL_DECREASE', detail: `Capital decreased by ${inr(-capitalEvent.amount)}` });
  }
  if (exitsByTrigger && exitsByTrigger.BELOW_THRESHOLD > 0) {
    triggers.push({ type: 'BELOW_THRESHOLD', detail: `${exitsByTrigger.BELOW_THRESHOLD} holding(s) fell below the selection threshold` });
  }
  if (concentrated && concentrated.length) {
    triggers.push({ type: 'CONCENTRATION', detail: `Position concentration too high: ${concentrated.map((c) => c.symbol).join(', ')}` });
  }
  if (riskBreach) triggers.push({ type: 'RISK_LIMIT_BREACH', detail: riskBreach });
  if (drawdownHalt) triggers.push({ type: 'DRAWDOWN_HALT', detail: drawdownHalt });
  return { triggers, review };
}

function findConcentrated({ positions, priceOf, equity, params }) {
  const out = [];
  const cap = equity * params.maxPositionPct;
  for (const p of positions) {
    const px = priceOf(p.symbol) ?? p.avgPrice;
    const value = px * p.qty;
    if (value > cap * (1 + params.concentrationTolerance)) {
      const trimQty = Math.min(p.qty, Math.ceil((value - cap) / px));
      out.push({ symbol: p.symbol, value, weight: value / equity, capValue: cap, trimQty, price: px });
    }
  }
  return out;
}

/** Trim the largest risk contributors until open risk is back under the cap. */
function findRiskBreach({ positions, priceOf, equity, params, scoreOf }) {
  const rows = positions.map((p) => {
    const px = priceOf(p.symbol) ?? p.avgPrice;
    const stop = Number.isFinite(p.stopPrice) ? p.stopPrice : p.initialStop;
    const riskPerShare = Number.isFinite(stop) ? Math.max(0, px - stop) : 0;
    return { symbol: p.symbol, qty: p.qty, price: px, riskPerShare, risk: riskPerShare * p.qty };
  });
  const cap = equity * params.maxOpenRiskPct;
  let total = rows.reduce((a, r) => a + r.risk, 0);
  if (total <= cap * 1.0001) return { breach: false, total, cap, trims: [] };
  const trims = [];
  const sorted = [...rows].sort((a, b) => b.risk * (1.2 - (scoreOf(b.symbol) ?? 50) / 100) - a.risk * (1.2 - (scoreOf(a.symbol) ?? 50) / 100));
  for (const r of sorted) {
    if (total <= cap) break;
    if (!(r.riskPerShare > 0)) continue;
    const excess = total - cap;
    const qty = Math.min(r.qty, Math.ceil(excess / r.riskPerShare));
    trims.push({ symbol: r.symbol, qty, price: r.price });
    total -= qty * r.riskPerShare;
  }
  return { breach: true, total: rows.reduce((a, r) => a + r.risk, 0), cap, trims };
}

function drawdownState({ equity, peakEquity, params }) {
  const dd = peakEquity > 0 ? 1 - equity / peakEquity : 0;
  return { drawdown: Math.max(0, dd), halted: dd >= params.maxDrawdownHaltPct };
}

/**
 * Pair weak holdings with strong candidates. A swap is only proposed when:
 *  - candidate score beats the holding by >= replaceMinScoreGain points,
 *  - the candidate's entry is actionable today,
 *  - expected edge (score gain x edgePerScorePointPct) exceeds round-trip costs
 *    by `replaceCostMultiple`.
 * `edgePerScorePointPct` is a configurable heuristic: the assumed extra return
 * (in %) per point of score difference over a review cycle.
 */
function evaluateReplacements({ holdings, candidates, params, costs, slippageBps, maxSwaps = 2 }) {
  const swaps = [];
  const rejected = [];
  const usedCandidates = new Set();
  const weakest = [...holdings].sort((a, b) => a.score - b.score);
  const best = [...candidates].sort((a, b) => b.score - a.score);
  for (const h of weakest) {
    if (swaps.length >= maxSwaps) break;
    const cand = best.find((c) => !usedCandidates.has(c.symbol));
    if (!cand) break;
    const gain = cand.score - h.score;
    if (gain < params.replaceMinScoreGain) {
      rejected.push(`Keep ${h.symbol} (score ${h.score}) over ${cand.symbol} (score ${cand.score}): improvement ${round(gain, 1)} < required ${params.replaceMinScoreGain}`);
      continue;
    }
    const edgePct = (gain * params.edgePerScorePointPct) / 100;
    const costPct = roundTripCostPct({ price: h.price, qty: h.qty, costs, slippageBps });
    if (edgePct < costPct * params.replaceCostMultiple) {
      rejected.push(`Keep ${h.symbol}: expected edge ${round(edgePct * 100, 2)}% does not cover ${params.replaceCostMultiple}x the round-trip cost ${round(costPct * 100, 2)}%`);
      continue;
    }
    usedCandidates.add(cand.symbol);
    swaps.push({
      sell: h.symbol,
      buy: cand.symbol,
      gain: round(gain, 1),
      expectedEdgePct: round(edgePct, 4),
      costPct: round(costPct, 4),
      reason: `${cand.symbol} (score ${cand.score}, ${cand.status}) is ${round(gain, 1)} points stronger than ${h.symbol} (score ${h.score}); expected edge ${round(edgePct * 100, 2)}% vs ${round(costPct * 100, 2)}% round-trip cost`,
    });
  }
  return { swaps, rejected };
}

module.exports = {
  periodKey,
  isReviewDue,
  nextReviewLabel,
  detectTriggers,
  findConcentrated,
  findRiskBreach,
  drawdownState,
  evaluateReplacements,
  daysBetween,
};
