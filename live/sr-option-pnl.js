'use strict';
/**
 * Paper ₹ as Live would mark it: same CE/PE contract, buy worse than close
 * (ask / fill friction), sell worse than close (bid), F&O charges, and the
 * resting SL-LIMIT (trigger + 90% limit) if option lows tag the stop.
 * Index points stay on the trade; they are not this rupee column.
 */
const market = require('./kite-market');
const { computeProtectiveSlTrigger } = require('./strategy-core.cjs');
const { estimateRoundTripCharges } = require('./charge-entry-gate');
const { OPTION_SL_MAX_RS } = require('./sr-strategy-config');
const optionStore = require('./sr-option-store');

const TICK = 0.05;

function hmOf(date) {
  return String(date || '').slice(11, 16);
}

function hmToMin(hm) {
  const p = String(hm || '').split(':');
  const h = Number(p[0]);
  const m = Number(p[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function tickPrem(p) {
  const n = Number(p);
  if (!(n > 0)) return 0;
  return Number(Math.max(TICK, Math.round(n / TICK) * TICK).toFixed(2));
}

function hmAdd(hm, deltaMin) {
  const n = hmToMin(hm);
  if (n == null) return '';
  const x = Math.max(0, n + Number(deltaMin) || 0);
  const h = String(Math.floor(x / 60)).padStart(2, '0');
  const m = String(x % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function barDay(bar) {
  return String(bar?.date || '').slice(0, 10);
}

function clockOf(hm) {
  const s = String(hm || '');
  const iso = /T(\d{2}:\d{2})/.exec(s);
  if (iso) return iso[1];
  const hmOnly = /^(\d{2}:\d{2})/.exec(s);
  return hmOnly ? hmOnly[1] : s.slice(0, 5);
}

function dayOfStamp(hm, day) {
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(String(day))) return String(day);
  const s = String(hm || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function candlesOnDay(candles, day) {
  if (!day) return candles || [];
  return (candles || []).filter((c) => barDay(c) === day);
}

/** Prefer the exact 5m stamp; else the next/prev 5m (Kite option bars often sit on :10 when the index fill is :05). */
function pickBarFlex(candles, hm, day) {
  const d = dayOfStamp(hm, day);
  const list = candlesOnDay(candles, d);
  return pickBar(list, hm)
    || pickBar(list, hmAdd(hm, 5))
    || pickBar(list, hmAdd(hm, -5));
}

function lastBarOnDay(candles, day) {
  const list = candlesOnDay(candles, day);
  return list.length ? list[list.length - 1] : null;
}

function ohlcOf(bar) {
  if (!bar) return null;
  const close = Number(bar.close);
  if (!(close > 0)) return null;
  const open = Number(bar.open);
  const high = Number(bar.high);
  const low = Number(bar.low);
  return {
    open: Number.isFinite(open) && open > 0 ? open : close,
    high: Number.isFinite(high) && high > 0 ? high : close,
    low: Number.isFinite(low) && low > 0 ? low : close,
    close,
  };
}

/** In on a dump 5m bar is the body high (open), not the stopped close. */
function fillBarEntryPx(bar) {
  const o = ohlcOf(bar);
  if (!o) return null;
  return tickPrem(Math.max(o.open, o.close));
}

function pickBar(candles, hm) {
  const want = clockOf(hm);
  if (!Array.isArray(candles) || !want) return null;
  let last = null;
  for (const c of candles) {
    const h = hmOf(c.date);
    if (!h) continue;
    if (h <= want) last = c;
    if (h === want) return c;
  }
  return last;
}

function barsInHold(candles, entryHm, exitHm, day, opts = {}) {
  const a = hmToMin(clockOf(entryHm));
  const b = hmToMin(clockOf(exitHm));
  if (a == null || b == null) return [];
  const d = dayOfStamp(entryHm, day) || dayOfStamp(exitHm, day);
  const afterFill = opts.afterFill === true;
  return candlesOnDay(candles, d).filter((c) => {
    const m = hmToMin(hmOf(c.date));
    if (m == null || m > b) return false;
    return afterFill ? m > a : m >= a;
  });
}

/** Live BUY is ask/ltp, never the printed close. Friction from liveOps. */
function liveLikeEntryPrem(bar, friction = 0.5) {
  const c = Number(bar?.close) || 0;
  if (!(c > 0)) return 0;
  const h = Number(bar.high) || 0;
  const raw = c + Math.max(0, Number(friction) || 0);
  const cap = h > 0 ? Math.min(h, raw) : raw;
  return tickPrem(Math.max(c, cap));
}

/** Live EXIT is bid/market, never the printed close. */
function liveLikeExitPrem(bar, friction = 0.5) {
  const c = Number(bar?.close) || 0;
  if (!(c > 0)) return 0;
  const l = Number(bar.low) || 0;
  const raw = c - Math.max(0, Number(friction) || 0);
  const floor = l > 0 ? Math.max(l, raw) : raw;
  return tickPrem(Math.max(TICK, Math.min(c, floor)));
}

/** Same 90% limit Live places on the protective SL. */
function slLimitFill(trigger, barLow) {
  const trig = tickPrem(trigger);
  const low = Number(barLow) || 0;
  if (!(trig > 0) || !(low > 0) || low > trig + 1e-9) return null;
  const limit = tickPrem(Math.max(TICK, trig * 0.9));
  return tickPrem(Math.min(trig, Math.max(low, limit)));
}

/**
 * Live rests SL-M after fill. Paper:
 * fill bar — close vs SL only (pre-fill wick is ignored)
 * later bars — low vs SL (stop can fill on a wick after the order is live)
 */
function slWalkPx(bar, slTrigger, isFillBar) {
  if (!bar || !(Number(slTrigger) > 0)) return null;
  const probe = isFillBar
    ? (Number(bar.close) || 0)
    : (Number(bar.low) || Number(bar.close) || 0);
  return slLimitFill(slTrigger, probe);
}

function walkOptionSl(candles, entryHm, exitHm, day, slTrigger, fillBar) {
  const rest = barsInHold(candles, entryHm, exitHm, day, { afterFill: true });
  const walk = [];
  if (fillBar) walk.push({ bar: fillBar, isFillBar: true });
  for (const bar of rest) walk.push({ bar, isFillBar: false });
  for (const { bar, isFillBar } of walk) {
    const fill = slWalkPx(bar, slTrigger, isFillBar);
    if (fill != null) return { fill, isFillBar };
  }
  return null;
}

function optionRupees(entryPrem, exitPrem, lotSize, lots = 1) {
  const e = Number(entryPrem);
  const x = Number(exitPrem);
  const q = Math.max(1, Number(lotSize) || 0) * Math.max(1, Number(lots) || 1);
  if (!(e > 0 && x > 0 && q > 0)) return null;
  return Math.round((x - e) * q);
}

function indexStopPrice(trade, spec) {
  const fromOpts = Number(spec?.opts?.stopPts);
  const pts = Number.isFinite(fromOpts) && fromOpts > 0
    ? fromOpts
    : (Number(trade?.target) > 0 ? Number(trade.target) : 20);
  return trade.side === 'BUY' ? trade.entryPrice - pts : trade.entryPrice + pts;
}

/**
 * Live holds one option. A Paper row whose entry is still inside the previous
 * hold is not a Live fill — skip its ₹ so the day net is the Live book.
 */
function markOneOpenLeg(trades) {
  const out = [];
  const busy = new Map();
  for (const t of trades || []) {
    const day = String(t.date || '');
    const en = hmToMin(t.entryTime);
    const ex = hmToMin(t.exitTime);
    const until = busy.get(day);
    if (en != null && until != null && en < until) {
      out.push({ ...t, liveSkip: 'one-leg' });
      continue;
    }
    if (ex != null) busy.set(day, Math.max(until || 0, ex));
    out.push(t);
  }
  return out;
}

function liveFriction() {
  return 0.5;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

async function loadOptionCandles(authorization, pick, day, mem) {
  const key = `${pick.instrumentToken}|${day}`;
  if (mem.has(key)) return { candles: mem.get(key), barsSource: 'memory' };
  const disk = optionStore.loadBars(pick.instrumentToken, day);
  const isToday = day === todayIso();
  let kite = [];
  if (authorization && (isToday || !disk.length)) {
    try {
      kite = await market.fetchHistorical5m(authorization, pick.instrumentToken, day, day) || [];
    } catch (_) { kite = []; }
  }
  const candles = (kite.length >= disk.length ? kite : disk) || [];
  if (kite.length) {
    optionStore.saveBars({
      instrumentToken: pick.instrumentToken,
      tradingSymbol: pick.tradingSymbol,
      date: day,
      candles: kite,
    });
  }
  mem.set(key, candles);
  const barsSource = kite.length && kite.length >= disk.length ? 'kite' : (disk.length ? 'cache' : 'empty');
  return { candles, barsSource };
}

async function optionPnlForTrade({ authorization, spec, trade, lots, session, pickOption }) {
  const cache = session || {};
  if (!cache._optHist) cache._optHist = new Map();
  const pick = await pickOption(authorization, spec, trade, { ...cache, paperPick: true });
  if (!pick || !(pick.instrumentToken > 0)) {
    return { rupees: null, rupeesSource: 'unavailable', reason: 'no-contract', instrumentToken: null };
  }
  optionStore.saveContract({
    name: spec.root, tradingSymbol: pick.tradingSymbol, instrumentToken: pick.instrumentToken,
    expiry: pick.expiry, strike: pick.strike, instrumentType: pick.instrumentType,
    exchange: pick.exchange, lotSize: pick.lotSize,
  });
  const day = trade.date;
  const { candles: rawBars, barsSource } = await loadOptionCandles(authorization, pick, day, cache._optHist);
  const candles = Array.isArray(rawBars) ? rawBars : [];
  const entryBar = pickBarFlex(candles, trade.entryTime, day);
  const exitBar = pickBarFlex(candles, trade.exitTime, day) || lastBarOnDay(candles, day);
  const entryOhlc = ohlcOf(entryBar);
  const exitOhlc = ohlcOf(exitBar);
  const friction = liveFriction();
  const entryPrint = fillBarEntryPx(entryBar);
  const entryPrem = liveLikeEntryPrem(
    entryPrint != null ? { close: entryPrint, high: entryBar && entryBar.high } : entryBar,
    friction,
  );
  let exitPrem = liveLikeExitPrem(exitBar, friction);
  let exitVia = 'bid';
  const lotSize = Math.max(1, Number(pick.lotSize) || spec.unitsPerLot || 1);
  const qty = lotSize * Math.max(1, Number(lots) || 1);

  const indexRisk = Math.abs(Number(trade.entryPrice) - indexStopPrice(trade, spec));
  const slTrigger = computeProtectiveSlTrigger({
    fillPremium: entryPrem,
    indexRiskPts: indexRisk,
    exchange: spec.exchange || pick.exchange,
    tradingSymbol: pick.tradingSymbol,
    ltp: entryPrem,
      maxLossRs: (OPTION_SL_MAX_RS[spec.key] || 0) * Math.max(1, Number(lots) || 1),
    lotUnits: qty,
  });
  const hit = walkOptionSl(candles, trade.entryTime, trade.exitTime, day, slTrigger, entryBar);
  if (hit) {
    exitPrem = hit.fill;
    exitVia = hit.isFillBar ? 'sl-limit-fill-close' : 'sl-limit';
  }

  const gross = optionRupees(entryPrem, exitPrem, lotSize, lots);
  if (gross == null) {
    return {
      ok: !!(entryOhlc && entryOhlc.close > 0),
      rupees: null, rupeesSource: 'unavailable', reason: 'no-option-bars',
      optionSymbol: pick.tradingSymbol, instrumentToken: Number(pick.instrumentToken) || 0,
      lotSize, barsSource,
      optionEntryPremium: entryPrem || null,
      optionExitPremium: exitPrem || null,
      entryClose: entryOhlc ? entryOhlc.close : null,
      exitClose: exitOhlc ? exitOhlc.close : null,
      entryOhlc,
      exitOhlc,
    };
  }
  const charged = estimateRoundTripCharges({
    entryPrice: entryPrem, exitPrice: exitPrem, quantity: qty,
  });
  const chargesRs = Math.round(Number(charged.totalRs) || 0);
  return {
    ok: true,
    rupees: Math.round(gross - chargesRs),
    rupeesSource: barsSource === 'cache' ? 'option-cache' : 'option-live',
    optionSymbol: pick.tradingSymbol,
    instrumentToken: Number(pick.instrumentToken) || 0,
    optionEntryPremium: entryPrem,
    optionExitPremium: exitPrem,
    entryClose: entryOhlc ? entryOhlc.close : null,
    exitClose: exitOhlc ? exitOhlc.close : null,
    entryOhlc,
    exitOhlc,
    lotSize,
    chargesRs,
    exitVia,
    slTrigger: slTrigger || null,
    barsSource,
  };
}

function summarizeSidecar(trades) {
  const attempted = (trades || []).length;
  const priced = (trades || []).filter((t) => Number.isFinite(t.optionRupees));
  const wins = priced.filter((t) => t.optionRupees > 0);
  const losers = priced.filter((t) => t.optionRupees <= 0);
  return {
    attempted,
    priced: priced.length,
    wins: wins.length,
    losses: losers.length,
    profit: wins.reduce((a, t) => a + t.optionRupees, 0),
    loss: losers.reduce((a, t) => a + t.optionRupees, 0),
    net: priced.reduce((a, t) => a + t.optionRupees, 0),
  };
}

function summarizeOptionTrades(trades) {
  const priced = trades.filter((t) => (
    (t.rupeesSource === 'option' || t.rupeesSource === 'option-live' || t.rupeesSource === 'option-cache' || t.rupeesSource === 'index-fut')
    && !t.liveSkip
    && Number.isFinite(t.rupees)
  ));
  const wins = priced.filter((t) => t.rupees > 0);
  const losers = priced.filter((t) => t.rupees <= 0);
  const profit = wins.reduce((a, t) => a + t.rupees, 0);
  const loss = losers.reduce((a, t) => a + t.rupees, 0);
  const net = priced.reduce((a, t) => a + t.rupees, 0);
  return {
    totalProfitRupees: profit,
    totalLossRupees: loss,
    netRupees: net,
    grossRupees: net,
    optionWins: wins.length,
    optionLosses: losers.length,
    optionPriced: priced.length,
  };
}

module.exports = {
  optionRupees, pickBar, pickBarFlex, ohlcOf, optionPnlForTrade, summarizeOptionTrades, summarizeSidecar, hmOf,
  liveLikeEntryPrem, liveLikeExitPrem, slLimitFill, slWalkPx, walkOptionSl, fillBarEntryPx, markOneOpenLeg, barsInHold, lastBarOnDay,
};
