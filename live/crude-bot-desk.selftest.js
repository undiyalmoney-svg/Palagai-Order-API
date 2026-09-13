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
assert.strictEqual(STRATEGY_ID, 'live-crude-green');
assert.strictEqual(PLAYBOOK.wallMode, 'session-or');
assert.strictEqual(PLAYBOOK.orbFromHm, '09:00');
assert.strictEqual(PLAYBOOK.orbToHm, '09:30');
assert.strictEqual(PLAYBOOK.minOrbPts, 0);
assert.strictEqual(PLAYBOOK.maxOrbPts, 60);
assert.strictEqual(PLAYBOOK.entryStartHm, '16:00');
assert.strictEqual(PLAYBOOK.maxTradesPerDay, 2);
assert.strictEqual(PLAYBOOK.allowBuy, false);
assert.strictEqual(PLAYBOOK.allowSell, true);
assert.strictEqual(PLAYBOOK.sitOutAfterLoss, false);
assert.strictEqual(PLAYBOOK.stopPts, 30);
assert.strictEqual(PLAYBOOK.targetByScore[1], 80);
assert.ok(isCrudeDeskBody({ engine: 'crude-desk' }));
assert.match(fs.readFileSync(path.join(__dirname, 'crude-bot-desk.js'), 'utf8'), /require\('\.\/dna-live-crude-green'\)/);

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

function fillSession(day, fromHm, toHm, mid) {
  const out = [];
  for (let m = hmToMin(fromHm); m < hmToMin(toHm); m += 5) {
    const even = Math.floor(m / 5) % 2 === 0;
    const o = even ? mid : mid - 1;
    const c = even ? mid - 1 : mid;
    out.push(bar(day, minToHm(m), o, mid + 2, mid - 3, c));
  }
  return out;
}

/** Morning OR 45 pts (5295–5340). Evening close through OR + confirm + target. */
function buildWinDay(day) {
  const out = [];
  out.push(bar(day, '09:00', 5310, 5340, 5308, 5330));
  out.push(bar(day, '09:05', 5330, 5338, 5310, 5318));
  out.push(bar(day, '09:10', 5318, 5322, 5306, 5312));
  out.push(bar(day, '09:15', 5312, 5316, 5295, 5300));
  out.push(bar(day, '09:20', 5300, 5308, 5296, 5304));
  out.push(bar(day, '09:25', 5304, 5312, 5298, 5308));
  out.push(...fillSession(day, '09:30', '10:00', 5310));
  out.push(bar(day, '10:00', 5310, 5365, 5308, 5360));
  out.push(bar(day, '10:05', 5360, 5362, 5330, 5334));
  out.push(bar(day, '10:10', 5334, 5336, 5312, 5316));
  out.push(...fillSession(day, '10:15', '16:00', 5320));
  out.push(bar(day, '16:00', 5318, 5320, 5286, 5288));
  out.push(bar(day, '16:05', 5288, 5290, 5276, 5278));
  out.push(bar(day, '16:10', 5278, 5280, 5270, 5272));
  out.push(bar(day, '16:15', 5272, 5274, 5264, 5266));
  out.push(bar(day, '16:20', 5266, 5268, 5200, 5208));
  out.push(bar(day, '16:25', 5208, 5212, 5204, 5206));
  out.push(...fillSession(day, '16:30', '22:45', 5206));
  return out;
}

function buildWideOrDay(day) {
  const out = [];
  out.push(bar(day, '09:00', 5310, 5410, 5280, 5400));
  out.push(bar(day, '09:05', 5400, 5412, 5380, 5390));
  out.push(bar(day, '09:10', 5390, 5395, 5370, 5375));
  out.push(bar(day, '09:15', 5375, 5380, 5360, 5365));
  out.push(bar(day, '09:20', 5365, 5370, 5350, 5355));
  out.push(bar(day, '09:25', 5355, 5360, 5340, 5345));
  out.push(...fillSession(day, '09:30', '16:00', 5350));
  out.push(bar(day, '16:00', 5350, 5420, 5348, 5418));
  out.push(bar(day, '16:05', 5418, 5422, 5416, 5420));
  out.push(...fillSession(day, '16:10', '22:45', 5420));
  return out;
}

