/**
 * Black-Scholes European option pricer + realized-volatility estimator.
 *
 * Purpose: historical research backtests can't get real Nifty option premiums
 * beyond the current/recent weeks (Kite's /instruments only lists live
 * contracts — see instrument-archive.js). This module prices a modeled
 * option leg from real underlying index candles instead of either (a) an
 * unavailable real premium or (b) a flat "index points × ₹/point" proxy —
 * it models actual delta/theta/vol decay, which the flat proxy cannot.
 *
 * Standalone and read-only: does not touch paper-desk-engine.ts (the
 * live-money P&L path) or any file the live desk depends on.
 */

/** Abramowitz-Stegun 7.1.26 erf approximation (~1e-7 accuracy). */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * European option price via Black-Scholes (no dividend yield — short-dated
 * index weeklies, dividend drag is negligible).
 *
 * @param {number} spot underlying price
 * @param {number} strike
 * @param {number} tYears time to expiry in years (must be > 0; use intrinsic value at/after expiry)
 * @param {number} vol annualized volatility (e.g. 0.14 = 14%)
 * @param {number} r annualized risk-free rate (e.g. 0.065)
 * @param {'CE'|'PE'} type
 * @returns {number} theoretical premium (>= 0.05 tick floor)
 */
function blackScholesPrice(spot, strike, tYears, vol, r, type) {
  const S = Math.max(0.01, Number(spot) || 0);
  const K = Math.max(0.01, Number(strike) || 0);
  if (!(tYears > 0)) {
    const intrinsic = type === 'CE' ? Math.max(0, S - K) : Math.max(0, K - S);
    return Math.max(0.05, Math.round(intrinsic * 20) / 20);
  }
  const v = Math.max(0.01, Number(vol) || 0.13);
  const T = tYears;
  const rr = Number(r) || 0;
  const d1 = (Math.log(S / K) + (rr + 0.5 * v * v) * T) / (v * Math.sqrt(T));
  const d2 = d1 - v * Math.sqrt(T);
  let price;
  if (type === 'CE') {
    price = S * normalCdf(d1) - K * Math.exp(-rr * T) * normalCdf(d2);
  } else {
    price = K * Math.exp(-rr * T) * normalCdf(-d2) - S * normalCdf(-d1);
  }
  return Math.max(0.05, Math.round(Math.max(0, price) * 20) / 20);
}

/**
 * Annualized realized volatility from daily closes (close-to-close log
 * returns, stdev × sqrt(252)). Causal — only uses closes up to `uptoIndex`
 * inclusive. Clamped to a sane range so a freak quiet/chaotic stretch can't
 * feed BS a degenerate input.
 *
 * @param {number[]} dailyCloses
 * @param {number} uptoIndex inclusive index into dailyCloses
 * @param {number} lookbackDays
 */
function realizedVolAnnualized(dailyCloses, uptoIndex, lookbackDays = 20) {
  const end = Math.min(uptoIndex, dailyCloses.length - 1);
  const start = Math.max(1, end - lookbackDays + 1);
  const rets = [];
  for (let i = start; i <= end; i += 1) {
    const prev = dailyCloses[i - 1];
    const cur = dailyCloses[i];
    if (prev > 0 && cur > 0) {
      rets.push(Math.log(cur / prev));
    }
  }
  if (rets.length < 5) return 0.13; // default until enough warmup history
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1);
  const dailyVol = Math.sqrt(Math.max(0, variance));
  const annualized = dailyVol * Math.sqrt(252);
  return Math.min(0.6, Math.max(0.07, annualized));
}

module.exports = { blackScholesPrice, realizedVolAnnualized, normalCdf, erf };
