'use strict';

const { clamp, round, percentRank } = require('../utils/math');
const { lerp, pctText } = require('./scoring');

/**
 * Market regime from market data only: NIFTY trend, breadth, volatility and
 * momentum. No subjective inputs.
 */

function computeRegime(view, params, prev = null) {
  const b = view.benchmarkFeatures();
  const ctx = view.context();
  const cfg = params.regime;
  if (!b || !b.valid) {
    return {
      regime: 'NEUTRAL',
      score: 50,
      components: {},
      metrics: {},
      reasons: ['Benchmark history unavailable - defaulting to NEUTRAL'],
      policy: params.regimePolicy.NEUTRAL,
      asOf: view.asOf,
    };
  }

  const reasons = [];
  let trendPts = 0;
  if (b.trend.aboveMid) trendPts += 10;
  if (b.trend.aboveLong) trendPts += 10;
  if (b.ema.mid > b.ema.long) trendPts += 10;
  if (b.trend.midSlope10 > 0) trendPts += 10;
  reasons.push(
    `NIFTY ${round(b.price, 0)} is ${b.trend.aboveMid ? 'above' : 'below'} its ${params.emaPeriods[1]}-EMA and ${
      b.trend.aboveLong ? 'above' : 'below'
    } its ${params.emaPeriods[3]}-EMA`,
  );

  const br = ctx.breadth;
  const breadthPts = br.pctAboveMid * 15 + br.pctAboveLong * 10 + br.pctPositive3m * 5;
  reasons.push(
    `Breadth: ${Math.round(br.pctAboveMid * 100)}% of stocks above ${params.emaPeriods[1]}-EMA, ${Math.round(
      br.pctAboveLong * 100,
    )}% above ${params.emaPeriods[3]}-EMA, ${Math.round(br.pctPositive3m * 100)}% with positive 3M return`,
  );

  const momPts = lerp(b.ret.m3, -0.1, 0.1, 0, 12) + lerp(b.ret.m1, -0.05, 0.05, 0, 8);
  reasons.push(`NIFTY momentum: 1M ${pctText(b.ret.m1)}, 3M ${pctText(b.ret.m3)}`);

  const hvWindow = view.indicatorWindow(view.panel.benchmark, 'hv20', 252).filter(Number.isFinite);
  const hvPct = hvWindow.length > 60 ? percentRank(hvWindow, b.vol.hv20) : 50;
  const volPts = lerp(hvPct, 0, 100, 10, 0);
  reasons.push(`NIFTY 20-day volatility ${pctText(b.vol.hv20, 1)} (${Math.round(hvPct)}th percentile of the last year)`);

  const score = clamp(trendPts + breadthPts + momPts + volPts, 0, 100);

  const dd = b.tech.pctFromHigh52;
  let regime;
  const hvHigh = hvPct >= cfg.highVolPercentile;
  const h = cfg.hysteresis || 0;
  const bullishThreshold = prev === 'BULLISH' ? cfg.bullishMin - h : cfg.bullishMin + (prev ? h : 0);
  const bearishThreshold = prev === 'BEARISH' ? cfg.bearishMax + h : cfg.bearishMax - (prev ? h : 0);
  if (hvHigh && score < 80) regime = 'HIGH_VOLATILITY';
  else if (score >= bullishThreshold) regime = 'BULLISH';
  else if (score <= bearishThreshold) regime = 'BEARISH';
  else regime = 'NEUTRAL';
  if (regime !== 'BEARISH' && b.ret.m1 <= -0.08) regime = 'HIGH_VOLATILITY';

  // Dual Momentum absolute filter with hysteresis so a week of noise does
  // not dump the book and buy it back. Turn OFF only when the 200-day is
  // lost and 3-month Nifty is clearly negative. Turn back ON only after
  // the 200-day is recaptured. Strategies can disable the cash gate.
  const nifty12x1 = Number.isFinite(b.ret.m12x1) ? b.ret.m12x1 : b.ret.m12;
  const above200 = !!b.trend.aboveLong;
  const m3 = Number.isFinite(b.ret.m3) ? b.ret.m3 : 0;
  const absEnabled = params.absoluteMomentum !== false;
  let absOn = true;
  if (absEnabled) {
    if (prev === 'BEARISH') {
      absOn = above200 && m3 > 0;
    } else {
      absOn = above200 || m3 > 0.02;
    }
    if (!absOn) {
      regime = 'BEARISH';
      reasons.push(
        `Absolute momentum OFF: NIFTY below 200-EMA and 3M ${pctText(b.ret.m3)} — Dual Momentum stays in cash`,
      );
    } else {
      reasons.push(`Absolute momentum ON: NIFTY 12-1 ${pctText(nifty12x1)}, 3M ${pctText(b.ret.m3)}, ${above200 ? 'above' : 'below'} 200-EMA`);
    }
  } else {
    reasons.push('Absolute momentum gate off — book stays invested through Nifty trend breaks');
  }

  reasons.push(`Regime score ${round(score, 1)}/100 -> ${regime}`);
  return {
    regime,
    score: round(score, 1),
    components: {
      trend: round(trendPts, 1),
      breadth: round(breadthPts, 1),
      momentum: round(momPts, 1),
      volatility: round(volPts, 1),
    },
    metrics: {
      niftyClose: round(b.price, 2),
      niftyRet1m: round(b.ret.m1, 4),
      niftyRet3m: round(b.ret.m3, 4),
      niftyRet12x1: round(nifty12x1, 4),
      absoluteMomentum: absOn && above200,
      hv20: round(b.vol.hv20, 4),
      hvPercentile: round(hvPct, 0),
      drawdownFrom52wHigh: round(dd, 4),
      pctAboveMid: round(br.pctAboveMid, 3),
      pctAboveLong: round(br.pctAboveLong, 3),
      pctPositive3m: round(br.pctPositive3m, 3),
      universeSize: br.n,
    },
    reasons,
    policy: params.regimePolicy[regime],
    asOf: view.asOf,
  };
}

module.exports = { computeRegime };
