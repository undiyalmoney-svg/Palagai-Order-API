'use strict';

function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function npdf(x) {
  return 0.3989423 * Math.exp((-x * x) / 2);
}

/** r = 0.065 with spot as S for index options; r = 0 with the matching future as S for Black-76 (crude). */
function bsPrice(S, K, T, iv, isCall, r = 0.065) {
  const sq = iv * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (iv * iv) / 2) * T) / sq;
  const d2 = d1 - sq;
  if (isCall) return S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2);
  return K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1);
}

/**
 * Implied volatility by bisection. Returns null when the price is below intrinsic value, above the
 * no-arbitrage bound, or T is not positive. Kite does not publish IV or Greeks, so these are derived values.
 */
function impliedVol(price, S, K, T, isCall, r = 0.065) {
  if (!(price > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return null;
  const intrinsic = isCall ? Math.max(S - K * Math.exp(-r * T), 0) : Math.max(K * Math.exp(-r * T) - S, 0);
  if (price < intrinsic + 0.01) return null;
  const upper = isCall ? S : K;
  if (price >= upper) return null;
  let lo = 0.01;
  let hi = 5;
  if (bsPrice(S, K, T, hi, isCall, r) < price) return null;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (bsPrice(S, K, T, mid, isCall, r) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Per-unit Greeks: delta, gamma (per 1 point of S), theta per calendar day (price units), vega per 1 vol point. */
function greeks(S, K, T, iv, isCall, r = 0.065) {
  if (!(iv > 0) || !(T > 0)) return null;
  const sq = iv * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (iv * iv) / 2) * T) / sq;
  const d2 = d1 - sq;
  const delta = isCall ? ncdf(d1) : ncdf(d1) - 1;
  const gamma = npdf(d1) / (S * sq);
  const thetaYear = -(S * npdf(d1) * iv) / (2 * Math.sqrt(T)) - (isCall ? 1 : -1) * r * K * Math.exp(-r * T) * ncdf(isCall ? d2 : -d2);
  const vega = (S * npdf(d1) * Math.sqrt(T)) / 100;
  return { delta, gamma, theta_day: thetaYear / 365, vega_1pct: vega };
}

module.exports = { impliedVol, bsPrice, greeks };
