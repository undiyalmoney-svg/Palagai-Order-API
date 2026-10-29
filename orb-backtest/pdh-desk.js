'use strict';

/**
 * Prior-day high/low break, follow the 09:45 majority side.
 * Test and live both take the best 2 names (widest stop %). Capital sizes quantity.
 * Live today: same engine, Kite cash, compulsory 1R take-profit.
 */
const { summarize } = require('./engine');
const { simulateDesk, dailyBooks } = require('../daily-profit/portfolio');
const { allDays } = require('./discover/split');

const ENGINE_VERSION = '1.3.165-pdh-test';
const NAME_RUPEES = 2000;
const MAX_NAMES = 8;
const LIVE_MAX_NAMES = 2;
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
  const maxStocksPerDay = LIVE_MAX_NAMES;
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
    targetR: LIVE_TARGET_R,
    allowOpen: liveLock,
    liveLock,
    matchLiveScan: true,
    entryFill: 'signalClose',
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
        ? 'Stop, compulsory 1R take-profit, or 15:15. Open trades mark to the last 5-minute close until then.'
        : 'Stop, compulsory 1R take-profit, or 15:15 — same exits as live. Fill is the signal print close.',
      stopLoss: row.stopLoss,
      target:
        'Compulsory 1R take-profit — exit if the trade makes 1× the stop distance. Not a guaranteed profit.',
      stockCount: liveLock
        ? '2 names / day on live Kite cash'
        : '2 names / day, filled as prints arrive like live. Capital sizes quantity.',
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
    matchLiveScan: candidate.matchLiveScan,
    entryFill: candidate.entryFill,
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
  const promised = promisedLock(sim.trades, cfg.capital, fundsRs);
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
          'Best two names. Compulsory 1R take-profit if the trade gets there, else stop or 15:15.',
          'The 1R lock is the take-profit we exit at — not a promised or guaranteed profit.',
          'Open trades mark to the last closed 5-minute candle until 15:15.',
          'Quantity is ~0.75% of that cash in rupee risk, notional capped at 5× cash.',
        ]
      : [
          'Simulated MIS backtest. No live orders are placed.',
          'After 09:45 IST, a 5-minute candle must fully close above the prior session high (long) or below the prior session low (short).',
          'The book only takes the 09:45 majority side from first-15 full closes. Mixed 09:45 days allow either side.',
          'Names fill as 5-minute prints arrive, same as live: remaining slots take the widest stop among names that have already qualified. A later name cannot replace an earlier fill.',
          'Fill is the signal candle close (live MARKET). Stop is the prior-day level. Compulsory 1R take-profit, else leftover at 15:15. Not a guaranteed profit.',
          'Quantity is ~0.75% of capital in rupee risk, notional capped at 5× capital.',
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
      ? 'Live today on retrieved Kite 5-minute candles, sized from Kite cash. Best two names. Compulsory 1R take-profit, not a guaranteed return. No live orders.'
      : 'Simulated prior-day break book on retrieved Kite 5-minute candles. Same two-name scan and 1R exit as live. Capital sizes quantity. Not live trading P&L.',
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
