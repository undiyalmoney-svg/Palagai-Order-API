'use strict';

const R = 0.065;

function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function bsPrice(S, K, T, iv, isCall) {
  const sq = iv * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (R + (iv * iv) / 2) * T) / sq;
  const d2 = d1 - sq;
  if (isCall) return S * ncdf(d1) - K * Math.exp(-R * T) * ncdf(d2);
  return K * Math.exp(-R * T) * ncdf(-d2) - S * ncdf(-d1);
}

/**
 * Implied volatility by bisection from a traded price. Returns null when the price is below
 * intrinsic value, above the no-arbitrage bound, or T is not positive. Kite does not publish IV,
 * so this is a derived value (Black-Scholes on the index spot) and is stored as such.
 */
function impliedVol(price, S, K, T, isCall) {
  if (!(price > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return null;
  const intrinsic = isCall ? Math.max(S - K * Math.exp(-R * T), 0) : Math.max(K * Math.exp(-R * T) - S, 0);
  if (price < intrinsic + 0.01) return null;
  const upper = isCall ? S : K;
  if (price >= upper) return null;
  let lo = 0.01;
  let hi = 5;
  if (bsPrice(S, K, T, hi, isCall) < price) return null;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (bsPrice(S, K, T, mid, isCall) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

module.exports = { impliedVol, bsPrice };
