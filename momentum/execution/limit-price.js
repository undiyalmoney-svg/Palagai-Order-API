'use strict';

const { roundTick } = require('../utils/math');

/**
 * LIMIT the owner can rest in advance (AMO after 16:00, or the next 09:15 open).
 * Same formula the order manager uses when it actually sends the ticket:
 *   BUY  — ~0.5% above last, never more than maxDeviation above the scan close
 *   SELL — ~0.5% below last so the open can fill
 */
function suggestedLimitPrice({ side, price, priceRef, maxDeviationPct = 0.04 }) {
  const px = Number(price) || Number(priceRef);
  const ref = Number(priceRef) || px;
  if (!Number.isFinite(px) || px <= 0) return null;
  const dev = Number.isFinite(maxDeviationPct) ? maxDeviationPct : 0.04;
  if (String(side).toUpperCase() === 'BUY') {
    const cap = ref * (1 + dev);
    const limit = Math.min(px * 1.005, cap);
    return roundTick(Math.max(limit, px));
  }
  return roundTick(px * 0.995);
}

module.exports = { suggestedLimitPrice };
