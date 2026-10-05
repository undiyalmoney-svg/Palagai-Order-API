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
            : `After ${SCAN_CLOCK} on the last trading day of the week (usually Friday). Rest LIMIT orders. They fill next morning at ${FILL_CLOCK}.`,
    },
    sell: {
      date: sellDate,
      weekday: WEEKDAYS[weekday(sellDate)],
      time: SCAN_CLOCK,
      when: sellWhen,
      instruction: `Check sells every trading day after ${SCAN_CLOCK}. HOLD means do nothing. SELL means rest a LIMIT for the next ${FILL_CLOCK} open.`,
    },
    holdRule: 'HOLD means keep the stock. Dual Momentum does not sell just because a week passed.',
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
        qty: Number(d.quantity) || 0,
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
  const units = Number(qty) > 0 && symbol ? `${qty} ${symbol} ` : '';
  if (side === 'BUY') return `Buy ${units}at ${px} LIMIT for the next ${fillTime} open.`;
  if (side === 'SELL') return `Sell ${units}at ${px} LIMIT for the next ${fillTime} open.`;
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

function defaultPaperRange(panel, from, to) {
  const last = panel.dates[panel.lastIndex] || to;
  const hist = Math.min(panel.lastIndex, 260);
  const first = panel.dates[hist] || from;
  let end = last;
  if (to) {
    const idx = panel.indexOnOrBefore(to);
    if (idx >= 0) end = panel.dates[idx];
  }
  let start;
  if (from) {
    const idx = panel.indexOnOrBefore(from);
    start = idx >= 0 ? panel.dates[idx] : first;
  } else {
    const idx = panel.indexOnOrBefore(addDays(end, -370));
    start = idx >= 0 ? panel.dates[Math.max(idx, hist)] : first;
  }
  if (start && end && daysBetween(start, end) < 90) {
    const idx = panel.indexOnOrBefore(addDays(end, -180));
    if (idx >= 0) start = panel.dates[Math.max(idx, hist)];
  }
  if (!start || start >= end) start = first;
  return { from: start, to: end, auto: !from || !to };
}

function signedInr(n) {
  const v = Number(n) || 0;
  const abs = inr(Math.abs(v));
  if (v > 0) return `+${abs}`;
  if (v < 0) return `−${abs}`;
  return abs;
}

function paperSummary({ capital, closed, open, metrics, from, to }) {
  const m = metrics || {};
  const wins = (closed || []).filter((t) => Number(t.pnl) > 0).length;
  const losses = (closed || []).filter((t) => Number(t.pnl) <= 0).length;
  const retPct = Number(m.totalReturnPct);
  const dd = Number(m.maxDrawdownPct);
  const winRate = Number(m.winRatePct);
  const profit = Number(m.totalPnl ?? 0);
  const headline =
    Number.isFinite(retPct) && retPct >= 0
      ? `Paper made ${signedInr(profit)} (${retPct.toFixed(1)}%) from ${from} to ${to}.`
      : `Paper P&L ${signedInr(profit)} from ${from} to ${to}.`;
  const bullets = [
    `${wins} winning closed trade(s), ${losses} losing.`,
    Number.isFinite(winRate) ? `Win rate ${winRate.toFixed(0)}%.` : null,
    Number.isFinite(dd) ? `Worst drop ${dd.toFixed(1)}%.` : null,
    `${(open || []).length} still held at the end.`,
    'Dual Momentum sits in cash when Nifty’s own trend is broken, so a bear stretch is not a forced buy list.',
    capital < 25_000
      ? 'A book this small pays the same DP/STT as a larger one. Dual Momentum’s edge is clearer from about ₹25,000. This week’s tickets still work.'
      : null,
  ].filter(Boolean);
  return {
    headline,
    bullets,
    honestNote:
      'This is a 4–16 week hold, not a one-week scalp. One week of P&L is noise. Use this 12-month paper as the proof; this week’s cards are the live work.',
    started: capital,
    ended: Number.isFinite(Number(m.endCapital)) ? Number(m.endCapital) : null,
    returnPct: Number.isFinite(retPct) ? retPct : null,
    winRatePct: Number.isFinite(winRate) ? winRate : null,
    maxDrawdownPct: Number.isFinite(dd) ? dd : null,
  };
}

