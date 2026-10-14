'use strict';

/**
 * Market-data provider seam. The desk talks to this, not to Kite directly,
 * so another licensed feed can replace Kite Connect later.
 */
const kiteMarket = require('../services/kite-market');

class KiteMarketProvider {
  constructor(opts = {}) {
    this.fetchQuotes = opts.fetchQuotes || kiteMarket.fetchQuotes;
    this.fetchHistoricalCandles = opts.fetchHistoricalCandles || kiteMarket.fetchHistoricalCandles;
    this.name = 'kite';
  }

  async quotes(authorization, keys) {
    return this.fetchQuotes(authorization, keys);
  }

  async history(authorization, instrumentToken, fromDate, toDate, interval) {
    return this.fetchHistoricalCandles(authorization, instrumentToken, fromDate, toDate, interval);
  }
}

module.exports = { KiteMarketProvider };
