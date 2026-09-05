'use strict';
/**
 * S/R Breakout LIVE worker — places real MIS option buys when the same engine
 * that powers Paper fires a fresh signal. Opt-in only (Start Live). Paper,
 * observe, and the collector stay read-only.
 */
const https = require('https');
const market = require('./kite-market');
const store = require('./live.store');
const { runSrBreakout } = require('./sr-breakout');
const { LiveBroker } = require('./live-broker');
const { NIFTY_50_INSTRUMENT, BANK_NIFTY_INSTRUMENT } = require('./strategy-core.cjs');

const TICK_MS = Number(process.env.SR_LIVE_INTERVAL_MS || 60_000);
const FRESH_MINUTES = 20;

const SPEC = {
  nifty: {
    key: 'nifty', name: 'Nifty 50', token: '256265', unitsPerLot: 75,
    bookId: NIFTY_50_INSTRUMENT.id, root: 'NIFTY', step: 50, spotKey: 'NSE:NIFTY 50',
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' },
    entryPts: 27, gapLo: 100, gapHi: 175, targetByScore: { 1: 20, 2: 25, 3: 30 },
    opts: { wallMode: 'intraday', retest: true, timeStopBars: 6, targetByScore: { 1: 20, 2: 20, 3: 20 } },
  },
  banknifty: {
    key: 'banknifty', name: 'Bank Nifty', token: '260105', unitsPerLot: 35,
    bookId: BANK_NIFTY_INSTRUMENT.id, root: 'BANKNIFTY', step: 100, spotKey: 'NSE:NIFTY BANK',
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' },
    entryPts: 60, gapLo: 275, gapHi: 465, targetByScore: { 1: 40, 2: 50, 3: 60 },
    opts: { wallMode: 'intraday', timeStopBars: 9, targetByScore: { 1: 20, 2: 20, 3: 20 } },
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

/**
 * Decide what Live should do for one engine trade.
 * enter = fresh signal, still in the window, not already filled.
 * exit  = we are in the trade and the engine/session says get out.
 * hold  = stay; skip = too late / already done; wait = bar not reached yet.
 */
function decideLiveAction({ trade, nowHm: hm, alreadyOpen, squareOffHm, freshMinutes = FRESH_MINUTES }) {
  const now = hmToMin(hm);
  const entry = hmToMin(trade.entryTime);
  const exit = hmToMin(trade.exitTime);
  const so = hmToMin(squareOffHm);
  const hardExit = ['TARGET', 'TIME', 'FAIL'].includes(trade.exitReason);
  const pastExit = hardExit && exit <= now;
  const sessionOver = now >= so;
  if (alreadyOpen) {
    if (sessionOver || pastExit) return 'exit';
    return 'hold';
  }
  if (sessionOver || pastExit) return 'skip';
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
    events: session.events.slice(-80),
  };
}

function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v != null ? n : d;
}