function nextActionLine(schedule, scan) {
  const buys = scan?.buy?.length || 0;
  const sells = scan?.sell?.length || 0;
  if (sells && buys) return `Sell ${sells} name(s) and buy ${buys} name(s). Rest LIMITs after ${SCAN_CLOCK} for the ${FILL_CLOCK} open.`;
  if (sells) return `Sell ${sells} name(s). Rest LIMITs after ${SCAN_CLOCK} for the ${FILL_CLOCK} open.`;
  if (buys) return `Buy ${buys} name(s). Rest LIMITs after ${schedule?.buy?.when || SCAN_CLOCK} for the ${FILL_CLOCK} open.`;
  if (scan?.hold?.length) return 'Hold. Do nothing until a later scan says Sell.';
  return `Next buy scan: ${schedule?.buy?.when || 'Friday after 16:00 IST'}.`;
}

function liveGuide({ tokenReady, fundsReady, cash }) {
  return [
    {
      step: 1,
      title: 'Get Token',
      body: 'Open Get Token once each morning. That is the only login Palagai needs.',
      href: '/dashboard/get-token',
      done: !!tokenReady,
    },
    {
      step: 2,
      title: 'We read your cash',
      body: tokenReady
        ? fundsReady
          ? `Kite equity cash ${inr(cash, 0)}. Palagai sizes 2–5 Dual Momentum names from this. You do not type capital.`
          : 'Token is in. Update it if funds did not load, then open Live again.'
        : 'After the token, Palagai reads Kite equity cash and sizes the book for you.',
      done: !!tokenReady && !!fundsReady,
    },
    {
      step: 3,
      title: 'Follow this week’s tickets',
      body: 'Buy, Hold or Sell — one card each. Rest the LIMIT after 16:00 IST for the next 09:15 IST open.',
      done: !!tokenReady && !!fundsReady,
    },
  ];
}

function thisWeekFromEngine(momentum, userId, capital, extra = {}) {
  const cap = Number(capital);
  if (!Number.isFinite(cap) || cap < 0) return null;
  const { result } = momentum.decideNow({ userId, capital: Math.max(cap, 10_000), forceReview: true });
  const grouped = groupActions(result.decisions, new Map(), extra);
  return {
    asOf: result.asOf,
    headline: result.summary?.headline || '',
    answer: result.summary?.answer || '',
    regime: result.regime?.regime || null,
    ...grouped,
  };
}

