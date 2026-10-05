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
const { suggestedLimitPrice } = require('../execution/limit-price');
const { inr } = require('../utils/math');
const { isBookEtf, BOOK_ETF_BY_SYMBOL } = require('../data/universe');

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
        suggestedLimit: suggestedLimitPrice({ side: 'BUY', price: d.priceRef, priceRef: d.priceRef }),
        date: run.asOf,
        action: d.action,
        reason: d.reason,
      });
    }
  }
  return { week, picks };
}

function fillHint(side, limit, fillTime, { qty, symbol } = {}) {
  if (limit == null) return null;
  const px = inr(limit, 2);
  const units = Number(qty) > 0 && symbol ? `${qty} of ${symbol} ` : '';
  if (side === 'BUY') {
    return `Rest a LIMIT buy ${units}at ${px} for the next ${fillTime} open (AMO after ${SCAN_CLOCK}). Do not pay more than 4% above last close.`;
  }
  if (side === 'SELL') {
    return `Rest a LIMIT sell ${units}at ${px} for the next ${fillTime} open.`;
  }
  return null;
}

function sellLimitFor(lastPrice, priceRef, maxDeviationPct) {
  return suggestedLimitPrice({
    side: 'SELL',
    price: lastPrice || priceRef,
    priceRef: priceRef || lastPrice,
    maxDeviationPct,
  });
}

function rowFromDecision(d, signalId, extra = {}) {
  const executable = ['BUY', 'SELL', 'EXIT', 'REDUCE', 'ADD'].includes(d.action);
  const buy = ['BUY', 'STRONG_BUY', 'ADD'].includes(d.action);
  const sell = ['SELL', 'EXIT', 'REDUCE'].includes(d.action);
  const pos = extra.position || null;
  const lastPrice = extra.lastPrice ?? d.priceRef;
  const qty = Number(d.action === 'HOLD' ? (pos?.qty ?? d.quantity) : d.quantity) || 0;
  const suggestedBuy = buy
    ? suggestedLimitPrice({
        side: 'BUY',
        price: d.priceRef || lastPrice,
        priceRef: d.priceRef,
        maxDeviationPct: extra.maxDeviationPct,
      })
    : null;
  const suggestedSell = buy ? null : sellLimitFor(lastPrice, d.priceRef, extra.maxDeviationPct);
  const suggestedLimit = buy ? suggestedBuy : suggestedSell;
  const hintSide = buy ? 'BUY' : 'SELL';
  return {
    symbol: d.symbol,
    name: d.name || d.symbol,
    sector: d.sector || '',
    action: d.action,
    qty,
    priceRef: d.priceRef,
    lastPrice: lastPrice ?? null,
    avgPrice: pos?.avgPrice ?? null,
    stopPrice: d.risk?.stopPrice ?? null,
    suggestedLimit,
    suggestedBuy,
    suggestedSell,
    fillHint: fillHint(hintSide, suggestedLimit, extra.fillTime || FILL_CLOCK, { qty, symbol: d.symbol }),
    whyThisPrice: d.explanation?.whyThisPrice || null,
    allocationValue: d.allocationValue,
    reason: d.reason,
    score: d.score,
    signalId: signalId || null,
    canExecute: executable && !!signalId,
  };
}

