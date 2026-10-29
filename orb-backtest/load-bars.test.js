'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, putCachedBars } = require('./store');
const { loadUniverseBars } = require('./load-bars');

function sessionBars(day) {
  const out = [];
  for (let m = 9 * 60 + 15; m <= 15 * 60 + 15; m += 5) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    out.push({ t, day, o: 100, h: 100.2, l: 99.8, c: 100.1, v: 1000 });
  }
  return out;
}

test('loadUniverseBars reads covering cache in batches of 10 and never calls Kite', async () => {
  const db = openDatabase(':memory:');
  const symbols = Array.from({ length: 25 }, (_, i) => `SYM${String(i + 1).padStart(2, '0')}`);
  const inst = new Map();
  for (const symbol of symbols) {
    putCachedBars(db, symbol, '2026-08-31', '2026-10-27', {
      '2026-09-15': sessionBars('2026-09-15'),
      '2026-10-16': sessionBars('2026-10-16'),
    });
    inst.set(symbol, { instrumentToken: 1, tradingSymbol: symbol, exchange: 'NSE', instrumentType: 'EQ' });
  }

  const progress = [];
  const loaded = await loadUniverseBars({
    authorization: 'token unused',
    from: '2026-09-14',
    to: '2026-10-16',
    db,
    symbols,
    batchSize: 10,
    instrumentMap: inst,
    onProgress: (p) => progress.push({ ...p }),
  });

  assert.equal(loaded.withBars, 25);
  assert.equal(loaded.cacheHits, 25);
  assert.equal(loaded.gaps.length, 0);
  assert.deepEqual(Object.keys(loaded.symbolBars['SYM01']).sort(), ['2026-09-15', '2026-10-16']);

  const batches = [...new Set(progress.filter((p) => p.phase === 'candles').map((p) => p.batch))];
  assert.deepEqual(batches, [1, 2, 3]);
  assert.equal(progress[0].batches, 3);
  assert.equal(progress[0].batchSize, 10);
  db.close();
});

test('covering cache skips Kite entirely when every name is already stored', async () => {
  const db = openDatabase(':memory:');
  const symbols = ['AAA', 'BBB', 'CCC'];
  for (const symbol of symbols) {
    putCachedBars(db, symbol, '2026-08-31', '2026-10-27', { '2026-10-16': sessionBars('2026-10-16') });
  }
  const loaded = await loadUniverseBars({
    authorization: null,
    from: '2026-10-16',
    to: '2026-10-16',
    db,
    symbols,
    batchSize: 10,
  });
  assert.equal(loaded.cacheHits, 3);
  assert.equal(loaded.withBars, 3);
  assert.equal(loaded.missing.length, 0);
  db.close();
});

test('loadUniverseBars yields between batches so the event loop stays pollable', async () => {
  const db = openDatabase(':memory:');
  const symbols = Array.from({ length: 30 }, (_, i) => `BAT${String(i + 1).padStart(2, '0')}`);
  const inst = new Map();
  for (const symbol of symbols) {
    putCachedBars(db, symbol, '2026-08-31', '2026-10-27', { '2026-10-16': sessionBars('2026-10-16') });
    inst.set(symbol, { instrumentToken: 1, tradingSymbol: symbol, exchange: 'NSE', instrumentType: 'EQ' });
  }

  let polls = 0;
  const timer = setInterval(() => {
    polls += 1;
  }, 1);
  const started = Date.now();
  await loadUniverseBars({
    authorization: 'token unused',
    from: '2026-10-16',
    to: '2026-10-16',
    db,
    symbols,
    batchSize: 10,
    instrumentMap: inst,
  });
  clearInterval(timer);
  const elapsed = Date.now() - started;
  assert.ok(polls >= 2, `expected the event loop to tick during batched cache hits, got ${polls} polls in ${elapsed}ms`);
  db.close();
});
