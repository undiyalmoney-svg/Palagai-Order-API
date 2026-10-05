'use strict';

/**
 * Scan universe: every NSE large-cap and mid-cap (Nifty 100 + Midcap 150).
 *
 * `CORE_UNIVERSE` is the original 50 used by fast synthetic tests. Live and
 * paper scans use the full large+mid list. `basePrice` is only for the
 * simulated provider; Kite resolves real tokens by trading symbol.
 *
 * Small-caps (Nifty Smallcap 250) were papered in
 * `research/compare-smallcap.js` and left off: a ₹10k book only holds 2–3
 * names, and realistic small-cap spreads/vol steal those slots.
 */

const { LARGE_CAP, MID_CAP } = require('./universe-large-mid');

const BENCHMARK = {
  symbol: 'NIFTY50',
  name: 'NIFTY 50',
  sector: 'INDEX',
  kiteKey: 'NSE:NIFTY 50',
  kiteToken: 256265,
  basePrice: 10500,
};

const CORE_UNIVERSE = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'ENERGY', basePrice: 1000 },
  { symbol: 'ONGC', name: 'Oil & Natural Gas Corp', sector: 'ENERGY', basePrice: 150 },
  { symbol: 'COALINDIA', name: 'Coal India', sector: 'ENERGY', basePrice: 200 },
  { symbol: 'NTPC', name: 'NTPC', sector: 'ENERGY', basePrice: 130 },
  { symbol: 'POWERGRID', name: 'Power Grid Corp', sector: 'ENERGY', basePrice: 190 },
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', basePrice: 2000 },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT', basePrice: 700 },
  { symbol: 'HCLTECH', name: 'HCL Technologies', sector: 'IT', basePrice: 550 },
  { symbol: 'WIPRO', name: 'Wipro', sector: 'IT', basePrice: 270 },
  { symbol: 'TECHM', name: 'Tech Mahindra', sector: 'IT', basePrice: 650 },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'BANK', basePrice: 1100 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'BANK', basePrice: 450 },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'BANK', basePrice: 300 },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'BANK', basePrice: 1300 },
  { symbol: 'AXISBANK', name: 'Axis Bank', sector: 'BANK', basePrice: 600 },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank', sector: 'BANK', basePrice: 1200 },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'FINANCE', basePrice: 2500 },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv', sector: 'FINANCE', basePrice: 1000 },
  { symbol: 'HDFCLIFE', name: 'HDFC Life Insurance', sector: 'FINANCE', basePrice: 550 },
  { symbol: 'SBILIFE', name: 'SBI Life Insurance', sector: 'FINANCE', basePrice: 750 },
  { symbol: 'MARUTI', name: 'Maruti Suzuki', sector: 'AUTO', basePrice: 7000 },
  { symbol: 'M&M', name: 'Mahindra & Mahindra', sector: 'AUTO', basePrice: 650 },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', sector: 'AUTO', basePrice: 200 },
  { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto', sector: 'AUTO', basePrice: 2800 },
  { symbol: 'EICHERMOT', name: 'Eicher Motors', sector: 'AUTO', basePrice: 2300 },
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical', sector: 'PHARMA', basePrice: 450 },
  { symbol: 'DRREDDY', name: "Dr. Reddy's Laboratories", sector: 'PHARMA', basePrice: 2600 },
  { symbol: 'CIPLA', name: 'Cipla', sector: 'PHARMA', basePrice: 500 },
  { symbol: 'DIVISLAB', name: "Divi's Laboratories", sector: 'PHARMA', basePrice: 2200 },
  { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals', sector: 'PHARMA', basePrice: 1600 },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'FMCG', basePrice: 1900 },
  { symbol: 'ITC', name: 'ITC', sector: 'FMCG', basePrice: 220 },
  { symbol: 'NESTLEIND', name: 'Nestle India', sector: 'FMCG', basePrice: 1400 },
  { symbol: 'BRITANNIA', name: 'Britannia Industries', sector: 'FMCG', basePrice: 2800 },
  { symbol: 'TATACONSUM', name: 'Tata Consumer Products', sector: 'FMCG', basePrice: 450 },
  { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'METALS', basePrice: 70 },
  { symbol: 'JSWSTEEL', name: 'JSW Steel', sector: 'METALS', basePrice: 350 },
  { symbol: 'HINDALCO', name: 'Hindalco Industries', sector: 'METALS', basePrice: 200 },
  { symbol: 'LT', name: 'Larsen & Toubro', sector: 'INFRA', basePrice: 1200 },
  { symbol: 'ADANIPORTS', name: 'Adani Ports & SEZ', sector: 'INFRA', basePrice: 350 },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement', sector: 'CEMENT', basePrice: 4200 },
  { symbol: 'GRASIM', name: 'Grasim Industries', sector: 'CEMENT', basePrice: 850 },
  { symbol: 'ASIANPAINT', name: 'Asian Paints', sector: 'CONSUMER', basePrice: 1500 },
  { symbol: 'TITAN', name: 'Titan Company', sector: 'CONSUMER', basePrice: 900 },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'TELECOM', basePrice: 450 },
  { symbol: 'LTIM', name: 'LTIMindtree', sector: 'IT', basePrice: 3000, listed: '2022-11-15' },
  { symbol: 'JIOFIN', name: 'Jio Financial Services', sector: 'FINANCE', basePrice: 230, listed: '2023-08-21' },
  { symbol: 'ETERNAL', name: 'Eternal (Zomato)', sector: 'CONSUMER', basePrice: 120, listed: '2021-07-23' },
  { symbol: 'SHRIRAMFIN', name: 'Shriram Finance', sector: 'FINANCE', basePrice: 1200 },
  { symbol: 'TRENT', name: 'Trent', sector: 'CONSUMER', basePrice: 450 },
];

const UNIVERSE = [];
const seen = new Set();
for (const u of [...CORE_UNIVERSE, ...LARGE_CAP, ...MID_CAP]) {
  if (seen.has(u.symbol)) continue;
  seen.add(u.symbol);
  UNIVERSE.push(u);
}

const SECTOR_BY_SYMBOL = new Map(UNIVERSE.map((u) => [u.symbol, u.sector]));
const UNIVERSE_BY_SYMBOL = new Map(UNIVERSE.map((u) => [u.symbol, u]));

function listUniverse() {
  return UNIVERSE.map((u) => ({ symbol: u.symbol, name: u.name, sector: u.sector }));
}

/** Held at Kite for many books. Never a weekly momentum *buy*, but Live must show qty and a sell price. */
const BOOK_ETFS = [
  { symbol: 'NIFTYBEES', name: 'Nifty BeES' },
  { symbol: 'SILVERBEES', name: 'Silver BeES' },
  { symbol: 'GOLDBEES', name: 'Gold BeES' },
];
const BOOK_ETF_BY_SYMBOL = new Map(BOOK_ETFS.map((u) => [u.symbol, u]));

function isBookEtf(symbol) {
  return BOOK_ETF_BY_SYMBOL.has(String(symbol || '').toUpperCase());
}

module.exports = {
  BENCHMARK,
  CORE_UNIVERSE,
  LARGE_CAP,
  MID_CAP,
  UNIVERSE,
  SECTOR_BY_SYMBOL,
  UNIVERSE_BY_SYMBOL,
  BOOK_ETFS,
  BOOK_ETF_BY_SYMBOL,
  isBookEtf,
  listUniverse,
};
