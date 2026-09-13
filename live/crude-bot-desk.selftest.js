'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  ENGINE,
  STRATEGY_ID,
  PLAYBOOK,
  replayRetest,
  runCrudeDesk,
  isCrudeDeskBody,
  isOptionPrem,
  overlayOptionPrices,
} = require('./crude-bot-desk');

assert.strictEqual(ENGINE, 'crude-desk');
assert.strictEqual(STRATEGY_ID, 'crude-retest');
assert.strictEqual(PLAYBOOK.retest, true);
assert.strictEqual(PLAYBOOK.lockArmPts, 20);
assert.strictEqual(PLAYBOOK.lockAtPts, 12);
assert.strictEqual(PLAYBOOK.maxRetestBars, 2);
assert.ok(isCrudeDeskBody({ engine: 'crude-desk' }));
assert.ok(!isCrudeDeskBody({ engine: 'sr-desk' }));

const src = fs.readFileSync(path.join(__dirname, 'crude-bot-desk.js'), 'utf8');
assert.match(src, /runSrBreakout\(/);
assert.doesNotMatch(src, /require\('\.\/dna-live-crude-green'\)/);

function hmToMin(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}
function minToHm(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function bar(day, hm, o, h, l, c) {
  return { date: `${day}T${hm}:00+0530`, open: o, high: h, low: l, close: c };
}

/**
 * Range under a 5310 cap (no premature 3-bar break), drift up so trend>0,
 * then one 15m close through the wall, a 5m retest, then TARGET +20.
 */
function buildDay(day) {
  const out = [];
  for (let m = hmToMin('09:00'); m < hmToMin('16:00'); m += 5) {
    const t = (m - hmToMin('09:00')) / 5;
    const mid = 5280 + t * 0.08;
    const even = Math.floor(m / 5) % 2 === 0;
    const o = even ? mid : mid - 1;
    const c = even ? mid - 1 : mid;
    out.push(bar(day, minToHm(m), o, Math.min(5308, mid + 3), mid - 4, c));
  }
  // 16:00–16:10: 15m close through ~5308 wall.
  out.push(bar(day, '16:00', 5304, 5322, 5303, 5320));
  out.push(bar(day, '16:05', 5320, 5321, 5316, 5318));
  out.push(bar(day, '16:10', 5318, 5319, 5315, 5317));
  // First 5m after 16:15 15m close: retest the broken high, then +20.
  out.push(bar(day, '16:15', 5317, 5318, 5306, 5308));
  out.push(bar(day, '16:20', 5308, 5340, 5307, 5335));
  out.push(bar(day, '16:25', 5335, 5342, 5334, 5340));
  for (let m = hmToMin('16:30'); m <= hmToMin('22:45'); m += 5) {
    out.push(bar(day, minToHm(m), 5340, 5342, 5338, 5340));
  }
  return out;
}

const day = '2026-09-11';
const candles = buildDay(day);
const { trades, raw } = replayRetest(candles, {
  lots: 1,
  fromDate: day,
  toDate: day,
  symbol: 'CRUDEOILM25SEPFUT',
});
assert.ok(trades.length >= 1, `expected a retest trade, got ${trades.length}`);
assert.strictEqual(trades[0].vehicle, 'option');
assert.strictEqual(trades[0].side, 'BUY');
assert.match(String(trades[0].sideLabel), /CE BUY|PE BUY/);
assert.strictEqual(trades[0].optionEntryPremium, null);
assert.ok(Number(trades[0].indexEntry) > 2000);
assert.ok(!/FUT/i.test(String(trades[0].optionSymbol)));
assert.strictEqual(trades[0].exitReason, 'TARGET');
assert.ok(Number(trades[0].netOptionPnlRs) > 0);
assert.ok(isOptionPrem(120, 8864));
assert.ok(!isOptionPrem(8864, 8864));

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
    { candles, market: { fetchUserMargins: async () => null }, skipOptionOverlay: true },
  );
  assert.strictEqual(paper.engine, 'crude-desk');
  assert.strictEqual(paper.strategy, 'crude-retest');
  assert.strictEqual(paper.maxLots, 3);
  assert.ok(paper.trades.length >= 1);
  assert.match(paper.note, /retest/i);
  assert.match(paper.note, /ATM CE\/PE/i);
  assert.strictEqual(paper.trades[0].optionEntryPremium, null);

  const csv = [
    'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type',
    '11,1,CRUDEOILM26SEPFUT,CRUDEOILM,0,2026-09-18,0,1,1,FUT',
    '22,2,CRUDEOILM26SEP5300CE,CRUDEOILM,0,2026-09-18,5300,0.05,10,CE',
    '23,3,CRUDEOILM26SEP5300PE,CRUDEOILM,0,2026-09-18,5300,0.05,10,PE',
  ].join('\n');
  const optCandles = [];
  for (let m = hmToMin('10:00'); m <= hmToMin('22:45'); m += 5) {
    optCandles.push({
      date: `${day}T${minToHm(m)}:00+0530`,
      open: 118,
      high: 122,
      low: 116,
      close: 118,
    });
  }
  const priced = await overlayOptionPrices(trades, raw, {
    authorization: 'token x:y',
    lots: 1,
    fromDate: day,
    toDate: day,
    market: {
      fetchInstrumentsCsv: async () => csv,
      fetchHistorical5m: async (_a, token) => (Number(token) === 22 || Number(token) === 23 ? optCandles : []),
    },
  });
  assert.ok(priced[0].optionEntryPremium > 50 && priced[0].optionEntryPremium < 250, priced[0].optionEntryPremium);
  assert.ok(priced[0].slPrice > 0 && priced[0].slPrice < priced[0].optionEntryPremium);
  assert.match(String(priced[0].optionSymbol), /CRUDEOILM26SEP5300CE|CRUDEOILM26SEP5300PE/);
  console.log(
    'crude-bot-desk.selftest: ok',
    paper.trades[0].exitReason,
    paper.trades[0].netOptionPnlRs,
    'n=',
    paper.trades.length,
    'optIn',
    priced[0].optionEntryPremium,
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
