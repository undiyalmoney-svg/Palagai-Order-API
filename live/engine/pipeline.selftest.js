'use strict';
const assert = require('assert');
const { confirmDirection, selectTradeExpiry, liveTransactionType } = require('./pipeline');

const pe = confirmDirection({ side: 'SELL', option: 'PE' });
assert.strictEqual(pe.optionType, 'PE');
assert.strictEqual(pe.transaction, 'BUY', 'direction first, then BUY the put');
const ce = confirmDirection({ side: 'BUY' });
assert.strictEqual(ce.optionType, 'CE');
assert.strictEqual(ce.transaction, 'BUY');

assert.strictEqual(
  selectTradeExpiry(['2026-09-15', '2026-09-22'], '2026-09-10'),
  '2026-09-15',
  'before expiry day: nearest weekly still after today',
);
assert.strictEqual(
  selectTradeExpiry(['2026-09-15', '2026-09-22'], '2026-09-15'),
  '2026-09-22',
  'expiry day: skip today, pick the next weekly',
);
assert.strictEqual(
  selectTradeExpiry(['2026-09-15'], '2026-09-15'),
  null,
  'expiry day with no next contract: do not buy the dying weekly',
);

assert.strictEqual(liveTransactionType({ vehicle: 'option' }, { side: 'SELL' }), 'BUY');
assert.strictEqual(liveTransactionType({ vehicle: 'fut' }, { side: 'SELL' }), 'SELL');

console.log('engine/pipeline.selftest: ok');