async function start(userId, body = {}) {
  const session = getSession(userId);
  if (session.status === 'running') {
    session.message = 'Already running. Stop first to change lots/instruments.';
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
    : ['nifty', 'banknifty'];
  if (!keys.length) {
    const err = new Error('Select Nifty and/or Bank Nifty. Crude Live is not wired (index options only).');
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
    dayLossStopRs: numOr(body.dayLossStopRs, 3500),
    dayProfitTargetRs: numOr(body.dayProfitTargetRs, 3500),
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
  for (const k of keys) session.broker.setLots(SPEC[k].bookId, session.config.lots);
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

function getJson(p, authorization) {
  return new Promise((res, rej) => {
    https.get({ hostname: 'api.kite.trade', path: p, headers: { 'X-Kite-Version': '3', Authorization: authorization } },
      (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}
function getText(p, authorization) {
  return new Promise((res, rej) => {
    https.get({ hostname: 'api.kite.trade', path: p, headers: { 'X-Kite-Version': '3', Authorization: authorization } },
      (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b)); }).on('error', rej);
  });
}

async function optionMap(authorization, root, type) {
  const csv = await getText('/instruments/NFO', authorization);
  const lines = csv.trim().split('\n');
  const map = new Map();
  const expiries = new Set();
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const name = (p[3] || '').replace(/"/g, '');
    const t = (p[9] || '').replace(/"/g, '');
    if (name !== root || t !== type) continue;
    const strike = Number(p[6]);
    const exp = (p[5] || '').replace(/"/g, '');
    map.set(strike + '|' + exp, { token: (p[0] || '').replace(/"/g, ''), sym: (p[2] || '').replace(/"/g, '') });
    expiries.add(exp);
  }
  return { map, expiries: [...expiries].sort() };
}

async function quotes(authorization, keys) {
  const qs = keys.map((k) => 'i=' + encodeURIComponent(k)).join('&');
  const j = await getJson('/quote?' + qs, authorization);
  return j.status === 'success' ? j.data : {};
}

async function pickOption(authorization, spec, trade) {
  const dir = trade.side === 'BUY' ? 1 : -1;
  const type = dir > 0 ? 'CE' : 'PE';
  const today = trade.date || todayIso();
  const state = await optionMap(authorization, spec.root, type);
  const spot = trade.entryPrice;
  const atm = Math.round(spot / spec.step) * spec.step;
  const expiry = state.expiries.find((e) => e > today) || state.expiries.find((e) => e >= today) || null;
  const candStrikes = dir > 0 ? [atm - spec.step, atm, atm + spec.step] : [atm + spec.step, atm, atm - spec.step];
  const candKeys = [];
  const candMeta = [];
  for (const strike of candStrikes) {
    const found = state.map.get(strike + '|' + expiry);
    if (found) { candKeys.push('NFO:' + found.sym); candMeta.push({ strike, sym: found.sym, token: found.token }); }
  }
  if (!candKeys.length) return null;
  const qmap = await quotes(authorization, candKeys.concat([spec.spotKey]));
  const cands = candMeta.map((m) => {
    const q = qmap['NFO:' + m.sym];
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
    tradingSymbol: pick.sym,
    instrumentToken: Number(pick.token) || 0,
    exchange: 'NFO',
    lotSize: spec.unitsPerLot,
    optionEntryPremium: pick.ask || pick.ltp,
  };
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
        const candles = await market.fetchHistorical5m(authorization, spec.token, warmupFrom, today);
        const entryPts = cfg.entryPts != null ? cfg.entryPts : spec.entryPts;
        const perPoint = spec.unitsPerLot * lots;
        const dayLossStop = cfg.dayLossStopRs > 0 ? cfg.dayLossStopRs / perPoint : 0;
        const dayProfitTarget = cfg.dayProfitTargetRs > 0 ? cfg.dayProfitTargetRs / perPoint : 0;
        const { trades } = runSrBreakout(candles, {
          entryPts, trendBars: 20, gapLo: spec.gapLo, gapHi: spec.gapHi,
          targetByScore: spec.targetByScore, maxTradesPerDay: cfg.maxTradesPerDay,
          dayLossStop, dayProfitTarget, reportFromDate: today, ...spec.session, ...spec.opts,
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
              exchange: current.exchange || 'NFO',
              lotSize: spec.unitsPerLot,
            }
            : null;
          if (openTrade) {
            const act = decideLiveAction({
              trade: openTrade, nowHm: hm, alreadyOpen: true, squareOffHm: spec.session.squareOffHm,
            });
            if (act === 'hold' && opt) {
              open = {
                option: opt,
                indexEntry: openTrade.entryPrice,
                indexStop: openTrade.side === 'BUY' ? openTrade.entryPrice - openTrade.target : openTrade.entryPrice + openTrade.target,
                indexTarget: openTrade.side === 'BUY' ? openTrade.entryPrice + openTrade.target : openTrade.entryPrice - openTrade.target,
                entryTime: openTrade.entryTime,
                skipChargeGate: true,
              };
            } else if (act === 'exit') {
              pushEvent(session, 'SIGNAL', `${spec.name} exit · ${openTrade.exitReason} at ${openTrade.exitTime}`);
              session.openSignal.delete(bookId);
            }
          } else if (hm >= spec.session.squareOffHm) {
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
          for (const t of trades) {
            const id = signalId(key, t);
            if (session.entered.has(id)) continue;
            const act = decideLiveAction({
              trade: t, nowHm: hm, alreadyOpen: false, squareOffHm: spec.session.squareOffHm,
            });
            if (act !== 'enter') continue;
            pushEvent(session, 'SIGNAL', `${t.entryTime} ${spec.name} ${t.option} — placing live BUY`);
            const option = await pickOption(authorization, spec, t);
            if (!option || !(option.instrumentToken > 0)) {
              pushEvent(session, 'SKIP', `${spec.name}: no option contract to buy`);
              session.entered.add(id);
              break;
            }
            session.entered.add(id);
            session.openSignal.set(bookId, id);
            open = {
              option,
              optionEntryPremium: option.optionEntryPremium,
              indexEntry: t.entryPrice,
              indexStop: t.side === 'BUY' ? t.entryPrice - (t.target || 20) : t.entryPrice + (t.target || 20),
              indexTarget: t.side === 'BUY' ? t.entryPrice + (t.target || 20) : t.entryPrice - (t.target || 20),
              entryTime: t.entryTime,
              skipChargeGate: true,
            };
            break;
          }
        }

        await session.broker.syncInstrument({
          authorization,
          instrumentId: bookId,
          instrumentName: spec.name,
          open,
          lots,
        });
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
  start, stop, status, decideLiveAction, signalId, hmToMin, SPEC, FRESH_MINUTES, _sessions: sessions,
};
