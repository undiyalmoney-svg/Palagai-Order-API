'use strict';
/**
 * Crude Bot — new evening squeeze-break on MCX CRUDEOILM futures.
 *
 * Not S/R wall-break. Not Autobot. Not live-crude-green (morning OR 09:00–09:30
 * then 16:00 entries). Those desks never paid; this book is a different rule:
 *
 *   17:00–17:45 IST coil (width 12–28 pts)
 *   first 5m close beyond the coil after 17:50
 *   1 MIS futures lot-unit, SL then 1.8R, square-off 21:30
 *   max 1 trade / day
 *
 * Paper ₹ = points × ₹10 × lots − charges. Live buys/sells the mini future.
 */
const defaultMarket = require('./kite-market');
const store = require('./live.store');
const { lotsFromAvailableFunds } = require('./daily-desk-defaults');
const { resolveDeskCapital } = require('./sr-desk');
const { LiveBroker } = require('./live-broker');

const ENGINE = 'crude-desk';
const STRATEGY_ID = 'crude-squeeze';
const STRATEGY_VERSION = '2026.09-squeeze';
const BOOK_ID = 'crude-oil-mini';
const RS_PER_POINT = 10;
const CHARGE_RS = 40;
const DAY_LOSS_STOP_RS = 2500;
const DAY_PROFIT_TARGET_RS = 4000;
const TICK_MS = Number(process.env.CRUDE_BOT_INTERVAL_MS || 60_000);

const RULES = {
  squeezeStart: '17:00',
  squeezeEnd: '17:45',
  entryStart: '17:50',
  entryEnd: '21:00',
  squareOff: '21:30',
  minWidth: 12,
  maxWidth: 28,
  breakBuf: 2,
  maxStopPts: 18,
  targetR: 1.8,
  maxTargetPts: 32,
  maxTradesDay: 1,
};

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
function barDay(bar) {
  return String(bar?.date || '').slice(0, 10);
}
function barHm(bar) {
  const s = String(bar?.date || bar?.time || '');
  const m = s.match(/T(\d{2}):(\d{2})/) || String(bar?.hm || '').match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
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

function squeezeOf(dayBars) {
  const lo = hmToMin(RULES.squeezeStart);
  const hi = hmToMin(RULES.squeezeEnd);
  const coil = dayBars.filter((b) => {
    const m = hmToMin(barHm(b));
    return m >= lo && m <= hi;
  });
  if (coil.length < 3) return null;
  const high = Math.max(...coil.map((b) => Number(b.high)));
  const low = Math.min(...coil.map((b) => Number(b.low)));
  const width = high - low;
  if (!(width >= RULES.minWidth && width <= RULES.maxWidth)) {
    return { skip: true, high, low, width, reason: `coil ${round2(width)}pts (want ${RULES.minWidth}–${RULES.maxWidth})` };
  }
  return { skip: false, high, low, width };
}

function mapRow(t, lots, symbol) {
  const perPoint = RS_PER_POINT * lots;
  const pts = Number(t.points) || 0;
  const gross = pts * perPoint;
  const net = t.open ? gross : gross - CHARGE_RS * lots;
  const entryHm = `${t.entryTime}:00`;
  const exitHm = t.exitTime ? `${t.exitTime}:00` : null;
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
    indexStop: t.stop,
    indexTarget: t.target,
    stopPts: Math.abs(t.entryPrice - t.stop),
    slTrigger: t.stop,
    slPrice: t.stop,
    slOn: true,
    optionEntryPremium: t.entryPrice,
    optionExitPremium: t.exitPrice,
    optionPnlRs: Math.round(gross),
    netOptionPnlRs: Math.round(net),
    indexPoints: round2(pts),
    exitReason: t.exitReason,
    open: !!t.open,
    lots,
    premiumSource: 'mcx_fut',
    vehicle: 'fut',
  };
}

/**
 * Replay 5m CRUDEOILM candles. Does not call runSrBreakout or crude DNA.
 */
