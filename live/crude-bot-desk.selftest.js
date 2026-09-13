'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  ENGINE,
  STRATEGY_ID,
  RULES,
  replaySqueeze,
  runCrudeDesk,
  isCrudeDeskBody,
} = require('./crude-bot-desk');

assert.strictEqual(ENGINE, 'crude-desk');
assert.strictEqual(STRATEGY_ID, 'crude-squeeze');
assert.strictEqual(RULES.squeezeStart, '17:00');
assert.ok(isCrudeDeskBody({ engine: 'crude-desk' }));
assert.ok(isCrudeDeskBody({ desk: 'crude' }));
assert.ok(!isCrudeDeskBody({ engine: 'sr-desk' }));

const src = fs.readFileSync(path.join(__dirname, 'crude-bot-desk.js'), 'utf8');
assert.doesNotMatch(src, /runSrBreakout\(/);
assert.doesNotMatch(src, /require\('\.\/dna-live-crude-green'\)/);
assert.doesNotMatch(src, /require\('\.\/sr-breakout'\)/);

function bar(day, hm, o, h, l, c) {
  return { date: `${day}T${hm}:00+0530`, open: o, high: h, low: l, close: c };
}

function coil(day, base) {
  // 17:00–17:45 every 5m, width 18
  const out = [];
  for (let m = 17 * 60; m <= 17 * 60 + 45; m += 5) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    out.push(bar(day, `${hh}:${mm}`, base + 5, base + 18, base, base + 8));
  }
  return out;
}

const day = '2026-09-11';
const candles = [
  ...coil(day, 5400),
  bar(day, '17:50', 5410, 5412, 5408, 5411),
  bar(day, '18:00', 5418, 5424, 5416, 5422), // close >= 5420 → BUY
  bar(day, '18:05', 5422, 5456, 5420, 5455), // target
];
const { trades } = replaySqueeze(candles, { lots: 1, fromDate: day, toDate: day, symbol: 'CRUDEOILM25SEPFUT' });
assert.strictEqual(trades.length, 1);
assert.strictEqual(trades[0].side, 'BUY');
assert.strictEqual(trades[0].exitReason, 'TARGET');
assert.strictEqual(trades[0].vehicle, 'fut');
assert.ok(trades[0].slPrice > 0);
assert.ok(trades[0].netOptionPnlRs > 0, `net ${trades[0].netOptionPnlRs}`);
assert.match(trades[0].optionSymbol, /CRUDEOILM/);

const wide = coil('2026-09-12', 5400).map((b, i) =>
  i === 0 ? { ...b, high: b.low + 40 } : b,
);
const skip = replaySqueeze(wide, { lots: 1, fromDate: '2026-09-12', toDate: '2026-09-12' });
assert.strictEqual(skip.trades.length, 0);

(async () => {
  const paper = await runCrudeDesk(
    {
      authorization: 'token x:y',
      fromDate: day,
      toDate: day,
      capitalRs: 40000,
      capitalSource: 'mine',
      liveMoney: false,
    },
    { candles, market: { fetchUserMargins: async () => null } },
  );
  assert.strictEqual(paper.engine, 'crude-desk');
  assert.strictEqual(paper.strategy, 'crude-squeeze');
  assert.strictEqual(paper.instruments[0].id, 'crude');
  assert.ok(paper.trades.length >= 1);
  assert.match(paper.note, /squeeze/i);
  assert.doesNotMatch(paper.note, /S\/R wall-break/);
  console.log('crude-bot-desk.selftest: ok', trades[0].exitReason, trades[0].netOptionPnlRs);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
