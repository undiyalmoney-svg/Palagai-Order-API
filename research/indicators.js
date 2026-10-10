'use strict';

function round(n, dp = 4) {
  if (!Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** EMA seeded with the SMA of the first `period` values. Earlier points are null. */
function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder RSI. */
function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i += 1) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function trueRange(curr, prevClose) {
  if (prevClose == null) return curr.high - curr.low;
  return Math.max(curr.high - curr.low, Math.abs(curr.high - prevClose), Math.abs(curr.low - prevClose));
}

/** Wilder ATR. */
function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period) return out;
  const trs = candles.map((c, i) => trueRange(c, i ? candles[i - 1].close : null));
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += trs[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < candles.length; i += 1) {
    prev = (prev * (period - 1) + trs[i]) / period;
    out[i] = prev;
  }
  return out;
}

function wilderSmooth(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let prev = sum;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = prev - prev / period + values[i];
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder ADX. Returns { adx, plusDi, minusDi } arrays.
 * DX is smoothed with Wilder; the first ADX sits at index (2*period - 1).
 */
function adx(candles, period = 14) {
  const n = candles.length;
  const adxOut = new Array(n).fill(null);
  const plus = new Array(n).fill(null);
  const minus = new Array(n).fill(null);
  if (n <= period) return { adx: adxOut, plusDi: plus, minusDi: minus };
  const tr = [];
  const pdm = [];
  const mdm = [];
  for (let i = 0; i < n; i += 1) {
    const prev = i ? candles[i - 1] : null;
    tr.push(trueRange(candles[i], prev ? prev.close : null));
    if (!prev) {
      pdm.push(0);
      mdm.push(0);
      continue;
    }
    const up = candles[i].high - prev.high;
    const down = prev.low - candles[i].low;
    pdm.push(up > down && up > 0 ? up : 0);
    mdm.push(down > up && down > 0 ? down : 0);
  }
  const trS = wilderSmooth(tr, period);
  const pS = wilderSmooth(pdm, period);
  const mS = wilderSmooth(mdm, period);
  const dx = new Array(n).fill(null);
  for (let i = 0; i < n; i += 1) {
    if (trS[i] == null || trS[i] === 0) continue;
    plus[i] = (100 * pS[i]) / trS[i];
    minus[i] = (100 * mS[i]) / trS[i];
    const den = plus[i] + minus[i];
    dx[i] = den === 0 ? 0 : (100 * Math.abs(plus[i] - minus[i])) / den;
  }
  const dxVals = dx.map((v) => (v == null ? 0 : v));
  // Smooth DX starting once `period` DX values exist (index period-1 onward).
  const start = period - 1;
  if (n > start + period) {
    let sum = 0;
    for (let i = start; i < start + period; i += 1) sum += dxVals[i];
    let prev = sum / period;
    const at = start + period - 1;
    adxOut[at] = prev;
    for (let i = at + 1; i < n; i += 1) {
      prev = (prev * (period - 1) + dxVals[i]) / period;
      adxOut[i] = prev;
    }
  }
  return { adx: adxOut, plusDi: plus, minusDi: minus };
}

/** Session VWAP from typical price. Returns null when volume is missing. */
function vwap(candles) {
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const v = Number(c.volume) || 0;
    if (v <= 0) continue;
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * v;
    vol += v;
  }
  if (vol <= 0) return null;
  return pv / vol;
}

module.exports = { round, ema, rsi, atr, adx, vwap };
