'use strict';
const assert = require('assert');
const { overlayPaperWithLiveFills, liveWhy, liveFillsFromSnap, liveFillsFromKiteOrders, clockOf } = require('./sr-paper-live-overlay');

assert.strictEqual(clockOf('2026-09-16T11:20:00+0530'), '11:20');
assert.strictEqual(liveWhy({ closedBy: 'sl' }, { exitReason: 'STOP' }), 'STOP');
assert.strictEqual(liveWhy({ closedBy: 'exit' }, { exitReason: 'GIVEUP' }), 'GIVEUP');

const paper = [
  {
    instrumentId: 'nifty', instrumentName: 'Nifty 50', direction: 'PE',
    entryTime: '2026-09-16T11:20:00+0530', exitReason: 'GIVEUP', open: false,
    optionEntryPremium: 150, optionExitPremium: 140, netOptionPnlRs: -650, quantity: 65,
  },
  {
    instrumentId: 'nifty', instrumentName: 'Nifty 50', direction: 'PE',
    entryTime: '2026-09-16T11:50:00+0530', exitReason: 'CLOSE', open: true,
    optionEntryPremium: 148, optionExitPremium: 148, netOptionPnlRs: 0, quantity: 65,
  },
  {
    instrumentId: 'bank', instrumentName: 'Bank Nifty', direction: 'CE',
    entryTime: '2026-09-16T10:50:00+0530', exitReason: 'TIME', open: false,
    optionEntryPremium: 780, optionExitPremium: 760, netOptionPnlRs: -600, quantity: 30,
  },
];

const fills = [
  {
    instrumentId: 'nifty-50', tradingSymbol: 'NIFTY2692223200PE',
    entryTime: '2026-09-16T11:30:05+0530', entryPremium: 144.15, exitPremium: 138.75,
    closedBy: 'exit', status: 'flat', quantity: 65,
  },
  {
    instrumentId: 'bank-nifty', tradingSymbol: 'BANKNIFTY26SEP56200CE',
    entryTime: '2026-09-16T10:51:42+0530', entryPremium: 776.75, exitPremium: 735.1,
    closedBy: 'sl', status: 'flat', slTrigger: 735.1, quantity: 30,
  },
];

const out = overlayPaperWithLiveFills(paper, fills);
assert.strictEqual(out[0].liveMatched, true);
assert.strictEqual(out[0].exitReason, 'GIVEUP', 'Why is the Live GIVEUP fill, not a later CLOSE');
assert.strictEqual(out[0].optionEntryPremium, 144.15);
assert.strictEqual(out[0].optionExitPremium, 138.75);
assert.strictEqual(out[0].optionPnlRs, Math.round((138.75 - 144.15) * 65));
assert.strictEqual(out[0].open, false);
assert.ok(!out[1].liveMatched);
assert.ok(/Live filled 11:20 GIVEUP/.test(out[1].skipReason), out[1].skipReason);
assert.strictEqual(out[1].open, false);
assert.strictEqual(out[2].exitReason, 'STOP', 'Bank Why follows Kite SL, not Paper TIME/CLOSE');
assert.strictEqual(out[2].optionEntryPremium, 776.75);
assert.strictEqual(out[2].slTrigger, 735.1);

const snap = {
  broker: {
    closedLegs: fills,
    positions: [],
  },
};
assert.strictEqual(liveFillsFromSnap(snap).length, 2);

{
  const kite = liveFillsFromKiteOrders([
    { tag: 'PALAGAI', transaction_type: 'BUY', status: 'COMPLETE', filled_quantity: 30, average_price: 776.75, tradingsymbol: 'BANKNIFTY26SEP56200CE', order_timestamp: '2026-09-16 10:51:42' },
    { tag: 'PALAGAISL', transaction_type: 'SELL', status: 'COMPLETE', filled_quantity: 30, average_price: 735.1, tradingsymbol: 'BANKNIFTY26SEP56200CE', order_timestamp: '2026-09-16 11:19:05', trigger_price: 735.1 },
    { tag: 'PALAGAI', transaction_type: 'BUY', status: 'COMPLETE', filled_quantity: 65, average_price: 144.15, tradingsymbol: 'NIFTY2692223200PE', order_timestamp: '2026-09-16 11:30:05' },
    { tag: 'PALAGAI', transaction_type: 'SELL', status: 'COMPLETE', filled_quantity: 65, average_price: 138.75, tradingsymbol: 'NIFTY2692223200PE', order_timestamp: '2026-09-16 11:40:36' },
  ], '2026-09-16');
  assert.strictEqual(kite.length, 2);
  const npe = kite.find((f) => /PE$/.test(f.tradingSymbol));
  const bce = kite.find((f) => /CE$/.test(f.tradingSymbol));
  assert.strictEqual(npe.entryPremium, 144.15);
  assert.strictEqual(npe.exitPremium, 138.75);
  assert.strictEqual(npe.closedBy, 'exit');
  assert.strictEqual(bce.closedBy, 'sl');
  const fromKite = overlayPaperWithLiveFills(paper, kite);
  assert.strictEqual(fromKite[0].exitReason, 'GIVEUP');
  assert.strictEqual(fromKite[0].optionPnlRs, -351);
  assert.ok(/Live filled 11:20 GIVEUP/.test(fromKite[1].skipReason));
}

console.log('sr-paper-live-overlay.selftest: ok');
