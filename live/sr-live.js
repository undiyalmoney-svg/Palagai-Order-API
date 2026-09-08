'use strict';
/**
 * S/R Breakout LIVE worker — places real MIS option buys when the same engine
 * that powers Paper fires a fresh signal. Opt-in only (Start Live). Paper,
 * observe, and the collector stay read-only.
 */
const market = require('./kite-market');
const store = require('./live.store');
const { runSrBreakout } = require('./sr-breakout');
// Exit/entry rules come from the SHARED config so Live and Paper cannot drift.
const { exitOptsFor, DEFAULT_LOTS, DAY_LOSS_STOP_RS, DAY_PROFIT_TARGET_RS, LOT_UNITS, OPTION_SL_MAX_RS } = require('./sr-strategy-config');
const { LiveBroker } = require('./live-broker');
const { NIFTY_50_INSTRUMENT, BANK_NIFTY_INSTRUMENT, CRUDE_OIL_MINI_INSTRUMENT } = require('./strategy-core.cjs');

const TICK_MS = Number(process.env.SR_LIVE_INTERVAL_MS || 60_000);
const FRESH_MINUTES = 20;

const SPEC = {
  nifty: {
    key: 'nifty', name: 'Nifty 50', token: '256265', unitsPerLot: LOT_UNITS.nifty,
    bookId: NIFTY_50_INSTRUMENT.id, root: 'NIFTY', step: 50, spotKey: 'NSE:NIFTY 50',
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' },
    entryPts: 27, gapLo: 100, gapHi: 175, targetByScore: { 1: 20, 2: 25, 3: 30 },
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
  if (sessionOver || finished) return 'skip';
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
      tickTimer: null,
      tickBusy: false,
      broker: null,
    });
  }
  return sessions.get(id);
}

function pushEvent(session, action, detail) {
  session.events.push({ at: new Date().toISOString(), action, detail: String(detail || '') });
  if (session.events.length > 200) session.events.splice(0, session.events.length - 200);
}

