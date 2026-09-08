'use strict';
/**
 * Paper ₹ from REAL option 5-min closes, not index points × lot.
 * Same CE/PE Live buys (ATM weekly, ask/ltp pick). Entry/exit marks are the
 * option candle at the engine's entryTime / exitTime — never a delta proxy.
 */
const market = require('./kite-market');

function hmOf(date) {
  return String(date || '').slice(11, 16);
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

function optionRupees(entryPrem, exitPrem, lotSize, lots = 1) {
  const e = Number(entryPrem);
  const x = Number(exitPrem);
  const q = Math.max(1, Number(lotSize) || 0) * Math.max(1, Number(lots) || 1);
  if (!(e > 0 && x > 0 && q > 0)) return null;
  return Math.round((x - e) * q);
}

async function optionPnlForTrade({ authorization, spec, trade, lots, session, pickOption }) {
  const cache = session || {};
  if (!cache._optHist) cache._optHist = new Map();
  const pick = await pickOption(authorization, spec, trade, cache);
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
  const entryPrem = Number(entryBar?.close) || 0;
  const exitPrem = Number(exitBar?.close) || 0;
  const lotSize = Math.max(1, Number(pick.lotSize) || spec.unitsPerLot || 1);
  const rupees = optionRupees(entryPrem, exitPrem, lotSize, lots);
  if (rupees == null) {
    return {
      rupees: null, rupeesSource: 'unavailable', reason: 'no-option-bars',
      optionSymbol: pick.tradingSymbol, lotSize,
    };
  }
  return {
    rupees,
    rupeesSource: 'option',
    optionSymbol: pick.tradingSymbol,
    optionEntryPremium: entryPrem,
    optionExitPremium: exitPrem,
    lotSize,
  };
}

function summarizeOptionTrades(trades) {
  const priced = trades.filter((t) => t.rupeesSource === 'option' && Number.isFinite(t.rupees));
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

module.exports = { optionRupees, pickBar, optionPnlForTrade, summarizeOptionTrades, hmOf };
