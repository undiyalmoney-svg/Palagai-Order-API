'use strict';

const { UNIVERSE } = require('../momentum/data/universe');

/**
 * Dated membership of the scan universe.
 * Symbols are the application's existing liquid large-cap list (Nifty 50 style),
 * not a fabricated price series. Live runs replace instrument tokens from the
 * Kite instruments file when credentials are configured.
 *
 * Membership date is the date this list was recorded in the repo. It is not a
 * claim that the official index was unchanged after that date — refresh from
 * Kite when a session is available.
 */
const UNIVERSE_DATE = '2026-03-31';

function nifty50(date = UNIVERSE_DATE) {
  return UNIVERSE.slice(0, 50).map((row) => ({
    exchange: 'NSE',
    symbol: row.symbol,
    name: row.name,
    sector: row.sector,
    instrumentToken: null,
    tickSize: 0.05,
    lotSize: 1,
    universeDate: date,
    eligible: true,
  }));
}

module.exports = { UNIVERSE_DATE, nifty50 };
