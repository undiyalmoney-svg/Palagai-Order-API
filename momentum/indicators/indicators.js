'use strict';

/**
 * Indicator Engine — pure, causal functions.
 *
 * Every output[i] depends only on input[0..i], so a value computed on the full
 * series is identical to the value that would have been computed on the series
 * truncated at i. This is what makes the backtester free of look-ahead bias.
 * Invalid / warm-up positions are NaN.
 */

function nanArray(n) {
  const a = new Float64Array(n);
  a.fill(NaN);
  return a;
}

function sma(values, period) {
  const n = values.length;
  const out = nanArray(n);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    const v = values[i];
    if (Number.isNaN(v)) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count += 1;
    if (count > period) sum -= values[i - period];
    if (count >= period) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` valid values. */
function ema(values, period) {
  const n = values.length;
  const out = nanArray(n);
  const k = 2 / (period + 1);
  let prev = NaN;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < n; i += 1) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(prev)) {
      seedSum += v;
      seedCount += 1;
      if (seedCount === period) {
        prev = seedSum / period;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** Wilder's smoothing (RMA). */
function wilder(values, period) {
  const n = values.length;
  const out = nanArray(n);
  let prev = NaN;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < n; i += 1) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(prev)) {
      seedSum += v;
      seedCount += 1;
      if (seedCount === period) {
        prev = seedSum / period;
        out[i] = prev;
      }
    } else {
      prev = (prev * (period - 1) + v) / period;
      out[i] = prev;
    }
  }
  return out;
}

function rsi(close, period = 14) {
  const n = close.length;
  const gains = nanArray(n);
  const losses = nanArray(n);
  for (let i = 1; i < n; i += 1) {
    if (Number.isNaN(close[i]) || Number.isNaN(close[i - 1])) continue;
    const d = close[i] - close[i - 1];
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }
  const ag = wilder(gains, period);
  const al = wilder(losses, period);
  const out = nanArray(n);
  for (let i = 0; i < n; i += 1) {
    if (Number.isNaN(ag[i]) || Number.isNaN(al[i])) continue;
    out[i] = al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]);
  }
  return out;
}

function macd(close, fast = 12, slow = 26, signalPeriod = 9) {
  const f = ema(close, fast);
  const s = ema(close, slow);
  const n = close.length;
  const line = nanArray(n);
  for (let i = 0; i < n; i += 1) {
    if (!Number.isNaN(f[i]) && !Number.isNaN(s[i])) line[i] = f[i] - s[i];
  }
  const signal = ema(line, signalPeriod);
  const hist = nanArray(n);
  for (let i = 0; i < n; i += 1) {
    if (!Number.isNaN(line[i]) && !Number.isNaN(signal[i])) hist[i] = line[i] - signal[i];
  }
  return { line, signal, hist };
}

function trueRange(high, low, close) {
  const n = close.length;
  const out = nanArray(n);
  for (let i = 0; i < n; i += 1) {
    if (Number.isNaN(high[i]) || Number.isNaN(low[i]) || Number.isNaN(close[i])) continue;
    if (i === 0 || Number.isNaN(close[i - 1])) out[i] = high[i] - low[i];
    else {
      out[i] = Math.max(
        high[i] - low[i],
        Math.abs(high[i] - close[i - 1]),
        Math.abs(low[i] - close[i - 1]),
      );
    }
  }
  return out;
}

function atr(high, low, close, period = 14) {
  return wilder(trueRange(high, low, close), period);
}

function adx(high, low, close, period = 14) {
  const n = close.length;
  const plusDm = nanArray(n);
  const minusDm = nanArray(n);
  for (let i = 1; i < n; i += 1) {
    if (Number.isNaN(high[i]) || Number.isNaN(high[i - 1]) || Number.isNaN(low[i]) || Number.isNaN(low[i - 1])) {
      continue;
    }
    const up = high[i] - high[i - 1];
    const down = low[i - 1] - low[i];
    plusDm[i] = up > down && up > 0 ? up : 0;
    minusDm[i] = down > up && down > 0 ? down : 0;
  }
  const tr = trueRange(high, low, close);
  const trS = wilder(tr, period);
  const pS = wilder(plusDm, period);
  const mS = wilder(minusDm, period);
  const pdi = nanArray(n);
  const mdi = nanArray(n);
  const dx = nanArray(n);
  for (let i = 0; i < n; i += 1) {
    if (Number.isNaN(trS[i]) || trS[i] === 0 || Number.isNaN(pS[i]) || Number.isNaN(mS[i])) continue;
    pdi[i] = (100 * pS[i]) / trS[i];
    mdi[i] = (100 * mS[i]) / trS[i];
    const denom = pdi[i] + mdi[i];
    dx[i] = denom === 0 ? 0 : (100 * Math.abs(pdi[i] - mdi[i])) / denom;
  }
  return { adx: wilder(dx, period), pdi, mdi };
}

/** Rolling max/min over `period` bars *ending at i - offset* (offset 1 = excludes today). */
function rollingMax(values, period, offset = 0) {
  const n = values.length;
  const out = nanArray(n);
  for (let i = 0; i < n; i += 1) {
    const end = i - offset;
    const start = end - period + 1;
    if (start < 0) continue;
    let m = -Infinity;
    let ok = true;
    for (let j = start; j <= end; j += 1) {
      if (Number.isNaN(values[j])) {
        ok = false;
        break;
      }
      if (values[j] > m) m = values[j];
    }
    if (ok) out[i] = m;
  }
  return out;
}

function rollingMin(values, period, offset = 0) {
  const n = values.length;
  const out = nanArray(n);
  for (let i = 0; i < n; i += 1) {
    const end = i - offset;
    const start = end - period + 1;
    if (start < 0) continue;
    let m = Infinity;
    let ok = true;
    for (let j = start; j <= end; j += 1) {
      if (Number.isNaN(values[j])) {
        ok = false;
        break;
      }
      if (values[j] < m) m = values[j];
    }
    if (ok) out[i] = m;
  }
  return out;
}

/** Simple return over `lag` bars. */
function pctChange(values, lag) {
  const n = values.length;
  const out = nanArray(n);
  for (let i = lag; i < n; i += 1) {
    const prev = values[i - lag];
    const cur = values[i];
    if (Number.isNaN(prev) || Number.isNaN(cur) || prev === 0) continue;
    out[i] = cur / prev - 1;
  }
  return out;
}

/** Annualised historical volatility from daily log returns. */
function histVol(close, period = 20) {
  const n = close.length;
  const lr = nanArray(n);
  for (let i = 1; i < n; i += 1) {
    if (Number.isNaN(close[i]) || Number.isNaN(close[i - 1]) || close[i - 1] <= 0) continue;
    lr[i] = Math.log(close[i] / close[i - 1]);
  }
  const out = nanArray(n);
  for (let i = period; i < n; i += 1) {
    let s = 0;
    let s2 = 0;
    let ok = true;
    for (let j = i - period + 1; j <= i; j += 1) {
      const v = lr[j];
      if (Number.isNaN(v)) {
        ok = false;
        break;
      }
      s += v;
      s2 += v * v;
    }
    if (!ok) continue;
    const mean = s / period;
    const variance = Math.max(0, (s2 - period * mean * mean) / (period - 1));
    out[i] = Math.sqrt(variance) * Math.sqrt(252);
  }
  return out;
}

/**
 * Ratio of volume on up-days to volume on down-days over `period` bars —
 * a simple accumulation/distribution gauge.
 */
function upDownVolume(close, volume, period = 20) {
  const n = close.length;
  const out = nanArray(n);
  for (let i = period; i < n; i += 1) {
    let up = 0;
    let down = 0;
    let ok = true;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (Number.isNaN(close[j]) || Number.isNaN(close[j - 1]) || Number.isNaN(volume[j])) {
        ok = false;
        break;
      }
      if (close[j] > close[j - 1]) up += volume[j];
      else if (close[j] < close[j - 1]) down += volume[j];
    }
    if (!ok) continue;
    out[i] = down === 0 ? (up > 0 ? 3 : 1) : Math.min(3, up / down);
  }
  return out;
}

/** Indicators that do not depend on strategy parameters (computed once per symbol). */
function computeBase({ open, high, low, close, volume }) {
  const n = close.length;
  const volAvg20 = sma(volume, 20);
  const dmi = adx(high, low, close, 14);
  const m = macd(close);
  const volAvg20Prior = nanArray(n);
  for (let i = 1; i < n; i += 1) volAvg20Prior[i] = volAvg20[i - 1];
  const value = nanArray(n);
  for (let i = 0; i < n; i += 1) value[i] = close[i] * volume[i];
  const ret231 = nanArray(n);
  for (let i = 252; i < n; i += 1) {
    const a = close[i - 252];
    const b = close[i - 21];
    if (!Number.isNaN(a) && !Number.isNaN(b) && a > 0) ret231[i] = b / a - 1;
  }
  return {
    open,
    high,
    low,
    close,
    volume,
    rsi: rsi(close, 14),
    macdLine: m.line,
    macdSignal: m.signal,
    macdHist: m.hist,
    atr: atr(high, low, close, 14),
    adx: dmi.adx,
    pdi: dmi.pdi,
    mdi: dmi.mdi,
    hv20: histVol(close, 20),
    volAvg20,
    volAvg20Prior,
    volAvg50: sma(volume, 50),
    volAvg5: sma(volume, 5),
    tradedValue20: sma(value, 20),
    upDownVol20: upDownVolume(close, volume, 20),
    swingLow10: rollingMin(low, 10, 0),
    high55: rollingMax(high, 55, 1),
    high252: rollingMax(high, 252, 0),
    low252: rollingMin(low, 252, 0),
    ret1: pctChange(close, 1),
    ret5: pctChange(close, 5),
    ret21: pctChange(close, 21),
    ret63: pctChange(close, 63),
    ret126: pctChange(close, 126),
    ret252: pctChange(close, 252),
    ret231,
  };
}

/** Indicators that depend on tunable parameters: EMA periods and Donchian lookback. */
function computeParamDependent({ high, low, close }, { emaPeriods, breakoutLookback }) {
  const [pFast, pMid, pSlow, pLong] = emaPeriods;
  return {
    emaFast: ema(close, pFast),
    emaMid: ema(close, pMid),
    emaSlow: ema(close, pSlow),
    emaLong: ema(close, pLong),
    donchHigh: rollingMax(high, breakoutLookback, 1),
    donchLow: rollingMin(low, breakoutLookback, 1),
  };
}

module.exports = {
  nanArray,
  sma,
  ema,
  wilder,
  rsi,
  macd,
  trueRange,
  atr,
  adx,
  rollingMax,
  rollingMin,
  pctChange,
  histVol,
  upDownVolume,
  computeBase,
  computeParamDependent,
};
