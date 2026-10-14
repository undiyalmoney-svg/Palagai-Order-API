'use strict';

const { listNifty50, INDICES } = require('../heatmap/universe');
const { DEFAULTS } = require('./settings');
const { sessionStatus, formatIst } = require('./engine');

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pctFor(symbol) {
  const n = (hash(symbol) % 701) / 100 - 3.5;
  return Math.round(n * 100) / 100;
}

function biasFromSymbol(symbol) {
  // Deliberately NOT using daily % as the technical trend.
  const cycle = hash(symbol) % 5;
  const map = [
    { bias: 'bullish', label: 'Bullish', confirmed: true, score: 5, strength: 'strong' },
    { bias: 'mild-bull', label: 'Mild bullish bias', confirmed: false, score: 2, strength: 'moderate' },
    { bias: 'sideways', label: 'Sideways', confirmed: false, score: 0, strength: 'weak' },
    { bias: 'mild-bear', label: 'Mild bearish bias', confirmed: false, score: -2, strength: 'moderate' },
    { bias: 'bearish', label: 'Bearish', confirmed: true, score: -5, strength: 'strong' },
  ];
  return map[cycle];
}

function breakoutFor(symbol, iv) {
  const n = hash(symbol + iv) % 7;
  if (n === 0) return { status: 'confirmed', direction: 'bull', interval: iv };
  if (n === 1) return { status: 'potential', direction: 'bear', interval: iv };
  if (n === 2) return { status: 'none', direction: null, interval: iv };
  return { status: 'none', direction: null, interval: iv };
}

function demoSnapshot(now = new Date(), settings = DEFAULTS) {
  const sess = sessionStatus(now);
  const stocks = listNifty50().map((m) => {
    const changePct = pctFor(m.symbol);
    const pack = ['HDFCBANK', 'RELIANCE', 'TCS', 'INFY', 'ICICIBANK'].includes(m.symbol)
      ? { bias: 'bullish', label: 'Bullish', confirmed: true, score: 5, strength: 'strong' }
      : ['INDUSINDBK', 'ADANIENT'].includes(m.symbol)
        ? { bias: 'bearish', label: 'Bearish', confirmed: true, score: -4, strength: 'moderate' }
        : biasFromSymbol(m.symbol);
    const br15 = breakoutFor(m.symbol, '15minute');
    const br60 = breakoutFor(m.symbol, '60minute');
    return {
      symbol: m.symbol,
      name: m.name,
      sector: m.sector,
      ltp: 100 + (hash(m.symbol) % 2400),
      changePct,
      bias: pack.bias,
      biasLabel: pack.label,
      confirmed: pack.confirmed,
      score: pack.score,
      strength: pack.strength,
      m15Trend: pack.bias === 'bearish' || pack.bias === 'mild-bear' ? 'bearish' : pack.bias === 'sideways' ? 'sideways' : 'bullish',
      h1Trend: pack.bias === 'mixed' ? 'mixed' : pack.bias === 'sideways' ? 'sideways' : pack.bias.includes('bear') ? 'bearish' : 'bullish',
      breakout15: br15,
      breakout60: br60,
      breakoutAgree: br15.direction && br15.direction === br60.direction && br15.status !== 'none',
      aboveEma20: changePct >= 0,
      aboveEma50: pack.score >= 0,
    };
  });

  const indices = INDICES.map((idx, i) => {
    const changePct = [-0.42, 0.31, -0.18][i];
    const pack = [
      { bias: 'mild-bear', label: 'Mild bearish bias', score: -2, strength: 'moderate', agreement: 'mixed' },
      { bias: 'mild-bull', label: 'Mild bullish bias', score: 2, strength: 'moderate', agreement: 'mixed' },
      { bias: 'mixed', label: 'Mixed', score: 0, strength: 'weak', agreement: 'mixed' },
    ][i];
    return {
      id: idx.id,
      name: idx.name,
      ltp: [22640, 55120, 74210][i],
      change: [-95.2, 168.4, -132.1][i],
      changePct,
      bias: pack.bias,
      biasLabel: pack.label,
      confirmed: false,
      score: pack.score,
      strength: pack.strength,
      strengthLabel: pack.strength === 'weak' ? 'Weak' : 'Moderate',
      breakout15: { status: 'none', direction: null, interval: '15minute' },
      breakout60: { status: 'none', direction: null, interval: '60minute' },
      agreement: pack.agreement,
      m15Trend: 'mixed',
      h1Trend: 'mixed',
      dayTrend: 'mixed',
    };
  });

  const advances = stocks.filter((s) => s.changePct > 0.05).length;
  const declines = stocks.filter((s) => s.changePct < -0.05).length;
  const unchanged = stocks.length - advances - declines;
  const sorted = [...stocks].sort((a, b) => b.changePct - a.changePct);

  return {
    private: true,
    demo: true,
    needsReauth: false,
    settings,
    session: {
      ...sess,
      istNow: formatIst(now),
      lastUpdateAt: now.toISOString(),
      lastTickAt: null,
      lastConfirmedCandleAt: null,
      connection: 'demo',
      freshness: 'missing',
      timeframe: '15minute',
      message:
        'DEMO MODE — Kite is not connected. Open Get Token, then refresh. These figures are labelled samples, not live prices.',
    },
    indices,
    stocks,
    breadth: {
      advances,
      declines,
      unchanged,
      adRatio: declines === 0 ? (advances > 0 ? null : 0) : Math.round((advances / declines) * 100) / 100,
      adRatioLabel: declines === 0 ? (advances > 0 ? '∞' : 'n/a') : String(Math.round((advances / declines) * 100) / 100),
      pctAboveEma20: Math.round((stocks.filter((s) => s.aboveEma20).length / stocks.length) * 1000) / 10,
      pctAboveEma50: Math.round((stocks.filter((s) => s.aboveEma50).length / stocks.length) * 1000) / 10,
      strongest: sorted.slice(0, 3).map((s) => ({ symbol: s.symbol, changePct: s.changePct })),
      weakest: sorted.slice(-3).reverse().map((s) => ({ symbol: s.symbol, changePct: s.changePct })),
      sectors: [],
      divergence: null,
    },
    setups: [],
    alerts: [
      {
        type: 'stale',
        provisional: true,
        symbol: 'DESK',
        message: 'Demo mode — connect Kite for live alerts.',
      },
    ],
    warning: 'DEMO MODE. Not live market data.',
  };
}

module.exports = { demoSnapshot };
