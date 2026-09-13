'use strict';
/**
 * Crude Bot — Nifty/Bank winning playbook on MCX CRUDEOILM futures.
 *
 * Old crude books never paid (fee-negative S/R crude; live-crude-green OR).
 * This desk does not use those. It copies the measured Nifty + Bank rules:
 *   intraday wall, 2-bar retest, +20 target, lock 20→12,
 *   time stop 6 bars, give-up off (Bank: give-up cost net), day ±₹3,500.
 * Vehicle is the mini future (₹10/pt), not ATM options.
 */
const defaultMarket = require('./kite-market');
const store = require('./live.store');
const { lotsFromAvailableFunds } = require('./daily-desk-defaults');
const { resolveDeskCapital } = require('./sr-desk');
const { LiveBroker } = require('./live-broker');
const { runSrBreakout } = require('./sr-breakout');

const ENGINE = 'crude-desk';
const STRATEGY_ID = 'crude-retest';
const STRATEGY_VERSION = '2026.09-retest';
const BOOK_ID = 'crude-oil-mini';
const RS_PER_POINT = 10;
const CHARGE_RS = 40;
const DAY_LOSS_STOP_RS = 3500;
const DAY_PROFIT_TARGET_RS = 3500;
const TICK_MS = Number(process.env.CRUDE_BOT_INTERVAL_MS || 60_000);

const PLAYBOOK = {
  wallMode: 'intraday',
  retest: true,
  maxRetestBars: 2,
  timeStopBars: 6,
  lockArmPts: 20,
  lockAtPts: 12,
  giveUpBar: 0,
  giveUpMinPts: 0,
  minScore: 1,
  capStopToDayBudget: true,
  targetByScore: { 1: 20, 2: 20, 3: 20 },
  entryPts: 10,
  trendBars: 20,
  gapLo: 22,
  gapHi: 45,
  entryStartHm: '10:00',
  entryEndHm: '21:30',
  squareOffHm: '22:45',
  maxTradesPerDay: 3,
};

const RULES = PLAYBOOK;

