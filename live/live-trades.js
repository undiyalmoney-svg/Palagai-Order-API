/**
 * Live money ledger — merges strategy trade marks with broker fill prices.
 *
 * Paper/replay closes use candle / trail-floor premiums. When realOrders is on,
 * those marks stay as `paper*` fields; broker average_price overwrites the
 * money fields so Auto Trader totals match Kite.
 */
const { summarize } = require('./backtest');

function roundPaise(n) {
  return Math.round(Number(n) * 100) / 100;
}

function tradeKey(t) {
  return `${t.instrumentId || ''}|${t.entryTime || ''}|${(t.optionTradingSymbol || t.tradingSymbol || '').toUpperCase()}`;
}

function lotUnitsOf(t) {
  const lot = Math.max(0, Number(t.optionLotSize || t.option?.lotSize || t.lotSize || 0) || 0);
  const lots = Math.max(1, Math.floor(Number(t.lotsMultiplier || t.lots || 1)) || 1);
  if (lot > 0) return lot * lots;
  const qty = Math.max(0, Number(t.quantity || 0) || 0);
  if (qty > 0) return qty;
  // Infer from paper marks when lot metadata missing on the closed trade.
  const pe = Number(t.paperEntryPremium);
  const px = Number(t.paperExitPremium);
  const pp = Number(t.paperOptionPnlRs);
  if (pe > 0 && px > 0 && pp != null && Math.abs(px - pe) > 1e-6) {
    const inferred = Math.round(pp / (px - pe));
    if (inferred > 0) return inferred;
  }
  return 0;
}

function recomputeMoney(t) {
  const entry = Number(t.optionEntryPremium);
  const exit = Number(t.optionExitPremium);
  const units = lotUnitsOf(t);
  if (!(entry > 0) || !(exit > 0) || !(units > 0)) {
    return t;
  }
  const gross = roundPaise((exit - entry) * units);
  t.optionPnlRs = gross;
  // Prefer frozen paper charges (set once at ingest) — never derive from
  // netOptionPnlRs which may already have been overwritten by a partial fill.
  let charges = t.chargesRs != null ? Number(t.chargesRs) : null;
  if (charges == null && t.paperOptionPnlRs != null && t.paperNetOptionPnlRs != null) {
    charges = roundPaise(Number(t.paperOptionPnlRs) - Number(t.paperNetOptionPnlRs));
    t.chargesRs = charges;
  }
  t.netOptionPnlRs = charges != null ? roundPaise(gross - charges) : gross;
  t.outcome = gross > 0 ? 'WIN' : gross < 0 ? 'LOSS' : 'FLAT';
  return t;
}

/**
 * Snapshot a closed paper trade into the live ledger (idempotent by entry key).
 */
function upsertPaperClose(ledger, closed) {
  if (!closed?.entryTime) return null;
  const sym =
    closed.optionTradingSymbol ||
    closed.option?.tradingSymbol ||
    closed.tradingSymbol ||
    '';
  const key = `${closed.instrumentId || ''}|${closed.entryTime}|${String(sym).toUpperCase()}`;
  const existing = ledger.find((t) => tradeKey(t) === key);
  if (existing) {
    if (existing.fillSource === 'broker' && existing.brokerExitPremium != null) {
      return existing; // never overwrite settled broker money with paper marks
    }
    return existing;
  }
  const row = {
    id: closed.id || `live-${key}`,
    instrumentId: closed.instrumentId,
    instrumentName: closed.instrumentName,
    direction: closed.direction,
    entryTime: closed.entryTime,
    exitTime: closed.exitTime,
    exitReason: closed.exitReason,
    optionTradingSymbol: sym,
    option: closed.option || null,
    optionLotSize: closed.option?.lotSize || closed.optionLotSize || null,
    lotsMultiplier: closed.lotsMultiplier || 1,
    quantity: closed.quantity || null,
    // Paper marks (audit)
    paperEntryPremium: closed.optionEntryPremium ?? null,
    paperExitPremium: closed.optionExitPremium ?? null,
    paperOptionPnlRs: closed.optionPnlRs ?? null,
    paperNetOptionPnlRs: closed.netOptionPnlRs ?? null,
    // Active money fields (start as paper; broker overwrites)
    optionEntryPremium: closed.optionEntryPremium ?? null,
    optionExitPremium: closed.optionExitPremium ?? null,
    optionPnlRs: closed.optionPnlRs ?? null,
    chargesRs: closed.chargesRs ?? null,
    netOptionPnlRs: closed.netOptionPnlRs ?? null,
    outcome: closed.outcome || closed.moneyOutcome || null,
    premiumEstimated: !!closed.premiumEstimated,
    fillSource: 'paper',
    brokerEntryPremium: null,
    brokerExitPremium: null,
    moneyStatus: 'paper_closed', // pending_broker_exit | settled
  };
  ledger.push(row);
  return row;
}

/**
 * Apply a broker fill onto the matching ledger row (or create a stub).
 * @param {'entry'|'exit'} side
 */
