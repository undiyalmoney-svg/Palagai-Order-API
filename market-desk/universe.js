'use strict';

/**
 * Private Charts desk universe: the public cash indices plus Crude Oil Mini.
 * Public /heatmap stays on Nifty 50 / Bank Nifty / Sensex only.
 */
const { INDICES, listNifty50 } = require('../heatmap/universe');

const CRUDE = {
  id: 'CRUDEOILM',
  name: 'Crude Oil Mini',
  kiteKey: 'MCX:CRUDEOILM',
  kiteToken: 0,
  exchange: 'MCX',
};

function cashIndices() {
  return INDICES.map((i) => ({
    ...i,
    exchange: i.id === 'SENSEX' ? 'BSE' : 'NSE',
  }));
}

function deskIndices(crude = CRUDE) {
  return [...cashIndices(), { ...CRUDE, ...crude }];
}

module.exports = { CRUDE, cashIndices, deskIndices, listNifty50, INDICES };