function paperReplay(research, momentum, userId, { from, to, capital } = {}) {
  const cap = Number(capital);
  if (!Number.isFinite(cap) || cap < 10_000) throw new ServiceError('BAD_REQUEST', 'Enter capital of at least ₹10,000');
  const panel = research.marketData.loadPanel();
  const range = defaultPaperRange(panel, from, to);
  const bt = research.runBacktest(userId, {
    capital: cap,
    from: range.from,
    to: range.to,
    name: `Paper desk ${range.from} to ${range.to}`,
  });
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
  const fromDate = bt.extra?.actualFrom || bt.from;
  const toDate = bt.extra?.actualTo || bt.to;
  const totalProfit = Math.round((closedPnl + openPnl) * 100) / 100;
  const cfg = momentum.config(userId);
  const lastOf = (symbol) => momentum.marketData.priceFor(symbol)?.price ?? null;
  const rowExtra = { maxDeviationPct: cfg.params.maxPriceDeviationPct ?? 0.04, fillTime: FILL_CLOCK, lastOf };
  const thisWeek = thisWeekFromEngine(momentum, userId, cap, rowExtra);
  const summary = paperSummary({
    capital: cap,
    closed,
    open,
    metrics: { ...bt.metrics, totalPnl: totalProfit, endCapital: bt.metrics?.endCapital },
    from: fromDate,
    to: toDate,
  });
  return {
    kind: 'PAPER',
    from: fromDate,
    to: toDate,
    autoRange: range.auto,
    capital: cap,
    strategy: bt.strategyId,
    strategyName: cfg.strategy?.name || 'Dual Momentum - Weekly',
    fillTime: FILL_CLOCK,
    scanTime: SCAN_CLOCK,
    totalProfit,
    closedProfit: Math.round(closedPnl * 100) / 100,
    openProfit: Math.round(openPnl * 100) / 100,
    metrics: bt.metrics,
    summary,
    thisWeek,
    nextAction: nextActionLine(buildSchedule(cfg.params.horizon), thisWeek),
    closed,
    open,
  };
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readKiteFunds(momentum, userId) {
  if (!momentum.sessions.authorization(userId)) {
    return { ok: false, error: 'No Kite session', equityCash: null, equityNet: null, source: null };
  }
  try {
    const funds = await withTimeout(momentum.readLiveFunds(userId), 8000, 'Kite funds');
    const equityCash = Number(funds?.equityCash ?? funds?.capitalRs);
    if (!Number.isFinite(equityCash) || equityCash < 0) {
      return { ok: false, error: 'Kite did not return equity cash', equityCash: null, equityNet: null, source: 'kite' };
    }
    return {
      ok: true,
      error: null,
      equityCash,
      equityNet: Number.isFinite(Number(funds?.equityNet)) ? Number(funds.equityNet) : null,
      capitalRs: Number.isFinite(Number(funds?.capitalRs)) ? Number(funds.capitalRs) : equityCash,
      source: 'kite',
    };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not read Kite funds', equityCash: null, equityNet: null, source: 'kite' };
  }
}

function applySizingCash(momentum, userId, { live, useMode, cap, reset }) {
  if (useMode === 'LIVE' && live) {
    momentum.store.updatePortfolio(live.id, { cash: cap, peakEquity: Math.max(Number(live.peakEquity) || 0, cap) });
    return momentum.store.getPortfolioById(live.id);
  }
  const existing = momentum.store.getPortfolio(userId, 'PAPER');
  const seed = Math.max(cap, 10_000);
  if (!existing || reset) momentum.initPaper(userId, seed, { reset: !!existing });
  const p = momentum.store.getPortfolio(userId, 'PAPER');
  momentum.store.updatePortfolio(p.id, {
    autoExecute: false,
    cash: cap,
    initialCapital: cap,
    peakEquity: Math.max(Number(p.peakEquity) || 0, cap),
  });
  return momentum.store.getPortfolioById(p.id);
}

async function deskOverview(momentum, userId, now = new Date()) {
  const cfg = momentum.config(userId);
  const asOf = lastCompletedTradingDate(now);
  const live = momentum.store.getPortfolio(userId, 'LIVE');
  const paper = momentum.store.getPortfolio(userId, 'PAPER');
  const book = live || paper;
  const lastOf = (symbol) => momentum.marketData.priceFor(symbol)?.price ?? null;
  const rowExtra = { maxDeviationPct: cfg.params.maxPriceDeviationPct ?? 0.04, fillTime: FILL_CLOCK, lastOf };
  let lastScan = latestScanFromStore(momentum, userId, { cfg, lastOf });
  let holdingsSync = null;
  let funds = { ok: false, error: null, equityCash: null, equityNet: null, source: null };
  if (momentum.sessions.authorization(userId)) {
    const previewP = withTimeout(momentum.previewCncHoldings(userId), 4000, 'Kite CNC')
      .then((preview) => ({
        ok: true,
        error: null,
        preview: !live,
        imported: preview.universeHoldings.map((h) => h.symbol),
        updated: [],
        removed: [],
        skipped: preview.skipped,
        universeHoldings: preview.universeHoldings,
      }))
      .catch((err) => ({
        ok: false,
        error: err.message || 'Could not read Kite holdings',
        preview: !live,
        imported: [],
        updated: [],
        removed: [],
        skipped: [],
        universeHoldings: [],
      }));
    [holdingsSync, funds] = await Promise.all([previewP, readKiteFunds(momentum, userId)]);
    const overlay = applyCncOverlay(lastScan || { buy: [], hold: [], sell: [] }, holdingsSync, rowExtra);
    lastScan = {
      ...(lastScan || {
        mode: live ? 'LIVE' : 'PAPER',
        usedPaperFallback: !live,
        capital: funds.ok ? funds.equityCash : book?.initialCapital ?? 0,
        asOf,
        runId: null,
        answer: '',
        headline: overlay.hold.length || overlay.alsoHeld.length ? 'Kite CNC holdings' : '',
        lastWeek: lastWeekPicks(momentum.store, book, asOf),
      }),
      holdingsSync,
      funds,
      ...overlay,
    };
  }
  return {
    kind: 'DESK',
    strategy: {
      id: cfg.strategy.id,
      name: cfg.strategy.name,
      horizon: cfg.params.horizon,
      description:
        cfg.strategy.description ||
        'Dual Momentum 12-1: buy the strongest NSE large/mid names, sit in cash when Nifty’s trend is broken.',
    },
    schedule: buildSchedule(cfg.params.horizon, now),
    paperDefaults: (() => {
      try {
        const panel = momentum.marketData.loadPanel();
        const range = defaultPaperRange(panel);
        return { capital: 25_000, ...range };
      } catch {
        return { capital: 25_000, from: null, to: null, auto: true };
      }
    })(),
    lastWeek: lastWeekPicks(momentum.store, book, asOf),
    liveEnabled: !!cfg.settings.live.enabled,
    hasLive: !!live,
    hasPaper: !!paper,
    tokenReady: !!momentum.sessions.authorization(userId),
    funds,
    guide: liveGuide({
      tokenReady: !!momentum.sessions.authorization(userId),
      fundsReady: funds.ok,
      cash: funds.ok ? funds.equityCash : null,
    }),
    lastScan,
  };
}

async function syncHoldingsForLiveScan(momentum, userId, live) {
  const empty = { imported: [], updated: [], removed: [], skipped: [], universeHoldings: [] };
  if (!momentum.sessions.authorization(userId)) {
    return {
      ok: false,
      error: 'No Kite session — Hold/Sell cannot read your CNC book. Update the token and run again.',
      preview: !live,
      ...empty,
    };
  }
  if (live) {
    try {
      const imported = await momentum.importLiveHoldings(userId);
      return {
        ok: true,
        error: null,
        preview: false,
        imported: imported.imported,
        updated: imported.updated,
        removed: imported.removed,
        skipped: imported.skipped,
        cash: imported.cash,
        universeHoldings: imported.holdings || [],
      };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not read Kite holdings', preview: false, ...empty };
    }
  }
  try {
    const preview = await withTimeout(momentum.previewCncHoldings(userId), 12000, 'Kite CNC');
    return {
      ok: true,
      error: null,
      preview: true,
      imported: preview.universeHoldings.map((h) => h.symbol),
      updated: [],
      removed: [],
      skipped: preview.skipped,
      universeHoldings: preview.universeHoldings,
    };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not read Kite holdings', preview: true, ...empty };
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

function cncHoldRows(holdings, extra = {}) {
  return (holdings || []).map((h) => {
    const symbol = String(h.symbol || '').toUpperCase();
    const last = extra.lastOf?.(symbol) || h.lastPrice || h.avgPrice || null;
    const qty = Number(h.qty) || 0;
    const suggestedSell = sellLimitFor(last, last, extra.maxDeviationPct);
    const reason =
      typeof extra.reasonFor === 'function'
        ? extra.reasonFor(h)
        : `${symbol} is in your Kite CNC book (qty ${qty}).`;
    return {
      symbol,
      name: h.name || symbol,
      sector: h.sector || '',
      action: 'HOLD',
      qty,
      priceRef: last,
      lastPrice: last,
      avgPrice: h.avgPrice ?? null,
      stopPrice: null,
      suggestedLimit: suggestedSell,
      suggestedBuy: null,
      suggestedSell,
      fillHint: fillHint('SELL', suggestedSell, extra.fillTime || FILL_CLOCK, { qty, symbol }),
      whyThisPrice: null,
      allocationValue: last && qty ? last * qty : 0,
      reason,
      score: null,
      signalId: null,
      canExecute: false,
    };
  });
}

function applyCncOverlay(grouped, holdingsSync, extra = {}) {
  const alsoHeld = alsoHeldRows(holdingsSync?.skipped, extra);
  const etfHolds = bookEtfHoldRows(holdingsSync?.skipped, extra);
  const taken = new Set([
    ...(grouped.hold || []).map((h) => h.symbol),
    ...(grouped.sell || []).map((h) => h.symbol),
  ]);
  const hold = [...(grouped.hold || [])];
  const preview = !!holdingsSync?.preview;
  const cncRows = cncHoldRows(holdingsSync?.universeHoldings, {
    ...extra,
    reasonFor: (h) =>
      preview
        ? `${h.symbol} is in your Kite CNC book (qty ${h.qty}). Live trading is not enabled — qty and sell price only.`
        : `${h.symbol} is in your Kite CNC book (qty ${h.qty}).`,
  });
  for (const row of [...etfHolds, ...cncRows]) {
    if (taken.has(row.symbol)) continue;
    hold.push(row);
    taken.add(row.symbol);
  }
  const buy = (grouped.buy || []).filter((b) => !taken.has(b.symbol));
  return { buy, hold, sell: grouped.sell || [], alsoHeld };
}

function latestScanFromStore(momentum, userId, extra = {}) {
  const live = momentum.store.getPortfolio(userId, 'LIVE');
  const paper = momentum.store.getPortfolio(userId, 'PAPER');
  const book = live || paper;
  if (!book) return null;
  const latest = momentum.store.listDecisionRuns(book.id, 1)[0];
  if (!latest) return null;
  const full = momentum.store.getDecisionRunById(latest.id);
  const decisions = full?.result?.decisions || [];
  const signals = momentum.store.listSignals({ userId, portfolioId: book.id, limit: 400 });
  const signalByKey = new Map();
  for (const s of signals) {
    if (s.decisionKey) signalByKey.set(s.decisionKey, s.id);
  }
  const cfg = extra.cfg || momentum.config(userId);
  const lastOf = extra.lastOf || ((symbol) => momentum.marketData.priceFor(symbol)?.price ?? null);
  const posBySymbol = new Map((momentum.store.listPositions(book.id) || []).map((p) => [p.symbol, p]));
  const grouped = groupActions(decisions, signalByKey, {
    posBySymbol,
    lastOf,
    maxDeviationPct: cfg.params.maxPriceDeviationPct ?? 0.04,
    fillTime: FILL_CLOCK,
  });
  return {
    mode: book.mode,
    usedPaperFallback: book.mode === 'PAPER',
    capital: book.initialCapital,
    asOf: latest.asOf,
    runId: latest.id,
    answer: full?.summary?.answer || latest.answer || '',
    headline: full?.summary?.headline || '',
    lastWeek: lastWeekPicks(momentum.store, book, latest.asOf),
    holdingsSync: null,
    alsoHeld: [],
    ...grouped,
  };
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
  const entered = Number(capital);
  const wantLive = String(mode).toUpperCase() === 'LIVE';
  const live = momentum.store.getPortfolio(userId, 'LIVE');
  const useMode = wantLive && live ? 'LIVE' : 'PAPER';
  const funds = wantLive ? await readKiteFunds(momentum, userId) : { ok: false, error: null, equityCash: null, equityNet: null, source: null };
  const kiteCash = funds.ok ? funds.equityCash : null;
  const sizedFrom = kiteCash != null ? 'kite-funds' : 'entered';
  const cap = sizedFrom === 'kite-funds' ? kiteCash : entered;
  if (sizedFrom === 'entered' && (!Number.isFinite(cap) || cap < 10_000)) {
    throw new ServiceError('BAD_REQUEST', 'Enter capital of at least ₹10,000');
  }
  if (sizedFrom === 'kite-funds' && (!Number.isFinite(cap) || cap < 0)) {
    throw new ServiceError('BAD_REQUEST', 'Kite cash is not available — update the token and run again');
  }
  let holdingsSync = null;
  if (wantLive) holdingsSync = await syncHoldingsForLiveScan(momentum, userId, live);
  applySizingCash(momentum, userId, { live, useMode, cap, reset });
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
  const rowExtra = { maxDeviationPct: cfg.params.maxPriceDeviationPct ?? 0.04, fillTime: FILL_CLOCK, lastOf };
  const overlay = applyCncOverlay(grouped, holdingsSync, rowExtra);
  const tokenReady = !!momentum.sessions.authorization(userId);
  const product = {
    kind: wantLive ? 'LIVE' : 'PAPER',
    strategy: 'Dual Momentum 12-1',
    tokenReady,
    fundsReady: !!funds.ok,
    cash: cap,
    sizedFrom,
    nextAction: nextActionLine(schedule, overlay),
    guide: liveGuide({ tokenReady, fundsReady: funds.ok, cash: cap }),
  };
  return {
    mode: useMode,
    usedPaperFallback: wantLive && useMode === 'PAPER',
    capital: cap,
    sizedFrom,
    funds,
    asOf: r.result.asOf,
    runId: r.runId,
    answer: r.result.summary.answer,
    headline: r.result.summary.headline,
    schedule,
    lastWeek: lastWeekPicks(momentum.store, book, r.result.asOf),
    holdingsSync,
    product,
    nextAction: product.nextAction,
    ...overlay,
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
  cncHoldRows,
  applyCncOverlay,
  suggestedLimitPrice,
  defaultPaperRange,
  paperSummary,
  liveGuide,
};
