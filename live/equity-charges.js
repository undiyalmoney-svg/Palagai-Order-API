/**
 * Zerodha MIS (intraday) equity charge estimator — NOT the same formula as
 * F&O options (charge-entry-gate.js). Equity intraday has its own STT/stamp
 * duty/brokerage structure.
 *
 * Rates (approximate, standard Zerodha intraday equity, 2026):
 *   Brokerage: min(Rs20, 0.03%) per executed order, each leg
 *   STT: 0.025% on SELL turnover only (intraday equity)
 *   Exchange (NSE) txn charges: 0.00297% on both legs
 *   SEBI: 0.0001% (Rs10/crore) on both legs
 *   Stamp duty: 0.003% on BUY turnover only
 *   GST: 18% on (brokerage + exchange + SEBI)
 */
function roundPaise(n) {
  return Math.round(n * 100) / 100;
}

function estimateEquityRoundTripCharges({ entryPrice, exitPrice, quantity }) {
  const qty = Math.max(0, Math.floor(quantity) || 0);
  const buyPx = Math.max(0, Number(entryPrice) || 0);
  const sellPx = Math.max(0, Number(exitPrice) || 0);
  if (qty < 1 || (buyPx <= 0 && sellPx <= 0)) {
    return { totalRs: 0 };
  }
  const buyTurnover = buyPx * qty;
  const sellTurnover = sellPx * qty;

  const brokerageBuy = Math.min(20, buyTurnover * 3e-4);
  const brokerageSell = Math.min(20, sellTurnover * 3e-4);
  const brokerageRs = roundPaise(brokerageBuy + brokerageSell);

  const sttRs = roundPaise(sellTurnover * 25e-5);
  const exchangeRs = roundPaise((buyTurnover + sellTurnover) * 297e-7);
  const sebiRs = roundPaise((buyTurnover + sellTurnover) * 1e-6);
  const stampRs = roundPaise(buyTurnover * 3e-5);
  const gstRs = roundPaise((brokerageRs + exchangeRs + sebiRs) * 0.18);

  return {
    totalRs: roundPaise(brokerageRs + sttRs + exchangeRs + sebiRs + stampRs + gstRs),
    brokerageRs,
    sttRs,
    exchangeRs,
    sebiRs,
    stampRs,
    gstRs,
  };
}

/**
 * Zerodha CNC (delivery, multi-day hold) equity charge estimator.
 *
 * Materially different from intraday (estimateEquityRoundTripCharges above):
 *   Brokerage: Rs0 (Zerodha equity delivery is brokerage-free)
 *   STT: 0.1% on BOTH buy and sell turnover (vs 0.025% sell-only intraday)
 *   Stamp duty: 0.015% on BUY turnover (vs 0.003% intraday — 5x higher)
 *   DP (Depository Participant) charge: ~Rs15 + 18% GST, ONCE per scrip per
 *     sell day, regardless of quantity — a flat cost intraday trades never
 *     pay (shares never leave the demat account intraday). Easy to forget
 *     and easy to underestimate on a strategy with many small positions.
 *   Exchange + SEBI: same rates as intraday.
 */
const DP_CHARGE_RS = 15;
const DP_GST_RATE = 0.18;

function estimateDeliveryRoundTripCharges({ entryPrice, exitPrice, quantity }) {
  const qty = Math.max(0, Math.floor(quantity) || 0);
  const buyPx = Math.max(0, Number(entryPrice) || 0);
  const sellPx = Math.max(0, Number(exitPrice) || 0);
  if (qty < 1 || (buyPx <= 0 && sellPx <= 0)) {
    return { totalRs: 0 };
  }
  const buyTurnover = buyPx * qty;
  const sellTurnover = sellPx * qty;

  const sttRs = roundPaise((buyTurnover + sellTurnover) * 1e-3);
  const exchangeRs = roundPaise((buyTurnover + sellTurnover) * 297e-7);
  const sebiRs = roundPaise((buyTurnover + sellTurnover) * 1e-6);
  const stampRs = roundPaise(buyTurnover * 15e-5);
  const dpRs = roundPaise(DP_CHARGE_RS * (1 + DP_GST_RATE));
  const gstRs = roundPaise(exchangeRs * 0.18); // brokerage is 0, so GST base is just exchange+SEBI-ish

  return {
    totalRs: roundPaise(sttRs + exchangeRs + sebiRs + stampRs + dpRs + gstRs),
    sttRs,
    exchangeRs,
    sebiRs,
    stampRs,
    dpRs,
    gstRs,
    brokerageRs: 0,
  };
}

module.exports = { estimateEquityRoundTripCharges, estimateDeliveryRoundTripCharges };
