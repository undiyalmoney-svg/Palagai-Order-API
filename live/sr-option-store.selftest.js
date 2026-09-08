'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-opt-store-'));
process.env.SR_OPTION_STORE_DIR = dir;
const store = require('./sr-option-store');

assert.strictEqual(store.pickFrontExpiry(['2026-09-15', '2025-03-06', '2025-03-13'], '2025-03-01'), '2025-03-06');
assert.strictEqual(store.pickFrontExpiry(['2026-09-15'], '2025-03-01'), null, 'must not bind an old signal to today\'s weekly');
assert.strictEqual(store.pickFrontExpiry(['2026-09-15'], '2026-09-08'), '2026-09-15');

assert.strictEqual(store.loadBars(1, '2026-09-01').length, 0);
assert.ok(store.saveBars({
  instrumentToken: 99,
  tradingSymbol: 'NIFTY2690824100CE',
  date: '2026-09-01',
  candles: [{ date: '2026-09-01T11:05:00+0530', open: 1, high: 2, low: 1, close: 1.5 }],
}));
assert.strictEqual(store.loadBars(99, '2026-09-01').length, 1);
assert.ok(store.saveBars({
  instrumentToken: 99,
  tradingSymbol: 'NIFTY2690824100CE',
  date: '2026-09-01',
  candles: [
    { date: '2026-09-01T11:05:00+0530', close: 1.5 },
    { date: '2026-09-01T11:10:00+0530', close: 1.6 },
  ],
}));
assert.strictEqual(store.loadBars(99, '2026-09-01').length, 2, 'keep the longer series');

assert.ok(store.saveContract({
  name: 'NIFTY', tradingSymbol: 'NIFTY2690824100CE', instrumentToken: 99,
  expiry: '2026-09-08', strike: 24100, instrumentType: 'CE', lotSize: 65,
}));
const merged = store.mergeNfoInstruments([], store.listContracts(), 'NIFTY', 'CE');
assert.strictEqual(merged.length, 1);
assert.strictEqual(merged[0].instrumentToken, 99);
assert.strictEqual(store.mergeNfoInstruments([], store.listContracts(), 'NIFTY', 'PE').length, 0);

(async () => {
  const { pickOption, SPEC } = require('./sr-live');
  const pick = await pickOption('no-auth', SPEC.nifty, {
    date: '2026-09-01', side: 'BUY', option: 'CE', entryPrice: 24100,
  }, { paperPick: true, nfoInstruments: [] });
  assert.ok(pick);
  assert.strictEqual(pick.tradingSymbol, 'NIFTY2690824100CE');
  const historic = await pickOption('no-auth', SPEC.nifty, {
    date: '2025-03-01', side: 'BUY', option: 'CE', entryPrice: 22000,
  }, {
    paperPick: true,
    nfoInstruments: [
      { name: 'NIFTY', tradingSymbol: 'NIFTY2691524100CE', instrumentToken: 1, expiry: '2026-09-15', strike: 24100, instrumentType: 'CE', exchange: 'NFO', lotSize: 65 },
      { name: 'NIFTY', tradingSymbol: 'NIFTY2530622000CE', instrumentToken: 2, expiry: '2025-03-06', strike: 22000, instrumentType: 'CE', exchange: 'NFO', lotSize: 65 },
    ],
    nfoWithArchive: [
      { name: 'NIFTY', tradingSymbol: 'NIFTY2691524100CE', instrumentToken: 1, expiry: '2026-09-15', strike: 24100, instrumentType: 'CE', exchange: 'NFO', lotSize: 65 },
      { name: 'NIFTY', tradingSymbol: 'NIFTY2530622000CE', instrumentToken: 2, expiry: '2025-03-06', strike: 22000, instrumentType: 'CE', exchange: 'NFO', lotSize: 65 },
    ],
  });
  assert.strictEqual(historic.tradingSymbol, 'NIFTY2530622000CE', 'historical trade uses that week\'s contract');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('sr-option-store.selftest ok');
})().catch((e) => { console.error(e); process.exit(1); });
