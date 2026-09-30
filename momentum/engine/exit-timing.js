'use strict';

const { round, roundPrice, inr } = require('../utils/math');
const { pctText } = require('./scoring');

/**
 * Exit-timing engine.
 *
 * Holding period is NOT an exit trigger. A position is held while its thesis
 * (trend, momentum, relative strength, volume, market, sector, rank) stays
 * valid, and is reduced/sold only when an explicit exit condition fires:
 *
 *  Hard (evaluated every day, act immediately):
 *    stop-loss / break-even stop / trailing stop, volume-backed breakdown,
 *    bearish regime with price under its trend average.
 *  Soft (thesis deterioration; acted on at review time, always on DAILY horizon):
 *    trend reversal, momentum/score deterioration, relative-strength
 *    deterioration, distribution volume, sector deterioration, climax run-up.
 *
 * We do not know the future high. The process is: ratchet the stop up as the
 * trend pays (break-even at `beAtR`, ATR chandelier trail after `trailStartR`)
 * so accumulated gains are protected while the trend is allowed to run.
 */

function computeStop({ position, f, regime, params, peak }) {
  const entry = position.avgPrice;
  const atr = f.vol.atr;
  const initial = Number.isFinite(position.initialStop) ? position.initialStop : entry - params.stopAtrMult * atr;
  const R = Math.max(entry - initial, entry * 0.005);
  const peakR = (peak - entry) / R;
  const trailMult = params.trailAtrMult * (regime.policy?.trailMult ?? 1);

  const candidates = [{ type: 'STOP_LOSS', price: initial, label: 'initial stop' }];
  if (peakR >= params.beAtR) {
    candidates.push({ type: 'BREAKEVEN_STOP', price: entry * 1.002, label: 'break-even stop' });
  }
  if (peakR >= params.trailStartR) {
    candidates.push({
      type: 'TRAILING_STOP',
      price: peak - trailMult * atr,
      label: `trailing stop (${round(trailMult, 2)}x ATR below the ${inr(peak, 2)} peak close)`,
    });
  }
  if (Number.isFinite(position.stopPrice)) {
    const prior = position.stopPrice;
    const cur = candidates.reduce((a, b) => (b.price > a.price ? b : a));
    if (prior > cur.price) {
      candidates.push({
        type: prior > entry ? 'TRAILING_STOP' : 'STOP_LOSS',
        price: prior,
        label: 'previously ratcheted stop',
      });
    }
  }
  const best = candidates.reduce((a, b) => (b.price > a.price ? b : a));
  return { price: roundPrice(best.price), type: best.type, label: best.label, R, peakR, initial };
}

function quantityFor(fraction, qty, price, params) {
  if (fraction >= 0.999) return qty;
  let q = Math.max(1, Math.floor(qty * fraction));
  if ((qty - q) * price < params.minTicketValue) q = qty;
  return Math.min(qty, q);
}

