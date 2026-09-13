'use strict';
/**
 * Crude Bot — session-OR after NSE close.
 *
 * On 2026-08-13→09-13 Kite 5m the bleed was max-4 + min-OR-40 (net +₹160).
 * Tuned book (same bars, 1 Mini lot, charges in):
 *   20 trades · 13W/7L · profit ₹4,180 / loss ₹2,380 · net ₹+1,800 · PF 1.76
 *
 *   - Morning OR 09:00–09:30 IST, skip only if wider than 60 pts.
 *   - Bullish/bearish close through the range, then a confirm bar (required).
 *   - Entries 16:00–21:00 IST only. Max 2 trades/day. Day stop 30 pts.
 *   - Stop 30 Mini pts, target 80, trail ₹350→₹180.
 * Paper ₹ = Mini points × ₹10 × lots. Live buys one ATM CE/PE (qty = Mini lots).
 */
const defaultMarket = require('./kite-market');
const store = require('./live.store');
const { crudeLotsFromAvailableFunds } = require('./daily-desk-defaults');
const { resolveDeskCapital } = require('./sr-desk');
const { LiveBroker } = require('./live-broker');
const srLive = require('./sr-live');
const { OPTION_SL_MAX_RS, LOT_UNITS } = require('./sr-strategy-config');
const {
  computeProtectiveSlTrigger,
  resolveAtmCrudeMiniOption,
  replayPaperOnCrude,
} = require('./strategy-core.cjs');
const { liveCrudeGreenProfileOverrides } = require('./dna-live-crude-green');
const {
  pickBarFlex,
  ohlcOf,
  liveLikeEntryPrem,
  liveLikeExitPrem,
  barsInHold,
  slLimitFill,
} = require('./sr-option-pnl');
const optionStore = require('./sr-option-store');

const ENGINE = 'crude-desk';
const STRATEGY_ID = 'live-crude-green';
const STRATEGY_VERSION = '2026.09-session-or';
const BOOK_ID = 'crude-oil-mini';
const RS_PER_POINT = 10;
const CHARGE_RS = 40;
const TICK_MS = Number(process.env.CRUDE_BOT_INTERVAL_MS || 60_000);
const PROFILE = liveCrudeGreenProfileOverrides();