function applyBrokerFill(ledger, fill) {
  const sym = String(fill.tradingSymbol || '').toUpperCase();
  const premium = Number(fill.premium);
  if (!(premium > 0) || !sym) return null;

  let row = null;
  if (fill.entryTime) {
    const key = `${fill.instrumentId || ''}|${fill.entryTime}|${sym}`;
    row = ledger.find((t) => tradeKey(t) === key) || null;
  }
  if (!row) {
    // Match open/newest unsettled row on symbol
    row =
      [...ledger]
        .reverse()
        .find(
          (t) =>
            (t.optionTradingSymbol || '').toUpperCase() === sym &&
            t.moneyStatus !== 'settled' &&
            (!fill.instrumentId || t.instrumentId === fill.instrumentId),
        ) || null;
  }
  if (!row) {
    row = {
      id: `live-broker-${sym}-${fill.entryTime || Date.now()}`,
      instrumentId: fill.instrumentId,
      instrumentName: fill.instrumentName || fill.instrumentId,
      direction: 'BUY',
      entryTime: fill.entryTime || null,
      exitTime: sideIsExit(fill.side) ? fill.at || new Date().toISOString() : null,
      exitReason: fill.reason || (sideIsExit(fill.side) ? 'Broker exit' : null),
      optionTradingSymbol: fill.tradingSymbol,
      optionLotSize: fill.lotSize || null,
      lotsMultiplier: fill.lots || 1,
      quantity: fill.quantity || null,
      paperEntryPremium: null,
      paperExitPremium: null,
      paperOptionPnlRs: null,
      optionEntryPremium: null,
      optionExitPremium: null,
      optionPnlRs: null,
      chargesRs: null,
      netOptionPnlRs: null,
      outcome: null,
      premiumEstimated: false,
      fillSource: 'broker',
      brokerEntryPremium: null,
      brokerExitPremium: null,
      moneyStatus: 'pending_broker_exit',
    };
    ledger.push(row);
  }

  if (fill.side === 'entry') {
    row.brokerEntryPremium = premium;
    row.optionEntryPremium = premium;
    row.premiumEstimated = false;
    if (!row.entryTime && fill.entryTime) row.entryTime = fill.entryTime;
    // Don't recompute money until exit fill — avoids mixing broker entry with paper exit.
    row.moneyStatus =
      row.brokerExitPremium != null ? 'settled' : 'pending_broker_exit';
    if (row.brokerExitPremium != null) {
      recomputeMoney(row);
      row.fillSource = 'broker';
    }
    return row;
  }

  if (sideIsExit(fill.side)) {
    row.brokerExitPremium = premium;
    row.optionExitPremium = premium;
    row.premiumEstimated = false;
    row.exitReason = fill.reason || row.exitReason || 'Broker exit';
    row.exitTime = fill.at || row.exitTime || new Date().toISOString();
    if (row.brokerEntryPremium != null) {
      row.optionEntryPremium = row.brokerEntryPremium;
    }
    if (row.optionEntryPremium != null && row.optionExitPremium != null) {
      recomputeMoney(row);
      row.fillSource = 'broker';
      row.moneyStatus = 'settled';
    } else {
      row.moneyStatus = 'pending_broker_exit';
    }
  }
  return row;
}

function sideIsExit(side) {
  const s = String(side || '').toLowerCase();
  return s === 'exit' || s === 'sl' || s === 'sell';
}

/** Ingest newly appeared replay closes into the ledger. */
function ingestReplayTrades(ledger, replayTrades, opts = {}) {
  const added = [];
  for (const t of replayTrades || []) {
    if (opts.rejectEstimated) {
      if (t.premiumEstimated) continue;
      const o = t.option || {};
      if (o.source === 'synthetic' || !(o.instrumentToken > 0)) continue;
      if (t.optionPnlRs == null && t.netOptionPnlRs == null) continue;
    }
    const before = ledger.length;
    const row = upsertPaperClose(ledger, t);
    if (row && ledger.length > before) added.push(row);
  }
  return added;
}

function moneyTotals(ledger, opts = {}) {
  const brokerSettled = (ledger || []).filter(
    (t) => t.moneyStatus === 'settled' && t.fillSource === 'broker',
  );
  const brokerTotals = summarize(brokerSettled);
  // Real-money desk: primary totals = broker fills only (ignore phantom paper).
  const forTotals = (ledger || []).filter((t) => {
    if (t.moneyStatus === 'pending_broker_exit') return false;
    if (opts.brokerOnly) {
      return t.fillSource === 'broker' && t.moneyStatus === 'settled';
    }
    if (t.premiumEstimated) return false;
    return t.optionPnlRs != null || t.netOptionPnlRs != null;
  });
  const totals = summarize(forTotals);
  return {
    ...totals,
    brokerTrades: brokerSettled.length,
    brokerNetRs: brokerTotals.optionNetAfterChargesRs,
    pendingBrokerExits: (ledger || []).filter((t) => t.moneyStatus === 'pending_broker_exit').length,
  };
}

function publicTrades(ledger) {
  return (ledger || []).map((t) => ({
    id: t.id,
    instrumentId: t.instrumentId,
    instrumentName: t.instrumentName,
    direction: t.direction,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    exitReason: t.exitReason,
    optionTradingSymbol: t.optionTradingSymbol,
    optionEntryPremium: t.optionEntryPremium,
    optionExitPremium: t.optionExitPremium,
    optionPnlRs: t.optionPnlRs,
    netOptionPnlRs: t.netOptionPnlRs,
    chargesRs: t.chargesRs,
    outcome: t.outcome,
    fillSource: t.fillSource,
    moneyStatus: t.moneyStatus,
    paperEntryPremium: t.paperEntryPremium,
    paperExitPremium: t.paperExitPremium,
    paperOptionPnlRs: t.paperOptionPnlRs,
    brokerEntryPremium: t.brokerEntryPremium,
    brokerExitPremium: t.brokerExitPremium,
    premiumEstimated: t.premiumEstimated,
  }));
}

module.exports = {
  tradeKey,
  upsertPaperClose,
  applyBrokerFill,
  ingestReplayTrades,
  moneyTotals,
  publicTrades,
  recomputeMoney,
};
