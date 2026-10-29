'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, putCachedBars, getCachedBars, getCachedBarsCovering, sliceBars } = require('./store');

function dayBars(day, close = 100) {
  return [{ t: '09:15', day, o: close, h: close + 1, l: close - 1, c: close, v: 1000 }];
}

test('covering cache reuses a wider pull and slices to the requested days', () => {
  const db = openDatabase(':memory:');
  putCachedBars(db, 'RELIANCE', '2026-08-31', '2026-10-27', {
    '2026-08-31': dayBars('2026-08-31', 90),
    '2026-09-15': dayBars('2026-09-15', 95),
    '2026-10-16': dayBars('2026-10-16', 100),
    '2026-10-27': dayBars('2026-10-27', 105),
  });

  assert.equal(getCachedBars(db, 'RELIANCE', '2026-09-14', '2026-10-16'), null);

  const sliced = getCachedBarsCovering(db, 'RELIANCE', '2026-09-14', '2026-10-16');
  assert.ok(sliced);
  assert.deepEqual(Object.keys(sliced).sort(), ['2026-09-15', '2026-10-16']);
  assert.equal(sliced['2026-10-16'][0].c, 100);
  assert.equal(sliced['2026-08-31'], undefined);

  const exact = getCachedBarsCovering(db, 'RELIANCE', '2026-08-31', '2026-10-27');
  assert.equal(Object.keys(exact).length, 4);

  assert.equal(getCachedBarsCovering(db, 'RELIANCE', '2026-07-01', '2026-07-31'), null);
  assert.equal(getCachedBarsCovering(db, 'TCS', '2026-09-14', '2026-10-16'), null);
  db.close();
});

test('sliceBars returns null when the window has no session days', () => {
  assert.equal(sliceBars({ '2026-10-16': dayBars('2026-10-16') }, '2026-09-01', '2026-09-30'), null);
});
