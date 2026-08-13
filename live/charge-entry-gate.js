/**
 * Charge-cover entry gate — skip tickets that cannot pay round-trip costs.
 *
 * Rule: expected option ₹ must be ≥ chargeCoverMultiple × estimated
 * round-trip charges. Fat Bank ATM premium can also be capped.
 * Crude is not gated here (separate DNA).
 */

const ATM_OPTION_DELTA = {
  nifty: 0.41,
  bank: 0.3,
  crude: 0.55,
  natgas: 0.55,
};

function roundPaise(n) {
  return Math.round(n * 100) / 100;
}

function bookForInstrumentId(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  if (id.includes('bank')) return 'bank';
  if (id.includes('natgas') || id.includes('naturalgas')) return 'natgas';
  if (id.includes('crude')) return 'crude';
  return 'nifty';
}

function estimateRoundTripCharges({ entryPrice, exitPrice, quantity }) {
  const qty = Math.max(0, Math.floor(quantity) || 0);
  const entry = Math.max(0, Number(entryPrice) || 0);
  const exit = Math.max(0, Number(exitPrice) || 0);
  if (qty < 1 || (entry <= 0 && exit <= 0)) {
    return { totalRs: 0 };
  }
  const buyTurnover = entry * qty;
  const sellTurnover = exit * qty;
  // Zerodha F&O options: ₹20 per executed order (not 0.03% like futures).
  const brokerageRs = roundPaise(20 + 20);
  const exchangeRs = roundPaise((buyTurnover + sellTurnover) * 35e-5);
  const sttRs = roundPaise(sellTurnover * 1e-3);
  const stampRs = roundPaise(buyTurnover * 3e-5);
  const sebiRs = roundPaise((buyTurnover + sellTurnover) * 1e-6);
  const gstRs = roundPaise((brokerageRs + exchangeRs + sebiRs) * 0.18);
  return {
    totalRs: roundPaise(brokerageRs + exchangeRs + gstRs + sebiRs + stampRs + sttRs),
  };
}

function expectedOptionRs({ instrumentId, indexEntry, indexStop, indexTarget, quantity, targetRMultiple }) {
  const qty = Math.max(0, Number(quantity) || 0);
  if (!(qty > 0)) return 0;
  const entry = Number(indexEntry) || 0;
  const stop = Number(indexStop) || 0;
  const target = Number(indexTarget) || 0;
  let targetPts = Math.abs(target - entry);
  if (!(targetPts > 0)) {
    const risk = Math.abs(entry - stop);
    const rr = Number(targetRMultiple) > 0 ? Number(targetRMultiple) : 3.5;
    targetPts = risk * rr;
  }
  if (!(targetPts > 0)) return 0;
  const delta = ATM_OPTION_DELTA[bookForInstrumentId(instrumentId)] || 0.41;
  return targetPts * delta * qty;
}

/**
 * @returns {{ skip: boolean, reason?: string, expectedRs?: number, chargesRs?: number, needRs?: number }}
 */
function evaluateChargeEntryGate(input = {}) {
  const book = bookForInstrumentId(input.instrumentId);
  if (book === 'crude' || book === 'natgas') return { skip: false };

  const ops = input.ops || {};
  const prem = Number(input.entryPremium) || 0;
  const qty = Math.max(0, Math.floor(Number(input.quantity) || 0));

  const maxPremKey = book === 'bank' ? 'maxBankEntryPremium' : 'maxNiftyEntryPremium';
  const maxPrem = Number(ops[maxPremKey]) || 0;
  if (maxPrem > 0 && prem > maxPrem) {
    return {
      skip: true,
      reason: `Charge-path skip — ${book} premium ₹${prem.toFixed(2)} > cap ₹${maxPrem}`,
    };
  }

  const multiple = Number(ops.chargeCoverMultiple);
  if (!(multiple > 0) || prem <= 0 || qty < 1) return { skip: false };

  const expectedRs = expectedOptionRs({
    instrumentId: input.instrumentId,
    indexEntry: input.indexEntry,
    indexStop: input.indexStop,
    indexTarget: input.indexTarget,
    quantity: qty,
    targetRMultiple: input.targetRMultiple,
  });
  const exitPrem = prem + expectedRs / qty;
  const chargesRs = estimateRoundTripCharges({
    entryPrice: prem,
    exitPrice: Math.max(0.05, exitPrem),
    quantity: qty,
  }).totalRs;
  const needRs = multiple * chargesRs;
  if (expectedRs + 1e-9 < needRs) {
    return {
      skip: true,
      reason: `Charge-path skip — expected ₹${Math.round(expectedRs)} < ${multiple}× charges ₹${Math.round(chargesRs)}`,
      expectedRs,
      chargesRs,
      needRs,
    };
  }
  return { skip: false, expectedRs, chargesRs, needRs };
}

module.exports = {
  bookForInstrumentId,
  estimateRoundTripCharges,
  expectedOptionRs,
  evaluateChargeEntryGate,
};
