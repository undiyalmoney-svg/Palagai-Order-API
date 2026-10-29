'use strict';

/**
 * Prior-day high/low break, follow the 09:45 majority side.
 * Name count is derived from capital (₹2,000 / name, hard cap 8).
 * Simulated MIS only.
 */
const { summarize } = require('./engine');
const { simulateDesk, dailyBooks } = require('../daily-profit/portfolio');
const { allDays } = require('./discover/split');

const ENGINE_VERSION = '1.3.158-pdh-follow';
const NAME_RUPEES = 2000;
const MAX_NAMES = 8;
const FAMILY = 'pdh_break';

function clampCapital(value) {
  return Math.max(1000, Math.min(10_000_000, Number(value) || 10000));
}

function namesFromCapital(capital) {
  return Math.min(MAX_NAMES, Math.max(1, Math.floor(clampCapital(capital) / NAME_RUPEES) || 1));
}

function pdhFollowCandidate(capital) {
  const cap = clampCapital(capital);
  const maxStocksPerDay = namesFromCapital(cap);
  const row = {
    family: FAMILY,
    name: 'Prior-day break, follow 09:45 crowd',
    capital: cap,
    maxStocksPerDay,
    rankBy: 'stopPct',
    crowdFilter: 'follow',
    sizing: 'risk',
    entryEnd: '14:30',
    timeExit: '15:15',
    targetR: null,
    entry:
      'After 09:45, a 5-minute bar fully closes beyond the prior session high or low. Only the 09:45 majority side is taken.',
    stopLoss: 'The prior-day level that was broken',
  };
  return {
    ...row,
    id: 'pdh-follow-crowd',
    rules: {
      entry: row.entry,
      cutoff: 'No new entries after 14:30 IST',
      exit: 'Stop or 15:15 time exit. No automatic target.',
      stopLoss: row.stopLoss,
      target: 'None',
      stockCount: `${maxStocksPerDay} name${maxStocksPerDay === 1 ? '' : 's'} / day, auto from capital (₹2,000 each, max 8)`,
      sizing: 'Risk ~0.75% of capital per stop distance, 5× notional cap',
      filters: ['Only the 09:45 majority side.'],
    },
  };
}

function deskConfig(capital) {
  const candidate = pdhFollowCandidate(capital);
  return {
    family: FAMILY,
    preset: 'pdh-follow',
    capital: candidate.capital,
    maxStocksPerDay: candidate.maxStocksPerDay,
    rankBy: candidate.rankBy,
    crowdFilter: candidate.crowdFilter,
    sizing: candidate.sizing,
    entryEnd: candidate.entryEnd,
    timeExit: candidate.timeExit,
    targetR: null,
    engineVersion: ENGINE_VERSION,
  };
}

async function runPdhFollowBook({ symbolBars, capital }) {
  const cfg = deskConfig(capital);
  const candidate = pdhFollowCandidate(cfg.capital);
  const sim = await simulateDesk(symbolBars, candidate, cfg.capital);
  const days = allDays(symbolBars);
  const books = dailyBooks(sim.trades, sim.signals, days, cfg.capital);
  const summary = summarize(sim.trades, cfg.capital);
  const taken = new Set((sim.trades || []).map((t) => `${t.day}|${t.symbol}`));
  const crosses = (sim.signals || []).map((s) => ({
    symbol: s.symbol,
    day: s.day,
    side: s.side,
    t: s.signalT,
    close: s.entryPx,
    orh: s.side === 'L' ? s.entryPx : s.stopPx,
    orl: s.side === 'L' ? s.stopPx : s.entryPx,
    orWPct: s.entryPx ? (Math.abs(s.entryPx - s.stopPx) / s.entryPx) * 100 : 0,
    qualified: true,
    taken: taken.has(`${s.day}|${s.symbol}`),
    reason: s.reason,
  }));
  summary.orbCrossed = crosses.length;
  summary.orbCrossedTaken = crosses.filter((c) => c.taken).length;
  return {
    simulated: true,
    liveOrders: false,
    family: FAMILY,
    config: cfg,
    rules: candidate.rules,
    assumptions: [
      'Simulated MIS backtest. No live orders are placed.',
      'After 09:45 IST, a 5-minute candle must fully close above the prior session high (long) or below the prior session low (short).',
      'The book only takes the 09:45 majority side from first-15 full closes. Mixed 09:45 days allow either side.',
      'Names are ranked by widest stop as a percent of price. Name count is auto: 1 per ₹2,000 of starting capital, hard cap 8.',
      'Quantity is ~0.75% of capital in rupee risk, notional capped at 5× capital. Stop is the prior-day level. Leftover exits at 15:15.',
      'History is never invented. Missing Nifty 500 names stay listed in coverage.',
    ],
    rawTrades: (sim.signals || []).length,
    summary,
    trades: sim.trades || [],
    crosses,
    snapshots: summary.snapshots,
    dailyBooks: books,
    lastBook: books.length ? books[books.length - 1] : null,
    note: 'Simulated prior-day break book on retrieved Kite 5-minute candles. Not live trading P&L.',
  };
}

module.exports = {
  ENGINE_VERSION,
  NAME_RUPEES,
  MAX_NAMES,
  clampCapital,
  namesFromCapital,
  pdhFollowCandidate,
  deskConfig,
  runPdhFollowBook,
};