function replaySqueeze(candles, { lots = 1, fromDate, toDate, symbol, forceCloseOpen = true } = {}) {
  const grouped = new Map();
  for (const bar of candles || []) {
    const day = barDay(bar);
    const hm = barHm(bar);
    if (!day || !hm) continue;
    if (fromDate && day < fromDate) continue;
    if (toDate && day > toDate) continue;
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push(bar);
  }
  const trades = [];
  let dayPnl = 0;
  let dayKey = '';

  for (const [day, raw] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (day !== dayKey) {
      dayKey = day;
      dayPnl = 0;
    }
    const dayBars = raw.slice().sort((a, b) => barHm(a).localeCompare(barHm(b)));
    const coil = squeezeOf(dayBars);
    if (!coil || coil.skip) continue;
    if (dayPnl <= -DAY_LOSS_STOP_RS || dayPnl >= DAY_PROFIT_TARGET_RS) continue;

    let open = null;
    let taken = 0;
    for (const bar of dayBars) {
      const hm = barHm(bar);
      const mins = hmToMin(hm);
      if (open) {
        const dir = open.side === 'SELL' ? -1 : 1;
        let exit = null;
        let why = null;
        if (dir > 0) {
          if (Number(bar.low) <= open.stop) {
            exit = open.stop;
            why = 'SL';
          } else if (Number(bar.high) >= open.target) {
            exit = open.target;
            why = 'TARGET';
          }
        } else if (Number(bar.high) >= open.stop) {
          exit = open.stop;
          why = 'SL';
        } else if (Number(bar.low) <= open.target) {
          exit = open.target;
          why = 'TARGET';
        }
        if (!exit && mins >= hmToMin(RULES.squareOff)) {
          exit = Number(bar.close);
          why = 'SQUARE';
        }
        if (exit != null) {
          const points = dir * (exit - open.entryPrice);
          const row = {
            date: day,
            side: open.side,
            entryTime: open.entryTime,
            exitTime: hm,
            entryPrice: open.entryPrice,
            exitPrice: exit,
            stop: open.stop,
            target: open.target,
            points,
            exitReason: why,
            open: false,
          };
          trades.push(mapRow(row, lots, symbol));
          dayPnl += (points * RS_PER_POINT - CHARGE_RS) * lots;
          open = null;
        }
        continue;
      }
      if (taken >= RULES.maxTradesDay) continue;
      if (mins < hmToMin(RULES.entryStart) || mins > hmToMin(RULES.entryEnd)) continue;
      const px = Number(bar.close);
      let side = null;
      if (px >= coil.high + RULES.breakBuf) side = 'BUY';
      else if (px <= coil.low - RULES.breakBuf) side = 'SELL';
      if (!side) continue;
      const dir = side === 'SELL' ? -1 : 1;
      const stopRaw = side === 'BUY' ? coil.low : coil.high;
      const stop = side === 'BUY'
        ? Math.max(stopRaw, px - RULES.maxStopPts)
        : Math.min(stopRaw, px + RULES.maxStopPts);
      const risk = Math.abs(px - stop);
      if (!(risk >= 4)) continue;
      const tgtPts = Math.min(RULES.maxTargetPts, risk * RULES.targetR);
      const target = px + dir * tgtPts;
      open = { side, entryTime: hm, entryPrice: px, stop, target };
      taken += 1;
    }
    if (open) {
      const last = dayBars[dayBars.length - 1];
      const lastHm = barHm(last);
      if (forceCloseOpen || hmToMin(lastHm) >= hmToMin(RULES.squareOff)) {
        const dir = open.side === 'SELL' ? -1 : 1;
        const exit = Number(last.close);
        trades.push(mapRow({
          date: day,
          side: open.side,
          entryTime: open.entryTime,
          exitTime: lastHm,
          entryPrice: open.entryPrice,
          exitPrice: exit,
          stop: open.stop,
          target: open.target,
          points: dir * (exit - open.entryPrice),
          exitReason: 'SQUARE',
          open: false,
        }, lots, symbol));
      } else {
        trades.push(mapRow({
          date: day,
          side: open.side,
          entryTime: open.entryTime,
          exitTime: null,
          entryPrice: open.entryPrice,
          exitPrice: null,
          stop: open.stop,
          target: open.target,
          points: 0,
          exitReason: 'OPEN',
          open: true,
        }, lots, symbol));
      }
    }
  }
  return { trades, rules: RULES };
}

