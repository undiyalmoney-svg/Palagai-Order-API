'use strict';

/**
 * Public Index Heatmap universes: Nifty 50, Bank Nifty, Sensex.
 * Quotes come from public Yahoo/Groww feeds (any IP). The owner's Kite
 * session is never used here — that feed stays on the private Charts desk.
 */

const { CORE_UNIVERSE, BENCHMARK } = require('../momentum/data/universe');

const DROP = new Set(['LTIM', 'DIVISLAB', 'TATAMOTORS']);

const EXTRA = [
  { symbol: 'ADANIENT', name: 'Adani Enterprises', sector: 'INFRA' },
  { symbol: 'BEL', name: 'Bharat Electronics', sector: 'DEFENCE' },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp', sector: 'AUTO' },
  { symbol: 'BANKBARODA', name: 'Bank of Baroda', sector: 'BANK' },
  { symbol: 'PNB', name: 'Punjab National Bank', sector: 'BANK' },
  { symbol: 'FEDERALBNK', name: 'Federal Bank', sector: 'BANK' },
  { symbol: 'IDFCFIRSTB', name: 'IDFC First Bank', sector: 'BANK' },
  { symbol: 'AUBANK', name: 'AU Small Finance Bank', sector: 'BANK' },
  { symbol: 'CANBK', name: 'Canara Bank', sector: 'BANK' },
];

/** Approximate weight order (1 = largest). Layout only. */
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
  BANKBARODA: 51,
  PNB: 52,
  CANBK: 53,
  FEDERALBNK: 54,
  IDFCFIRSTB: 55,
  AUBANK: 56,
};

const INDICES = [
  {
    id: 'NIFTY50',
    name: 'NIFTY 50',
    yahoo: '^NSEI',
    growwUrl:
      'https://groww.in/v1/api/stocks_data/v1/accord_points/exchange/NSE/segment/CASH/latest_indices_ohlc/NIFTY',
    kiteKey: BENCHMARK.kiteKey,
    kiteToken: BENCHMARK.kiteToken,
  },
  {
    id: 'BANKNIFTY',
    name: 'NIFTY BANK',
    yahoo: '^NSEBANK',
    growwUrl:
      'https://groww.in/v1/api/stocks_data/v1/accord_points/exchange/NSE/segment/CASH/latest_indices_ohlc/BANKNIFTY',
    kiteKey: 'NSE:NIFTY BANK',
    kiteToken: 260105,
  },
  {
    id: 'SENSEX',
    name: 'SENSEX',
    yahoo: '^BSESN',
    growwUrl:
      'https://groww.in/v1/api/stocks_data/v1/accord_points/exchange/BSE/segment/CASH/latest_indices_ohlc/SENSEX',
    kiteKey: 'BSE:SENSEX',
    kiteToken: 265,
  },
];

const bySymbol = new Map(CORE_UNIVERSE.map((u) => [u.symbol, u]));
for (const u of EXTRA) {
  if (!bySymbol.has(u.symbol)) bySymbol.set(u.symbol, u);
}

function member(symbol, i = 0) {
  const live = bySymbol.get(symbol) || { symbol, name: symbol, sector: 'OTHER' };
  return {
    symbol: live.symbol,
    name: live.name || symbol,
    sector: live.sector || 'OTHER',
    kiteKey: `NSE:${live.symbol}`,
    yahoo: `${live.symbol}.NS`,
    mcapRank: MCAP_RANK[live.symbol] || 80 + i,
  };
}

const NIFTY_50_SYMBOLS = [
  ...CORE_UNIVERSE.filter((u) => !DROP.has(u.symbol)).map((u) => u.symbol),
  'ADANIENT',
  'BEL',
  'HEROMOTOCO',
];

const BANKNIFTY_SYMBOLS = [
  'HDFCBANK',
  'ICICIBANK',
  'SBIN',
  'AXISBANK',
  'KOTAKBANK',
  'INDUSINDBK',
  'BANKBARODA',
  'PNB',
  'CANBK',
  'FEDERALBNK',
  'IDFCFIRSTB',
  'AUBANK',
];

const SENSEX_SYMBOLS = [
  'RELIANCE',
  'HDFCBANK',
  'ICICIBANK',
  'INFY',
  'ITC',
  'TCS',
  'LT',
  'SBIN',
  'BHARTIARTL',
  'AXISBANK',
  'HINDUNILVR',
  'BAJFINANCE',
  'M&M',
  'KOTAKBANK',
  'SUNPHARMA',
  'MARUTI',
  'NTPC',
  'HCLTECH',
  'ULTRACEMCO',
  'TITAN',
  'POWERGRID',
  'TATASTEEL',
  'ADANIPORTS',
  'BAJAJFINSV',
  'ASIANPAINT',
  'NESTLEIND',
  'TECHM',
  'JSWSTEEL',
  'INDUSINDBK',
  'WIPRO',
];

function decorate(symbols) {
  const rows = symbols.map((s, i) => member(s, i));
  rows.sort((a, b) => a.mcapRank - b.mcapRank || a.symbol.localeCompare(b.symbol));
  return rows;
}

const NIFTY_50 = decorate(NIFTY_50_SYMBOLS);
const BANKNIFTY = decorate(BANKNIFTY_SYMBOLS);
const SENSEX = decorate(SENSEX_SYMBOLS);

const MEMBERS = {
  NIFTY50: NIFTY_50,
  BANKNIFTY,
  SENSEX,
};

const INDEX = INDICES[0];

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

function listIndices() {
  return INDICES.map((i) => ({ id: i.id, name: i.name }));
}

function getIndex(id) {
  const want = String(id || 'NIFTY50').toUpperCase().replace(/[\s-]/g, '');
  const aliases = { NIFTY: 'NIFTY50', NIFTYBANK: 'BANKNIFTY', BANKNIFTY: 'BANKNIFTY', SENSEX: 'SENSEX', NIFTY50: 'NIFTY50' };
  const key = aliases[want] || 'NIFTY50';
  return INDICES.find((i) => i.id === key) || INDICES[0];
}

function listMembers(indexId) {
  const idx = getIndex(indexId);
  return (MEMBERS[idx.id] || NIFTY_50).map((u) => ({ ...u }));
}

function listNifty50() {
  return listMembers('NIFTY50');
}

module.exports = {
  INDEX,
  INDICES,
  NIFTY_50,
  BANKNIFTY,
  SENSEX,
  BUCKETS,
  TRENDS,
  listNifty50,
  listMembers,
  listIndices,
  getIndex,
};
