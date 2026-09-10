'use strict';
/**
 * Auto Bot desk strategy: Align Combo · GENIE (not S/R Breakout, not Trap V2).
 * Nifty ATM CE/PE buys. Bank/Crude stay hard-off on this worker.
 */
const { createGenieStrategy } = require('./strategy-core.cjs');
const { indexDayRiskOverrides } = require('./daily-desk-defaults');
const { clampMaxTradesToDna } = require('./dna-live-green');

function genieInitOverrides(config, instrumentId) {
  const risk =
    indexDayRiskOverrides({
      instrumentId,
      enableNifty: !!(config && config.enableNifty),
      enableBank: !!(config && config.enableBank),
      dayProfitLock: !!(config && config.dayProfitLock),
      strictDayStop: !!(config && config.strictDayStop),
    }) || {};
  const extras = { genieRouterEnabled: true };
  if (config && config.optionStandDownRs != null) {
    extras.optionStandDownRs = Number(config.optionStandDownRs);
  }
  const bank = /bank/i.test(String(instrumentId || ''));
  const fromUi = bank ? config && config.bankMaxTradesDay : config && config.niftyMaxTradesDay;
  return {
    ...risk,
    extras,
    maxTradesPerDay: clampMaxTradesToDna(fromUi),
  };
}

function makeGenieStrategy(config, instrumentId) {
  const s = createGenieStrategy();
  s.initialize(genieInitOverrides(config, instrumentId));
  return s;
}

module.exports = { genieInitOverrides, makeGenieStrategy, DESK_STRATEGY_ID: 'align-combo-genie' };