const PLAYBOOK = {
  wallMode: 'session-or',
  orbFromHm: PROFILE.sessionOrStart,
  orbToHm: PROFILE.sessionOrEnd,
  minOrbPts: PROFILE.minOrWidth,
  maxOrbPts: PROFILE.maxOrWidth,
  requireConfirm: PROFILE.requireConfirm,
  failStop: false,
  sitOutAfterLoss: false,
  stopPts: PROFILE.stopPts,
  targetByScore: { 1: PROFILE.eveningTargetPts, 2: PROFILE.eveningTargetPts, 3: PROFILE.eveningTargetPts },
  entryStartHm: PROFILE.eveningEntryStart,
  entryEndHm: PROFILE.eveningEntryEnd,
  squareOffHm: '22:45',
  maxTradesPerDay: PROFILE.maxEveningTradesDay,
  dayLossStopPts: PROFILE.dayLossStopPts,
  dayProfitLockPts: PROFILE.dayProfitLockPts,
  trailArmRs: PROFILE.profitLockArmRs,
  trailLockRs: PROFILE.profitLockLockRs,
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

function engineOpts() {
  return {
    stopPts: PLAYBOOK.stopPts,
    targetPts: PLAYBOOK.targetByScore[1],
  };
}

function dayRiskRs(lots) {
  return PLAYBOOK.stopPts * RS_PER_POINT * Math.max(1, Number(lots) || 1);
}

function hhmmOf(iso) {
  const m = /T(\d{2}:\d{2})/.exec(String(iso || ''));
  return m ? m[1] : String(iso || '').slice(11, 16);
}

function dateOf(iso) {
  return String(iso || '').slice(0, 10);
}

function paperToRaw(t, openFlag = false) {
  const dir = t.direction === 'SELL' ? 'SELL' : 'BUY';
  return {
    date: dateOf(t.entryTime),
    entryTime: hhmmOf(t.entryTime),
    exitTime: openFlag ? null : hhmmOf(t.exitTime),
    entryPrice: Number(t.indexEntry),
    exitPrice: openFlag ? Number(t.indexEntry) : Number(t.indexExit),
    side: dir,
    option: dir === 'SELL' ? 'PE' : 'CE',
    points: openFlag ? 0 : Number(t.indexPoints) || 0,
    open: openFlag,
    openAtFill: openFlag,
    exitReason: openFlag ? 'OPEN' : t.exitReason,
    target: Math.abs(Number(t.indexTarget) - Number(t.indexEntry)) || PLAYBOOK.targetByScore[1],
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
    lotSize: 1,
  };
  row.selectedInstrument = row.option.tradingSymbol;
  const x = Number(pnl?.optionExitPremium || pnl?.exitClose);
  if (isOptionPrem(x, row.indexEntry) && row.exitHm && !row.open) {
    row.exitPrice = x;
    row.optionExitPremium = x;
    row.exitOhlc = pnl.exitOhlc || null;
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
    indexTarget: Number(t.entryPrice) + dir * (Number(t.target) || PLAYBOOK.targetByScore[1]),
    stopPts,
    slTrigger: null,
    slPrice: null,
    slOn: false,
    optionEntryPremium: null,
    optionExitPremium: null,
    optionPnlRs: Math.round(gross),
    netOptionPnlRs: Math.round(net),
    chargesRs: open ? 0 : CHARGE_RS * lots,
    pnlSource: 'index_x_lot_crude',
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
    lotSize: 1,
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
    const lotsN = Math.max(1, Number(lots) || 1);
    const indexRisk = Math.abs(Number(t.entryPrice) - (Number(t.entryPrice) - (Number(engineOpts(lots).stopPts) || 0)));
    const slTrigger = computeProtectiveSlTrigger({
      fillPremium: entryPrem,
      indexRiskPts: indexRisk,
      exchange: 'MCX',
      tradingSymbol: pick.tradingSymbol,
      ltp: entryPrem,
      maxLossRs: (OPTION_SL_MAX_RS.crude || 0) * lotsN,
      lotUnits: (LOT_UNITS.crude || 10) * lotsN,
    });
    for (const bar of barsInHold(candles, t.entryTime, t.exitTime)) {
      const fill = slLimitFill(slTrigger, Number(bar.low) || Number(bar.close) || 0);
      if (fill != null) {
        exitPrem = fill;
        break;
      }
    }
    return applyOptionPnl(row, {
      optionSymbol: pick.tradingSymbol,
      instrumentToken: pick.instrumentToken,
      lotSize: 1,
      optionEntryPremium: entryPrem,
      optionExitPremium: exitPrem,
      entryClose: entryOhlc ? entryOhlc.close : null,
      exitClose: exitOhlc ? exitOhlc.close : null,
      entryOhlc,
      exitOhlc,
      slTrigger,
      barsSource: candles.length ? 'kite' : 'empty',
      rupeesSource: candles.length ? 'option-live' : 'unavailable',
    }, lots);
  });
}

function replayRetest(candles, { lots = 1, fromDate, toDate, symbol, forceCloseOpen = true } = {}) {
  const tradeParams = liveCrudeGreenProfileOverrides();
  const replay = replayPaperOnCrude({
    instrumentId: BOOK_ID,
    instrumentName: 'Crude Oil Mini',
    candles: candles || [],
    fromDate: fromDate || '0000-01-01',
    toDate: toDate || '9999-12-31',
    instruments: [],
    optionCandlesByToken: new Map(),
    neededOptionTokens: new Set(),
    forceCloseOpen,
    lotsMultiplier: 1,
    enableMorning: false,
    enableEvening: true,
    tradeParams,
    dayLossStopPts: tradeParams.dayLossStopPts,
  });
  const raw = (replay.trades || []).map((t) => paperToRaw(t, false));
  if (!forceCloseOpen && replay.open) {
    raw.push(paperToRaw({
      direction: replay.open.direction,
      indexEntry: replay.open.entry,
      indexExit: replay.open.entry,
      indexStop: replay.open.stop,
      indexTarget: replay.open.target,
      indexPoints: 0,
      entryTime: replay.open.entryTime,
      exitTime: null,
      exitReason: 'OPEN',
    }, true));
  }
  const trades = raw.map((t) => mapRow(t, lots, symbol));
  return { trades, raw, rules: PLAYBOOK, lastSignal: replay.lastSignal };
}