function analyzeExit({ position, f, score, rank, rankCutoff, regime, params, sector, isReviewDay, nextReviewLabel, peakClose }) {
  const entry = position.avgPrice;
  const close = f.price;
  const peak = Math.max(peakClose || entry, close, entry);
  const gainPct = close / entry - 1;
  const stop = computeStop({ position, f, regime, params, peak });
  const rMultiple = (close - entry) / stop.R;
  const [, pm, ps] = params.emaPeriods;

  const reasons = [];
  const warnings = [];
  const thesis = [];
  const addThesis = (id, label, ok, detail) => thesis.push({ id, label, ok: !!ok, detail });

  const trendBars = f.trend.closesBelowMid;
  const trendBreakSoft = trendBars >= params.trendBreakBars;
  const trendBreakSevere = close < f.ema.slow;
  addThesis('trend', 'Trend intact', !trendBreakSoft && !trendBreakSevere, `Price ${inr(close, 2)} vs ${pm}-EMA ${inr(f.ema.mid, 2)} (${trendBars} close(s) below), ${ps}-EMA ${inr(f.ema.slow, 2)}`);
  const scoreWeak = score.total < params.holdScore;
  const scoreSevere = score.total < params.sellScore;
  addThesis('score', 'Composite score above hold level', !scoreWeak, `Score ${score.total} (hold >= ${params.holdScore}, sell < ${params.sellScore})`);
  const momentumFade = f.ret.m3 < 0;
  addThesis('momentum', 'Momentum positive', !momentumFade, `3M ${pctText(f.ret.m3)}, 1M ${pctText(f.ret.m1)}`);
  const rsBad = f.rs.vsIndex3m <= params.rsDeteriorationPct && f.rs.vsIndex1m < 0;
  addThesis('relativeStrength', 'Relative strength holding', !rsBad, `3M vs NIFTY ${pctText(f.rs.vsIndex3m)}, 1M vs NIFTY ${pctText(f.rs.vsIndex1m)}`);
  const distribution = f.flow.upDown < 0.7 && f.flow.rel > 1.2 && f.ret.d1 < 0;
  addThesis('volume', 'No distribution selling', !distribution, `Up/down volume ${round(f.flow.upDown, 2)}, relative volume ${round(f.flow.rel, 2)}x`);
  const marketBad = regime.regime === 'BEARISH';
  addThesis('market', 'Market regime supportive', !marketBad, `Regime ${regime.regime}`);
  const sectorBad = !!sector && Number.isFinite(sector.ret3m) && sector.ret3m < params.sectorWeakPct && f.price < f.ema.fast;
  addThesis('sector', 'Sector not deteriorating', !sectorBad, sector ? `Sector 3M ${pctText(sector.ret3m)}` : 'n/a');
  const rankBad = Number.isFinite(rank) && rank > rankCutoff && score.total < params.minScore;
  addThesis('rank', 'Still ranked among top candidates', !rankBad, Number.isFinite(rank) ? `Rank #${rank} (cutoff #${rankCutoff})` : 'Unranked');

  const base = {
    stopPrice: stop.price,
    stopType: stop.type,
    initialStop: roundPrice(stop.initial),
    peakClose: round(peak, 2),
    gainPct: round(gainPct, 4),
    rMultiple: round(rMultiple, 2),
    peakR: round(stop.peakR, 2),
    thesis,
    rank,
  };

  const done = (action, trigger, fraction, headline, detail = {}) => ({
    action,
    timing: action === 'HOLD' ? (detail.timing || 'HOLD') : 'NOW',
    trigger,
    fraction,
    quantity: action === 'HOLD' ? 0 : quantityFor(fraction, position.qty, close, params),
    headline,
    reasons: [...reasons],
    warnings: [...warnings],
    ...base,
    ...detail,
  });

  if (close <= stop.price) {
    const label = stop.type === 'TRAILING_STOP' ? 'Trailing stop hit' : stop.type === 'BREAKEVEN_STOP' ? 'Break-even stop hit' : 'Stop-loss hit';
    reasons.push(`${label}: close ${inr(close, 2)} <= ${stop.label} ${inr(stop.price, 2)}`);
    reasons.push(`Position return ${pctText(gainPct)} (${round(rMultiple, 2)}R, peak ${round(stop.peakR, 2)}R)`);
    return done('EXIT', stop.type, 1, `EXIT - ${label.toLowerCase()}`);
  }

  if (close < f.tech.donchLow && f.flow.rel >= params.breakdownRelVol && close < f.ema.mid) {
    reasons.push(`Breakdown: close ${inr(close, 2)} below the ${params.breakoutLookback}-day low ${inr(f.tech.donchLow, 2)} on ${round(f.flow.rel, 2)}x volume`);
    return done('EXIT', 'BREAKDOWN', 1, 'EXIT - volume-backed breakdown below support');
  }

  if (marketBad && close < f.ema.mid) {
    reasons.push(`Market regime is BEARISH and price is below its ${pm}-EMA`);
    return done('EXIT', 'REGIME_BEARISH', 1, 'EXIT - bearish market regime with broken stock trend');
  }

  if (marketBad) warnings.push('Bearish regime: trailing stop tightened');

  const invalid = [];
  if (trendBreakSoft || trendBreakSevere) invalid.push('trend');
  if (scoreWeak) invalid.push('score');
  if (momentumFade) invalid.push('momentum');
  if (rsBad) invalid.push('relativeStrength');
  if (distribution) invalid.push('volume');
  if (sectorBad) invalid.push('sector');
  if (rankBad) invalid.push('rank');

  const climax = f.tech.extensionAtr >= params.climaxExtensionAtr && f.tech.rsi >= params.climaxRsi;
  const failedLabels = thesis.filter((t) => !t.ok).map((t) => t.label.toLowerCase());
  const detailLines = thesis.filter((t) => !t.ok).map((t) => `${t.label}: ${t.detail}`);

  const severe = trendBreakSevere || scoreSevere || invalid.length >= 3;
  const moderate = invalid.length >= 2 || scoreWeak;

  if (severe || moderate) {
    if (!isReviewDay) {
      reasons.push(...detailLines);
      warnings.push(`Exit signals flagged (${failedLabels.join(', ')}); deferred to ${nextReviewLabel || 'the next review'} unless the stop is hit`);
      return done('HOLD', null, 0, `WAIT - thesis weakening (${failedLabels.join(', ')}); decision at ${nextReviewLabel || 'next review'}`, { timing: 'WAIT' });
    }
    reasons.push(...detailLines);
    const trigger = trendBreakSevere || trendBreakSoft ? 'TREND_REVERSAL' : scoreSevere || scoreWeak ? 'MOMENTUM_DETERIORATION' : rsBad ? 'RS_DETERIORATION' : sectorBad ? 'SECTOR_DETERIORATION' : 'THESIS_INVALID';
    if (severe || position.partials?.reduced) {
      return done('SELL', trigger, 1, `SELL - investment thesis no longer valid (${failedLabels.join(', ')})`);
    }
    return done('REDUCE', trigger, params.reduceFraction, `REDUCE - thesis weakening (${failedLabels.join(', ')}); trimming ${Math.round(params.reduceFraction * 100)}% and re-checking at the next review`);
  }

  if (climax && !position.partials?.tookProfit) {
    reasons.push(`Climactic run: ${round(f.tech.extensionAtr, 1)} ATR above ${params.emaPeriods[0]}-EMA with RSI ${round(f.tech.rsi, 0)}`);
    reasons.push(`Banking part of a ${pctText(gainPct)} gain while the trailing stop protects the rest`);
    return done('REDUCE', 'TAKE_PROFIT', params.climaxTakeFraction, 'REDUCE - taking partial profit into a climactic move');
  }

  if (invalid.length === 1) {
    warnings.push(`Watch: ${failedLabels[0]} (${detailLines[0]})`);
  }
  reasons.push(`Thesis valid: ${thesis.filter((t) => t.ok).length}/${thesis.length} checks pass`);
  reasons.push(`Protective stop ${inr(stop.price, 2)} (${stop.label}); position ${pctText(gainPct)} / ${round(rMultiple, 2)}R`);
  return done('HOLD', null, 0, 'HOLD - trend and momentum thesis remains valid');
}

module.exports = { analyzeExit, computeStop, quantityFor };
