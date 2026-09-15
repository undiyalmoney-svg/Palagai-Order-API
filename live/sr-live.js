'use strict';
/**
 * S/R Breakout LIVE worker — places real MIS option buys when the same engine
 * that powers Paper fires a fresh signal. Opt-in only (Start Live). Paper,
 * observe, and the collector stay read-only.
 */
const market = require('./kite-market');
const store = require('./live.store');
const persist = require('./desk-live-persist');
const optionStore = require('./sr-option-store');
const { archiveSrInstruments, instrumentsWithArchive } = require('./instrument-archive');
const { connectMongo, getDb } = require('./live.mongo');
const { runSrBreakout } = require('./sr-breakout');
// Exit/entry rules come from the SHARED config so Live and Paper cannot drift.
const { exitOptsFor, DEFAULT_LOTS, DAY_LOSS_STOP_RS, DAY_PROFIT_TARGET_RS, LOT_UNITS, OPTION_SL_MAX_RS, STRATEGY_ID, STRATEGY_VERSION } = require('./sr-strategy-config');
const { LiveBroker } = require('./live-broker');
const { approveLiveStart, approveLiveEntry } = require('./engine/risk');
const { confirmDirection, selectTradeExpiry, liveTransactionType } = require('./engine/pipeline');
const { NIFTY_50_INSTRUMENT, BANK_NIFTY_INSTRUMENT, CRUDE_OIL_MINI_INSTRUMENT } = require('./strategy-core.cjs');

const TICK_MS = Number(process.env.SR_LIVE_INTERVAL_MS || 15_000);
const TICK_STUCK_MS = Number(process.env.SR_LIVE_TICK_STUCK_MS || 25_000);
const HISTORY_TIMEOUT_MS = Number(process.env.SR_LIVE_HISTORY_MS || 20_000);
const FRESH_MINUTES = 20;

const SPEC = {
  nifty: {
    key: 'nifty', name: 'Nifty 50', token: '256265', unitsPerLot: LOT_UNITS.nifty,
    bookId: NIFTY_50_INSTRUMENT.id, root: 'NIFTY', step: 50, spotKey: 'NSE:NIFTY 50',
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' },
    entryPts: 27, gapLo: 100, gapHi: 175, targetByScore: { 1: 20, 2: 25, 3: 30 },
    // Cash Nifty 50 cannot be traded. Live BUYS the ATM weekly option
    // (CE on a bullish break, PE on a bearish break) — same as Bank/Crude.
    // Do not sell futures or sell premium.
    vehicle: 'option',
    opts: exitOptsFor('nifty'),
  },
  banknifty: {
    key: 'banknifty', name: 'Bank Nifty', token: '260105', unitsPerLot: LOT_UNITS.banknifty,
    bookId: BANK_NIFTY_INSTRUMENT.id, root: 'BANKNIFTY', step: 100, spotKey: 'NSE:NIFTY BANK',
    exchange: 'NFO',
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' },
    entryPts: 60, gapLo: 275, gapHi: 465, targetByScore: { 1: 40, 2: 50, 3: 60 },
    opts: exitOptsFor('banknifty'),
  },
  crude: {
    key: 'crude', name: 'Crude Oil Mini', token: null, unitsPerLot: LOT_UNITS.crude,
    bookId: CRUDE_OIL_MINI_INSTRUMENT.id, root: 'CRUDEOILM', step: 50, spotKey: null,
    exchange: 'MCX',
    session: { entryStartHm: '09:30', entryEndHm: '20:00', squareOffHm: '23:20' },
    entryPts: 50, gapLo: 78, gapHi: 130, targetByScore: { 1: 20, 2: 25, 3: 30 },
    opts: exitOptsFor('crude'),
  },
};

