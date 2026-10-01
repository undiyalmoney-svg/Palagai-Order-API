'use strict';

const { clamp, round, roundPrice, inr } = require('../utils/math');
const { pctText } = require('./scoring');

/**
 * Entry-timing engine.
 *
 * Decides whether a ranked candidate is actionable *today* using a rules-based
 * definition of a good entry: confirmed setup (breakout on volume, pullback
 * reversal, or strong continuation), intact trend/momentum/regime, acceptable
 * extension and reward/risk. It does not claim to know the best future price;
 * when it says WAIT/WATCH it states the exact condition that would upgrade it.
 *
 * Status: WAIT < WATCH < BUY < STRONG_BUY
 */

const STATUS_ORDER = { WAIT: 0, WATCH: 1, BUY: 2, STRONG_BUY: 3 };

function statusAtLeast(status, min) {
  return STATUS_ORDER[status] >= STATUS_ORDER[min];
}

/** Stop, target and reward/risk for a prospective entry at `f.price`. */
function planRisk(f, params) {
  const entry = f.price;
  const atr = f.vol.atr;
  let stop = entry - params.stopAtrMult * atr;
  let stopType = `${params.stopAtrMult}x ATR`;
  const structural = f.tech.swingLow10 - 0.25 * atr;
  if (structural > stop && entry - structural >= 1.2 * atr) {
    stop = structural;
    stopType = '10-day swing low';
  }
  const minDist = entry * params.minStopPct;
  const maxDist = entry * params.maxStopPct;
  let dist = entry - stop;
  if (dist < minDist) {
    dist = minDist;
    stopType += ` (widened to min ${Math.round(params.minStopPct * 100)}%)`;
  }
  if (dist > maxDist) {
    dist = maxDist;
    stopType += ` (capped at max ${Math.round(params.maxStopPct * 100)}%)`;
  }
  stop = roundPrice(entry - dist);
  const risk = entry - stop;
  let target = entry + params.targetR * risk;
  let targetType = `${params.targetR}R`;
  const res = f.tech.high52w;
  if (Number.isFinite(res) && res > entry * 1.002 && res < target) {
    target = res;
    targetType = '52-week high (resistance)';
  }
  target = roundPrice(target);
  return {
    entry: roundPrice(entry),
    stop,
    stopType,
    riskPerShare: round(risk, 2),
    riskPct: round(risk / entry, 4),
    target,
    targetType,
    rewardRisk: round((target - entry) / risk, 2),
  };
}

function detectSetups(f, params) {
  const t = f.tech;
  const setups = [];
  const uptrend = f.ema.mid > f.ema.slow && f.price > f.ema.slow;

  if (t.breakoutAge !== null) {
    const volOk = t.breakoutRelVol >= params.volBreakoutMult;
    setups.push({
      type: 'BREAKOUT',
      confirmed: volOk,
      note: `Close above ${params.breakoutLookback}-day high ${inr(t.breakoutLevel, 2)} ${
        t.breakoutAge === 0 ? 'today' : `${t.breakoutAge} bar(s) ago`
      } on ${round(t.breakoutRelVol, 2)}x volume (need >= ${params.volBreakoutMult}x)`,
    });
  }

  const touched = f.low <= f.ema.fast + 0.25 * f.vol.atr && f.price >= f.ema.mid - 0.5 * f.vol.atr;
  const nearHigh = Number.isFinite(t.pctFromHigh52) && t.pctFromHigh52 >= -0.15;
  const reversal = f.price > f.open && f.price > f.prevClose;
  const rsiOk = t.rsi >= params.pullbackMinRsi && t.rsi <= params.pullbackMaxRsi;
  if (uptrend && nearHigh && touched) {
    setups.push({
      type: 'PULLBACK',
      confirmed: reversal && rsiOk && f.tech.extensionAtr <= 1.5,
      note: `Pullback into ${params.emaPeriods[0]}-EMA zone ${reversal ? 'with a bullish reversal close' : 'without a reversal close yet'} (RSI ${round(t.rsi, 0)})`,
    });
  }

  if (
    f.trend.stack &&
    t.pctFromHigh52 >= -0.06 &&
    f.tech.extensionAtr <= 1.75 &&
    f.flow.rel >= 0.9 &&
    t.adx >= 22 &&
    t.macdHist > 0
  ) {
    setups.push({
      type: 'CONTINUATION',
      confirmed: true,
      note: `Strong continuation: EMAs stacked, within ${pctText(-t.pctFromHigh52)} of the 52-week high, ADX ${round(t.adx, 0)}`,
    });
  }
  return setups;
}

