'use strict';

const {
  addDays,
  daysBetween,
  isoWeekKey,
  monthKey,
  isTradingDay,
  lastCompletedTradingDate,
  istDate,
  toIstParts,
  weekday,
} = require('../utils/dates');
const { ServiceError } = require('./momentum-service');

const SCAN_CLOCK = '16:00 IST';
const FILL_CLOCK = '09:15 IST';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function lastTradingDayOfIsoWeek(ymd) {
  const key = isoWeekKey(ymd);
  let start = ymd;
  while (isoWeekKey(addDays(start, -1)) === key) start = addDays(start, -1);
  let last = start;
  let cur = start;
  while (isoWeekKey(cur) === key) {
    if (isTradingDay(cur)) last = cur;
    cur = addDays(cur, 1);
  }
  return last;
}

function lastTradingDayOfMonth(ymd) {
  const mk = monthKey(ymd);
  let d = `${mk}-28`;
  while (monthKey(addDays(d, 1)) === mk) d = addDays(d, 1);
  while (!isTradingDay(d)) d = addDays(d, -1);
  return d;
}

function nextTradingDayOnOrAfter(ymd) {
  let d = ymd;
  while (!isTradingDay(d)) d = addDays(d, 1);
  return d;
}

function pastTodayScan(now) {
  const p = toIstParts(now);
  return p.hour * 60 + p.minute >= 16 * 60;
}

function previousIsoWeek(ymd) {
  const current = isoWeekKey(ymd);
  let d = addDays(ymd, -1);
  while (isoWeekKey(d) === current) d = addDays(d, -1);
  return isoWeekKey(d);
}

function buildSchedule(horizon, now = new Date()) {
  const today = istDate(now);
  const lastBar = lastCompletedTradingDate(now);
  const scanned = pastTodayScan(now) && isTradingDay(today);
  let buyDate;
  if (horizon === 'DAILY') {
    buyDate = scanned ? nextTradingDayOnOrAfter(addDays(today, 1)) : nextTradingDayOnOrAfter(today);
  } else if (horizon === 'MONTHLY') {
    const monthEnd = lastTradingDayOfMonth(today);
    if (today < monthEnd || (today === monthEnd && !scanned)) buyDate = monthEnd;
    else buyDate = lastTradingDayOfMonth(addDays(monthEnd, 1));
  } else {
    const weekEnd = lastTradingDayOfIsoWeek(today);
    if (today < weekEnd || (today === weekEnd && !scanned)) buyDate = weekEnd;
    else buyDate = lastTradingDayOfIsoWeek(addDays(weekEnd, 7));
  }
  const sellDate = scanned ? nextTradingDayOnOrAfter(addDays(today, 1)) : nextTradingDayOnOrAfter(today);
  const buyWhen = `${WEEKDAYS[weekday(buyDate)]} ${buyDate} after ${SCAN_CLOCK}`;
  const sellWhen = `${WEEKDAYS[weekday(sellDate)]} ${sellDate} after ${SCAN_CLOCK}`;
  return {
    horizon,
    scanTime: SCAN_CLOCK,
    fillTime: FILL_CLOCK,
    lastCompletedBar: lastBar,
    today,
    buy: {
      date: buyDate,
      weekday: WEEKDAYS[weekday(buyDate)],
      time: SCAN_CLOCK,
      when: buyWhen,
      instruction:
        horizon === 'DAILY'
          ? `Run the scanner every trading day after ${SCAN_CLOCK}. New buys fill the next morning at ${FILL_CLOCK}.`
          : horizon === 'MONTHLY'
            ? `Run the buy scanner on the last trading day of the month after ${SCAN_CLOCK}. New buys fill the next morning at ${FILL_CLOCK}.`
            : `Run the buy scanner on the last trading day of the week after ${SCAN_CLOCK} (usually Friday). New buys fill the next morning at ${FILL_CLOCK}.`,
    },
    sell: {
      date: sellDate,
      weekday: WEEKDAYS[weekday(sellDate)],
      time: SCAN_CLOCK,
      when: sellWhen,
      instruction: `Run the scanner every trading day after ${SCAN_CLOCK} for sells. If the row says HOLD, do nothing. If it says SELL or EXIT, sell at the next open (${FILL_CLOCK}). A stop can appear any day — do not wait for Friday.`,
    },
    holdRule: 'HOLD means keep the stock. Do not sell until a later scan says SELL or EXIT.',
  };
}