/** @type {Map<string, SrLiveSession>} */
const sessions = new Map();

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
function nowHm() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}
function shiftDays(iso, d) {
  const x = new Date(iso + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
}
function hmToMin(hm) {
  const [h, m] = String(hm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function signalId(key, trade) {
  return `${key}|${trade.date}|${trade.entryTime}`;
}

/** Engine actually finished this trade. CLOSE is not in this set: on a live
 *  day the engine parks CLOSE on the last fetched 5-min bar (always <= now),
 *  which means "still open in the replay", not "session square-off done".
 *  Treating CLOSE as flat skipped every Monday buy even with Live on. */
const ENGINE_DONE = new Set(['TARGET', 'TIME', 'FAIL', 'STOP', 'LOCK', 'GIVEUP']);

function stopDistancePts(trade, spec) {
  const fromOpts = Number(spec?.opts?.stopPts);
  if (Number.isFinite(fromOpts) && fromOpts > 0) return fromOpts;
  const t = Number(trade?.target);
  return Number.isFinite(t) && t > 0 ? t : 20;
}

function indexStopPrice(trade, spec) {
  const pts = stopDistancePts(trade, spec);
  return trade.side === 'BUY' ? trade.entryPrice - pts : trade.entryPrice + pts;
}

/**
 * Decide what Live should do for one engine trade.
 * enter = fresh signal, still in the window, not already filled.
 * exit  = we are in the trade and the engine/session says get out.
 * hold  = stay; skip = too late / already done; wait = bar not reached yet.
 */
function engineTradeStillOpen(trade, hm) {
  if (!trade) return false;
  const now = hmToMin(hm);
  const exit = hmToMin(trade.exitTime);
  return !(ENGINE_DONE.has(trade.exitReason) && exit <= now);
}

function engineBookHasOpenTrade(trades, hm) {
  return (trades || []).some((t) => engineTradeStillOpen(t, hm));
}

/** Holding an option from 11:50 while Paper already opened 12:10 must SELL first.
 *  Attaching the new engine id to the old Kite PE skipped Nifty LOCK #2 and #3.
 *  After PM2 restart the adopted Kite row has entryTime null — still flatten,
 *  never glue that fill onto a later still-open engine leg. */
function mustExitHeldForNewLeg(held, tracked) {
  const b = tracked?.entryTime;
  if (!b) return false;
  const a = held?.entryTime;
  if (!a) return true;
  return String(a) !== String(b);
}

function matchHeldEngineTrade(trades, openTrade, held) {
  if (openTrade) return openTrade;
  const t = held?.entryTime;
  if (!t) return null;
  return (trades || []).find((x) => String(x.entryTime) === String(t)) || null;
}

function decideLiveAction({ trade, nowHm: hm, alreadyOpen, squareOffHm, freshMinutes = FRESH_MINUTES }) {
  const now = hmToMin(hm);
  const entry = hmToMin(trade.entryTime);
  const exit = hmToMin(trade.exitTime);
  const so = hmToMin(squareOffHm);
  const finished = ENGINE_DONE.has(trade.exitReason) && exit <= now;
  const sessionOver = now >= so;
  if (alreadyOpen) {
    if (sessionOver || finished) return 'exit';
    return 'hold';
  }
  // Do NOT skip a fresh entry just because the replay already printed TARGET /
  // LOCK / GIVEUP. Nifty retest only emits the trade once a 5-min bar exists
  // AFTER fill; that same bar can wick +20 and mark TARGET. Live then never
  // sent Kite (9 Sep 2026 11:50 SELL: Paper TARGET at 11:55, entered=[]).
  // Enter while the signal is still inside the fresh window; the next tick
  // flattens if the engine is already done.
  if (sessionOver) return 'skip';
  if (now < entry) return 'wait';
  if (now - entry > freshMinutes) return 'skip';
  return 'enter';
}

function getSession(userId) {
  const id = String(userId);
  if (!sessions.has(id)) {
    sessions.set(id, {
      userId: id,
      status: 'stopped',
      message: 'S/R Live idle',
      config: null,
      events: [],
      entered: new Set(),
      openSignal: new Map(),
      lastTickAt: null,
      lastError: null,
      lastPreflight: null,
      tickTimer: null,
      tickBusy: false,
      broker: null,
      hydrated: false,
    });
    hydrateSrSession(sessions.get(id));
  }
  return sessions.get(id);
}

function persistSrSession(session) {
  if (!session || !session.userId) return;
  persist.scheduleSave('sr', session.userId, () => ({
    status: session.status,
    message: session.message,
    events: session.events,
    lastError: session.lastError,
    lastPreflight: session.lastPreflight,
    lastTickAt: session.lastTickAt,
    config: session.config,
    entered: [...(session.entered || [])],
    openSignal: session.openSignal ? Object.fromEntries(session.openSignal) : {},
    broker: persist.brokerSnapshot(session.broker),
    savedAt: new Date().toISOString(),
  }));
}

function hydrateSrSession(session) {
  if (session.hydrated) return;
  session.hydrated = true;
  const snap = persist.load('sr', session.userId);
  if (!snap) return;
  session.status = snap.status === 'running' ? 'running' : (snap.status || 'stopped');
  session.message = snap.message || session.message;
  session.events = Array.isArray(snap.events) ? snap.events : [];
  session.lastError = snap.lastError || null;
  session.lastPreflight = snap.lastPreflight || null;
  session.lastTickAt = snap.lastTickAt || null;
  session.config = snap.config || null;
  session.entered = new Set(snap.entered || []);
  session.openSignal = new Map(Object.entries(snap.openSignal || {}));
  session.broker = new LiveBroker({
    pushEvent: (a, d) => pushEvent(session, a, d),
    realOrders: true,
  });
  persist.restoreBroker(session.broker, snap.broker);
  if (session.status === 'running') startTick(session);
}

function pushEvent(session, action, detail) {
  session.events.push({ at: new Date().toISOString(), action, detail: String(detail || '') });
  if (session.events.length > 200) session.events.splice(0, session.events.length - 200);
  persistSrSession(session);
}

function bookNameFor(instrumentId) {
  const hit = Object.values(SPEC).find((s) => s.bookId === instrumentId);
  return hit?.name || instrumentId;
}

function optionKindOfSymbol(sym) {
  const s = String(sym || '').toUpperCase();
  if (/PE$/.test(s) || /\bPE\b/.test(s)) return 'PE';
  if (/CE$/.test(s) || /\bCE\b/.test(s)) return 'CE';
  return '';
}

function liveTradeRow(session, instrumentId, p, pnlById) {
  const broker = session?.broker;
  const open = p.status === 'open' || p.status === 'exiting';
  const slTrigger = Number(p.slTrigger) > 0 ? Number(p.slTrigger) : null;
  const slOn = !!(p.slOrderId && open);
  const kind = optionKindOfSymbol(p.tradingSymbol);
  const pnl = pnlById?.get(instrumentId) || null;
  const qty = Number(p.quantity) || 0;
  const entry = Number(p.entryPremium) || 0;
  const exitPx = Number(p.exitPremium) || 0;
  let pnlRs = pnl?.pnlRs;
  if (pnlRs == null && !open && entry > 0 && exitPx > 0 && qty > 0) {
    const signed = p.direction === 'SELL' ? (entry - exitPx) * qty : (exitPx - entry) * qty;
    pnlRs = Math.round(signed);
  }
  const lots = typeof broker?.lotsFor === 'function' ? broker.lotsFor(instrumentId) : 1;
  return {
    instrumentName: bookNameFor(instrumentId),
    instrumentId,
    selectedInstrument: p.tradingSymbol || null,
    optionSymbol: p.tradingSymbol || null,
    side: p.direction || 'BUY',
    sideLabel: kind ? `${kind} BUY` : (p.direction || 'BUY'),
    direction: kind || p.direction || 'BUY',
    entryTime: p.entryTime || null,
    exitTime: open ? null : (p.exitTime || null),
    entryPrice: entry > 0 ? entry : null,
    optionEntryPremium: entry > 0 ? entry : null,
    exitPrice: open
      ? (Number(p.lastLtp) > 0 ? Number(p.lastLtp) : null)
      : (exitPx > 0 ? exitPx : null),
    optionExitPremium: exitPx > 0 ? exitPx : null,
    slTrigger,
    slPrice: slTrigger,
    slOn,
    slOrderId: p.slOrderId || null,
    lots,
    quantity: p.quantity || null,
    netOptionPnlRs: pnlRs != null ? pnlRs : null,
    optionPnlRs: pnlRs != null ? pnlRs : null,
    open,
    exitReason: open ? (slOn ? 'OPEN' : 'OPEN · SL missing') : (p.closedBy || p.status || 'flat'),
  };
}

/** Same shape as paper desk trades so Trade Bot can reuse the result table. */
function liveTradesFromBroker(session) {
  const broker = session?.broker;
  if (!broker || typeof broker.positions?.entries !== 'function') return [];
  const snap = typeof broker.moneySnapshot === 'function'
    ? broker.moneySnapshot()
    : { legs: [] };
  const pnlById = new Map((snap.legs || []).map((leg) => [leg.instrumentId, leg]));
  const rows = [];
  const seen = new Set();
  const add = (instrumentId, p) => {
    if (!p || p.status === 'error') return;
    const key = `${instrumentId}|${p.entryTime || ''}|${p.tradingSymbol || ''}|${p.closedBy || p.status || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(liveTradeRow(session, instrumentId, p, pnlById));
  };
  for (const p of broker.closedLegs || []) {
    add(p.instrumentId, p);
  }
  for (const [instrumentId, p] of broker.positions.entries()) {
    add(instrumentId, p);
  }
  return rows;
}

function statusPayload(session) {
  const trades = liveTradesFromBroker(session);
  const positions = trades.map((t) => ({
    instrumentId: t.instrumentId,
    symbol: t.optionSymbol,
    status: t.open ? 'open' : 'flat',
    entryTime: t.entryTime,
    quantity: t.quantity,
    entryPremium: t.optionEntryPremium,
    slTrigger: t.slTrigger,
    slOrderId: t.slOrderId,
    slOn: !!t.slOn,
  }));
  return {
    status: 'ok',
    running: session.status === 'running',
    mode: 'live-broker',
    liveBrokerOrders: session.status === 'running' ? 'ENABLED' : 'OFF',
    message: session.message,
    lastTickAt: session.lastTickAt,
    lastError: session.lastError,
    lastPreflight: session.lastPreflight || null,
    liveAssistant: session.lastError
      ? { ok: false, checks: [{ id: 'tick', ok: false, detail: session.lastError }] }
      : session.lastPreflight || undefined,
    config: session.config,
    entered: [...session.entered],
    strategyId: STRATEGY_ID,
    strategyVersion: STRATEGY_VERSION,
    openSignals: Object.fromEntries(session.openSignal),
    positions,
    trades,
    kitePnl: session.broker && typeof session.broker.moneySnapshot === 'function'
      ? session.broker.moneySnapshot()
      : { closedRs: 0, openRs: 0, netRs: 0, legs: [] },
    events: session.events.slice(-80),
    liveMoney: session.status === 'running',
  };
}

function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v != null ? n : d;
}

/** Update max-trades / day rupee brakes on a running session. Does not flatten. */
function applyDeskLimits(config, body = {}) {
  const next = { ...(config || {}) };
  next.maxTradesPerDay = Math.max(1, numOr(body.maxTradesPerDay, next.maxTradesPerDay || 3));
  if (body.dayLossStopRs != null && body.dayLossStopRs !== '') {
    next.dayLossStopRs = numOr(body.dayLossStopRs, 0);
  }
  if (body.dayProfitTargetRs != null && body.dayProfitTargetRs !== '') {
    next.dayProfitTargetRs = numOr(body.dayProfitTargetRs, 0);
  }
  return next;
}

async function start(userId, body = {}) {
  const session = getSession(userId);
  if (session.status === 'running') {
    session.config = applyDeskLimits(session.config, body);
    session.message =
      `S/R Live on · max ${session.config.maxTradesPerDay}/day · ` +
      `day SL ₹${session.config.dayLossStopRs} · day PT ₹${session.config.dayProfitTargetRs} ` +
      `(open legs kept)`;
    pushEvent(session, 'CONFIG', session.message);
    return statusPayload(session);
  }
  const auto = store.statusFor(userId);
  const startGate = approveLiveStart({ autoBotRunning: !!(auto && auto.status === 'running') });
  if (!startGate.ok) {
    const err = new Error(startGate.reason);
    err.status = 400;
    throw err;
  }
  const keys = Array.isArray(body.instruments) && body.instruments.length
    ? body.instruments.filter((k) => SPEC[k])
    : ['nifty', 'banknifty', 'crude'];
  if (!keys.length) {
    const err = new Error('Select Nifty, Bank Nifty, and/or Crude Oil Mini.');
    err.status = 400;
    throw err;
  }
  const auth = body.authorization || (await store.getAuthorizationFor(userId));
  if (!auth) {
    const err = new Error('Kite token missing — Get Token, then Start live.');
    err.status = 400;
    throw err;
  }
  const lotsByInstrument = body.lotsByInstrument && typeof body.lotsByInstrument === 'object'
    ? body.lotsByInstrument
    : {};
  session.config = {
    instruments: keys,
    lots: Math.max(1, numOr(lotsByInstrument[keys[0]], numOr(body.lots, 1))),
    lotsByInstrument,
    maxTradesPerDay: Math.max(1, numOr(body.maxTradesPerDay, 3)),
    dayLossStopRs: numOr(body.dayLossStopRs, DAY_LOSS_STOP_RS),
    dayProfitTargetRs: numOr(body.dayProfitTargetRs, DAY_PROFIT_TARGET_RS),
    entryPts: body.entryPts != null && body.entryPts !== '' ? numOr(body.entryPts, null) : null,
  };
  session.status = 'running';
  session.message = `S/R Live on · ${keys.join('+')} · ${session.config.lots} lot(s) · real MIS`;
  session.lastError = null;
  session.lastPreflight = body.liveAssistant || null;
  session.entered = new Set();
  session.openSignal = new Map();
  session.broker = new LiveBroker({
    pushEvent: (a, d) => pushEvent(session, a, d),
    realOrders: true,
  });
  session.broker.setMaxOpenLegs(0);
  for (const k of keys) {
    const nLots = Math.max(1, numOr(lotsByInstrument[k], session.config.lots));
    session.broker.setLots(SPEC[k].bookId, nLots);
    if (OPTION_SL_MAX_RS[k] != null) {
      session.broker.setOptionMaxLossRs(SPEC[k].bookId, OPTION_SL_MAX_RS[k] * nLots);
    }
  }
  pushEvent(session, 'START', session.message);
  try {
    await session.broker.reconcileFromBroker(auth);
  } catch (e) {
    pushEvent(session, 'ERROR', `reconcile: ${e.message}`);
  }
  startTick(session);
  persistSrSession(session);
  return statusPayload(session);
}

async function stop(userId) {
  const session = getSession(userId);
  session.status = 'stopped';
  session.message = 'Stopped by user — no new S/R live orders';
  if (session.tickTimer) {
    clearInterval(session.tickTimer);
    session.tickTimer = null;
  }
  pushEvent(session, 'STOP', session.message);
  persistSrSession(session);
  return statusPayload(session);
}

function startTick(session) {
  if (session.tickTimer) return;
  const run = () => {
    if (session.status !== 'running') return;
    const started = Number(session.tickStartedAt) || 0;
    if (session.tickBusy && started && Date.now() - started > TICK_STUCK_MS) {
      session.tickBusy = false;
      session.lastError = 'Live tick stuck on Kite history — retrying';
      pushEvent(session, 'ERROR', session.lastError);
    }
    void onTick(session).catch((err) => {
      session.tickBusy = false;
      session.lastError = String(err.message || err);
      pushEvent(session, 'ERROR', session.lastError);
    });
  };
  run();
  session.tickTimer = setInterval(run, TICK_MS);
}

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function parseMcxCsv(csv) {
  const lines = String(csv || '').trim().split('\n');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const token = String(p[0] || '').replace(/"/g, '');
    const sym = String(p[2] || '').replace(/"/g, '');
    const name = String(p[3] || '').replace(/"/g, '');
    const expiry = String(p[5] || '').replace(/"/g, '');
    const strike = Number(p[6]);
    const lotSize = Number(p[8]) || 1;
    const type = String(p[9] || '').replace(/"/g, '');
    if (!/^CRUDEOILM/.test(sym)) continue;
    rows.push({ token, sym, name, expiry, strike, lotSize, type });
  }
  return rows;
}

async function resolveCrudeFuture(authorization, session, today) {
  const cached = session.crudeFuture;
  if (cached && cached.date === today && cached.token) return cached;
  const csv = await market.fetchInstrumentsCsv(authorization, 'MCX');
  const futs = parseMcxCsv(csv).filter((r) => r.type === 'FUT' && r.expiry > today);
  futs.sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));
  if (!futs.length) throw new Error('No live CRUDEOILM future found');
  const fut = { date: today, token: futs[0].token, symbol: futs[0].sym, expiry: futs[0].expiry, csv };
  session.crudeFuture = fut;
  return fut;
}

function crudeStrikeStep(optRows, atm) {
  const strikes = [...new Set(optRows.map((r) => r.strike).filter((s) => s > 0))].sort((a, b) => a - b);
  let best = 50;
  let bestDist = Infinity;
  for (let i = 1; i < strikes.length; i++) {
    const d = strikes[i] - strikes[i - 1];
    if (d <= 0) continue;
    const mid = (strikes[i] + strikes[i - 1]) / 2;
    const dist = Math.abs(mid - atm);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best || 50;
}

function selectNearestFut(rows, root, today) {
  const want = String(root || '').toUpperCase();
  const list = (rows || []).filter((r) =>
    String(r.name || '').toUpperCase() === want &&
    String(r.instrumentType || '').toUpperCase() === 'FUT' &&
    Number(r.instrumentToken) > 0,
  );
  const expiries = [...new Set(list.map((r) => r.expiry).filter(Boolean))].sort();
  const expiry = selectTradeExpiry(expiries, today);
  if (!expiry) return null;
  return list.find((r) => r.expiry === expiry) || null;
}

async function pickIndexFuture(authorization, spec, session, today) {
  session = session || {};
  const inst = session.nfoInstruments
    || (session.nfoInstruments = await market.fetchInstruments(authorization));
  const found = selectNearestFut(inst, spec.root, today || todayIso());
  if (!found) return null;
  let ltp = null;
  try {
    const qmap = await market.fetchQuotes(authorization, ['NFO:' + found.tradingSymbol]);
    ltp = qmap['NFO:' + found.tradingSymbol]?.last_price ?? null;
  } catch (_) { /* paper can price from index pts without LTP */ }
  return {
    tradingSymbol: found.tradingSymbol,
    instrumentToken: Number(found.instrumentToken) || 0,
    exchange: 'NFO',
    lotSize: Math.max(1, Number(found.lotSize) || spec.unitsPerLot),
    optionEntryPremium: ltp,
  };
}

async function pickOption(authorization, spec, trade, session) {
  session = session || {};
  const intent = confirmDirection(trade);
  const dir = intent.side === 'BUY' ? 1 : -1;
  const type = intent.optionType;
  const today = trade.date || todayIso();
  const spot = trade.entryPrice;

  if (spec.exchange === 'MCX') {
    const fut = await resolveCrudeFuture(authorization, session, today);
    const optRows = parseMcxCsv(fut.csv || await market.fetchInstrumentsCsv(authorization, 'MCX'))
      .filter((r) => r.type === type && r.expiry === fut.expiry && Number(r.token) > 0);
    const step = crudeStrikeStep(optRows, spot) || spec.step;
    const atm = Math.round(spot / step) * step;
    const candStrikes = dir > 0 ? [atm - step, atm, atm + step] : [atm + step, atm, atm - step];
    const candMeta = [];
    for (const strike of candStrikes) {
      const found = optRows.find((r) => r.strike === strike);
      if (found) candMeta.push(found);
    }
    if (!candMeta.length) return null;
    if (session.paperPick) {
      candMeta.sort((a, b) => Math.abs(a.strike - atm) - Math.abs(b.strike - atm));
      const pick = candMeta[0];
      return {
        tradingSymbol: pick.sym,
        instrumentToken: Number(pick.token) || 0,
        exchange: 'MCX',
        lotSize: Math.max(1, Number(pick.lotSize) || 1),
        optionEntryPremium: null,
        strike: Number(pick.strike) || atm,
        instrumentType: type,
        expiry: fut.expiry,
        expiryRolled: parseMcxCsv(fut.csv || '').some((r) => r.type === 'FUT' && r.expiry === today),
      };
    }
    const keys = candMeta.map((m) => 'MCX:' + m.sym);
    if (fut.symbol) keys.push('MCX:' + fut.symbol);
    const qmap = await market.fetchQuotes(authorization, keys);
    const cands = candMeta.map((m) => {
      const q = qmap['MCX:' + m.sym];
      const ltp = q?.last_price ?? null;
      const bid = q?.depth?.buy?.[0]?.price ?? null;
      const ask = q?.depth?.sell?.[0]?.price ?? null;
      const spread = bid != null && ask != null ? ask - bid : 0;
      const spreadPct = ltp ? spread / ltp : 1;
      return {
        ...m, ltp, ask,
        rank: (q?.oi || 0) / 1e6 - spreadPct * 20 - Math.abs(m.strike - atm) / step * 0.5,
      };
    }).filter((c) => c.ltp);
    if (!cands.length) return null;
    cands.sort((a, b) => b.rank - a.rank);
    const pick = cands[0];
    return {
      tradingSymbol: pick.sym,
      instrumentToken: Number(pick.token) || 0,
      exchange: 'MCX',
      lotSize: Math.max(1, Number(pick.lotSize) || 1),
      optionEntryPremium: pick.ask || pick.ltp,
    };
  }

  const liveInst = session.nfoInstruments
    || (session.nfoInstruments = await market.fetchInstruments(authorization).catch(() => []));
  if (session.paperPick && liveInst.length && !session._srArchived) {
    session._srArchived = true;
    if (!getDb()) {
      try { await connectMongo(); } catch (_) { /* paper still uses live + file cache */ }
    }
    await archiveSrInstruments(liveInst).catch(() => {});
  }
  let inst = liveInst;
  if (session.paperPick) {
    if (!session.nfoWithArchive) {
      if (!getDb()) {
        try { await connectMongo(); } catch (_) { /* live-only fallback */ }
      }
      session.nfoWithArchive = await instrumentsWithArchive(liveInst);
    }
    inst = optionStore.mergeNfoInstruments(session.nfoWithArchive, optionStore.listContracts(), spec.root, type);
  }
  const rows = inst.filter((r) =>
    String(r.name || '').toUpperCase() === spec.root &&
    String(r.instrumentType || '').toUpperCase() === type &&
    (r.exchange === 'NFO' || !r.exchange) &&
    Number(r.instrumentToken) > 0,
  ).map((r) => ({
    ...r,
    expiry: optionStore.expiryIso(r.expiry),
    strike: Number(r.strike),
    instrumentToken: Number(r.instrumentToken),
  }));
  const expiries = [...new Set(rows.map((r) => r.expiry).filter(Boolean))].sort();
  const expiry = session.paperPick
    ? optionStore.pickFrontExpiry(expiries, today, 14)
    : selectTradeExpiry(expiries, today);
  if (!expiry) return null;
  const expiryRolled = expiries.includes(today);
  const atm = Math.round(spot / spec.step) * spec.step;
  const candStrikes = dir > 0 ? [atm - spec.step, atm, atm + spec.step] : [atm + spec.step, atm, atm - spec.step];
  const candMeta = [];
  for (const strike of candStrikes) {
    const found = rows.find((r) => r.expiry === expiry && r.strike === strike);
    if (found) candMeta.push(found);
  }
  if (!candMeta.length) return null;
  if (session.paperPick) {
    candMeta.sort((a, b) => Math.abs(a.strike - atm) - Math.abs(b.strike - atm));
    const pick = candMeta[0];
      return {
        tradingSymbol: pick.tradingSymbol,
        instrumentToken: Number(pick.instrumentToken) || 0,
        exchange: 'NFO',
        lotSize: Math.max(1, Number(pick.lotSize) || spec.unitsPerLot),
        optionEntryPremium: null,
        expiry: pick.expiry,
        strike: pick.strike,
        instrumentType: type,
        expiryRolled,
      };
  }
  const keys = candMeta.map((m) => 'NFO:' + m.tradingSymbol).concat([spec.spotKey]);
  const qmap = await market.fetchQuotes(authorization, keys);
  const cands = candMeta.map((m) => {
    const q = qmap['NFO:' + m.tradingSymbol];
    const ltp = q?.last_price ?? null;
    const bid = q?.depth?.buy?.[0]?.price ?? null;
    const ask = q?.depth?.sell?.[0]?.price ?? null;
    const spread = bid != null && ask != null ? ask - bid : 0;
    const spreadPct = ltp ? spread / ltp : 1;
    return {
      ...m, ltp, ask,
      rank: (q?.oi || 0) / 1e6 - spreadPct * 20 - Math.abs(m.strike - atm) / spec.step * 0.5,
    };
  }).filter((c) => c.ltp);
  if (!cands.length) return null;
  cands.sort((a, b) => b.rank - a.rank);
  const pick = cands[0];
  return {
    tradingSymbol: pick.tradingSymbol,
    instrumentToken: Number(pick.instrumentToken) || 0,
    exchange: 'NFO',
    lotSize: Math.max(1, Number(pick.lotSize) || spec.unitsPerLot),
    optionEntryPremium: pick.ask || pick.ltp,
    expiry: pick.expiry,
    strike: pick.strike,
    instrumentType: type,
    expiryRolled,
  };
}

async function pickFreshLiveEntry(session, authorization, spec, key, trades, hm, lots) {
  for (const t of trades) {
    const id = signalId(key, t);
    if (session.entered.has(id)) continue;
    const act = decideLiveAction({
      trade: t, nowHm: hm, alreadyOpen: false, squareOffHm: spec.session.squareOffHm,
    });
    if (act !== 'enter') {
      if (act === 'skip' && !session.entered.has(id)) {
        const age = hmToMin(hm) - hmToMin(t.entryTime);
        pushEvent(
          session,
          'SKIP',
          `${t.entryTime} ${spec.name} ${t.exitReason || ''} — not entering (${age}m after entry, need <${FRESH_MINUTES}m)`,
        );
        session.entered.add(id);
      }
      continue;
    }
    const auto = store.statusFor(session.userId);
    const risk = approveLiveEntry({
      sessionRunning: session.status === 'running',
      autoBotRunning: !!(auto && auto.status === 'running'),
      enteredCount: session.entered.size,
      maxTradesPerDay: session.config && session.config.maxTradesPerDay,
      emergencyStop: !!(session.config && session.config.emergencyStop),
    });
    if (!risk.ok) {
      pushEvent(session, 'SKIP', `${t.entryTime} ${spec.name} risk: ${risk.reason}`);
      continue;
    }
    const fut = spec.vehicle === 'fut';
    const intent = confirmDirection(t);
    const tx = liveTransactionType(spec, t);
    pushEvent(session, 'DIRECTION', `${t.entryTime} ${spec.name} ${intent.side} → ${intent.optionType}`);
    const option = fut
      ? await pickIndexFuture(authorization, spec, session, t.date)
      : await pickOption(authorization, spec, t, session);
    if (!option || !(option.instrumentToken > 0)) {
      pushEvent(session, 'SKIP', `${spec.name}: no ${fut ? 'Nifty future' : 'option contract'} to trade`);
      session.entered.add(id);
      continue;
    }
    const rolled = !!(option.expiryRolled);
    pushEvent(
      session,
      'SELECT',
      `${spec.name} ${option.tradingSymbol}` +
        (option.expiry ? ` exp ${option.expiry}` : '') +
        (rolled ? ' (next weekly — not today’s expiry)' : ''),
    );
    pushEvent(
      session,
      'SIGNAL',
      `${t.entryTime} ${spec.name} enter ${option.tradingSymbol || spec.name}` +
        ` @ ${t.entryPrice} — Kite ${tx} + SL`,
    );
    session.entered.add(id);
    session.openSignal.set(spec.bookId, id);
    return {
      option,
      optionEntryPremium: option.optionEntryPremium,
      indexEntry: t.entryPrice,
      indexStop: indexStopPrice(t, spec),
      indexTarget: t.side === 'BUY' ? t.entryPrice + (t.target || 20) : t.entryPrice - (t.target || 20),
      entryTime: t.entryTime,
      direction: tx,
      vehicle: fut ? 'fut' : 'option',
      skipChargeGate: true,
      // Resting SL stays put. Engine leave → broker cancels SL then exits.
      // Do not run Auto Bot peak-trail while S/R is holding.
      protectOnly: true,
    };
  }
  return null;
}

async function onTick(session) {
  if (session.tickBusy) return;
  session.tickBusy = true;
  session.tickStartedAt = Date.now();
  try {
    const authorization = await store.getAuthorizationFor(session.userId);
    if (!authorization) {
      session.lastError = 'Kite token missing — Push Token, then Start Live again.';
      return;
    }
    const today = todayIso();
    const hm = nowHm();
    const cfg = session.config;
    const watchBits = [];

    for (const key of cfg.instruments) {
      const spec = SPEC[key];
      if (!spec) continue;
      const lots = Math.max(1, numOr(
        cfg.lotsByInstrument && cfg.lotsByInstrument[key],
        cfg.lots,
      ));
      try {
        const warmupFrom = shiftDays(today, -12);
        let token = spec.token;
        if (key === 'crude') {
          const fut = await resolveCrudeFuture(authorization, session, today);
          token = fut.token;
        }
        if (!token) throw new Error('missing instrument token');
        const candles = await withTimeout(
          market.fetchHistorical5m(authorization, token, warmupFrom, today),
          HISTORY_TIMEOUT_MS,
          `${spec.name} 5m`,
        );
        const entryPts = cfg.entryPts != null ? cfg.entryPts : spec.entryPts;
        const perPoint = spec.unitsPerLot * lots;
        const dayLossStop = cfg.dayLossStopRs > 0 ? cfg.dayLossStopRs / perPoint : 0;
        const dayProfitTarget = cfg.dayProfitTargetRs > 0 ? cfg.dayProfitTargetRs / perPoint : 0;
        const { trades } = runSrBreakout(candles, {
          entryPts, trendBars: 20, gapLo: spec.gapLo, gapHi: spec.gapHi,
          targetByScore: spec.targetByScore, maxTradesPerDay: cfg.maxTradesPerDay,
          dayLossStop, dayProfitTarget, reportFromDate: today, ...spec.session,
          // Rebuilt with the session's lot size: the rupee cut-off is a TOTAL,
          // so its point distance depends on lots. spec.opts is the 1-lot form
          // kept for the Paper/Live equality self-test.
          ...exitOptsFor(key, lots),
        });
        const last = trades[trades.length - 1];
        watchBits.push(
          last
            ? `${spec.name} ${trades.length} · ${last.entryTime} ${last.option || last.side} ${last.exitReason}`
            : `${spec.name} 0 setups`,
        );

        const bookId = spec.bookId;
        const current = session.broker.positions.get(bookId);
        const openId = session.openSignal.get(bookId) || null;
        const openTrade = openId ? trades.find((t) => signalId(key, t) === openId) : null;

        let open = null;
        if (current?.status === 'open') {
          const opt = current.tradingSymbol
            ? {
              tradingSymbol: current.tradingSymbol,
              instrumentToken: current.instrumentToken,
              exchange: current.exchange || spec.exchange || 'NFO',
              lotSize: Math.max(1, Number(current.quantity) || spec.unitsPerLot),
            }
            : null;
          // Match the Kite fill to ITS engine row only. Never attach the next
          // still-open Paper leg (12:10 / 13:20) onto an 11:50 PE we still hold.
          const tracked = matchHeldEngineTrade(trades, openTrade, current);
          const nextOpen = trades.find((t) => engineTradeStillOpen(t, hm)) || null;
          if (tracked && mustExitHeldForNewLeg(current, tracked)) {
            pushEvent(
              session,
              'SIGNAL',
              `${spec.name} exit · next engine leg ${tracked.entryTime} — flatten held ${current.entryTime || 'adopted'} option first`,
            );
            session.openSignal.delete(bookId);
          } else if (!tracked && nextOpen && mustExitHeldForNewLeg(current, nextOpen)) {
            pushEvent(
              session,
              'SIGNAL',
              `${spec.name} exit · next engine leg ${nextOpen.entryTime} — flatten held ${current.entryTime || 'adopted'} option first`,
            );
            session.openSignal.delete(bookId);
          } else if (tracked) {
            const act = decideLiveAction({
              trade: tracked, nowHm: hm, alreadyOpen: true, squareOffHm: spec.session.squareOffHm,
            });
            if (act === 'hold' && opt) {
              session.openSignal.set(bookId, signalId(key, tracked));
              open = {
                option: opt,
                indexEntry: tracked.entryPrice,
                indexStop: indexStopPrice(tracked, spec),
                indexTarget: tracked.side === 'BUY' ? tracked.entryPrice + tracked.target : tracked.entryPrice - tracked.target,
                entryTime: tracked.entryTime,
                skipChargeGate: true,
                protectOnly: true,
                direction: current.direction || liveTransactionType(spec, tracked),
                vehicle: current.vehicle || spec.vehicle || 'option',
              };
            } else if (act === 'exit') {
              pushEvent(
                session,
                'SIGNAL',
                `${spec.name} exit · ${tracked.exitReason} at ${tracked.exitTime}` +
                  ` ${current.tradingSymbol || ''} ${tracked.entryPrice} → ${tracked.exitPrice}`,
              );
              session.openSignal.delete(bookId);
            }
          } else if (hm >= spec.session.squareOffHm || (trades.length > 0 && !engineBookHasOpenTrade(trades, hm))) {
            if (trades.length > 0 && !engineBookHasOpenTrade(trades, hm)) {
              pushEvent(session, 'SIGNAL', `${spec.name} exit · engine book is flat — flattening leftover option`);
            }
            session.openSignal.delete(bookId);
          } else if (opt) {
            open = {
              option: opt,
              indexEntry: current.indexEntry,
              indexStop: current.indexStop,
              entryTime: current.entryTime,
              skipChargeGate: true,
              protectOnly: true,
              direction: current.direction || 'BUY',
              vehicle: current.vehicle || spec.vehicle || 'option',
            };
          }
        } else {
          open = await pickFreshLiveEntry(session, authorization, spec, key, trades, hm, lots);
        }

        await session.broker.syncInstrument({
          authorization,
          instrumentId: bookId,
          instrumentName: spec.name,
          open,
          lots,
        });
        const after = session.broker.positions.get(bookId);
        if (!open && (!after || after.status === 'flat' || after.status === 'error')) {
          const next = await pickFreshLiveEntry(session, authorization, spec, key, trades, hm, lots);
          if (next) {
            await session.broker.syncInstrument({
              authorization,
              instrumentId: bookId,
              instrumentName: spec.name,
              open: next,
              lots,
            });
          }
        }
      } catch (e) {
        watchBits.push(`${spec.name} error`);
        pushEvent(session, 'ERROR', `${spec.name}: ${e.message}`);
      }
    }
    const watch = `${hm} ${watchBits.join(' · ') || 'no books'}`;
    if (session.lastWatch !== watch) {
      pushEvent(session, 'WATCH', watch);
      session.lastWatch = watch;
    }
    session.message = `S/R Live · ${watch}`;
    session.lastTickAt = new Date().toISOString();
    session.lastError = null;
    persistSrSession(session);
  } finally {
    session.tickBusy = false;
  }
}

function status(userId) {
  return statusPayload(getSession(userId));
}

module.exports = {
  start, stop, status, decideLiveAction, applyDeskLimits, signalId, hmToMin,
  engineTradeStillOpen, engineBookHasOpenTrade, mustExitHeldForNewLeg, matchHeldEngineTrade, pickOption, pickIndexFuture, selectNearestFut, liveTransactionType, liveTradesFromBroker, SPEC, FRESH_MINUTES, _sessions: sessions,
};
