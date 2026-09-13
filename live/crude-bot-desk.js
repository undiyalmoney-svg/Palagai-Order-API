'use strict';
/**
 * Crude Bot — Nifty/Bank winning playbook on MCX CRUDEOILM futures.
 *
 * Old crude books never paid (fee-negative S/R crude; live-crude-green OR).
 * This desk does not use those. It copies the measured Nifty + Bank rules:
 *   intraday wall, 2-bar retest, +20 target, lock 20→12,
 *   time stop 6 bars, give-up off (Bank: give-up cost net), day ±₹3,500.
 * Vehicle is one ATM Crude Mini CE or PE (same as Nifty/Bank). Signals still
 * come from the CRUDEOILM future 5m. Paper In/Out are option 5m OHLC (Kite
 * listed; NSE charting has no MCX crude options). Live buys the Kite contract.
 */
const defaultMarket = require('./kite-market');
const store = require('./live.store');
const { lotsFromAvailableFunds } = require('./daily-desk-defaults');
const { resolveDeskCapital } = require('./sr-desk');
const { LiveBroker } = require('./live-broker');
const { runSrBreakout } = require('./sr-breakout');
const srLive = require('./sr-live');
const { OPTION_SL_MAX_RS, LOT_UNITS } = require('./sr-strategy-config');
const { computeProtectiveSlTrigger, resolveAtmCrudeMiniOption } = require('./strategy-core.cjs');
const {
  pickBarFlex,
  ohlcOf,
  liveLikeEntryPrem,
  liveLikeExitPrem,
  optionRupees,
  barsInHold,
  slLimitFill,
} = require('./sr-option-pnl');
const optionStore = require('./sr-option-store');

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

