'use strict';

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function round(x, dp = 2) {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** dp;
  return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f;
}

/** NSE price tick is ₹0.05 for most equities. */
function roundTick(price, tick = 0.05) {
  return Math.round(price / tick) * tick;
}

function roundPrice(price) {
  return round(roundTick(price), 2);
}

function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function stdev(arr, ddof = 1) {
  if (arr.length <= ddof) return 0;
  const m = mean(arr);
  let s = 0;
  for (const v of arr) s += (v - m) * (v - m);
  return Math.sqrt(s / (arr.length - ddof));
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return NaN;
  const idx = clamp(p, 0, 1) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/** Percentile rank (0-100) of `value` within `values` (mid-rank for ties). */
function percentRank(values, value) {
  if (!values.length || !Number.isFinite(value)) return 50;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return ((below + 0.5 * equal) / values.length) * 100;
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i += 1) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va <= 0 || vb <= 0) return 0;
  return cov / Math.sqrt(va * vb);
}

function sum(arr, fn = (x) => x) {
  let s = 0;
  for (const v of arr) s += fn(v);
  return s;
}

function inr(n, dp = 0) {
  if (!Number.isFinite(n)) return '₹—';
  const neg = n < 0;
  const abs = Math.abs(n);
  const fixed = abs.toFixed(dp);
  const [intPart, frac] = fixed.split('.');
  let out;
  if (intPart.length <= 3) out = intPart;
  else {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    out = `${rest},${last3}`;
  }
  return `${neg ? '-' : ''}₹${out}${frac ? `.${frac}` : ''}`;
}

function pct(x, dp = 1) {
  if (!Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(dp)}%`;
}

module.exports = {
  clamp,
  round,
  roundTick,
  roundPrice,
  mean,
  stdev,
  percentile,
  percentRank,
  pearson,
  sum,
  inr,
  pct,
};
