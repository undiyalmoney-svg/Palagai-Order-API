'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateCandidates, BASELINE_ID, describe, toEngineConfig } = require('./candidates');
const { splitDays } = require('./split');
const { runDiscovery } = require('./pipeline');
const { clampConfig, backtestStock, toMin } = require('../engine');

function bar(day, hm, o, h, l, c, v = 1000) {
  return { t: hm, day, o, h, l, c, v };
}

function fmt(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function sessionBars(day, overlay = {}, rest = { o: 104.2, h: 104.6, l: 103.9, c: 104.3, v: 800 }) {
  const bars = [];
  for (let m = toMin('09:15'); m <= toMin('15:15'); m += 5) {
    const hm = fmt(m);
    if (overlay[hm]) bars.push({ t: hm, day, v: 1000, ...overlay[hm] });
    else bars.push({ t: hm, day, v: rest.v || 800, ...rest });
  }
  return bars;
}

function longSetup(day) {
  return sessionBars(day, {
    '09:15': { o: 100, h: 101.2, l: 99.8, c: 100.6 },
    '09:20': { o: 100.6, h: 101.8, l: 100.4, c: 101.4 },
    '09:25': { o: 101.4, h: 102, l: 101.2, c: 101.7 },
    '09:30': { o: 101.8, h: 102.6, l: 101.7, c: 102.4 },
    '09:35': { o: 102.4, h: 102.9, l: 102.2, c: 102.7 },
    '09:40': { o: 102.7, h: 103.4, l: 102.5, c: 103.1 },
    '09:45': { o: 103.1, h: 103.2, l: 102.4, c: 102.5 },
    '09:50': { o: 102.5, h: 102.6, l: 101.9, c: 102.0 },
    '09:55': { o: 102.0, h: 103.0, l: 101.85, c: 102.8 },
    '10:00': { o: 102.9, h: 103.6, l: 102.7, c: 103.4 },
    '10:30': { o: 103.4, h: 104.8, l: 103.2, c: 104.5 },
    '11:00': { o: 104.5, h: 105.2, l: 104.3, c: 105.0 },
    '15:15': { o: 104.8, h: 105.0, l: 104.4, c: 104.7 },
  });
}

test('search space always includes the original first-15 baseline with inspectable rules', () => {
  const list = generateCandidates({ capital: 40000, budget: 24 });
  assert.equal(list[0].id, BASELINE_ID);
  assert.equal(list[0].isBaseline, true);
  assert.equal(list[0].experimental, false);
  assert.equal(list[0].pullbacksNeeded, 2);
  assert.equal(list[0].timeExit, '15:15');
  assert.equal(list[0].targetR, null);
  const ids = new Set(list.map((c) => c.id));
  assert.equal(ids.size, list.length);
  const text = describe(list[0]);
  assert.match(text.entry, /fully close/i);
  assert.match(text.stopLoss, /signal-candle/i);
  assert.ok(list.some((c) => c.experimental));
  assert.ok(list.every((c) => c.rules && c.rules.entry && c.rules.exit));
  const tenK = list.find((c) => c.crowdFilter === 'skipShort' && c.rankBy === 'stopPct' && c.entryEnd === '14:30');
  assert.ok(tenK, '10k skip-short-crowd widest-stop desk is in the search');
  assert.equal(tenK.maxStocksPerDay, 5);
  assert.match(tenK.rules.filters.join(' '), /short-crowd/i);
  assert.match(tenK.rules.stockCount, /widest signal-candle stop/i);
  assert.ok(list.some((c) => c.crowdFilter === 'skipShort' && c.entryEnd === '12:30'));
});

test('chronological split never shuffles future days into training', () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
  const split = splitDays(days);
  assert.equal(split.mode, 'train_val_oos');
  assert.ok(split.train[split.train.length - 1] < split.validation[0]);
  assert.ok(split.validation[split.validation.length - 1] < split.oos[0]);
});

test('discovery ranks the original book against alternatives and never live-orders', async () => {
  const byDay = {};
  for (let d = 16; d <= 23; d += 1) {
    const day = `2026-10-${d}`;
    byDay[day] = longSetup(day);
  }
  const out = await runDiscovery({
    symbolBars: { AAA: byDay, BBB: byDay },
    capital: 40000,
    budget: 12,
  });
  assert.equal(out.simulated, true);
  assert.equal(out.liveOrders, false);
  assert.ok(out.candidatesEvaluated >= 8);
  assert.ok(out.leaderboard.some((r) => r.id === BASELINE_ID && r.isBaseline));
  assert.ok(out.dailyWinners.length >= 8);
  assert.ok(out.dailyWinners.every((d) => d.selection === 'retrospective'));
  assert.match(out.dailyWinners[0].note, /not knowable before the open/i);
  assert.ok(out.weeklyWinners.length >= 1);
  assert.ok(out.assumptions.some((a) => /baseline/i.test(a)));
  for (const row of out.leaderboard) {
    if (row.netPnl <= 0) assert.equal(row.profitable, false);
  }
  if (!out.recommended) {
    assert.match(out.noRobust, /No sufficiently robust profitable strategy found/i);
  } else {
    assert.ok(out.recommended.rules.entry);
    assert.ok(out.recommended.oos);
  }
});

test('baseline engine config still enters on the green high and stops at the green low', () => {
  const day = '2026-10-16';
  const cfg = clampConfig(toEngineConfig(generateCandidates({ budget: 1 })[0], 40000));
  const { trades } = backtestStock('AAA', { [day]: longSetup(day) }, cfg);
  assert.equal(trades[0].stopPx, 101.85);
  assert.ok(trades[0].entryPx >= 103);
  assert.equal(trades[0].exitReason, 'EOD');
  assert.equal(trades[0].tgtPx, null);
});
