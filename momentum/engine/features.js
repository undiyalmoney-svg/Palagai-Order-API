'use strict';

const { indicatorKey } = require('../config/defaults');

/**
 * Feature extraction at a single bar index. Reads indicator arrays at <= i only.
 */

function num(v) {
  return Number.isNaN(v) ? NaN : v;
}

function computeFeatures(ind, i, bench, params) {
  const close = ind.close[i];
  const atrV = ind.atr[i];
  const emaFast = ind.emaFast[i];
  const emaMid = ind.emaMid[i];
  const emaSlow = ind.emaSlow[i];
  const emaLong = ind.emaLong[i];

  let closesBelowMid = 0;
  for (let k = 0; k < 6 && i - k >= 0; k += 1) {
    if (ind.close[i - k] < ind.emaMid[i - k]) closesBelowMid += 1;
    else break;
  }

  let breakoutAge = null;
  for (let k = 0; k <= (params.breakoutFreshBars || 3) && i - k >= 0; k += 1) {
    if (ind.close[i - k] > ind.donchHigh[i - k]) {
      breakoutAge = k;
      break;
    }
  }

  const breakoutRelVol =
    breakoutAge === null ? NaN : ind.volume[i - breakoutAge] / ind.volAvg20Prior[i - breakoutAge];
  const breakoutLevel = breakoutAge === null ? NaN : ind.donchHigh[i - breakoutAge];

  const midPrev = i >= 10 ? ind.emaMid[i - 10] : NaN;
  const stackPairs = [emaFast > emaMid, emaMid > emaSlow, emaSlow > emaLong];
  const benchRet = {
    m1: bench ? bench.ret21[i] : NaN,
    m3: bench ? bench.ret63[i] : NaN,
    m6: bench ? bench.ret126[i] : NaN,
  };
  const ret = {
    d1: num(ind.ret1[i]),
    w1: num(ind.ret5[i]),
    m1: num(ind.ret21[i]),
    m3: num(ind.ret63[i]),
    m6: num(ind.ret126[i]),
    m12: num(ind.ret252[i]),
    m12x1: num(ind.ret231[i]),
  };

  const f = {
    idx: i,
    price: close,
    open: ind.open[i],
    high: ind.high[i],
    low: ind.low[i],
    prevClose: i > 0 ? ind.close[i - 1] : NaN,
    volume: ind.volume[i],
    ret,
    ema: { fast: emaFast, mid: emaMid, slow: emaSlow, long: emaLong },
    trend: {
      aboveFast: close > emaFast,
      aboveMid: close > emaMid,
      aboveSlow: close > emaSlow,
      aboveLong: close > emaLong,
      stack: stackPairs.every(Boolean),
      stackCount: stackPairs.filter(Boolean).length,
      midSlope10: midPrev > 0 ? emaMid / midPrev - 1 : NaN,
      closesBelowMid,
    },
    rs: {
      vsIndex1m: ret.m1 - benchRet.m1,
      vsIndex3m: ret.m3 - benchRet.m3,
      vsIndex6m: ret.m6 - benchRet.m6,
    },
    flow: {
      rel: ind.volume[i] / ind.volAvg20Prior[i],
      expansion: ind.volAvg5[i] / ind.volAvg50[i],
      upDown: ind.upDownVol20[i],
      avg20: ind.volAvg20[i],
    },
    vol: {
      atr: atrV,
      atrPct: atrV / close,
      hv20: ind.hv20[i],
    },
    tech: {
      rsi: ind.rsi[i],
      macdLine: ind.macdLine[i],
      macdSignal: ind.macdSignal[i],
      macdHist: ind.macdHist[i],
      macdHistPrev: i > 0 ? ind.macdHist[i - 1] : NaN,
      adx: ind.adx[i],
      pdi: ind.pdi[i],
      mdi: ind.mdi[i],
      donchHigh: ind.donchHigh[i],
      donchLow: ind.donchLow[i],
      breakout: close > ind.donchHigh[i],
      breakoutAge,
      breakoutRelVol,
      breakoutLevel,
      high55: ind.high55[i],
      high52w: ind.high252[i],
      low52w: ind.low252[i],
      pctFromHigh52: close / ind.high252[i] - 1,
      extensionAtr: (close - emaFast) / atrV,
      swingLow10: ind.swingLow10[i],
    },
    liq: {
      advValue: ind.tradedValue20[i],
      avgVol20: ind.volAvg20[i],
    },
  };
  f.valid = [close, atrV, emaLong, emaSlow, ind.ret63[i], ind.rsi[i], ind.volAvg20Prior[i], ind.adx[i]].every(
    (v) => Number.isFinite(v),
  );
  return f;
}

/** Compact, JSON-safe view of the numbers that drove a decision. */
function featureSnapshot(f) {
  if (!f) return null;
  const r = (v, dp = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** dp) / 10 ** dp : null);
  return {
    price: r(f.price),
    ret: Object.fromEntries(Object.entries(f.ret).map(([k, v]) => [k, r(v, 4)])),
    ema: Object.fromEntries(Object.entries(f.ema).map(([k, v]) => [k, r(v)])),
    trend: {
      stack: f.trend.stack,
      aboveMid: f.trend.aboveMid,
      aboveLong: f.trend.aboveLong,
      midSlope10: r(f.trend.midSlope10, 4),
    },
    rs: Object.fromEntries(Object.entries(f.rs).map(([k, v]) => [k, r(v, 4)])),
    relVolume: r(f.flow.rel),
    atr: r(f.vol.atr),
    atrPct: r(f.vol.atrPct, 4),
    hv20: r(f.vol.hv20, 3),
    rsi: r(f.tech.rsi, 1),
    macdHist: r(f.tech.macdHist, 3),
    adx: r(f.tech.adx, 1),
    breakout: f.tech.breakout,
    donchHigh: r(f.tech.donchHigh),
    high52w: r(f.tech.high52w),
    pctFromHigh52: r(f.tech.pctFromHigh52, 4),
    extensionAtr: r(f.tech.extensionAtr, 2),
    advValueCr: r(f.liq.advValue / 1e7, 1),
  };
}

module.exports = { computeFeatures, featureSnapshot, indicatorKey };
