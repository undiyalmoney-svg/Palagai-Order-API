'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestedLimitPrice } = require('../execution/limit-price');
const { rowFromDecision } = require('../services/desk');

test('buy limit is about 0.5% above last and never more than 4% above the scan close', () => {
  assert.equal(suggestedLimitPrice({ side: 'BUY', price: 100, priceRef: 100 }), 100.5);
  // Last already through the 4% cap: bid last so the ticket is still marketable; execute still rejects >4%.
  assert.equal(suggestedLimitPrice({ side: 'BUY', price: 106, priceRef: 100 }), 106);
  assert.equal(suggestedLimitPrice({ side: 'SELL', price: 100, priceRef: 100 }), 99.5);
});

test('HOLD desk rows use the share count from the live book, not zero', () => {
  const row = rowFromDecision(
    { symbol: 'TCS', name: 'TCS', action: 'HOLD', quantity: 0, priceRef: 3500, allocationValue: 35000, reason: 'thesis intact', score: 70, risk: { stopPrice: 3200 } },
    null,
    { position: { symbol: 'TCS', qty: 10, avgPrice: 3100 }, lastPrice: 3520 },
  );
  assert.equal(row.qty, 10);
  assert.equal(row.avgPrice, 3100);
  assert.equal(row.lastPrice, 3520);
  assert.equal(row.stopPrice, 3200);
  assert.equal(row.suggestedLimit, null);
});

test('BUY desk rows include a LIMIT the owner can rest in advance', () => {
  const row = rowFromDecision(
    { symbol: 'INFY', name: 'INFY', action: 'BUY', quantity: 4, priceRef: 1500, allocationValue: 6000, reason: 'weekly leader', score: 82 },
    12,
    { lastPrice: 1500, maxDeviationPct: 0.04 },
  );
  assert.equal(row.suggestedLimit, 1507.5);
  assert.match(row.fillHint, /LIMIT buy/);
  assert.match(row.fillHint, /09:15 IST/);
  assert.equal(row.canExecute, true);
  assert.equal(row.signalId, 12);
});