function instrumentRow(trades) {
  const tot = summarize(trades);
  return {
    id: 'crude',
    instrumentName: 'Crude Oil Mini',
    status: tot.trades ? 'taken' : 'not-taken',
    ...tot,
    why: tot.trades ? 'Taken' : 'No evening squeeze-break in this window.',
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
    const warm = shiftDays(fromDate, -2);
    candles = await market.fetchHistorical5m(authorization, fut.token, warm, toDate);
  }
  const { trades } = replaySqueeze(candles, {
    lots: L,
    fromDate,
    toDate,
    symbol,
    forceCloseOpen: true,
  });
  const totals = summarize(trades);
  const book = {
    id: 'crude',
    label: 'Crude Oil Mini',
    sitOut: false,
    spec: { engine: ENGINE, strategy: STRATEGY_ID },
    specText: `CRUDEOILM FUT · evening squeeze ${RULES.squeezeStart}–${RULES.squeezeEnd} · 1 trade/day`,
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
    allocation: { taken: [{ instrumentName: 'Crude Oil Mini', bookId: 'crude', direction: 'SQUEEZE', lots: L }], trades, totals },
    specText: book.specText,
    books: [book],
    coreBooks: [book],
    note:
      'Crude Bot trades only Crude Oil Mini futures (MIS). Evening squeeze-break: coil 17:00–17:45 IST (12–28 pts), first close beyond it after 17:50, SL then 1.8R, square-off 21:30, max 1/day. Not Nifty/Bank, not S/R, not the old crude DNA. Paper ₹ is points × ₹10 × lots. SL ₹ is the futures stop.',
    instruments: [instrumentRow(trades)],
    protection: {
      fundsRs: capital,
      capitalRs: capital,
      riskPerTradeRs: Math.round(L * RULES.maxStopPts * RS_PER_POINT),
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
      : 'No evening squeeze-break in this window (need a 12–28 pt 17:00–17:45 coil, then a close outside it).',
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
      entered: false,
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
    note: 'Crude Bot live is MCX CRUDEOILM futures. Stop live on this tab stops only Crude Bot.',
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
  session.message = `Crude Bot on · CRUDEOILM FUT · ${session.lots} lot(s) · squeeze-break`;
  session.lastError = null;
  session.lastPreflight = liveAssistant || null;
  session.entered = false;
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

function engineTradeStillOpen(t) {
  return !!(t && (t.open || String(t.exitReason || '').toUpperCase() === 'OPEN'));
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
      shiftDays(today, -2),
      today,
    );
    const { trades } = replaySqueeze(candles, {
      lots: session.lots,
      fromDate: today,
      toDate: today,
      symbol: session.fut.symbol,
      forceCloseOpen: hmToMin(hm) >= hmToMin(RULES.squareOff),
    });
    session.trades = trades;
    const pos = session.broker.positions.get(BOOK_ID);
    const liveOpen = trades.find((t) => engineTradeStillOpen(t) && String(t.entryTime || '').slice(0, 10) === today);
    const done = trades.find((t) => !engineTradeStillOpen(t) && String(t.entryTime || '').slice(0, 10) === today);

    if (pos?.status === 'open') {
      const shouldExit =
        hmToMin(hm) >= hmToMin(RULES.squareOff) ||
        (done && String(done.exitReason || '') !== 'OPEN');
      if (shouldExit) {
        await session.broker.placeExit(authorization, pos, 'Crude Oil Mini');
        pushEvent(session, 'EXIT', done?.exitReason || 'SQUARE');
      }
      return;
    }

    if (liveOpen && !session.entered) {
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
      session.entered = true;
      pushEvent(session, 'SIGNAL', `${side} CRUDEOILM squeeze-break @ ${liveOpen.entryPrice}`);
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
  BOOK_ID,
  replaySqueeze,
  runCrudeDesk,
  startLive,
  stop,
  status,
  isCrudeDeskBody,
  summarize,
  resolveCrudeFuture,
  parseMcxFuts,
};
