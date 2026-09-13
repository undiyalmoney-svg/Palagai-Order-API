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
assert.strictEqual(STRATEGY_ID, 'crude-us-orb');
assert.strictEqual(PLAYBOOK.wallMode, 'orb');
assert.strictEqual(PLAYBOOK.orbFromHm, '18:30');
assert.strictEqual(PLAYBOOK.orbToHm, '19:00');
assert.strictEqual(PLAYBOOK.retest, true);
assert.strictEqual(PLAYBOOK.stopPts, 15);
assert.strictEqual(PLAYBOOK.targetByScore[1], 30);
assert.strictEqual(PLAYBOOK.lockArmPts, 30);
assert.strictEqual(PLAYBOOK.lockAtPts, 18);
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
 * Quiet Indian session (plus a fake 16:00 spike the old Nifty-hours book
 * would take), then a US 18:30–19:00 opening range, a 15m close through it,
 * a 5m retest, then TARGET +30.
 */
function buildDay(day) {
  const out = [];
  for (let m = hmToMin('09:00'); m < hmToMin('16:00'); m += 5) {
    const t = (m - hmToMin('09:00')) / 5;
    const mid = 5260 + t * 0.35;
    const even = Math.floor(m / 5) % 2 === 0;
    const o = even ? mid : mid - 1;
    const c = even ? mid - 1 : mid;
    out.push(bar(day, minToHm(m), o, mid + 2, mid - 3, c));
  }
  // Fake daytime break — must NOT trade (entries start 19:00).
  out.push(bar(day, '16:00', 5304, 5340, 5303, 5338));
  out.push(bar(day, '16:05', 5338, 5341, 5334, 5336));
  out.push(bar(day, '16:10', 5336, 5337, 5308, 5310));
  for (let m = hmToMin('16:15'); m < hmToMin('18:30'); m += 5) {
    out.push(bar(day, minToHm(m), 5308, 5312, 5304, 5308));
  }
  // Opening range 18:30–19:00: high 5312, low 5290 (22 pts).
  out.push(bar(day, '18:30', 5308, 5312, 5300, 5306));
  out.push(bar(day, '18:35', 5306, 5310, 5296, 5302));
  out.push(bar(day, '18:40', 5302, 5308, 5294, 5300));
  out.push(bar(day, '18:45', 5300, 5306, 5290, 5298));
  out.push(bar(day, '18:50', 5298, 5304, 5292, 5300));
  out.push(bar(day, '18:55', 5300, 5308, 5294, 5304));
  // 19:00 15m close through 5312 with trend.
  out.push(bar(day, '19:00', 5306, 5318, 5305, 5316));
  out.push(bar(day, '19:05', 5316, 5320, 5314, 5318));
  out.push(bar(day, '19:10', 5318, 5324, 5316, 5322));
  // Retest the OR high, then +30.
  out.push(bar(day, '19:15', 5320, 5321, 5312, 5314));
  out.push(bar(day, '19:20', 5314, 5348, 5313, 5344));
  out.push(bar(day, '19:25', 5344, 5348, 5342, 5346));
  for (let m = hmToMin('19:30'); m <= hmToMin('23:15'); m += 5) {
    out.push(bar(day, minToHm(m), 5346, 5348, 5344, 5346));
  }
  return out;
}

const day = '2026-09-11';
const candles = buildDay(day);
const morningOnly = candles.filter((c) => String(c.date).slice(11, 16) < '18:30');
const { trades: none } = replayRetest(morningOnly, {
  lots: 1,
  fromDate: day,
  toDate: day,
  symbol: 'CRUDEOILM25SEPFUT',
});
assert.strictEqual(none.length, 0, 'daytime spike must not trade before the US opening range');

const { trades, raw } = replayRetest(candles, {
  lots: 1,
  fromDate: day,
  toDate: day,
  symbol: 'CRUDEOILM25SEPFUT',
});
assert.ok(trades.length >= 1, `expected a US-ORB trade, got ${trades.length}`);
assert.ok(String(trades[0].entryHm || trades[0].entryClock).slice(0, 5) >= '19:00');
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
  assert.strictEqual(paper.strategy, 'crude-us-orb');
  assert.strictEqual(paper.maxLots, 3);
  assert.strictEqual(paper.trades[0].lots, 3);
  assert.strictEqual(paper.trades[0].exitReason, 'TARGET');
  assert.strictEqual(
    paper.trades[0].netOptionPnlRs,
    Math.round(Number(paper.trades[0].indexPoints) * 10 * 3 - 40 * 3),
  );
  assert.ok(Number(paper.trades[0].indexPoints) >= 29);
  assert.strictEqual(paper.trades[0].pnlSource, 'index_x_lot_crude');
  assert.ok(paper.trades.length >= 1);
  assert.match(paper.note, /opening range/i);
  assert.match(paper.note, /ATM CE\/PE/i);
  assert.strictEqual(paper.trades[0].optionEntryPremium, null);

  const csv = [
    'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type',
    '11,1,CRUDEOILM26SEPFUT,CRUDEOILM,0,2026-09-18,0,1,1,FUT',
    '22,2,CRUDEOILM26SEP5300CE,CRUDEOILM,0,2026-09-18,5300,0.05,10,CE',
    '23,3,CRUDEOILM26SEP5300PE,CRUDEOILM,0,2026-09-18,5300,0.05,10,PE',
  ].join('\n');
  const optCandles = [];
  for (let m = hmToMin('10:00'); m <= hmToMin('23:15'); m += 5) {
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

  const { trades: sized, raw: sizedRaw } = replayRetest(candles, {
    lots: 3,
    fromDate: day,
    toDate: day,
    symbol: 'CRUDEOILM25SEPFUT',
  });
  const indexNet = Number(sized[0].netOptionPnlRs);
  assert.strictEqual(sized[0].lots, 3);
  assert.strictEqual(indexNet, Math.round(Number(sized[0].indexPoints) * 10 * 3 - 40 * 3));
  const dump = [];
  for (let m = hmToMin('10:00'); m <= hmToMin('23:15'); m += 5) {
    dump.push({
      date: `${day}T${minToHm(m)}:00+0530`,
      open: 180,
      high: 185,
      low: 40,
      close: 45,
    });
  }
  const overlaySized = await overlayOptionPrices(sized, sizedRaw, {
    authorization: 'token x:y',
    lots: 3,
    fromDate: day,
    toDate: day,
    market: {
      fetchInstrumentsCsv: async () => csv,
      fetchHistorical5m: async (_a, token) => (Number(token) === 22 || Number(token) === 23 ? dump : []),
    },
  });
  assert.strictEqual(overlaySized[0].netOptionPnlRs, indexNet, 'overlay must not rewrite paper ₹ with option × lot_size 10 × lots');
  assert.strictEqual(overlaySized[0].lots, 3);
  assert.ok(overlaySized[0].optionEntryPremium > 0 && overlaySized[0].optionEntryPremium < 250);
  console.log(
    'crude-bot-desk.selftest: ok',
    paper.trades[0].exitReason,
    paper.trades[0].netOptionPnlRs,
    'n=',
    paper.trades.length,
    'optIn',
    priced[0].optionEntryPremium,
    'pts',
    paper.trades[0].indexPoints,
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
