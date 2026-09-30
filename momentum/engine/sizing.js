'use strict';

const { pearson, round, inr, mean } = require('../utils/math');

/**
 * Dynamic portfolio size and position sizing.
 *
 * Portfolio size is the tightest of several *constraints derived from capital,
 * risk limits and live market data*, not a fixed formula:
 *
 *  SIZE            investable capital / minimum position value
 *  RISK            open-risk budget / per-trade risk budget
 *  DIVERSIFICATION largest N whose marginal diversification benefit (using the
 *                  measured average correlation of the current candidates)
 *                  is still worth adding a position
 *  LIQUIDITY       candidates that can absorb a minimum-size position
 *  QUALIFYING      held positions with valid thesis + new qualifying stocks
 *  CONFIG          user-configured maximum
 *
 * The result is then scaled by the market-regime multiplier.
 */

function effectiveN(n, rho) {
  return n / (1 + (n - 1) * rho);
}

function diversificationLimit(rho, minMarginal, cap = 40) {
  let best = 1;
  for (let n = 2; n <= cap; n += 1) {
    if (effectiveN(n, rho) - effectiveN(n - 1, rho) >= minMarginal) best = n;
    else break;
  }
  return best;
}

function averageCorrelation(view, symbols, lookback) {
  const syms = symbols.slice(0, 10);
  if (syms.length < 2) return { rho: 0.35, measured: false };
  const rets = syms.map((s) => view.dailyReturns(s, lookback));
  const vals = [];
  for (let i = 0; i < syms.length; i += 1) {
    for (let j = i + 1; j < syms.length; j += 1) vals.push(pearson(rets[i], rets[j]));
  }
  return { rho: Math.max(0, Math.min(0.95, mean(vals))), measured: true };
}

function maxCorrelationToHeld(view, symbol, held, lookback) {
  if (!held.length) return { value: 0, with: null };
  const r = view.dailyReturns(symbol, lookback);
  let best = { value: -1, with: null };
  for (const h of held) {
    if (h === symbol) continue;
    const c = pearson(r, view.dailyReturns(h, lookback));
    if (c > best.value) best = { value: c, with: h };
  }
  return best.value < -0.99 ? { value: 0, with: null } : best;
}

function recommendPortfolioSize({ equity, heldValid, qualifying, liquidQualifying, rho, rhoMeasured, params, policy }) {
  const reservePct = Math.max(params.minCashPct, policy.minCashPct);
  const investable = equity * (1 - reservePct);
  const risk = params.riskPerTradePct * policy.sizeMult;
  const constraints = [
    {
      id: 'SIZE',
      label: 'Minimum position size',
      value: Math.max(1, Math.floor(investable / params.minPositionValue)),
      detail: `${inr(investable)} investable / ${inr(params.minPositionValue)} minimum position`,
    },
    {
      id: 'RISK',
      label: 'Open-risk budget',
      value: Math.max(1, Math.floor(params.maxOpenRiskPct / risk)),
      detail: `${round(params.maxOpenRiskPct * 100, 1)}% open-risk cap / ${round(risk * 100, 2)}% risk per position`,
    },
    {
      id: 'DIVERSIFICATION',
      label: 'Diversification',
      value: diversificationLimit(rho, params.marginalDiversificationMin),
      detail: `avg pairwise correlation ${round(rho, 2)}${rhoMeasured ? ' (measured on top candidates)' : ' (default, too few candidates to measure)'}; adding more positions stops paying off beyond this`,
    },
    {
      id: 'LIQUIDITY',
      label: 'Liquidity',
      value: Math.max(heldValid, liquidQualifying + heldValid),
      detail: `${liquidQualifying} qualifying stock(s) can absorb a minimum-size position at ${round(params.maxAdvParticipation * 100, 1)}% of average daily value`,
    },
    {
      id: 'QUALIFYING',
      label: 'Qualifying stocks',
      value: Math.max(0, heldValid + qualifying),
      detail: `${heldValid} held with valid thesis + ${qualifying} new candidate(s) passing trend/momentum/score`,
    },
    {
      id: 'CONFIG',
      label: 'Configured maximum',
      value: params.maxPositions,
      detail: `Configured portfolio size cap ${params.maxPositions}`,
    },
  ];
  const tightest = constraints.reduce((a, b) => (b.value < a.value ? b : a));
  const rawMin = tightest.value;
  let n = Math.floor(rawMin * policy.positionsMult);
  if (!policy.allowNewBuys) n = Math.min(n, heldValid);
  if (policy.allowNewBuys && rawMin >= 1 && n < 1) n = 1;
  n = Math.max(0, n);
  for (const c of constraints) c.binding = c.id === tightest.id;

  const regimeNote =
    policy.positionsMult < 1
      ? ` Regime multiplier x${policy.positionsMult} reduces ${rawMin} to ${n}.`
      : '';
  const explanation =
    n === 0
      ? `Recommended portfolio size: 0 stocks - ${tightest.label.toLowerCase()} leaves no room (${tightest.detail}).${regimeNote}`
      : `Recommended portfolio size: ${n} stock${n === 1 ? '' : 's'} - limited by ${tightest.label.toLowerCase()} (${tightest.detail}).${regimeNote} Cash reserve ${Math.round(reservePct * 100)}%.`;
  return { n, rawMin, constraints, explanation, reservePct, investable, rho: round(rho, 3), rhoMeasured };
}

/** Target rupee value for one position given the current portfolio plan. */
function targetPositionValue({ price, riskPerShare, equity, n, investable, advValue, params, policy }) {
  const stopPct = riskPerShare / price;
  const riskBudget = equity * params.riskPerTradePct * policy.sizeMult;
  const riskValue = stopPct > 0 ? riskBudget / stopPct : Infinity;
  const capMax = equity * params.maxPositionPct;
  const capLiq = Number.isFinite(advValue) ? advValue * params.maxAdvParticipation : Infinity;
  const equal = n > 0 ? investable / n : 0;
  let target;
  let basis;
  if (params.sizing === 'EQUAL_WEIGHT') {
    target = Math.min(equal * policy.sizeMult, capMax, capLiq);
    basis = 'equal weight';
  } else {
    target = Math.min(riskValue, capMax, capLiq, equal * 1.3);
    basis = 'risk-based';
  }
  const caps = [
    [riskValue, 'risk budget'],
    [capMax, 'max position size'],
    [capLiq, 'liquidity'],
    [equal * 1.3, 'equal-weight envelope'],
  ];
  if (params.sizing !== 'EQUAL_WEIGHT') {
    const binding = caps.reduce((a, b) => (b[0] < a[0] ? b : a));
    basis = `risk-based, bound by ${binding[1]}`;
  }
  return { value: Math.max(0, target), basis, stopPct, riskValue, capMax, capLiq, equal };
}

module.exports = {
  effectiveN,
  diversificationLimit,
  averageCorrelation,
  maxCorrelationToHeld,
  recommendPortfolioSize,
  targetPositionValue,
};
