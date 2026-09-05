'use strict';
/**
 * S/R EXECUTION-MODE FIREWALL.
 *
 * The S/R research / paper / observation subsystem (sr-breakout, sr-observe,
 * sr-collector and their controllers) must NEVER place, modify, or cancel a
 * real broker order. That guarantee is already architectural — none of those
 * modules import live-broker.js — but this module makes it EXPLICIT and
 * testable rather than relying on a hidden frontend button.
 *
 * EXECUTION_MODE is a hard constant here. Paper / observe / collector stay
 * firewalled (assertBrokerDisabled). The dedicated S/R Live worker
 * (sr-live.js) is the only path allowed to place MIS orders, and only after
 * the user presses Start Live.
 */

const MODES = Object.freeze({ PAPER: 'PAPER', LIVE_SIGNAL: 'LIVE_SIGNAL', LIVE_BROKER: 'LIVE_BROKER' });

const EXECUTION_MODE = process.env.SR_EXECUTION_MODE || MODES.LIVE_SIGNAL;
/** Paper/observe remain disabled. S/R Live worker is a separate opt-in path. */
const LIVE_BROKER_DISABLED = true;

function brokerOrdersEnabled() {
  return LIVE_BROKER_DISABLED === false && EXECUTION_MODE === MODES.LIVE_BROKER;
}

/** Throw if anything on the S/R path attempts real broker execution. */
function assertBrokerDisabled(where = 'sr') {
  if (brokerOrdersEnabled()) return; // (never true in this build)
  const err = new Error(
    `[sr-firewall] Real broker orders are DISABLED (mode=${EXECUTION_MODE}). ` +
    `${where} may only generate signals, tickets and paper/observation records — never place an order.`,
  );
  err.code = 'SR_BROKER_DISABLED';
  throw err;
}

module.exports = { MODES, EXECUTION_MODE, LIVE_BROKER_DISABLED, brokerOrdersEnabled, assertBrokerDisabled };
