'use strict';
const assert = require('assert');
const { LiveBroker, crudeMiniOrderLotSize } = require('./live-broker');

assert.strictEqual(
  crudeMiniOrderLotSize({ tradingSymbol: 'CRUDEOILM26SEP5300CE', exchange: 'MCX', lotSize: 10 }),
  1,
);
assert.strictEqual(
  crudeMiniOrderLotSize({ tradingSymbol: 'CRUDEOILM26SEPFUT', exchange: 'MCX', lotSize: 10 }),
  1,
);
assert.strictEqual(
  crudeMiniOrderLotSize({ tradingSymbol: 'NIFTY26SEP25000CE', exchange: 'NFO', lotSize: 65 }),
  65,
);

const broker = new LiveBroker({ pushEvent() {}, realOrders: false });
broker.setLots('nifty-50', 1);
broker.setOptionMaxLossRs('nifty-50', 5000);

const fillLate = broker.optionSlTrigger({
  fillPremium: 0,
  ltp: 120,
  indexRisk: 76.92,
  exchange: 'NFO',
  tradingSymbol: 'NIFTY2591525000CE',
  instrumentId: 'nifty-50',
  quantity: 65,
  fut: false,
});
assert.ok(fillLate > 0 && fillLate < 120, `late fill must still get option SL, got ${fillLate}`);

broker.setOptionMaxLossRs('bank-nifty', 2500);
const bankFull = broker.optionSlTrigger({
  fillPremium: 776.75,
  ltp: 776.75,
  indexRisk: 2500 / 30,
  exchange: 'NFO',
  tradingSymbol: 'BANKNIFTY26SEP56200CE',
  instrumentId: 'bank-nifty',
  quantity: 30,
  fut: false,
});
assert.ok(Math.abs((776.75 - bankFull) - 2500 / 30) < 1, `Live Bank SL must match Paper ₹2500 pts, got ${bankFull}`);
broker.setOptionMaxLossRs('bank-nifty', 0);
const bank = broker.optionSlTrigger({
  fillPremium: 0,
  ltp: 280,
  indexRisk: 0,
  exchange: 'NFO',
  tradingSymbol: 'BANKNIFTY2591551200PE',
  instrumentId: 'bank-nifty',
  quantity: 30,
  fut: false,
});
assert.ok(bank > 0 && bank < 280, `Bank with no ₹ cap still parks SL below LTP, got ${bank}`);

console.log('live-broker-sl.selftest ok');