/** @type {Map<string, object>} */
const sessions = new Map();

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
function nowHm() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}
function hmToMin(hm) {
  const [h, m] = String(hm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function shiftDays(iso, d) {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
}
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
function padHm(hm) {
  const s = String(hm || '');
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{2}:\d{2}$/.test(s)) return `${s}:00`;
  return s || '00:00:00';
}

function summarize(trades) {
  let wins = 0;
  let losses = 0;
  let grossProfitRs = 0;
  let grossLossRs = 0;
  let net = 0;
  let pts = 0;
  for (const t of trades || []) {
    const n = Number(t.netOptionPnlRs) || 0;
    net += n;
    pts += Number(t.indexPoints) || 0;
    if (n > 0) {
      wins += 1;
      grossProfitRs += n;
    } else if (n < 0) {
      losses += 1;
      grossLossRs += Math.abs(n);
    }
  }
  const pf = grossLossRs > 0 ? grossProfitRs / grossLossRs : wins ? 99 : 0;
  return {
    trades: (trades || []).length,
    wins,
    losses,
    grossProfitRs: Math.round(grossProfitRs),
    grossLossRs: Math.round(grossLossRs),
    netRs: Math.round(net),
    optionNetRs: Math.round(net + CHARGE_RS * (trades || []).length),
    optionNetAfterChargesRs: Math.round(net),
    underlyingPoints: round2(pts),
    profitFactor: round2(pf),
    winRate: (trades || []).length ? round2(wins / trades.length) : 0,
    expectancyRs: (trades || []).length ? Math.round(net / trades.length) : 0,
  };
}

function parseMcxFuts(csv) {
  const lines = String(csv || '').trim().split('\n');
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const p = lines[i].split(',');
    const token = String(p[0] || '').replace(/"/g, '');
    const sym = String(p[2] || '').replace(/"/g, '');
    const expiry = String(p[5] || '').replace(/"/g, '');
    const type = String(p[9] || '').replace(/"/g, '');
    if (!/^CRUDEOILM/.test(sym) || type !== 'FUT') continue;
    rows.push({ token, sym, expiry });
  }
  return rows;
}

async function resolveCrudeFuture(market, authorization, today) {
  const csv = await market.fetchInstrumentsCsv(authorization, 'MCX');
  const futs = parseMcxFuts(csv).filter((r) => r.expiry > today);
  futs.sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));
  if (!futs.length) throw new Error('No live CRUDEOILM future found');
  return { token: futs[0].token, symbol: futs[0].sym, expiry: futs[0].expiry };
}

function engineOpts(lots) {
  const L = Math.max(1, Number(lots) || 1);
  const perPoint = RS_PER_POINT * L;
  return {
    ...PLAYBOOK,
    stopPts: DAY_LOSS_STOP_RS / perPoint,
    dayLossStop: DAY_LOSS_STOP_RS / perPoint,
    dayProfitTarget: DAY_PROFIT_TARGET_RS / perPoint,
  };
}

function mapRow(t, lots, symbol) {
  const perPoint = RS_PER_POINT * lots;
  const pts = Number(t.points) || 0;
  const open = !!(t.openAtFill || t.open);
  const gross = pts * perPoint;
  const net = open ? gross : gross - CHARGE_RS * lots;
  const dir = t.side === 'SELL' ? -1 : 1;
  const stopPts = Number(engineOpts(lots).stopPts) || 0;
  const stop = Number(t.entryPrice) - dir * stopPts;
  const entryHm = padHm(t.entryTime);
  const exitHm = t.exitTime ? padHm(t.exitTime) : null;
  return {
    instrumentName: 'Crude Oil Mini',
    instrumentId: BOOK_ID,
    selectedInstrument: symbol || 'CRUDEOILM FUT',
    optionSymbol: symbol || 'CRUDEOILM FUT',
    option: { tradingSymbol: symbol || 'CRUDEOILM FUT', symbol: symbol || 'CRUDEOILM FUT' },
    side: t.side,
    sideLabel: t.side === 'SELL' ? 'FUT SELL' : 'FUT BUY',
    direction: t.side,
    entryTime: `${t.date}T${entryHm}+0530`,
    exitTime: t.exitTime ? `${t.date}T${exitHm}+0530` : null,
    entryHm,
    exitHm,
    entryClock: entryHm,
    exitClock: exitHm,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    indexEntry: t.entryPrice,
    indexExit: t.exitPrice,
    indexStop: round2(stop),
    indexTarget: Number(t.entryPrice) + dir * (Number(t.target) || 20),
    stopPts,
    slTrigger: round2(stop),
    slPrice: round2(stop),
    slOn: true,
    optionEntryPremium: t.entryPrice,
    optionExitPremium: t.exitPrice,
    optionPnlRs: Math.round(gross),
    netOptionPnlRs: Math.round(net),
    indexPoints: round2(pts),
    exitReason: t.exitReason,
    open,
    lots,
    premiumSource: 'mcx_fut',
    vehicle: 'fut',
  };
}

function replayRetest(candles, { lots = 1, fromDate, toDate, symbol } = {}) {
  const { trades: raw } = runSrBreakout(candles || [], {
    ...engineOpts(lots),
    reportFromDate: fromDate || '',
  });
  const trades = (raw || [])
    .filter((t) => {
      if (fromDate && t.date < fromDate) return false;
      if (toDate && t.date > toDate) return false;
      return true;
    })
    .map((t) => mapRow(t, lots, symbol));
  return { trades, rules: PLAYBOOK };
}

function instrumentRow(trades) {
  const tot = summarize(trades);
  return {
    id: 'crude',
    instrumentName: 'Crude Oil Mini',
    status: tot.trades ? 'taken' : 'not-taken',
    ...tot,
    why: tot.trades ? 'Taken' : 'No with-trend retest break in this window.',
  };
}

async function runCrudeDesk({ authorization, fromDate, toDate, capitalRs, capitalSource, liveMoney }, deps = {}) {
  if (!fromDate || !toDate || fromDate > toDate) {
    const err = new Error('Valid fromDate ≤ toDate (YYYY-MM-DD) required');
    err.status = 400;
    throw err;
  }
  const market = deps.market || defaultMarket;
  let kiteFunds = null;
  if (typeof market.fetchUserMargins === 'function' && authorization && !deps.candles) {
    try {
      kiteFunds = await market.fetchUserMargins(authorization);
    } catch {
      kiteFunds = null;
    }
  }
  const resolved = resolveDeskCapital({ capitalRs, capitalSource, liveMoney, kiteFunds });
  const capital = resolved.capital;
  const L = lotsFromAvailableFunds(capital);
  const today = todayIso();
  let symbol = 'CRUDEOILM FUT';
  let candles = deps.candles || [];
  if (!deps.candles) {
    if (!authorization) {
      const err = new Error('Kite session required — Get Token, then Run.');
      err.status = 400;
      throw err;
    }
    const fut = await resolveCrudeFuture(market, authorization, today);
    symbol = fut.symbol;
    candles = await market.fetchHistorical5m(authorization, fut.token, shiftDays(fromDate, -5), toDate);
  }
  const { trades } = replayRetest(candles, { lots: L, fromDate, toDate, symbol });
  const totals = summarize(trades);
  const book = {
    id: 'crude',
    label: 'Crude Oil Mini',
    sitOut: false,
    spec: { engine: ENGINE, strategy: STRATEGY_ID },
    specText: `CRUDEOILM FUT · Nifty/Bank retest playbook · day ±₹${DAY_LOSS_STOP_RS}`,
    totals,
    trades,
    status: 'on',
    why: '',
  };
  return {
    fromDate,
    toDate,
    engine: ENGINE,
    strategy: STRATEGY_ID,
    strategyVersion: STRATEGY_VERSION,
    capitalRs: capital,
    capitalSource: resolved.capitalSource,
    kiteFunds,
    maxLots: L,
    allocation: {
      taken: [{ instrumentName: 'Crude Oil Mini', bookId: 'crude', direction: 'RETEST', lots: L }],
      trades,
      totals,
    },
    specText: book.specText,
    books: [book],
    coreBooks: [book],
    note:
      'Crude Bot trades only Crude Oil Mini futures (MIS). Same playbook as the paying Nifty/Bank desk: intraday wall, 2-bar retest, +20 pts, lock 20→12, day ±₹3,500. Not the old crude S/R book and not live-crude-green. Paper ₹ is points × ₹10 × lots (Nifty is ×65, so 1 crude lot is smaller rupees per point). SL ₹ is the futures stop.',
    instruments: [instrumentRow(trades)],
    protection: {
      fundsRs: capital,
      capitalRs: capital,
      riskPerTradeRs: Math.round(L * 20 * RS_PER_POINT),
      dayRiskRs: DAY_LOSS_STOP_RS,
      dayRiskUsedRs: Math.max(0, -Math.min(0, totals.netRs)),
      stillProtectedRs: Math.max(0, capital - DAY_LOSS_STOP_RS),
      protectedFloorRs: Math.max(0, capital - DAY_LOSS_STOP_RS),
      monthMtdRs: totals.netRs,
    },
    totals,
    liveTotals: totals,
    trades,
    message: trades.length
      ? undefined
      : 'No with-trend retest break in this window (need an intraday wall break, then a pullback within 2 bars).',
  };
}

function getSession(userId) {
  const id = String(userId);
  if (!sessions.has(id)) {
    sessions.set(id, {
      userId: id,
      status: 'stopped',
      message: 'Crude Bot idle',
      events: [],
      lastError: null,
      lastPreflight: null,
      tickTimer: null,
      tickBusy: false,
      broker: null,
      fut: null,
      enteredKeys: new Set(),
      lots: 1,
      trades: [],
    });
  }
  return sessions.get(id);
}

function pushEvent(session, action, detail) {
  session.events.push({ at: new Date().toISOString(), action, detail: String(detail || '') });
  if (session.events.length > 200) session.events.splice(0, session.events.length - 200);
}

function statusPayload(session) {
  const running = session.status === 'running';
  const brokerPos = session.broker ? [...session.broker.positions.values()] : [];
  return {
    status: session.status,
    running,
    liveMoney: running,
    realOrders: running,
    engine: ENGINE,
    strategy: STRATEGY_ID,
    strategyVersion: STRATEGY_VERSION,
    message: session.message,
    lastError: session.lastError,
    events: session.events.slice(-40),
    trades: session.trades || [],
    positions: brokerPos,
    lastPreflight: session.lastPreflight,
    note: 'Crude Bot live is MCX CRUDEOILM futures with the Nifty/Bank retest playbook. Stop live on this tab stops only Crude Bot.',
  };
}

async function startLive(userId, { authorization, lots, liveAssistant }) {
  const session = getSession(userId);
  if (session.status === 'running') {
    session.message = 'Crude Bot already running.';
    return statusPayload(session);
  }
  if (!authorization) {
    const err = new Error('Kite token missing — Get Token, then Start live.');
    err.status = 400;
    throw err;
  }
  session.lots = Math.max(1, Number(lots) || 1);
  session.status = 'running';
  session.message = `Crude Bot on · CRUDEOILM FUT · ${session.lots} lot(s) · retest playbook`;
  session.lastError = null;
  session.lastPreflight = liveAssistant || null;
  session.enteredKeys = new Set();
  session.trades = [];
  session.fut = null;
  session.broker = new LiveBroker({
    pushEvent: (a, d) => pushEvent(session, a, d),
    realOrders: true,
  });
  session.broker.setMaxOpenLegs(1);
  session.broker.setLots(BOOK_ID, session.lots);
  pushEvent(session, 'START', session.message);
  startTick(session);
  return statusPayload(session);
}

async function stop(userId) {
  const session = getSession(userId);
  session.status = 'stopped';
  session.message = 'Stopped by user — Crude Bot idle';
  if (session.tickTimer) {
    clearInterval(session.tickTimer);
    session.tickTimer = null;
  }
  pushEvent(session, 'STOP', session.message);
  return statusPayload(session);
}

function startTick(session) {
  if (session.tickTimer) return;
  const run = () => {
    if (session.status !== 'running') return;
    void onTick(session).catch((err) => {
      session.lastError = String(err.message || err);
      pushEvent(session, 'ERROR', session.lastError);
    });
  };
  run();
  session.tickTimer = setInterval(run, TICK_MS);
}

function engineTradeStillOpen(t, nowHm) {
  if (!t) return false;
  const why = String(t.exitReason || '').toUpperCase();
  if (['TARGET', 'LOCK', 'STOP', 'TIME', 'GIVEUP', 'FAIL', 'SL'].includes(why)) return false;
  if (hmToMin(nowHm) >= hmToMin(PLAYBOOK.squareOffHm)) return false;
  return why === 'CLOSE' || why === 'OPEN' || !!t.open;
}

async function onTick(session) {
  if (session.tickBusy) return;
  session.tickBusy = true;
  try {
    const authorization = await store.getAuthorizationFor(session.userId);
    if (!authorization) {
      session.lastError = 'Kite token missing — Get Token, then Start live again.';
      return;
    }
    const today = todayIso();
    const hm = nowHm();
    const market = defaultMarket;
    if (!session.fut || session.fut.date !== today) {
      const fut = await resolveCrudeFuture(market, authorization, today);
      session.fut = { ...fut, date: today };
    }
    const candles = await market.fetchHistorical5m(
      authorization,
      session.fut.token,
      shiftDays(today, -5),
      today,
    );
    const { trades } = replayRetest(candles, {
      lots: session.lots,
      fromDate: today,
      toDate: today,
      symbol: session.fut.symbol,
    });
    session.trades = trades;
    const pos = session.broker.positions.get(BOOK_ID);
    const liveOpen = trades.find((t) => engineTradeStillOpen(t, hm) && String(t.entryTime || '').slice(0, 10) === today);
    const done = trades.find((t) => !engineTradeStillOpen(t, hm) && String(t.entryTime || '').slice(0, 10) === today);

    if (pos?.status === 'open') {
      const shouldExit =
        hmToMin(hm) >= hmToMin(PLAYBOOK.squareOffHm) ||
        (done && !engineTradeStillOpen(done, hm));
      if (shouldExit) {
        await session.broker.placeExit(authorization, pos, 'Crude Oil Mini');
        pushEvent(session, 'EXIT', done?.exitReason || 'SQUARE');
      }
      return;
    }

    if (liveOpen && !(session.enteredKeys instanceof Set ? session.enteredKeys.has(liveOpen.entryTime) : false)) {
      if (!(session.enteredKeys instanceof Set)) session.enteredKeys = new Set();
      const side = liveOpen.side === 'SELL' ? 'SELL' : 'BUY';
      await session.broker.placeEntry(authorization, BOOK_ID, 'Crude Oil Mini', {
        direction: side,
        vehicle: 'fut',
        skipChargeGate: true,
        premiumEstimated: false,
        optionEntryPremium: liveOpen.entryPrice,
        indexEntry: liveOpen.entryPrice,
        indexStop: liveOpen.slPrice || liveOpen.slTrigger,
        indexTarget: liveOpen.indexTarget,
        entryTime: liveOpen.entryTime,
        option: {
          tradingSymbol: session.fut.symbol,
          instrumentToken: Number(session.fut.token) || 0,
          exchange: 'MCX',
          lotSize: 1,
          source: 'listed',
        },
      });
      session.enteredKeys.add(liveOpen.entryTime);
      pushEvent(session, 'SIGNAL', `${side} CRUDEOILM retest @ ${liveOpen.entryPrice}`);
    }
  } finally {
    session.tickBusy = false;
  }
}

function status(userId) {
  return statusPayload(getSession(userId));
}

function isCrudeDeskBody(body, query) {
  const e = String(body?.engine || body?.desk || query?.desk || query?.engine || '').toLowerCase();
  return e === 'crude-desk' || e === 'crude' || e === 'crude-bot';
}

module.exports = {
  ENGINE,
  STRATEGY_ID,
  STRATEGY_VERSION,
  RULES,
  PLAYBOOK,
  BOOK_ID,
  replayRetest,
  runCrudeDesk,
  startLive,
  stop,
  status,
  isCrudeDeskBody,
  summarize,
  resolveCrudeFuture,
  parseMcxFuts,
};
