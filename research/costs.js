'use strict';

const { estimateEquityRoundTripCharges } = require('../services/equity-charges');

/**
 * Intraday cash-equity (MIS-style) charges. A flat brokerage is not used as
 * the whole cost. Delivery charges are not applied because positions are
 * squared off inside the session and are not assumed to be held overnight.
 */
function roundTripCharges(entryPrice, exitPrice, quantity) {
  return estimateEquityRoundTripCharges({ entryPrice, exitPrice, quantity });
}

module.exports = { roundTripCharges };
