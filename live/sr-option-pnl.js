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
const { LIVE_GREEN_DNA } = require('./dna-live-green');

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

/** Last 5-min option bar whose clock is <= hm (causal). */
function pickBar(candles, hm) {
  if (!Array.isArray(candles) || !hm) return null;
  let last = null;
  for (const c of candles) {
    const h = hmOf(c.date);
    if (!h) continue;
    if (h <= hm) last = c;
    if (h === hm) return c;
  }
  return last;
}

function barsInHold(candles, entryHm, exitHm) {
  const a = hmToMin(entryHm);
  const b = hmToMin(exitHm);
  if (a == null || b == null) return [];
  return (candles || []).filter((c) => {
    const m = hmToMin(hmOf(c.date));
    return m != null && m >= a && m <= b;
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
  const n = Number(LIVE_GREEN_DNA.liveOps.fillFrictionPremium);
  return Number.isFinite(n) && n >= 0 ? n : 0.5;
}

function shouldSimSlLimit(exitReason) {
  // S/R LOCK/TARGET/GIVEUP flatten with a MARKET sell after canceling the SL.
  // Simulating the Auto Bot ₹300/lot stop on 5-min option *lows* dumps those
  // winners (TARGET +20 pts → −₹800). Only the engine STOP is an SL exit.
  return String(exitReason || '').toUpperCase() === 'STOP';
}

async function optionPnlForTrade({ authorization, spec, trade, lots, session, pickOption }) {
  const cache = session || {};
  if (!cache._optHist) cache._optHist = new Map();
  const pick = await pickOption(authorization, spec, trade, { ...cache, paperPick: true });
  if (!pick || !(pick.instrumentToken > 0)) {
    return { rupees: null, rupeesSource: 'unavailable', reason: 'no-contract' };
  }
  const day = trade.date;
  const key = `${pick.instrumentToken}|${day}`;
  let candles = cache._optHist.get(key);
  if (!candles) {
    candles = await market.fetchHistorical5m(authorization, pick.instrumentToken, day, day);
    cache._optHist.set(key, candles || []);
  }
  const entryBar = pickBar(candles, trade.entryTime);
  const exitBar = pickBar(candles, trade.exitTime) || (candles.length ? candles[candles.length - 1] : null);
  const friction = liveFriction();
  const entryPrem = liveLikeEntryPrem(entryBar, friction);
  let exitPrem = liveLikeExitPrem(exitBar, friction);
  let exitVia = 'bid';
  const lotSize = Math.max(1, Number(pick.lotSize) || spec.unitsPerLot || 1);
  const qty = lotSize * Math.max(1, Number(lots) || 1);
  let slTrigger = null;

  if (shouldSimSlLimit(trade.exitReason)) {
    const indexRisk = Math.abs(Number(trade.entryPrice) - indexStopPrice(trade, spec));
    slTrigger = computeProtectiveSlTrigger({
      fillPremium: entryPrem,
      indexRiskPts: indexRisk,
      exchange: spec.exchange || pick.exchange,
      tradingSymbol: pick.tradingSymbol,
      ltp: entryPrem,
      maxLossRs: (LIVE_GREEN_DNA.liveOps.maxOptionLossRs || 0) * Math.max(1, Number(lots) || 1),
      lotUnits: qty,
    });
    for (const bar of barsInHold(candles, trade.entryTime, trade.exitTime)) {
      const low = Number(bar.low) || Number(bar.close) || 0;
      const fill = slLimitFill(slTrigger, low);
      if (fill != null) {
        exitPrem = fill;
        exitVia = 'sl-limit';
        break;
      }
    }
  }

  const gross = optionRupees(entryPrem, exitPrem, lotSize, lots);
  if (gross == null) {
    return {
      rupees: null, rupeesSource: 'unavailable', reason: 'no-option-bars',
      optionSymbol: pick.tradingSymbol, lotSize,
    };
  }
  const charged = estimateRoundTripCharges({
    entryPrice: entryPrem, exitPrice: exitPrem, quantity: qty,
  });
  const chargesRs = Math.round(Number(charged.totalRs) || 0);
  return {
    rupees: Math.round(gross - chargesRs),
    rupeesSource: 'option-live',
    optionSymbol: pick.tradingSymbol,
    optionEntryPremium: entryPrem,
    optionExitPremium: exitPrem,
    lotSize,
    chargesRs,
    exitVia,
    slTrigger: slTrigger || null,
  };
}

function summarizeOptionTrades(trades) {
  const priced = trades.filter((t) => (
    (t.rupeesSource === 'option' || t.rupeesSource === 'option-live')
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
  optionRupees, pickBar, optionPnlForTrade, summarizeOptionTrades, hmOf,
  liveLikeEntryPrem, liveLikeExitPrem, slLimitFill, markOneOpenLeg, barsInHold,
  shouldSimSlLimit,
};
