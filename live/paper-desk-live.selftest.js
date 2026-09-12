'use strict';
const assert = require('assert');
const { PaperDeskWorker } = require('./paper-desk-live');
const store = require('./live.store');

const worker = new PaperDeskWorker({
  readAuth: () => ({ apiKey: 'k', accessToken: 't' }),
  pushEvent: () => {},
  heartbeat: () => {},
  getConfig: () => ({
    engine: 'paper-desk',
    realOrders: false,
    deskPlan: {
      allocation: {
        taken: [
          { bookId: 'nifty', lots: 1 },
          { bookId: 'stocks', lots: 4 },
          { bookId: 'stock:RELIANCE', lots: 6 },
        ],
      },
      books: [
        { id: 'nifty', spec: { mode: 'straddle', straddle: 'short', orMinutes: 15, stopPts: 20 }, sitOut: false, token: 256265 },
        { id: 'stocks', spec: { family: 'inside-day' }, sitOut: false },
        { id: 'stock:RELIANCE', spec: { family: 'inside-day' }, sitOut: false },
      ],
    },
  }),
});
const funded = worker.fundedBooks();
assert.strictEqual(funded.length, 1);
assert.strictEqual(funded[0].book.id, 'nifty');

const watching = new PaperDeskWorker({
  readAuth: () => ({ apiKey: 'k', accessToken: 't' }),
  pushEvent: () => {},
  heartbeat: () => {},
  getConfig: () => ({
    engine: 'paper-desk',
    realOrders: false,
    deskPlan: {
      allocation: { taken: [] },
      month: { locked: true, mode: 'month-locked' },
      books: [
        { id: 'nifty', spec: { mode: 'straddle', straddle: 'short', orMinutes: 15 }, sitOut: false, token: 256265 },
        { id: 'bank', spec: { mode: 'straddle', straddle: 'short', orMinutes: 15 }, sitOut: false, token: 260105 },
      ],
    },
  }),
});
assert.strictEqual(watching.fundedBooks().length, 2, 'live watches Nifty+Bank before the 15m print, even with empty taken');

(async () => {
  const uid = `paper-desk-selftest-${Date.now()}`;
  const st = await store.start(uid, {
    engine: 'paper-desk',
    realOrders: false,
    deskPlan: { allocation: { taken: [] }, books: [] },
  });
  assert.strictEqual(st.status, 'running');
  assert.strictEqual(st.config.engine, 'paper-desk');
  assert.ok(String(st.message).toLowerCase().includes('paper desk'));
  const stopped = await store.stop(uid);
  assert.strictEqual(stopped.status, 'stopped');
  console.log('paper-desk-live.selftest: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