function pairClosedTrades(fills) {
  const lots = new Map();
  const closed = [];
  for (const f of fills || []) {
    if (f.side === 'BUY') {
      const q = lots.get(f.symbol) || [];
      q.push({ date: f.date, price: f.price, qty: f.qty });
      lots.set(f.symbol, q);
    } else {
      const q = lots.get(f.symbol) || [];
      const buy = q.shift();
      closed.push({
        symbol: f.symbol,
        qty: f.qty,
        entryDate: buy?.date || null,
        entryTime: FILL_CLOCK,
        entryPrice: buy?.price ?? null,
        exitDate: f.date,
        exitTime: FILL_CLOCK,
        exitPrice: f.price,
        holdingDays: f.holdingDays,
        pnl: f.pnl,
        pnlPct: f.pnlPct,
        exitReason: f.reason,
        trigger: f.trigger || null,
      });
    }
  }
  return closed;
}

function lastWeekPicks(store, portfolio, asOf) {
  if (!portfolio) return { week: previousIsoWeek(asOf), picks: [] };
  const week = previousIsoWeek(asOf);
  const runs = store.listDecisionRuns(portfolio.id, 80);
  const picks = [];
  const seen = new Set();
  for (const run of runs) {
    if (isoWeekKey(run.asOf) !== week) continue;
    const full = store.getDecisionRunById(run.id);
    for (const d of full?.result?.decisions || []) {
      if (!['BUY', 'STRONG_BUY', 'ADD'].includes(d.action)) continue;
      if (seen.has(d.symbol)) continue;
      seen.add(d.symbol);
      picks.push({
        symbol: d.symbol,
        name: d.name || d.symbol,
        qty: d.quantity,
        priceRef: d.priceRef,
        date: run.asOf,
        action: d.action,
        reason: d.reason,
      });
    }
  }
  return { week, picks };
}

function rowFromDecision(d, signalId) {
  const executable = ['BUY', 'SELL', 'EXIT', 'REDUCE', 'ADD'].includes(d.action);
  return {
    symbol: d.symbol,
    name: d.name || d.symbol,
    sector: d.sector || '',
    action: d.action,
    qty: d.quantity,
    priceRef: d.priceRef,
    allocationValue: d.allocationValue,
    reason: d.reason,
    score: d.score,
    signalId: signalId || null,
    canExecute: executable && !!signalId,
  };
}

function groupActions(decisions, signalByKey) {
  const rows = (decisions || [])
    .filter((d) => ['BUY', 'STRONG_BUY', 'ADD', 'HOLD', 'SELL', 'EXIT', 'REDUCE'].includes(d.action))
    .map((d) => rowFromDecision(d, signalByKey.get(d.decisionKey)));
  return {
    buy: rows.filter((r) => ['BUY', 'STRONG_BUY', 'ADD'].includes(r.action)),
    hold: rows.filter((r) => r.action === 'HOLD'),
    sell: rows.filter((r) => ['SELL', 'EXIT', 'REDUCE'].includes(r.action)),
  };
}

