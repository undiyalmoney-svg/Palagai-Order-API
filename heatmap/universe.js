'use strict';

/**
 * Public Index Heatmap universe — Nifty 50 cash names the desk already knows.
 * ADANIENT / BEL / HEROMOTOCO replace LTIM / DIVISLAB / TATAMOTORS so the
 * public board matches the live index more closely than CORE_UNIVERSE.
 */

const { CORE_UNIVERSE, BENCHMARK } = require('../momentum/data/universe');

const DROP = new Set(['LTIM', 'DIVISLAB', 'TATAMOTORS']);

const EXTRA = [
  { symbol: 'ADANIENT', name: 'Adani Enterprises', sector: 'INFRA' },
  { symbol: 'BEL', name: 'Bharat Electronics', sector: 'DEFENCE' },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp', sector: 'AUTO' },
];

/** Approximate Nifty 50 weight order (1 = largest). Layout only — not live mcap. */
const MCAP_RANK = {
  HDFCBANK: 1,
  RELIANCE: 2,
  ICICIBANK: 3,
  INFY: 4,
  BHARTIARTL: 5,
  TCS: 6,
  SBIN: 7,
  ITC: 8,
  LT: 9,
  AXISBANK: 10,
  KOTAKBANK: 11,
  BAJFINANCE: 12,
  HINDUNILVR: 13,
  'M&M': 14,
  SUNPHARMA: 15,
  MARUTI: 16,
  HCLTECH: 17,
  NTPC: 18,
  ADANIENT: 19,
  ULTRACEMCO: 20,
  TITAN: 21,
  POWERGRID: 22,
  TATASTEEL: 23,
  ONGC: 24,
  BAJAJFINSV: 25,
  WIPRO: 26,
  ADANIPORTS: 27,
  COALINDIA: 28,
  BEL: 29,
  JSWSTEEL: 30,
  ASIANPAINT: 31,
  NESTLEIND: 32,
  GRASIM: 33,
  TECHM: 34,
  HINDALCO: 35,
  CIPLA: 36,
  SBILIFE: 37,
  DRREDDY: 38,
  EICHERMOT: 39,
  APOLLOHOSP: 40,
  SHRIRAMFIN: 41,
  TRENT: 42,
  TATACONSUM: 43,
  'BAJAJ-AUTO': 44,
  HDFCLIFE: 45,
  INDUSINDBK: 46,
  BRITANNIA: 47,
  JIOFIN: 48,
  ETERNAL: 49,
  HEROMOTOCO: 50,
};

const INDEX = {
  id: 'NIFTY50',
  name: 'NIFTY 50',
  symbol: BENCHMARK.symbol,
  kiteKey: BENCHMARK.kiteKey,
  kiteToken: BENCHMARK.kiteToken,
};

const bySymbol = new Map(CORE_UNIVERSE.map((u) => [u.symbol, u]));

const NIFTY_50 = [
  ...CORE_UNIVERSE.filter((u) => !DROP.has(u.symbol)),
  ...EXTRA,
].map((u, i) => {
  const live = bySymbol.get(u.symbol) || u;
  return {
    symbol: live.symbol,
    name: live.name || u.name,
    sector: live.sector || u.sector || 'OTHER',
    kiteKey: `NSE:${live.symbol}`,
    mcapRank: MCAP_RANK[live.symbol] || 80 + i,
  };
});

NIFTY_50.sort((a, b) => a.mcapRank - b.mcapRank || a.symbol.localeCompare(b.symbol));

const BUCKETS = [
  { id: 'above-3', label: 'above 3%', tone: 'up-strong' },
  { id: '3-to-1', label: '3% to 1%', tone: 'up' },
  { id: '1-to--1', label: '1% to -1%', tone: 'flat' },
  { id: '-1-to--3', label: '-1% to -3%', tone: 'down' },
  { id: 'below--3', label: 'below -3%', tone: 'down-strong' },
];

const TRENDS = [
  { id: 'strong-up', label: 'Strong up' },
  { id: 'up', label: 'Up' },
  { id: 'sideways', label: 'Sideways' },
  { id: 'down', label: 'Down' },
  { id: 'strong-down', label: 'Strong down' },
  { id: 'reading', label: 'Reading' },
];

function listNifty50() {
  return NIFTY_50.map((u) => ({ ...u }));
}

module.exports = {
  INDEX,
  NIFTY_50,
  BUCKETS,
  TRENDS,
  listNifty50,
};
