'use strict';

/**
 * Prior-day high/low break, follow the 09:45 majority side.
 * Name count is derived from capital (₹2,000 / name, hard cap 8).
 * Live today: same engine, Kite cash, 1 name, 1R lock. Simulated MIS only.
 */
const { summarize } = require('./engine');
const { simulateDesk, dailyBooks } = require('../daily-profit/portfolio');
const { allDays } = require('./discover/split');

const ENGINE_VERSION = '1.3.161-pdh-live';
const NAME_RUPEES = 2000;
const MAX_NAMES = 8;
const LIVE_MAX_NAMES = 1;
const LIVE_TARGET_R = 1;
const FAMILY = 'pdh_break';

function clampCapital(value) {
  return Math.max(1000, Math.min(10_000_000, Number(value) || 10000));
}

function clampLiveCapital(value) {
  const n = Math.floor(Number(value) || 0);
  return Math.max(0, Math.min(10_000_000, n));
}

function namesFromCapital(capital) {
  return Math.min(MAX_NAMES, Math.max(1, Math.floor(clampCapital(capital) / NAME_RUPEES) || 1));
}

function pdhFollowCandidate(capital, opts = {}) {
  const liveLock = !!opts.liveLock;
  const cap = liveLock ? clampLiveCapital(capital) : clampCapital(capital);
  const maxStocksPerDay = liveLock ? LIVE_MAX_NAMES : namesFromCapital(cap);
  const row = {
    family: FAMILY,
    name: liveLock
      ? 'Prior-day break, follow 09:45 crowd, 1R lock'
      : 'Prior-day break, follow 09:45 crowd',
    capital: cap,
    maxStocksPerDay,
    rankBy: 'stopPct',
    crowdFilter: 'follow',
    sizing: 'risk',
    entryEnd: '14:30',
    timeExit: '15:15',
    targetR: liveLock ? LIVE_TARGET_R : null,
    allowOpen: liveLock,
    liveLock,
    entry:
      'After 09:45, a 5-minute bar fully closes beyond the prior session high or low. Only the 09:45 majority side is taken.',
    stopLoss: 'The prior-day level that was broken',
  };
  return {
    ...row,
    id: liveLock ? 'pdh-follow-live-lock' : 'pdh-follow-crowd',
    rules: {
      entry: row.entry,
      cutoff: 'No new entries after 14:30 IST',
      exit: liveLock
        ? 'Stop, 1R take-profit, or 15:15. Open trades mark to the last 5-minute close until then.'
        : 'Stop or 15:15 time exit. No automatic target.',
      stopLoss: row.stopLoss,
      target: liveLock ? '1R lock — exit if the trade makes 1× the stop distance. Not a guaranteed profit.' : 'None',
      stockCount: liveLock
        ? '1 name / day on live Kite cash'
        : `${maxStocksPerDay} name${maxStocksPerDay === 1 ? '' : 's'} / day, auto from capital (₹2,000 each, max 8)`,
      sizing: 'Risk ~0.75% of capital per stop distance, 5× notional cap',
      filters: ['Only the 09:45 majority side.', ...(liveLock ? ['Live today never places a Kite order.'] : [])],
    },
  };
}

function deskConfig(capital, opts = {}) {
  const candidate = pdhFollowCandidate(capital, opts);
  return {
    family: FAMILY,
    preset: candidate.liveLock ? 'pdh-follow-live-lock' : 'pdh-follow',
    capital: candidate.capital,
    maxStocksPerDay: candidate.maxStocksPerDay,
    rankBy: candidate.rankBy,
    crowdFilter: candidate.crowdFilter,
    sizing: candidate.sizing,
    entryEnd: candidate.entryEnd,
    timeExit: candidate.timeExit,
    targetR: candidate.targetR,
    allowOpen: candidate.allowOpen,
    liveLock: candidate.liveLock,
    engineVersion: ENGINE_VERSION,
  };
}

function roundPaise(n) {
  return Math.round(n * 100) / 100;
}

function promisedLock(trades, capital, fundsRs) {
  const list = trades || [];
  const sum = (reason) => list.filter((t) => t.exitReason === reason).reduce((s, t) => s + (t.netRs || 0), 0);
  return {
    targetR: LIVE_TARGET_R,
    fundsRs: fundsRs != null ? fundsRs : capital,
    capitalRs: capital,
    names: LIVE_MAX_NAMES,
    promisedRs: roundPaise(list.reduce((s, t) => s + (t.promisedRs || 0), 0)),
    lockedRs: roundPaise(sum('TARGET')),
    openRs: roundPaise(sum('OPEN')),
    stoppedRs: roundPaise(sum('SL')),
    actualRs: roundPaise(list.reduce((s, t) => s + (t.netRs || 0), 0)),
    riskRs: roundPaise(list.reduce((s, t) => s + (t.riskRs || 0), 0)),
    liveOrders: false,
    guaranteed: false,
  };
}

async function runPdhFollowBook({ symbolBars, capital, liveLock = false, fundsRs = null }) {
  const cfg = deskConfig(capital, { liveLock });
  const candidate = pdhFollowCandidate(cfg.capital, { liveLock });
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
  const promised = liveLock ? promisedLock(sim.trades, cfg.capital, fundsRs) : null;
  return {
    simulated: true,
    liveOrders: false,
    family: FAMILY,
    config: cfg,
    rules: candidate.rules,
    promised,
    assumptions: liveLock
      ? [
          'Same prior-day follow engine as Historical Backtest. No live orders are placed.',
          'Capital is Kite equity cash, not a typed backtest amount.',
          'One name only. Exit at 1R if the trade gets there, else stop or 15:15.',
          'The 1R lock is the take-profit we exit at — not a promised or guaranteed profit.',
          'Open trades mark to the last closed 5-minute candle until 15:15.',
          'Quantity is ~0.75% of that cash in rupee risk, notional capped at 5× cash.',
        ]
      : [
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
    note: liveLock
      ? 'Live today on retrieved Kite 5-minute candles, sized from Kite cash. 1R lock is a take-profit, not a guaranteed return. No live orders.'
      : 'Simulated prior-day break book on retrieved Kite 5-minute candles. Not live trading P&L.',
  };
}

module.exports = {
  ENGINE_VERSION,
  NAME_RUPEES,
  MAX_NAMES,
  LIVE_MAX_NAMES,
  LIVE_TARGET_R,
  clampCapital,
  clampLiveCapital,
  namesFromCapital,
  pdhFollowCandidate,
  deskConfig,
  promisedLock,
  runPdhFollowBook,
};