function paperReplay(research, userId, { from, to, capital }) {
  const cap = Number(capital);
  if (!Number.isFinite(cap) || cap < 10_000) throw new ServiceError('BAD_REQUEST', 'Enter capital of at least ₹10,000');
  if (!from || !to) throw new ServiceError('BAD_REQUEST', 'Choose a from date and a to date');
  const bt = research.runBacktest(userId, { capital: cap, from, to, name: `Paper desk ${from} to ${to}` });
  const closed = pairClosedTrades(bt.trades);
  const open = (bt.extra?.openPositions || []).map((p) => ({
    symbol: p.symbol,
    qty: p.qty,
    entryDate: p.entryDate,
    entryTime: FILL_CLOCK,
    entryPrice: p.avgPrice,
    lastPrice: p.lastPrice,
    holdingDays: p.entryDate && bt.extra?.actualTo ? daysBetween(p.entryDate, bt.extra.actualTo) : null,
    pnl: p.unrealizedPnl,
    status: 'HOLDING',
  }));
  const closedPnl = closed.reduce((a, t) => a + (Number(t.pnl) || 0), 0);
  const openPnl = open.reduce((a, t) => a + (Number(t.pnl) || 0), 0);
  return {
    from: bt.extra?.actualFrom || bt.from,
    to: bt.extra?.actualTo || bt.to,
    capital: cap,
    strategy: bt.strategyId,
    fillTime: FILL_CLOCK,
    scanTime: SCAN_CLOCK,
    totalProfit: Math.round((closedPnl + openPnl) * 100) / 100,
    closedProfit: Math.round(closedPnl * 100) / 100,
    openProfit: Math.round(openPnl * 100) / 100,
    metrics: bt.metrics,
    closed,
    open,
  };
}

function deskOverview(momentum, userId, now = new Date()) {
  const cfg = momentum.config(userId);
  const asOf = lastCompletedTradingDate(now);
  const live = momentum.store.getPortfolio(userId, 'LIVE');
  const paper = momentum.store.getPortfolio(userId, 'PAPER');
  const book = live || paper;
  return {
    schedule: buildSchedule(cfg.params.horizon, now),
    strategy: { id: cfg.strategy.id, name: cfg.strategy.name, horizon: cfg.params.horizon },
    lastWeek: lastWeekPicks(momentum.store, book, asOf),
    liveEnabled: !!cfg.settings.live.enabled,
    hasLive: !!live,
    hasPaper: !!paper,
  };
}

function scanDesk(momentum, userId, { capital, reset = false, mode = 'LIVE' } = {}) {
  const cap = Number(capital);
  if (!Number.isFinite(cap) || cap < 10_000) throw new ServiceError('BAD_REQUEST', 'Enter capital of at least ₹10,000');
  const wantLive = String(mode).toUpperCase() === 'LIVE';
  const live = momentum.store.getPortfolio(userId, 'LIVE');
  const useMode = wantLive && live ? 'LIVE' : 'PAPER';
  if (useMode === 'PAPER') {
    const existing = momentum.store.getPortfolio(userId, 'PAPER');
    if (!existing || reset) momentum.initPaper(userId, cap, { reset: !!existing });
    const p = momentum.store.getPortfolio(userId, 'PAPER');
    momentum.store.updatePortfolio(p.id, { autoExecute: false });
  }
  const r = momentum.runDecision({ userId, mode: useMode, kind: 'MANUAL', forceReview: true });
  const signalByKey = new Map((r.signals || []).map((s) => [s.decisionKey, s.id]));
  const grouped = groupActions(r.result.decisions, signalByKey);
  const schedule = buildSchedule(momentum.config(userId).params.horizon);
  const book = momentum.store.getPortfolio(userId, useMode);
  return {
    mode: useMode,
    usedPaperFallback: wantLive && useMode === 'PAPER',
    capital: cap,
    asOf: r.result.asOf,
    runId: r.runId,
    answer: r.result.summary.answer,
    headline: r.result.summary.headline,
    schedule,
    lastWeek: lastWeekPicks(momentum.store, book, r.result.asOf),
    ...grouped,
  };
}

module.exports = {
  SCAN_CLOCK,
  FILL_CLOCK,
  buildSchedule,
  pairClosedTrades,
  lastWeekPicks,
  previousIsoWeek,
  lastTradingDayOfIsoWeek,
  paperReplay,
  deskOverview,
  scanDesk,
};
