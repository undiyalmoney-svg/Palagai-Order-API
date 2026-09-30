'use strict';

const { clamp, round } = require('../utils/math');

/**
 * Transparent scoring: six components, each 0-100, combined with explicit weights.
 * Every component returns the notes that explain its number.
 */

const RET_KEY_MAP = { ret1: 'd1', ret5: 'w1', ret21: 'm1', ret63: 'm3', ret126: 'm6', ret231: 'm12x1', ret252: 'm12' };
const RET_LABEL = { d1: '1D', w1: '1W', m1: '1M', m3: '3M', m6: '6M', m12: '12M', m12x1: '12M-1M' };
const RET_SCALE = { d1: 0.02, w1: 0.04, m1: 0.08, m3: 0.15, m6: 0.25, m12: 0.4, m12x1: 0.35 };

function pctText(x, dp = 1) {
  return Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(dp)}%` : 'n/a';
}

function lerp(x, x0, x1, y0, y1) {
  if (x <= x0) return y0;
  if (x >= x1) return y1;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

function momentumScore(f, ctx, params) {
  const notes = [];
  let acc = 0;
  let wsum = 0;
  for (const [retKey, w] of Object.entries(params.momentumWeights)) {
    const key = RET_KEY_MAP[retKey];
    if (!key || !(w > 0)) continue;
    const v = f.ret[key];
    if (!Number.isFinite(v)) continue;
    const pct = ctx.percentile(key, v);
    const abs = 50 + 50 * Math.tanh(v / RET_SCALE[key]);
    const s = 0.7 * pct + 0.3 * abs;
    acc += w * s;
    wsum += w;
    notes.push(`${RET_LABEL[key]} ${pctText(v)} (universe percentile ${Math.round(pct)})`);
  }
  return { score: wsum ? acc / wsum : 0, notes };
}

function trendScore(f, params) {
  const notes = [];
  let s = 0;
  const [pf, pm, ps, pl] = params.emaPeriods;
  const items = [
    [f.trend.aboveFast, 15, `Price above ${pf}-EMA`],
    [f.trend.aboveMid, 20, `Price above ${pm}-EMA`],
    [f.trend.aboveSlow, 15, `Price above ${ps}-EMA`],
    [f.trend.aboveLong, 15, `Price above ${pl}-EMA`],
  ];
  for (const [ok, pts, label] of items) {
    if (ok) s += pts;
    notes.push(`${ok ? 'OK' : 'X'}: ${label}`);
  }
  s += (f.trend.stackCount / 3) * 20;
  notes.push(
    f.trend.stack
      ? `OK: EMAs fully stacked (${pf}>${pm}>${ps}>${pl})`
      : `EMA stack ${f.trend.stackCount}/3 aligned`,
  );
  const slopeOk = f.trend.midSlope10 > 0;
  if (slopeOk) s += 15;
  notes.push(`${slopeOk ? 'OK' : 'X'}: ${pm}-EMA slope ${pctText(f.trend.midSlope10)} over 10 bars`);
  return { score: clamp(s, 0, 100), notes };
}

function relativeStrengthScore(f, ctx, sectorRet3m) {
  const notes = [];
  const p3 = ctx.percentileRs3(f.rs.vsIndex3m);
  const p6 = ctx.percentileRs6(f.rs.vsIndex6m);
  const abs3 = 50 + 50 * Math.tanh(f.rs.vsIndex3m / 0.1);
  const secRel = Number.isFinite(sectorRet3m) ? f.ret.m3 - sectorRet3m : 0;
  const secScore = 50 + 50 * Math.tanh(secRel / 0.1);
  const s = 0.35 * p3 + 0.25 * p6 + 0.2 * abs3 + 0.2 * secScore;
  notes.push(`3M vs NIFTY ${pctText(f.rs.vsIndex3m)} (percentile ${Math.round(p3)})`);
  notes.push(`6M vs NIFTY ${pctText(f.rs.vsIndex6m)} (percentile ${Math.round(p6)})`);
  if (Number.isFinite(sectorRet3m)) notes.push(`3M vs sector average ${pctText(secRel)}`);
  return { score: clamp(s, 0, 100), notes };
}

function volumeScore(f) {
  const notes = [];
  const rel = f.flow.rel;
  let relS = lerp(rel, 0.3, 1, 15, 50);
  if (rel > 1) relS = lerp(rel, 1, 2, 50, 100);
  if (f.ret.d1 < 0 && rel > 1.5) relS = Math.min(relS, 25);
  const exp = lerp(f.flow.expansion, 0.6, 1, 15, 50) + (f.flow.expansion > 1 ? lerp(f.flow.expansion, 1, 1.6, 0, 45) : 0);
  const ud = lerp(f.flow.upDown, 0.5, 1, 15, 50) + (f.flow.upDown > 1 ? lerp(f.flow.upDown, 1, 2, 0, 50) : 0);
  const s = 0.35 * relS + 0.25 * clamp(exp, 0, 100) + 0.4 * clamp(ud, 0, 100);
  notes.push(`Relative volume ${round(rel, 2)}x (vs 20-day average)`);
  notes.push(`5d/50d volume expansion ${round(f.flow.expansion, 2)}x`);
  notes.push(`Up-day/down-day volume ratio ${round(f.flow.upDown, 2)} (${f.flow.upDown >= 1 ? 'accumulation' : 'distribution'})`);
  return { score: clamp(s, 0, 100), notes };
}

function volatilityScore(f) {
  const a = lerp(f.vol.atrPct, 0.01, 0.06, 100, 0);
  const h = lerp(f.vol.hv20, 0.15, 0.6, 100, 0);
  return {
    score: clamp(0.5 * a + 0.5 * h, 0, 100),
    notes: [`ATR ${pctText(f.vol.atrPct)} of price`, `20-day historical volatility ${pctText(f.vol.hv20, 0)} annualised`],
  };
}

function rsiPoints(r) {
  if (r < 35) return 10;
  if (r < 50) return lerp(r, 35, 50, 10, 55);
  if (r < 55) return lerp(r, 50, 55, 55, 85);
  if (r <= 70) return 100;
  if (r <= 78) return lerp(r, 70, 78, 100, 70);
  if (r <= 85) return lerp(r, 78, 85, 70, 35);
  return 20;
}

function technicalScore(f) {
  const notes = [];
  const rsiP = rsiPoints(f.tech.rsi);
  let macdP = f.tech.macdHist > 0 ? 60 : 15;
  if (f.tech.macdHist > f.tech.macdHistPrev) macdP += 25;
  if (f.tech.macdLine > 0) macdP += 15;
  let adxP;
  if (f.tech.pdi > f.tech.mdi) adxP = f.tech.adx >= 25 ? 100 : f.tech.adx >= 18 ? 70 : 45;
  else adxP = f.tech.adx >= 25 ? 10 : 25;
  const dist = -f.tech.pctFromHigh52;
  const proxP = dist <= 0.05 ? 100 : dist <= 0.1 ? lerp(dist, 0.05, 0.1, 100, 80) : dist <= 0.2 ? lerp(dist, 0.1, 0.2, 80, 50) : dist <= 0.35 ? lerp(dist, 0.2, 0.35, 50, 20) : 0;
  notes.push(`RSI(14) ${round(f.tech.rsi, 1)}`);
  notes.push(`MACD histogram ${round(f.tech.macdHist, 2)} (${f.tech.macdHist > f.tech.macdHistPrev ? 'rising' : 'falling'})`);
  notes.push(`ADX ${round(f.tech.adx, 1)} (+DI ${round(f.tech.pdi, 1)} / -DI ${round(f.tech.mdi, 1)})`);
  notes.push(`${pctText(f.tech.pctFromHigh52)} from 52-week high`);
  return { score: clamp(0.25 * rsiP + 0.25 * clamp(macdP, 0, 100) + 0.25 * adxP + 0.25 * proxP, 0, 100), notes };
}

/**
 * @returns {{total:number, components:Object}} total in 0-100.
 */
function scoreFeatures(f, ctx, params, sectorRet3m) {
  const parts = {
    momentum: momentumScore(f, ctx, params),
    trend: trendScore(f, params),
    relativeStrength: relativeStrengthScore(f, ctx, sectorRet3m),
    volume: volumeScore(f),
    volatility: volatilityScore(f),
    technical: technicalScore(f),
  };
  const components = {};
  let total = 0;
  let wsum = 0;
  for (const [k, w] of Object.entries(params.weights)) wsum += w;
  for (const [k, part] of Object.entries(parts)) {
    const weight = (params.weights[k] || 0) / (wsum || 1);
    const contribution = part.score * weight;
    total += contribution;
    components[k] = {
      score: round(part.score, 1),
      weight: round(weight, 3),
      contribution: round(contribution, 2),
      notes: part.notes,
    };
  }
  return { total: round(total, 1), components };
}

/** Universe eligibility gates (independent of the score). */
function eligibility(f, barsAvailable, params) {
  const reasons = [];
  if (!f || !f.valid) reasons.push('Insufficient indicator history');
  if (barsAvailable < params.minHistoryBars) reasons.push(`Only ${barsAvailable} bars of history (need ${params.minHistoryBars})`);
  if (f && f.price < params.minPrice) reasons.push(`Price below minimum ₹${params.minPrice}`);
  if (f && Number.isFinite(f.liq.advValue) && f.liq.advValue < params.minAdvRs) {
    reasons.push(`Average traded value ₹${round(f.liq.advValue / 1e7, 2)} cr below minimum ₹${round(params.minAdvRs / 1e7, 2)} cr`);
  }
  return { eligible: reasons.length === 0, reasons };
}

module.exports = { scoreFeatures, eligibility, pctText, lerp };
