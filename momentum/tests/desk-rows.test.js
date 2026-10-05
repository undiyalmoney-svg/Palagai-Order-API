'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestedLimitPrice } = require('../execution/limit-price');
const { rowFromDecision, bookEtfHoldRows } = require('../services/desk');

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
  assert.equal(row.suggestedSell, 3502.4);
  assert.equal(row.suggestedLimit, 3502.4);
  assert.match(row.fillHint, /LIMIT sell 10 of TCS/);
});

test('BUY desk rows include a LIMIT the owner can rest in advance', () => {
  const row = rowFromDecision(
    { symbol: 'INFY', name: 'INFY', action: 'BUY', quantity: 4, priceRef: 1500, allocationValue: 6000, reason: 'weekly leader', score: 82 },
    12,
    { lastPrice: 1500, maxDeviationPct: 0.04 },
  );
  assert.equal(row.suggestedLimit, 1507.5);
  assert.match(row.fillHint, /LIMIT buy 4 of INFY/);
  assert.match(row.fillHint, /09:15 IST/);
  assert.equal(row.canExecute, true);
  assert.equal(row.signalId, 12);
});

test('Nifty / Gold / Silver BeES skipped holdings become Hold rows with qty and sell LIMIT', () => {
  const rows = bookEtfHoldRows([
    { symbol: 'GOLDBEES', qty: 25, avgPrice: 70, lastPrice: 72, reason: 'outside momentum universe' },
    { symbol: 'NIFTYBEES', qty: 40, avgPrice: 280, lastPrice: 282, reason: 'outside momentum universe' },
    { symbol: 'SILVERBEES', qty: 12, avgPrice: 90, lastPrice: 91, reason: 'outside momentum universe' },
    { symbol: 'NOTAINDEX', qty: 8, avgPrice: 10, lastPrice: 11, reason: 'outside momentum universe' },
  ]);
  assert.equal(rows.length, 3);
  const gold = rows.find((r) => r.symbol === 'GOLDBEES');
  assert.equal(gold.qty, 25);
  assert.equal(gold.action, 'HOLD');
  assert.equal(gold.suggestedSell, suggestedLimitPrice({ side: 'SELL', price: 72, priceRef: 72 }));
  assert.match(gold.reason, /qty 25/);
  assert.ok(!rows.some((r) => r.symbol === 'NOTAINDEX'));
});

test('CNC overlay adds universe holdings and BeES onto Hold with qty and sell LIMIT', () => {
  const { applyCncOverlay } = require('../services/desk');
  const out = applyCncOverlay(
    {
      buy: [{ symbol: 'INFY', action: 'BUY', qty: 4, suggestedLimit: 1507.5 }],
      hold: [],
      sell: [],
    },
    {
      preview: true,
      universeHoldings: [{ symbol: 'TCS', qty: 10, avgPrice: 3500, lastPrice: 3520 }],
      skipped: [
        { symbol: 'GOLDBEES', qty: 25, avgPrice: 70, lastPrice: 72, reason: 'outside momentum universe' },
        { symbol: 'NOTAINDEX', qty: 8, avgPrice: 10, lastPrice: 11, reason: 'outside momentum universe' },
      ],
    },
    { lastOf: (s) => (s === 'TCS' ? 3520 : null) },
  );
  assert.equal(out.hold.find((r) => r.symbol === 'TCS').qty, 10);
  assert.ok(out.hold.find((r) => r.symbol === 'TCS').suggestedSell > 0);
  assert.equal(out.hold.find((r) => r.symbol === 'GOLDBEES').qty, 25);
  assert.equal(out.alsoHeld.find((r) => r.symbol === 'NOTAINDEX').qty, 8);
  assert.equal(out.buy.length, 1);
});