function groupActions(decisions, signalByKey, extra = {}) {
  const posBySymbol = extra.posBySymbol || new Map();
  const lastOf = extra.lastOf || (() => null);
  const rows = (decisions || [])
    .filter((d) => ['BUY', 'STRONG_BUY', 'ADD', 'HOLD', 'SELL', 'EXIT', 'REDUCE'].includes(d.action))
    .map((d) =>
      rowFromDecision(d, signalByKey.get(d.decisionKey), {
        position: posBySymbol.get(d.symbol) || null,
        lastPrice: lastOf(d.symbol) ?? d.priceRef,
        maxDeviationPct: extra.maxDeviationPct,
        fillTime: extra.fillTime,
      }),
    );
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

async function syncHoldingsForLiveScan(momentum, userId, live) {
  if (!live) {
    return {
      ok: false,
      error: 'Live book is not enabled, so this scan cannot read your CNC holdings. Connect Token and enable live trading.',
      imported: [],
      updated: [],
      removed: [],
      skipped: [],
    };
  }
  if (!momentum.sessions.authorization(userId)) {
    return {
      ok: false,
      error: 'No Kite session — Hold/Sell uses the last saved book, not a fresh CNC snapshot. Update the token and run again.',
      imported: [],
      updated: [],
      removed: [],
      skipped: [],
    };
  }
  try {
    const imported = await momentum.importLiveHoldings(userId);
    return {
      ok: true,
      error: null,
      imported: imported.imported,
      updated: imported.updated,
      removed: imported.removed,
      skipped: imported.skipped,
      cash: imported.cash,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Could not read Kite holdings',
      imported: [],
      updated: [],
      removed: [],
      skipped: [],
    };
  }
}

function alsoHeldRows(skipped, extra = {}) {
  return (skipped || [])
    .filter((s) => !isBookEtf(s.symbol))
    .map((s) => {
      const last = s.lastPrice || s.avgPrice || null;
      const qty = Number(s.qty) || 0;
      const suggestedSell = sellLimitFor(last, last, extra.maxDeviationPct);
      return {
        symbol: s.symbol,
        name: s.symbol,
        qty,
        avgPrice: s.avgPrice ?? null,
        lastPrice: last,
        suggestedSell,
        suggestedLimit: suggestedSell,
        fillHint: fillHint('SELL', suggestedSell, extra.fillTime || FILL_CLOCK, { qty, symbol: s.symbol }),
        reason: s.reason,
        suggestion: 'REVIEW',
        note: 'Held at Kite but not in the large/mid scanner. Keep or sell yourself — the weekly book will not auto-replace this name.',
      };
    });
}

function bookEtfHoldRows(skipped, extra = {}) {
  const seen = new Set();
  const rows = [];
  for (const s of skipped || []) {
    const symbol = String(s.symbol || '').toUpperCase();
    if (!isBookEtf(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    const meta = BOOK_ETF_BY_SYMBOL.get(symbol);
    const last = s.lastPrice || s.avgPrice || null;
    const qty = Number(s.qty) || 0;
    const suggestedSell = sellLimitFor(last, last, extra.maxDeviationPct);
    rows.push({
      symbol,
      name: meta?.name || symbol,
      sector: 'ETF',
      action: 'HOLD',
      qty,
      priceRef: last,
      lastPrice: last,
      avgPrice: s.avgPrice ?? null,
      stopPrice: null,
      suggestedLimit: suggestedSell,
      suggestedBuy: null,
      suggestedSell,
      fillHint: fillHint('SELL', suggestedSell, extra.fillTime || FILL_CLOCK, { qty, symbol }),
      whyThisPrice: null,
      allocationValue: last && qty ? last * qty : 0,
      reason: `${meta?.name || symbol} is in your Kite book (qty ${qty}). Not a weekly momentum pick — keep unless you want the cash.`,
      score: null,
      signalId: null,
      canExecute: false,
    });
  }
  return rows;
}

async function scanDesk(momentum, userId, { capital, reset = false, mode = 'LIVE' } = {}) {
  const cap = Number(capital);
  if (!Number.isFinite(cap) || cap < 10_000) throw new ServiceError('BAD_REQUEST', 'Enter capital of at least ₹10,000');
  const wantLive = String(mode).toUpperCase() === 'LIVE';
  const live = momentum.store.getPortfolio(userId, 'LIVE');
  const useMode = wantLive && live ? 'LIVE' : 'PAPER';
  let holdingsSync = null;
  if (wantLive) holdingsSync = await syncHoldingsForLiveScan(momentum, userId, live);
  if (useMode === 'PAPER') {
    const existing = momentum.store.getPortfolio(userId, 'PAPER');
    if (!existing || reset) momentum.initPaper(userId, cap, { reset: !!existing });
    const p = momentum.store.getPortfolio(userId, 'PAPER');
    momentum.store.updatePortfolio(p.id, { autoExecute: false });
  }
  const r = momentum.runDecision({ userId, mode: useMode, kind: 'MANUAL', forceReview: true });
  const signalByKey = new Map((r.signals || []).map((s) => [s.decisionKey, s.id]));
  const cfg = momentum.config(userId);
  const book = momentum.store.getPortfolio(userId, useMode);
  const posBySymbol = new Map((book ? momentum.store.listPositions(book.id) : []).map((p) => [p.symbol, p]));
  const lastOf = (symbol) => momentum.marketData.priceFor(symbol)?.price ?? null;
  const grouped = groupActions(r.result.decisions, signalByKey, {
    posBySymbol,
    lastOf,
    maxDeviationPct: cfg.params.maxPriceDeviationPct ?? 0.04,
    fillTime: FILL_CLOCK,
  });
  const schedule = buildSchedule(cfg.params.horizon);
  const rowExtra = { maxDeviationPct: cfg.params.maxPriceDeviationPct ?? 0.04, fillTime: FILL_CLOCK };
  const etfHolds = bookEtfHoldRows(holdingsSync?.skipped, rowExtra);
  const holdSymbols = new Set(grouped.hold.map((h) => h.symbol));
  for (const row of etfHolds) {
    if (!holdSymbols.has(row.symbol)) grouped.hold.push(row);
  }
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
    holdingsSync,
    alsoHeld: alsoHeldRows(holdingsSync?.skipped, rowExtra),
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
  rowFromDecision,
  bookEtfHoldRows,
  suggestedLimitPrice,
};