function statusPayload(session) {
  const positions = [];
  if (session.broker) {
    for (const [instrumentId, p] of session.broker.positions.entries()) {
      positions.push({
        instrumentId,
        symbol: p.tradingSymbol,
        status: p.status,
        entryTime: p.entryTime,
        quantity: p.quantity,
      });
    }
  }
  return {
    status: 'ok',
    running: session.status === 'running',
    mode: 'live-broker',
    liveBrokerOrders: session.status === 'running' ? 'ENABLED' : 'OFF',
    message: session.message,
    lastTickAt: session.lastTickAt,
    lastError: session.lastError,
    config: session.config,
    entered: [...session.entered],
    openSignals: Object.fromEntries(session.openSignal),
    positions,
    kitePnl: session.broker && typeof session.broker.moneySnapshot === 'function'
      ? session.broker.moneySnapshot()
      : { closedRs: 0, openRs: 0, netRs: 0, legs: [] },
    events: session.events.slice(-80),
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
  if (auto && auto.status === 'running') {
    const err = new Error('Auto Bot Live is already running. Stop Auto Bot before starting S/R Live.');
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
  const auth = await store.getAuthorizationFor(userId);
  if (!auth) {
    const err = new Error('Push Kite token first, then Start Live.');
    err.status = 400;
    throw err;
  }
  session.config = {
    instruments: keys,
    lots: Math.max(1, numOr(body.lots, 1)),
    maxTradesPerDay: Math.max(1, numOr(body.maxTradesPerDay, 3)),
    dayLossStopRs: numOr(body.dayLossStopRs, DAY_LOSS_STOP_RS),
    dayProfitTargetRs: numOr(body.dayProfitTargetRs, DAY_PROFIT_TARGET_RS),
    entryPts: body.entryPts != null && body.entryPts !== '' ? numOr(body.entryPts, null) : null,
  };
  session.status = 'running';
  session.message = `S/R Live on · ${keys.join('+')} · ${session.config.lots} lot(s) · real MIS`;
  session.lastError = null;
  session.entered = new Set();
  session.openSignal = new Map();
  session.broker = new LiveBroker({
    pushEvent: (a, d) => pushEvent(session, a, d),
    realOrders: true,
  });
  session.broker.setMaxOpenLegs(0);
  for (const k of keys) {
    session.broker.setLots(SPEC[k].bookId, session.config.lots);
    if (OPTION_SL_MAX_RS[k] != null) {
      session.broker.setOptionMaxLossRs(SPEC[k].bookId, OPTION_SL_MAX_RS[k] * session.config.lots);
    }
  }
  pushEvent(session, 'START', session.message);
  try {
    await session.broker.reconcileFromBroker(auth);
  } catch (e) {
    pushEvent(session, 'ERROR', `reconcile: ${e.message}`);
  }
  startTick(session);
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

async function pickOption(authorization, spec, trade, session) {
  session = session || {};
  const dir = trade.side === 'BUY' ? 1 : -1;
  const type = dir > 0 ? 'CE' : 'PE';
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

  const inst = session.nfoInstruments
    || (session.nfoInstruments = await market.fetchInstruments(authorization));
  const rows = inst.filter((r) =>
    String(r.name || '').toUpperCase() === spec.root &&
    r.instrumentType === type &&
    r.exchange === 'NFO' &&
    r.instrumentToken > 0,
  );
  const expiries = [...new Set(rows.map((r) => r.expiry).filter(Boolean))].sort();
  const expiry = expiries.find((e) => e > today) || expiries.find((e) => e >= today) || null;
  if (!expiry) return null;
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
  };
}

async function pickFreshLiveEntry(session, authorization, spec, key, trades, hm, lots) {
  for (const t of trades) {
    const id = signalId(key, t);
    if (session.entered.has(id)) continue;
    const act = decideLiveAction({
      trade: t, nowHm: hm, alreadyOpen: false, squareOffHm: spec.session.squareOffHm,
    });
    if (act !== 'enter') continue;
    pushEvent(session, 'SIGNAL', `${t.entryTime} ${spec.name} ${t.option} — placing live BUY`);
    const option = await pickOption(authorization, spec, t, session);
    if (!option || !(option.instrumentToken > 0)) {
      pushEvent(session, 'SKIP', `${spec.name}: no option contract to buy`);
      session.entered.add(id);
      continue;
    }
    session.entered.add(id);
    session.openSignal.set(spec.bookId, id);
    return {
      option,
      optionEntryPremium: option.optionEntryPremium,
      indexEntry: t.entryPrice,
      indexStop: indexStopPrice(t, spec),
      indexTarget: t.side === 'BUY' ? t.entryPrice + (t.target || 20) : t.entryPrice - (t.target || 20),
      entryTime: t.entryTime,
    };
  }
  return null;
}

async function onTick(session) {
  if (session.tickBusy) return;
  session.tickBusy = true;
  try {
    const authorization = await store.getAuthorizationFor(session.userId);
    if (!authorization) {
      session.lastError = 'Kite token missing — Push Token, then Start Live again.';
      return;
    }
    const today = todayIso();
    const hm = nowHm();
    const cfg = session.config;
    const lots = cfg.lots;

    for (const key of cfg.instruments) {
      const spec = SPEC[key];
      if (!spec) continue;
      try {
        const warmupFrom = shiftDays(today, -12);
        let token = spec.token;
        if (key === 'crude') {
          const fut = await resolveCrudeFuture(authorization, session, today);
          token = fut.token;
        }
        if (!token) throw new Error('missing instrument token');
        const candles = await market.fetchHistorical5m(authorization, token, warmupFrom, today);
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
              };
            } else if (act === 'exit') {
              pushEvent(session, 'SIGNAL', `${spec.name} exit · ${tracked.exitReason} at ${tracked.exitTime}`);
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
        pushEvent(session, 'ERROR', `${spec.name}: ${e.message}`);
      }
    }
    session.lastTickAt = new Date().toISOString();
    session.lastError = null;
  } finally {
    session.tickBusy = false;
  }
}

function status(userId) {
  return statusPayload(getSession(userId));
}

module.exports = {
  start, stop, status, decideLiveAction, applyDeskLimits, signalId, hmToMin,
  engineTradeStillOpen, engineBookHasOpenTrade, mustExitHeldForNewLeg, matchHeldEngineTrade, pickOption, SPEC, FRESH_MINUTES, _sessions: sessions,
};
