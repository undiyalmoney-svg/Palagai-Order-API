'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  OFFSETS,
  bookFromInstrument,
  isWatchedDerivative,
  stopPrice,
  uncoveredQty,
  restingSellQty,
  slOrderFields,
} = require('./rules');
const { classify } = require('./snapshot');

test('SL offsets: Nifty 50 −25, Crude −55, Bank Nifty −55, Sensex −40', () => {
  assert.equal(OFFSETS.nifty, 25);
  assert.equal(OFFSETS.crude, 55);
  assert.equal(OFFSETS.bank, 55);
  assert.equal(OFFSETS.sensex, 40);
  assert.equal(stopPrice('nifty', 180), 155);
  assert.equal(stopPrice('crude', 250), 195);
  assert.equal(stopPrice('bank', 320), 265);
  assert.equal(stopPrice('sensex', 210), 170);
});

test('stop is skipped when entry minus offset is not positive', () => {
  assert.equal(stopPrice('nifty', 25), null);
  assert.equal(stopPrice('nifty', 20), null);
  assert.equal(stopPrice('nifty', 0), null);
});

test('classifies Nifty, Bank, Crude and Sensex derivatives only', () => {
  assert.equal(bookFromInstrument('NIFTY25OCT24500CE'), 'nifty');
  assert.equal(bookFromInstrument('BANKNIFTY25OCT52000PE'), 'bank');
  assert.equal(bookFromInstrument('CRUDEOILM25NOVFUT'), 'crude');
  assert.equal(bookFromInstrument('SENSEX25OCT83000CE'), 'sensex');
  assert.equal(bookFromInstrument('NIFTYBEES'), null);
  assert.equal(bookFromInstrument('FINNIFTY25OCTCE'), null);
  assert.ok(isWatchedDerivative({ tradingsymbol: 'NIFTY25OCT24500CE', exchange: 'NFO' }));
  assert.ok(isWatchedDerivative({ tradingsymbol: 'SENSEX25OCT83000CE', exchange: 'BFO' }));
  assert.equal(isWatchedDerivative({ tradingsymbol: 'NIFTYBEES', exchange: 'NSE' }), false);
});

test('uncovered qty is live minus resting SELL qty', () => {
  assert.equal(uncoveredQty(65, 0), 65);
  assert.equal(uncoveredQty(65, 65), 0);
  assert.equal(uncoveredQty(65, 25), 40);
  assert.equal(uncoveredQty(65, 80), 0);
  assert.equal(uncoveredQty(0, 10), 0);
});

test('SL order uses the same qty and a trigger below entry', () => {
  const fields = slOrderFields(
    { instrument: 'NIFTY25OCT24500CE', exchange: 'NFO', book: 'nifty', product: 'MIS', qty: 65 },
    65,
    155,
  );
  assert.equal(fields.transaction_type, 'SELL');
  assert.equal(fields.order_type, 'SL');
  assert.equal(fields.quantity, '65');
  assert.equal(fields.tag, 'PALAGAI_SL_BUDDY');
  assert.equal(fields.trigger_price, '155.00');
  assert.ok(Number(fields.price) < Number(fields.trigger_price));
});