function instrumentRow(trades) {
  const tot = summarize(trades);
  return {
    id: 'crude',
    instrumentName: 'Crude Oil Mini',
    status: tot.trades ? 'taken' : 'not-taken',
    ...tot,
    why: tot.trades ? 'Taken' : 'No session-OR break after NSE (OR ≤60, confirm, 16:00–21:00, max 2/day).',
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
  const L = crudeLotsFromAvailableFunds(capital);
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
    specText: `CRUDEOILM ATM CE/PE · session OR ≤${PLAYBOOK.maxOrbPts} · confirm · 16:00–21:00 · SL${PLAYBOOK.stopPts}/TP${PLAYBOOK.targetByScore[1]} · trail ₹${PLAYBOOK.trailArmRs}→₹${PLAYBOOK.trailLockRs} · max ${PLAYBOOK.maxTradesPerDay}/day`,
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
      taken: [{ instrumentName: 'Crude Oil Mini', bookId: 'crude', direction: 'SESSION-OR', lots: L }],
      trades,
      totals,
    },
    specText: book.specText,
    books: [book],
    coreBooks: [book],
    note:
      `Crude Bot trades only Crude Oil Mini ATM CE/PE (MIS), ${L} Mini lot(s). Session OR 09:00–09:30 (skip if wider than ${PLAYBOOK.maxOrbPts} pts), confirm bar, entries 16:00–21:00 after NSE, max ${PLAYBOOK.maxTradesPerDay}/day. Stop ${PLAYBOOK.stopPts} pts (₹${dayRiskRs(L)} at this size) / target ${PLAYBOOK.targetByScore[1]} pts · trail ₹${PLAYBOOK.trailArmRs}→₹${PLAYBOOK.trailLockRs}. Day stop ${PLAYBOOK.dayLossStopPts} Mini pts. Paper ₹ = Mini points × ₹10 × lots.`,
    instruments: [instrumentRow(trades)],
    protection: {
      fundsRs: capital,
      capitalRs: capital,
      riskPerTradeRs: dayRiskRs(L),
      dayRiskRs: dayRiskRs(L),
      dayRiskUsedRs: Math.max(0, -Math.min(0, totals.netRs)),
      stillProtectedRs: Math.max(0, capital - dayRiskRs(L)),
      protectedFloorRs: Math.max(0, capital - dayRiskRs(L)),
      monthMtdRs: totals.netRs,
    },
    totals,
    liveTotals: totals,
    trades,
    message: trades.length
      ? undefined
      : 'No session-OR break after NSE (need morning OR ≤60 pts, a 16:00–21:00 close through it, then a confirm bar).',
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
    note: 'Crude Bot live buys one ATM Crude Mini CE or PE after NSE close (session OR ≤60, confirm, max 2/day). Stop live on this tab stops only Crude Bot.',
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
  session.message = `Crude Bot on · CRUDEOILM ATM CE/PE · ${session.lots} lot(s) · session OR ≤60 · confirm · SL30/TP80 · max 2/day`;
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
  session.broker.setOptionMaxLossRs(BOOK_ID, (OPTION_SL_MAX_RS.crude || 0) * session.lots);
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
      forceCloseOpen: false,
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
          lotSize: 1,
          strike: opt.strike,
          source: 'listed',
        },
      });
      session.enteredKeys.add(liveOpen.entryTime);
      pushEvent(session, 'SIGNAL', `BUY ${opt.tradingSymbol} session-OR @ ${opt.optionEntryPremium || liveOpen.optionEntryPremium || liveOpen.indexEntry}`);
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