function pickSetup(setups) {
  const rank = { BREAKOUT: 3, PULLBACK: 2, CONTINUATION: 1 };
  const confirmed = setups.filter((s) => s.confirmed).sort((a, b) => rank[b.type] - rank[a.type]);
  if (confirmed.length) return confirmed[0];
  return setups.sort((a, b) => rank[b.type] - rank[a.type])[0] || null;
}

function holdingExpectation(params, horizonPresets) {
  return horizonPresets[params.horizon]?.expectedHolding || 'held while the thesis stays valid';
}

function analyzeEntry({ f, score, elig, regime, params, sector, horizonPresets, weeklyReview = false }) {
  const policy = regime.policy;
  const checks = [];
  const add = (id, label, pass, critical, detail) => checks.push({ id, label, pass: !!pass, critical, detail });

  const effMin = params.minScore + policy.scoreBonus;
  add('regime', 'Market regime allows new buys', policy.allowNewBuys, true, `${regime.regime}${policy.allowNewBuys ? '' : ' - new purchases are paused'}`);
  add('eligible', 'Liquidity & history gates', elig.eligible, true, elig.eligible ? 'Passes liquidity, price and history gates' : elig.reasons.join('; '));
  // Weekly rank-and-buy uses the 50/100 EMA stack. The 200-day gate is a
  // daily-timing filter and was dropping every 10k candidate as WAIT.
  const trendOk = weeklyReview
    ? f.price > f.ema.mid && f.ema.mid > f.ema.slow
    : f.price > f.ema.mid && f.ema.mid > f.ema.slow && (!params.requireAboveLongEma || f.price > f.ema.long);
  add(
    'trend',
    'Trend intact',
    trendOk,
    true,
    `Price ${inr(f.price, 2)} vs ${params.emaPeriods[1]}-EMA ${inr(f.ema.mid, 2)}, ${params.emaPeriods[2]}-EMA ${inr(f.ema.slow, 2)}, ${params.emaPeriods[3]}-EMA ${inr(f.ema.long, 2)}`,
  );
  const momentumOk = f.ret.m3 > 0 && f.rs.vsIndex3m >= params.rsMin;
  add('momentum', 'Positive momentum & relative strength', momentumOk, true, `3M ${pctText(f.ret.m3)}, vs NIFTY ${pctText(f.rs.vsIndex3m)} (need >= ${pctText(params.rsMin)})`);
  const scoreOk = score.total >= effMin;
  add('score', 'Composite score above entry threshold', scoreOk, true, `Score ${score.total} vs required ${effMin}${policy.scoreBonus ? ` (${params.minScore} + ${policy.scoreBonus} regime premium)` : ''}`);

  const setups = detectSetups(f, params);
  let setup = pickSetup(setups);
  const risk = planRisk(f, params);
  add('setup', 'Entry setup confirmed', !!setup?.confirmed, false, setup ? setup.note : 'No breakout, pullback-reversal or continuation setup present');
  const volOk = setup?.type === 'BREAKOUT' ? f.tech.breakoutRelVol >= params.volBreakoutMult : f.flow.rel >= 0.8;
  add('volume', 'Volume confirmation', volOk, false, setup?.type === 'BREAKOUT' ? `Breakout volume ${round(f.tech.breakoutRelVol, 2)}x (need ${params.volBreakoutMult}x)` : `Relative volume ${round(f.flow.rel, 2)}x`);
  const extOk = f.tech.extensionAtr <= params.maxExtensionAtr;
  add('extension', 'Not over-extended', extOk, false, `${round(f.tech.extensionAtr, 2)} ATR vs ${params.emaPeriods[0]}-EMA (max +${params.maxExtensionAtr})`);
  add('rsi', 'RSI not overheated', f.tech.rsi <= params.rsiMax, false, `RSI ${round(f.tech.rsi, 1)} (max ${params.rsiMax})`);
  add('rewardRisk', 'Reward/risk acceptable', risk.rewardRisk >= params.minRewardRisk, false, `R:R ${risk.rewardRisk} to ${risk.targetType} (need >= ${params.minRewardRisk})`);
  const sectorOk = !sector || !Number.isFinite(sector.ret3m) || (sector.ret3m > params.sectorWeakPct && sector.pctAboveMid >= 0.35);
  add('sector', 'Sector trend supportive', sectorOk, false, sector ? `Sector 3M ${pctText(sector.ret3m)}, ${Math.round(sector.pctAboveMid * 100)}% of sector above ${params.emaPeriods[1]}-EMA` : 'n/a');
  add('macd', 'MACD momentum positive', f.tech.macdHist > 0, false, `MACD histogram ${round(f.tech.macdHist, 2)}`);

  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  const criticalFail = checks.filter((c) => c.critical && !c.pass);
  const waitFor = [];
  let status;
  let headline;

  const nonScoreCriticalFail = criticalFail.filter((c) => c.id !== 'score');
  if (nonScoreCriticalFail.length) {
    status = 'WAIT';
    for (const c of nonScoreCriticalFail) {
      if (c.id === 'regime') waitFor.push(`Market regime must improve from ${regime.regime} (new purchases are paused)`);
      else if (c.id === 'trend') waitFor.push(`Trend must repair: close above the ${params.emaPeriods[1]}-EMA (${inr(f.ema.mid, 2)}) with ${params.emaPeriods[1]}-EMA above ${params.emaPeriods[2]}-EMA`);
      else if (c.id === 'momentum') waitFor.push('3M momentum and relative strength vs NIFTY must turn positive');
      else if (c.id === 'eligible') waitFor.push(`Eligibility: ${elig.reasons.join('; ')}`);
    }
    headline = `WAIT - ${nonScoreCriticalFail[0].label.toLowerCase()} not satisfied`;
  } else if (!scoreOk) {
    if (score.total >= params.watchScore) {
      status = 'WATCH';
      waitFor.push(`Composite score must reach ${effMin} (currently ${score.total})`);
      headline = `WATCH - momentum is building but score ${score.total} is below the ${effMin} entry bar`;
    } else {
      status = 'WAIT';
      waitFor.push(`Composite score must reach ${effMin} (currently ${score.total})`);
      headline = `WAIT - score ${score.total} is too low`;
    }
  } else if (weeklyReview) {
    // Classic weekly momentum: buy the ranked leaders on review day. Daily
    // breakout / pullback confirmation is the next-day timing layer, not the
    // weekly decision. Waiting for it left the 10k desk with zero buys.
    if (!setup || !setup.confirmed) {
      setup = {
        type: 'WEEKLY_RANK',
        confirmed: true,
        note: `Weekly momentum rank — relative strength vs NIFTY ${pctText(f.rs.vsIndex3m)}, 3M ${pctText(f.ret.m3)}`,
      };
    }
    if (f.tech.extensionAtr > params.climaxExtensionAtr || f.tech.rsi > params.climaxRsi) {
      status = 'WATCH';
      waitFor.push(
        `Weekly rank is extended (${round(f.tech.extensionAtr, 1)} ATR, RSI ${round(f.tech.rsi, 0)}); wait for a pullback toward the ${params.emaPeriods[0]}-EMA`,
      );
      headline = 'WAIT FOR BETTER ENTRY - weekly leader is too extended to buy this week';
    } else {
      const strong = score.total >= params.strongScore && regime.regime === 'BULLISH';
      status = strong ? 'STRONG_BUY' : 'BUY';
      headline = `${status.replace('_', ' ')} - weekly rank entry confirmed with trend, momentum and regime support`;
    }
  } else if (!setup) {
    status = 'WATCH';
    const ph = f.tech.donchHigh;
    waitFor.push(`Breakout: close above ${inr(ph, 2)} (${params.breakoutLookback}-day high) on volume >= ${params.volBreakoutMult}x average (latest ${round(f.flow.rel, 2)}x)`);
    waitFor.push(`or Pullback: dip into the ${inr(f.ema.fast - 0.25 * f.vol.atr, 2)}-${inr(f.ema.fast + 0.25 * f.vol.atr, 2)} zone (${params.emaPeriods[0]}-EMA) followed by a bullish reversal close`);
    headline = 'WATCH - trend and momentum are fine but no entry trigger yet';
  } else if (!setup.confirmed) {
    status = 'WATCH';
    if (setup.type === 'BREAKOUT') {
      waitFor.push(`Breakout volume has not confirmed: need >= ${params.volBreakoutMult}x average volume on a close above ${inr(f.tech.breakoutLevel, 2)} (breakout bar had ${round(f.tech.breakoutRelVol, 2)}x)`);
      headline = `WAIT FOR CONFIRMATION - momentum is positive but breakout volume has not confirmed (${round(f.tech.breakoutRelVol, 2)}x vs ${params.volBreakoutMult}x)`;
    } else {
      waitFor.push(`Pullback needs a bullish reversal close (close > open and > prior close) with RSI ${params.pullbackMinRsi}-${params.pullbackMaxRsi}`);
      headline = 'WAIT FOR CONFIRMATION - pullback has reached support but has not reversed yet';
    }
  } else if (!extOk) {
    status = 'WATCH';
    waitFor.push(`Wait for a pullback toward the ${params.emaPeriods[0]}-EMA (${inr(f.ema.fast, 2)}); price is ${round(f.tech.extensionAtr, 1)} ATR above it`);
    headline = 'WAIT FOR BETTER ENTRY - price is extended above its trend average';
  } else if (!byId.rsi.pass) {
    status = 'WATCH';
    waitFor.push(`RSI must cool below ${params.rsiMax} (currently ${round(f.tech.rsi, 1)})`);
    headline = 'WAIT FOR BETTER ENTRY - RSI is overheated';
  } else if (!byId.rewardRisk.pass) {
    status = 'WATCH';
    waitFor.push(`Reward/risk is ${risk.rewardRisk}; need >= ${params.minRewardRisk}. A pullback toward ${inr(f.ema.fast, 2)} would improve it`);
    headline = 'WAIT FOR BETTER ENTRY - reward/risk is not attractive enough';
  } else if (setup.type === 'CONTINUATION' && score.total < params.minScore + 8) {
    status = 'WATCH';
    waitFor.push(`Continuation entries need a score of ${params.minScore + 8}+ (currently ${score.total}); otherwise wait for a breakout or pullback trigger`);
    headline = 'WATCH - continuation setup without enough score margin';
  } else {
    const strong =
      score.total >= params.strongScore &&
      regime.regime === 'BULLISH' &&
      (setup.type === 'BREAKOUT' || setup.type === 'PULLBACK') &&
      risk.rewardRisk >= 2 &&
      byId.sector.pass &&
      byId.macd.pass;
    status = strong ? 'STRONG_BUY' : 'BUY';
    headline = `${status.replace('_', ' ')} - ${setup.type.toLowerCase()} entry confirmed with trend, momentum and regime support`;
  }

  if (!weeklyReview && statusAtLeast(status, 'BUY') && !statusAtLeast(status, policy.minEntryStatus)) {
    status = 'WATCH';
    waitFor.push(`${regime.regime} regime only permits ${policy.minEntryStatus.replace('_', ' ')} entries (this is a BUY)`);
    headline = `WAIT - ${regime.regime} regime requires a stronger signal than this setup provides`;
  }

  const invalidation = [
    `Close at or below the protective stop ${inr(risk.stop, 2)} (${risk.stopType})`,
    `Two consecutive closes below the ${params.emaPeriods[1]}-EMA`,
    `Composite score falls below ${params.holdScore}`,
    'Market regime turns BEARISH',
  ];

  return {
    status,
    actionable: statusAtLeast(status, 'BUY'),
    setup: setup ? setup.type : 'NONE',
    headline,
    checks,
    waitFor,
    invalidation,
    risk,
    expectedHolding: holdingExpectation(params, horizonPresets),
    confirmations: checks.filter((c) => c.pass && !['regime', 'eligible'].includes(c.id)).map((c) => c.detail),
  };
}

module.exports = { analyzeEntry, planRisk, detectSetups, statusAtLeast, STATUS_ORDER };