function parseMcxInstruments(csv) {
  const lines = String(csv || '').trim().split('\n');
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const p = lines[i].split(',');
    const token = String(p[0] || '').replace(/"/g, '');
    const sym = String(p[2] || '').replace(/"/g, '');
    const expiry = String(p[5] || '').replace(/"/g, '');
    const type = String(p[9] || '').replace(/"/g, '');
    if (!/^CRUDEOILM/.test(sym)) continue;
    rows.push({
      instrumentToken: Number(token) || 0,
      tradingSymbol: sym,
      name: 'CRUDEOILM',
      expiry,
      strike: Number(p[6]) || 0,
      lotSize: Number(p[8]) || 1,
      instrumentType: type,
      exchange: 'MCX',
    });
  }
  return rows;
}

function parseMcxFuts(csv) {
  return parseMcxInstruments(csv)
    .filter((r) => r.instrumentType === 'FUT')
    .map((r) => ({ token: String(r.instrumentToken), sym: r.tradingSymbol, expiry: r.expiry }));
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

function atmStrike(px, step = 50) {
  const n = Number(px);
  if (!(n > 0)) return null;
  return Math.round(n / step) * step;
}

function isOptionPrem(px, indexPx) {
  const n = Number(px);
  if (!(n > 0) || n >= 2500) return false;
  const idx = Number(indexPx);
  if (idx > 0 && n > idx * 0.35) return false;
  return true;
}

function attachOptionSl(row, lots) {
  const fill = Number(row.optionEntryPremium) || 0;
  const lotsN = Math.max(1, Number(lots) || 1);
  const indexRisk = row.indexStop != null && row.indexEntry != null
    ? Math.abs(Number(row.indexEntry) - Number(row.indexStop))
    : Number(row.stopPts) || 0;
  let trigger = fill > 0
    ? computeProtectiveSlTrigger({
      fillPremium: fill,
      indexRiskPts: Math.max(0, Number(indexRisk) || 0),
      exchange: 'MCX',
      tradingSymbol: row.optionSymbol,
      ltp: fill,
      maxLossRs: (OPTION_SL_MAX_RS.crude || 0) * lotsN,
      lotUnits: (LOT_UNITS.crude || 10) * lotsN,
    })
    : 0;
  if (!(trigger > 0) && fill > 0) trigger = round2(Math.max(0.05, Math.round((fill * 0.9) / 0.05) * 0.05));
  if (fill > 0 && trigger >= fill) trigger = round2(Math.max(0.05, Math.round((fill * 0.9) / 0.05) * 0.05));
  row.slTrigger = trigger > 0 ? trigger : null;
  row.slPrice = row.slTrigger;
  row.slOn = !!(row.slTrigger > 0);
  return row;
}

function applyOptionPnl(row, pnl, lots) {
  const entry = Number(pnl?.optionEntryPremium || pnl?.entryClose);
  if (!isOptionPrem(entry, row.indexEntry)) return row;
  row.entryPrice = entry;
  row.optionEntryPremium = entry;
  row.entryOhlc = pnl.entryOhlc || null;
  row.premiumSource = pnl.barsSource === 'kite' || pnl.rupeesSource === 'option-live' ? 'kite-5m' : (pnl.rupeesSource || 'option-5m');
  row.optionSymbol = pnl.optionSymbol || row.optionSymbol;
  row.option = {
    tradingSymbol: pnl.optionSymbol || row.optionSymbol,
    symbol: pnl.optionSymbol || row.optionSymbol,
    strike: row.optionStrike,
    instrumentToken: pnl.instrumentToken || 0,
    exchange: 'MCX',
    lotSize: pnl.lotSize || LOT_UNITS.crude,
  };
  row.selectedInstrument = row.option.tradingSymbol;
  const x = Number(pnl?.optionExitPremium || pnl?.exitClose);
  if (isOptionPrem(x, row.indexEntry) && row.exitHm && !row.open) {
    row.exitPrice = x;
    row.optionExitPremium = x;
    row.exitOhlc = pnl.exitOhlc || null;
  }
  if (Number.isFinite(Number(pnl.rupees))) {
    row.netOptionPnlRs = Math.round(Number(pnl.rupees));
    row.optionPnlRs = Math.round(Number(pnl.rupees) + (Number(pnl.chargesRs) || 0));
    row.chargesRs = Number(pnl.chargesRs) || 0;
  }
  if (pnl.slTrigger > 0 && isOptionPrem(pnl.slTrigger, row.indexEntry)) {
    row.slTrigger = round2(pnl.slTrigger);
    row.slPrice = row.slTrigger;
  }
  return attachOptionSl(row, lots);
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
  const direction = t.option || (t.side === 'BUY' ? 'CE' : 'PE');
  const strike = atmStrike(t.entryPrice, 50);
  const label = strike != null ? `Crude Oil Mini ${strike} ${direction}` : `Crude Oil Mini ATM ${direction}`;
  return {
    instrumentName: 'Crude Oil Mini',
    instrumentId: BOOK_ID,
    selectedInstrument: label,
    optionSymbol: label,
    option: { tradingSymbol: label, symbol: label, strike },
    optionStrike: strike,
    side: 'BUY',
    sideLabel: `${direction} BUY`,
    direction,
    entryTime: `${t.date}T${entryHm}+0530`,
    exitTime: t.exitTime ? `${t.date}T${exitHm}+0530` : null,
    entryHm,
    exitHm,
    entryClock: entryHm,
    exitClock: exitHm,
    entryPrice: null,
    exitPrice: null,
    indexEntry: t.entryPrice,
    indexExit: t.exitPrice,
    indexStop: round2(stop),
    indexTarget: Number(t.entryPrice) + dir * (Number(t.target) || 20),
    stopPts,
    slTrigger: null,
    slPrice: null,
    slOn: false,
    optionEntryPremium: null,
    optionExitPremium: null,
    optionPnlRs: Math.round(gross),
    netOptionPnlRs: Math.round(net),
    indexPoints: round2(pts),
    exitReason: t.exitReason,
    open,
    lots,
    premiumSource: null,
    vehicle: 'option',
    futSymbol: symbol || 'CRUDEOILM FUT',
  };
}

async function fetchOptionBarsByToken(market, authorization, tokens, fromDate, toDate) {
  const map = new Map();
  const mkt = market || defaultMarket;
  for (const token of tokens) {
    if (!token || map.has(token)) continue;
    try {
      const bars = await mkt.fetchHistorical5m(authorization, token, fromDate, toDate, {
        oi: 1,
        chunkGapMs: 0,
      });
      map.set(token, bars || []);
    } catch {
      map.set(token, []);
    }
  }
  return map;
}

function resolveListedCrudeOption(instruments, rawTrade) {
  const dir = rawTrade.option === 'PE' || rawTrade.side === 'SELL' ? 'SELL' : 'BUY';
  const hit = resolveAtmCrudeMiniOption({
    instruments,
    direction: dir,
    spot: rawTrade.entryPrice,
    asOfDateTime: `${rawTrade.date}T${padHm(rawTrade.entryTime)}+05:30`,
  });
  const inst = hit?.instrument;
  if (!inst || hit.source === 'synthetic' || !(Number(inst.instrumentToken) > 0)) return null;
  return {
    tradingSymbol: inst.tradingSymbol,
    instrumentToken: Number(inst.instrumentToken) || 0,
    strike: Number(inst.strike) || 0,
    expiry: inst.expiry,
    lotSize: Math.max(1, Number(inst.lotSize) || 10),
    instrumentType: inst.instrumentType,
    exchange: 'MCX',
    source: hit.source,
  };
}

async function overlayOptionPrices(trades, raw, {
  authorization,
  lots,
  market,
  fromDate,
  toDate,
  instruments: injected,
} = {}) {
  if (!raw?.length) return trades;
  const mkt = market || defaultMarket;
  let instruments = injected;
  if (!instruments) {
    if (!authorization || typeof mkt.fetchInstrumentsCsv !== 'function') return trades;
    const csv = await mkt.fetchInstrumentsCsv(authorization, 'MCX');
    instruments = parseMcxInstruments(csv);
  }
  const picks = raw.map((t) => resolveListedCrudeOption(instruments, t));
  const windowFrom = fromDate || raw[0].date;
  const windowTo = toDate || raw[raw.length - 1].date;
  const tokens = [...new Set(picks.filter(Boolean).map((p) => p.instrumentToken))];
  const barsByToken = authorization && typeof mkt.fetchHistorical5m === 'function'
    ? await fetchOptionBarsByToken(mkt, authorization, tokens, windowFrom, windowTo)
    : new Map();

  return trades.map((row, i) => {
    const pick = picks[i];
    const t = raw[i];
    if (!pick || !t) return row;
    const candles = barsByToken.get(pick.instrumentToken) || [];
    if (candles.length) {
      optionStore.saveBars({
        instrumentToken: pick.instrumentToken,
        tradingSymbol: pick.tradingSymbol,
        date: t.date,
        candles: candles.filter((c) => String(c.date || '').slice(0, 10) === t.date),
      });
    }
    const entryBar = pickBarFlex(candles, t.entryTime);
    const exitBar = pickBarFlex(candles, t.exitTime) || (candles.length ? candles[candles.length - 1] : null);
    const entryOhlc = ohlcOf(entryBar);
    const exitOhlc = ohlcOf(exitBar);
    const entryPrem = liveLikeEntryPrem(entryBar, 0.5);
    let exitPrem = liveLikeExitPrem(exitBar, 0.5);
    const lotSize = pick.lotSize;
    const qty = lotSize * Math.max(1, Number(lots) || 1);
    const indexRisk = Math.abs(Number(t.entryPrice) - (Number(t.entryPrice) - (Number(engineOpts(lots).stopPts) || 0)));
    const slTrigger = computeProtectiveSlTrigger({
      fillPremium: entryPrem,
      indexRiskPts: indexRisk,
      exchange: 'MCX',
      tradingSymbol: pick.tradingSymbol,
      ltp: entryPrem,
      maxLossRs: (OPTION_SL_MAX_RS.crude || 0) * Math.max(1, Number(lots) || 1),
      lotUnits: qty,
    });
    for (const bar of barsInHold(candles, t.entryTime, t.exitTime)) {
      const fill = slLimitFill(slTrigger, Number(bar.low) || Number(bar.close) || 0);
      if (fill != null) {
        exitPrem = fill;
        break;
      }
    }
    const gross = optionRupees(entryPrem, exitPrem, lotSize, lots);
    return applyOptionPnl(row, {
      optionSymbol: pick.tradingSymbol,
      instrumentToken: pick.instrumentToken,
      lotSize,
      optionEntryPremium: entryPrem,
      optionExitPremium: exitPrem,
      entryClose: entryOhlc ? entryOhlc.close : null,
      exitClose: exitOhlc ? exitOhlc.close : null,
      entryOhlc,
      exitOhlc,
      rupees: gross,
      chargesRs: 0,
      slTrigger,
      barsSource: candles.length ? 'kite' : 'empty',
      rupeesSource: candles.length ? 'option-live' : 'unavailable',
    }, lots);
  });
}

function replayRetest(candles, { lots = 1, fromDate, toDate, symbol } = {}) {
  const { trades: rawAll } = runSrBreakout(candles || [], {
    ...engineOpts(lots),
    reportFromDate: fromDate || '',
  });
  const raw = (rawAll || []).filter((t) => {
    if (fromDate && t.date < fromDate) return false;
    if (toDate && t.date > toDate) return false;
    return true;
  });
  const trades = raw.map((t) => mapRow(t, lots, symbol));
  return { trades, raw, rules: PLAYBOOK };
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
  const { trades: mapped, raw } = replayRetest(candles, { lots: L, fromDate, toDate, symbol });
  const trades = await overlayOptionPrices(mapped, raw, {
    authorization: deps.skipOptionOverlay ? null : authorization,
    lots: L,
    market,
    fromDate,
    toDate,
    instruments: deps.optionInstruments,
  });
  const totals = summarize(trades);
  const book = {
    id: 'crude',
    label: 'Crude Oil Mini',
    sitOut: false,
    spec: { engine: ENGINE, strategy: STRATEGY_ID },
    specText: `CRUDEOILM ATM CE/PE · Nifty/Bank retest playbook · day ±₹${DAY_LOSS_STOP_RS}`,
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
      'Crude Bot trades only Crude Oil Mini ATM CE/PE (MIS). Same playbook as Nifty/Bank: intraday wall, 2-bar retest, +20 pts, lock 20→12, day ±₹3,500. Signals come from the mini future; In/Out/SL ₹ are the option premium (Kite 5m on listed MCX options). NSE charting is used for Nifty/Bank paper. Live buys one ATM CE or PE from Kite — it does not trade the future print.',
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
    note: 'Crude Bot live buys one ATM Crude Mini CE or PE on Kite (MIS). Stop live on this tab stops only Crude Bot.',
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
  session.message = `Crude Bot on · CRUDEOILM ATM CE/PE · ${session.lots} lot(s) · retest playbook`;
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
    const { trades: mapped, raw } = replayRetest(candles, {
      lots: session.lots,
      fromDate: today,
      toDate: today,
      symbol: session.fut.symbol,
    });
    const trades = await overlayOptionPrices(mapped, raw, {
      authorization,
      lots: session.lots,
      market,
      fromDate: today,
      toDate: today,
    });
    session.trades = trades;
    const pos = session.broker.positions.get(BOOK_ID);
    const liveOpenIdx = trades.findIndex((t) => engineTradeStillOpen(t, hm) && String(t.entryTime || '').slice(0, 10) === today);
    const liveOpen = liveOpenIdx >= 0 ? trades[liveOpenIdx] : null;
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
      const rawT = raw[liveOpenIdx] || {
        date: today,
        entryPrice: liveOpen.indexEntry,
        side: liveOpen.direction === 'PE' ? 'SELL' : 'BUY',
        option: liveOpen.direction === 'PE' ? 'PE' : 'CE',
      };
      const spec = { ...srLive.SPEC.crude, vehicle: 'option' };
      const opt = await srLive.pickOption(authorization, spec, rawT, session);
      if (!opt || !(Number(opt.instrumentToken) > 0)) {
        pushEvent(session, 'SKIP', 'No listed Crude Mini ATM CE/PE on Kite yet');
        return;
      }
      await session.broker.placeEntry(authorization, BOOK_ID, 'Crude Oil Mini', {
        direction: 'BUY',
        vehicle: 'option',
        skipChargeGate: true,
        premiumEstimated: false,
        optionEntryPremium: opt.optionEntryPremium || liveOpen.optionEntryPremium,
        indexEntry: liveOpen.indexEntry,
        indexStop: liveOpen.indexStop,
        indexTarget: liveOpen.indexTarget,
        entryTime: liveOpen.entryTime,
        option: {
          tradingSymbol: opt.tradingSymbol,
          instrumentToken: Number(opt.instrumentToken) || 0,
          exchange: 'MCX',
          lotSize: Math.max(1, Number(opt.lotSize) || 1),
          strike: opt.strike,
          source: 'listed',
        },
      });
      session.enteredKeys.add(liveOpen.entryTime);
      pushEvent(session, 'SIGNAL', `BUY ${opt.tradingSymbol} retest @ ${opt.optionEntryPremium || liveOpen.optionEntryPremium || liveOpen.indexEntry}`);
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
  overlayOptionPrices,
  isOptionPrem,
  resolveCrudeFuture,
  parseMcxFuts,
};