test('snapshot splits pending buys, live longs and resting SL', () => {
  const orders = [
    {
      order_id: 'p1',
      tradingsymbol: 'NIFTY25OCT24500CE',
      exchange: 'NFO',
      transaction_type: 'BUY',
      status: 'OPEN',
      product: 'MIS',
      quantity: 65,
      pending_quantity: 65,
      price: 180,
    },
    {
      order_id: 's1',
      tradingsymbol: 'BANKNIFTY25OCT52000PE',
      exchange: 'NFO',
      transaction_type: 'SELL',
      status: 'TRIGGER PENDING',
      product: 'MIS',
      quantity: 15,
      pending_quantity: 15,
      order_type: 'SL',
      trigger_price: 265,
    },
  ];
  const positions = [
    {
      tradingsymbol: 'BANKNIFTY25OCT52000PE',
      exchange: 'NFO',
      product: 'MIS',
      quantity: 15,
      average_price: 320,
    },
    {
      tradingsymbol: 'CRUDEOILM25NOVFUT',
      exchange: 'MCX',
      product: 'MIS',
      quantity: 1,
      average_price: 250,
    },
  ];
  const snap = classify(orders, positions);
  assert.equal(snap.pending.length, 1);
  assert.equal(snap.pending[0].instrument, 'NIFTY25OCT24500CE');
  assert.equal(snap.live.length, 2);
  const bank = snap.live.find((r) => r.book === 'bank');
  const crude = snap.live.find((r) => r.book === 'crude');
  assert.equal(bank.qty, 15);
  assert.equal(bank.stop, 265);
  assert.equal(bank.uncoveredQty, 0);
  assert.equal(crude.stop, 195);
  assert.equal(crude.uncoveredQty, 1);
  assert.equal(snap.sl.length, 1);
  assert.equal(snap.sl[0].qty, 15);
});

test('resting sell qty matches live so a second SL is not added', () => {
  const orders = [
    {
      tradingsymbol: 'NIFTY25OCT24500CE',
      transaction_type: 'SELL',
      status: 'TRIGGER PENDING',
      product: 'MIS',
      quantity: 65,
      order_type: 'SL',
    },
  ];
  assert.equal(restingSellQty(orders, 'NIFTY25OCT24500CE'), 65);
  assert.equal(uncoveredQty(65, restingSellQty(orders, 'NIFTY25OCT24500CE')), 0);
});

test('worker rests matching-qty SL only while watching', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-buddy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = require('./store');
  process.env.SL_BUDDY_STATE = path.join(dir, 'state.json');
  t.after(() => {
    delete process.env.SL_BUDDY_STATE;
  });

  const placed = [];
  const kite = {
    async getOrders() {
      return {
        data: {
          data: [
            {
              order_id: '1',
              tradingsymbol: 'NIFTY25OCT24500CE',
              exchange: 'NFO',
              transaction_type: 'BUY',
              status: 'COMPLETE',
              product: 'MIS',
              quantity: 65,
              average_price: 180,
              tag: 'MANUAL',
            },
          ],
        },
      };
    },
    async getPositions() {
      return {
        data: {
          data: {
            day: [
              {
                tradingsymbol: 'NIFTY25OCT24500CE',
                exchange: 'NFO',
                product: 'MIS',
                quantity: 65,
                average_price: 180,
              },
            ],
          },
        },
      };
    },
    async placeOrder(_auth, variety, fields) {
      placed.push({ variety, ...fields });
      return { data: { status: 'success', data: { order_id: `sl-${placed.length}` } } };
    },
  };

  const worker = require('./worker');
  worker.start({
    kite,
    getAuthorization: async () => 'token key:secret',
    saveAuthorization: () => true,
  });
  t.after(() => worker.stop());

  store.save({ ...store.empty('2026-10-12'), enabled: false, userId: 'u1' });
  await worker.tick({ place: true, force: true, userId: 'u1' });
  assert.equal(placed.length, 0);

  store.save({ ...store.empty('2026-10-12'), enabled: true, userId: 'u1' });
  const watching = await worker.tick({ place: true, force: true, userId: 'u1' });
  assert.equal(placed.length, 1);
  assert.equal(placed[0].quantity, '65');
  assert.equal(placed[0].trigger_price, '155.00');
  assert.equal(placed[0].tradingsymbol, 'NIFTY25OCT24500CE');
  assert.equal(placed[0].tag, 'PALAGAI_SL_BUDDY');
  assert.equal(watching.snapshot.live[0].qty, 65);

  store.save({ ...store.load(), enabled: false });
  await worker.tick({ place: true, force: true, userId: 'u1' });
  assert.equal(placed.length, 1);
});