const winDay = '2026-09-11';
const win = buildWinDay(winDay);
const morningOnly = win.filter((c) => String(c.date).slice(11, 16) < '16:00');
assert.strictEqual(replayRetest(morningOnly, { lots: 1, fromDate: winDay, toDate: winDay }).trades.length, 0);
assert.strictEqual(replayRetest(buildWideOrDay(winDay), { lots: 1, fromDate: winDay, toDate: winDay }).trades.length, 0);

const { trades, raw } = replayRetest(win, { lots: 1, fromDate: winDay, toDate: winDay, symbol: 'CRUDEOILM25SEPFUT' });
assert.ok(trades.length >= 1, `expected session-OR trade, got ${trades.length}`);
assert.ok(String(trades[0].entryHm || trades[0].entryClock).slice(0, 5) >= '16:00');
assert.strictEqual(trades[0].direction, 'PE');
assert.ok(Number(trades[0].indexPoints) > 0, `expected a green exit, got ${trades[0].exitReason} ${trades[0].indexPoints}`);
assert.ok(isOptionPrem(120, 8864));

(async () => {
  const paper = await runCrudeDesk(
    {
      authorization: 'token x:y',
      fromDate: winDay,
      toDate: winDay,
      capitalRs: 40000,
      capitalSource: 'mine',
      liveMoney: false,
    },
    { candles: win, market: { fetchUserMargins: async () => null }, skipOptionOverlay: true },
  );
  assert.strictEqual(paper.strategy, 'live-crude-green');
  assert.strictEqual(paper.maxLots, 3);
  assert.strictEqual(paper.trades[0].lots, 3);
  assert.strictEqual(
    paper.trades[0].netOptionPnlRs,
    Math.round(Number(paper.trades[0].indexPoints) * 10 * 3 - 40 * 3),
  );
  assert.ok(paper.trades[0].netOptionPnlRs > 0);
  assert.strictEqual(paper.protection.dayRiskRs, 30 * 10 * 3);
  assert.match(paper.note, /16:00–21:00/);
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
      date: `${winDay}T${minToHm(m)}:00+0530`,
      open: 118,
      high: 122,
      low: 116,
      close: 118,
    });
  }
  const priced = await overlayOptionPrices(trades, raw, {
    authorization: 'token x:y',
    lots: 1,
    fromDate: winDay,
    toDate: winDay,
    market: {
      fetchInstrumentsCsv: async () => csv,
      fetchHistorical5m: async (_a, token) => (Number(token) === 22 || Number(token) === 23 ? optCandles : []),
    },
  });
  assert.ok(priced[0].optionEntryPremium > 50 && priced[0].optionEntryPremium < 250);
  assert.strictEqual(priced[0].netOptionPnlRs, trades[0].netOptionPnlRs);

  const otherDay = '2026-09-12';
  const mixedBars = [
    ...optCandles,
    {
      date: `${otherDay}T16:40:00+0530`,
      open: 645.05,
      high: 645.05,
      low: 645.05,
      close: 645.05,
    },
  ];
  const csvZero = [
    'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type',
    '11,1,CRUDEOILM26SEPFUT,CRUDEOILM,0,2026-09-18,0,1,1,FUT',
    '23,3,CRUDEOILM26SEP5300PE,CRUDEOILM,0,2026-09-18,0,0.05,10,PE',
  ].join('\n');
  const isolated = await overlayOptionPrices(trades, raw, {
    authorization: 'token x:y',
    lots: 1,
    fromDate: winDay,
    toDate: otherDay,
    market: {
      fetchInstrumentsCsv: async () => csvZero,
      fetchHistorical5m: async () => mixedBars,
    },
  });
  assert.strictEqual(isolated[0].optionStrike, 5300);
  assert.ok(isolated[0].optionEntryPremium !== 645.05, 'must not use another day\'s option print');
  assert.notStrictEqual(isolated[0].entryOhlc && isolated[0].entryOhlc.close, 645.05);

  console.log(
    'crude-bot-desk.selftest: ok',
    paper.trades[0].exitReason,
    paper.trades[0].netOptionPnlRs,
    'dayRisk',
    paper.protection.dayRiskRs,
    'optIn',
    priced[0].optionEntryPremium,
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
