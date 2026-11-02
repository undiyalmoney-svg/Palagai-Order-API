/**
 * Zerodha commodity calculator 2026-11-02:
 * CRUDEOILM Nov NRML ₹31,051 (31.26%). MIS + SL-M still rejected at ₹14k free.
 */
const CRUDE_FUT_NRML_RS = 31_000;
const CRUDE_FUT_MIN_FREE_RS = 20_000;

function futOpenBlock(commodityCash) {
  const cash = Math.max(0, Math.round(Number(commodityCash) || 0));
  if (cash >= CRUDE_FUT_MIN_FREE_RS) return null;
  return (
    `Kite rejected Crude Mini FUT — it needs more than ₹14,000 free. ` +
    `Today’s CRUDEOILM NRML is ~₹${CRUDE_FUT_NRML_RS.toLocaleString('en-IN')}. ` +
    `Commodity cash ₹${cash.toLocaleString('en-IN')} cannot open 1 lot + SL-M. ` +
    `Standing down. Cheap CE/PE is the ₹14k plan on Test.`
  );
}

function isMarginReject(message) {
  return /margin|insufficient|required|rms|funds/i.test(String(message || ''));
}

module.exports = {
  CRUDE_FUT_NRML_RS,
  CRUDE_FUT_MIN_FREE_RS,
  futOpenBlock,
  isMarginReject,
};
