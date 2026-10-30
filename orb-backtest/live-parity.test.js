'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const scan = require('../pdh-live/scan');
const { runPdhFollowBook, pdhFollowCandidate, LIVE_MAX_NAMES } = require('./pdh-desk');
const { pdhSignalsForDay } = require('../daily-profit/signals');

function sessionBars(day, overlays = {}) {
  const out = [];
  for (let m = 9 * 60 + 15; m <= 15 * 60 + 15; m += 5) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const hit = overlays[t];
    out.push(
      hit
        ? { t, day, o: hit.o, h: hit.h, l: hit.l, c: hit.c, v: hit.v || 1000 }
        : { t, day, o: 100, h: 100.2, l: 99.8, c: 100.1, v: 1000 },
    );
  }
  return out;
}

function longCrowdDay(dayOverlays) {
  const prev = '2026-10-15';
  const day = '2026-10-16';
  const prevBars = sessionBars(prev, {
    '09:15': { o: 100, h: 101, l: 99.5, c: 100.8 },
    '15:15': { o: 101, h: 101.2, l: 100.8, c: 101 },
  });
  const first15 = {
    '09:15': { o: 101, h: 101.4, l: 100.8, c: 101.3 },
    '09:20': { o: 101.3, h: 101.5, l: 101.1, c: 101.4 },
    '09:25': { o: 101.4, h: 101.6, l: 101.2, c: 101.5 },
    '09:30': { o: 101.6, h: 102.4, l: 101.5, c: 102.3 },
    '09:35': { o: 102.3, h: 102.5, l: 102.2, c: 102.4 },
    '09:40': { o: 102.4, h: 102.6, l: 102.3, c: 102.5 },
  };
  return {
    prev,
    day,
    bars: sessionBars(day, { ...first15, ...dayOverlays }),
    prevBars,
  };
}

function shortCrowdDay(dayOverlays) {
  const prev = '2026-10-15';
  const day = '2026-10-16';
  const prevBars = sessionBars(prev, {
    '09:15': { o: 100, h: 100.5, l: 99, c: 99.2 },
    '15:15': { o: 99, h: 99.2, l: 98.8, c: 99 },
  });
  const first15 = {
    '09:15': { o: 99, h: 99.2, l: 98.6, c: 98.7 },
    '09:20': { o: 98.7, h: 98.9, l: 98.5, c: 98.6 },
    '09:25': { o: 98.6, h: 98.8, l: 98.4, c: 98.5 },
    '09:30': { o: 98.4, h: 98.5, l: 97.6, c: 97.7 },
    '09:35': { o: 97.7, h: 97.8, l: 97.5, c: 97.6 },
    '09:40': { o: 97.6, h: 97.7, l: 97.4, c: 97.5 },
  };
  return {
    prev,
    day,
    bars: sessionBars(day, { ...first15, ...dayOverlays }),
    prevBars,
  };
}

function istAt(day, hm) {
  const [h, m] = hm.split(':').map(Number);
  return new Date(Date.parse(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:05+05:30`));
}

/** Walk the live worker clock: every closed 5-minute bar from 09:50 through 14:30. */
function replayLiveFills(symbolBars, day, capital) {
  const fills = [];
  for (let nowMin = 9 * 60 + 50; nowMin <= 14 * 60 + 30; nowMin += 5) {
    const hm = `${String(Math.floor(nowMin / 60)).padStart(2, '0')}:${String(nowMin % 60).padStart(2, '0')}`;
    const found = scan.eligibleFromBars(symbolBars, {
      day,
      now: istAt(day, hm),
      capital,
      taken: fills.map((f) => f.symbol),
    });
    for (const pick of found.picks || []) {
      if (fills.some((f) => f.symbol === pick.symbol)) continue;
      fills.push(pick);
      if (fills.length >= LIVE_MAX_NAMES) return fills;
    }
  }
  return fills;
}

function liveExit(symbolBars, pick, day) {
  const bars = (symbolBars[pick.symbol] && symbolBars[pick.symbol][day]) || [];
  return scan.subsequentResolved(
    bars,
    { side: pick.side, fillPx: pick.fillPx, stopPx: pick.stopPx, targetR: 1, timeExit: '15:15' },
    pick.signalT,
  );
}

async function histBook(symbolBars, capital, day) {
  return runPdhFollowBook({
    symbolBars,
    capital,
    from: day,
    to: day,
  });
}

function sameFill(hist, live) {
  return {
    symbol: hist.symbol,
    side: hist.side,
    signalT: hist.signalT,
    entryT: hist.entryT,
    entryPx: hist.entryPx,
    stopPx: hist.stopPx,
    qty: hist.qty,
    exitReason: hist.exitReason,
    liveSymbol: live.symbol,
    liveSide: live.side,
    liveSignalT: live.signalT,
    liveFillPx: Math.round(live.fillPx * 100) / 100,
    liveStopPx: Math.round(live.stopPx * 100) / 100,
    liveQty: live.qty,
  };
}

test('live scan and historical PDH emit the same first-print signals', () => {
  const row = longCrowdDay({
    '09:50': { o: 102.6, h: 103.4, l: 102.5, c: 103.3 },
  });
  const symbolBars = { AAA: { [row.prev]: row.prevBars, [row.day]: row.bars } };
  const candidate = pdhFollowCandidate(10000);
  const fromSignals = pdhSignalsForDay(symbolBars, row.day, candidate);
  const fromLive = scan.pdhSignalsForDay(symbolBars, row.day, candidate);
  assert.deepEqual(fromSignals, fromLive);
  assert.equal(fromSignals[0].symbol, 'AAA');
  assert.equal(fromSignals[0].signalT, '09:50');
});

test('One day book matches a live worker replay: two names, close fill, 1R then leftover', async () => {
  const hold = {};
  for (let m = 9 * 60 + 55; m <= 15 * 60 + 15; m += 5) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    hold[t] = { o: 103.1, h: 103.3, l: 102.8, c: 103.0 };
  }
  const a = longCrowdDay({
    '09:50': { o: 102.6, h: 103.2, l: 102.5, c: 103.1 },
    ...hold,
  });
  const b = longCrowdDay({
    '11:20': { o: 102.6, h: 106.4, l: 102.5, c: 105.8 },
    '11:25': { o: 105.8, h: 106.0, l: 105.6, c: 105.9 },
    '15:15': { o: 105.8, h: 106.0, l: 105.5, c: 105.7 },
  });
  const c = longCrowdDay({
    '13:00': { o: 102, h: 112, l: 101.8, c: 111 },
    '15:15': { o: 110, h: 110.2, l: 109.8, c: 110 },
  });
  const symbolBars = {
    NARROW: { [a.prev]: a.prevBars, [a.day]: a.bars },
    WIDE: { [b.prev]: b.prevBars, [b.day]: b.bars },
    THIRD: { [c.prev]: c.prevBars, [c.day]: c.bars },
  };
  const capital = 20000;
  const liveFills = replayLiveFills(symbolBars, a.day, capital);
  const hist = await histBook(symbolBars, capital, a.day);

  assert.equal(liveFills.length, 2);
  assert.equal(hist.trades.length, 2);
  assert.deepEqual(
    liveFills.map((f) => f.symbol).sort(),
    hist.trades.map((t) => t.symbol).sort(),
  );
  assert.deepEqual(hist.trades.map((t) => t.symbol).sort(), ['NARROW', 'WIDE']);

  const histBy = Object.fromEntries(hist.trades.map((t) => [t.symbol, t]));
  for (const live of liveFills) {
    const row = histBy[live.symbol];
    const got = sameFill(row, live);
    assert.equal(got.symbol, got.liveSymbol);
    assert.equal(got.side, got.liveSide);
    assert.equal(got.signalT, got.liveSignalT);
    assert.equal(got.entryT, got.liveSignalT);
    assert.equal(got.entryPx, got.liveFillPx);
    assert.equal(got.stopPx, got.liveStopPx);
    assert.equal(got.qty, got.liveQty);
    assert.equal(got.exitReason, liveExit(symbolBars, live, a.day));
  }
});

test('One day 1R lock matches live subsequentResolved TARGET', async () => {
  const row = longCrowdDay({
    '09:50': { o: 102.6, h: 103.4, l: 102.5, c: 103.3 },
    '09:55': { o: 103.3, h: 103.5, l: 103.2, c: 103.4 },
    '10:00': { o: 103.4, h: 108, l: 103.3, c: 107.5 },
    '10:05': { o: 107.4, h: 107.6, l: 107.2, c: 107.5 },
    '15:15': { o: 107, h: 107.2, l: 106.8, c: 107 },
  });
  const symbolBars = { AAA: { [row.prev]: row.prevBars, [row.day]: row.bars } };
  const capital = 10000;
  const liveFills = replayLiveFills(symbolBars, row.day, capital);
  const hist = await histBook(symbolBars, capital, row.day);
  assert.equal(liveFills.length, 1);
  assert.equal(hist.trades.length, 1);
  assert.equal(hist.trades[0].symbol, liveFills[0].symbol);
  assert.equal(hist.trades[0].entryPx, Math.round(liveFills[0].fillPx * 100) / 100);
  assert.equal(hist.trades[0].exitReason, 'TARGET');
  assert.equal(liveExit(symbolBars, liveFills[0], row.day), 'TARGET');
});

test('One day stop matches live subsequentResolved SL', async () => {
  const row = longCrowdDay({
    '09:50': { o: 102.6, h: 103.4, l: 102.5, c: 103.3 },
    '09:55': { o: 103.3, h: 103.5, l: 100.9, c: 101.0 },
    '15:15': { o: 101, h: 101.2, l: 100.8, c: 101 },
  });
  const symbolBars = { AAA: { [row.prev]: row.prevBars, [row.day]: row.bars } };
  const capital = 10000;
  const liveFills = replayLiveFills(symbolBars, row.day, capital);
  const hist = await histBook(symbolBars, capital, row.day);
  assert.equal(liveFills.length, 1);
  assert.equal(hist.trades.length, 1);
  assert.equal(hist.trades[0].exitReason, 'SL');
  assert.equal(liveExit(symbolBars, liveFills[0], row.day), 'SL');
});

test('date range first session matches live once lookback bars are present', async () => {
  const row = longCrowdDay({
    '09:50': { o: 102.6, h: 103.4, l: 102.5, c: 103.3 },
    '15:15': { o: 103.3, h: 103.5, l: 103.1, c: 103.4 },
  });
  const symbolBars = { AAA: { [row.prev]: row.prevBars, [row.day]: row.bars } };
  const capital = 10000;
  const liveFills = replayLiveFills(symbolBars, row.day, capital);
  const hist = await runPdhFollowBook({
    symbolBars,
    capital,
    from: row.day,
    to: row.day,
  });
  assert.equal(hist.trades.length, liveFills.length);
  assert.equal(hist.trades[0].symbol, 'AAA');
  assert.equal(hist.trades[0].side, liveFills[0].side);
  assert.equal(hist.dailyBooks.length, 1);
});

test('live scan and historical PDH emit the same first-print short signals', () => {
  const row = shortCrowdDay({
    '09:50': { o: 97.4, h: 97.5, l: 96.6, c: 96.7 },
  });
  const symbolBars = { AAA: { [row.prev]: row.prevBars, [row.day]: row.bars } };
  const candidate = pdhFollowCandidate(10000);
  const fromSignals = pdhSignalsForDay(symbolBars, row.day, candidate);
  const fromLive = scan.pdhSignalsForDay(symbolBars, row.day, candidate);
  assert.deepEqual(fromSignals, fromLive);
  assert.equal(fromSignals[0].symbol, 'AAA');
  assert.equal(fromSignals[0].side, 'S');
  assert.equal(fromSignals[0].signalT, '09:50');
  assert.equal(fromSignals[0].stopPx, 98.8);
});

test('One day short 1R lock matches live subsequentResolved TARGET', async () => {
  const row = shortCrowdDay({
    '09:50': { o: 97.4, h: 97.5, l: 96.6, c: 96.7 },
    '09:55': { o: 96.7, h: 96.9, l: 96.5, c: 96.6 },
    '10:00': { o: 96.6, h: 96.8, l: 92, c: 92.5 },
    '15:15': { o: 93, h: 93.2, l: 92.8, c: 93 },
  });
  const symbolBars = { AAA: { [row.prev]: row.prevBars, [row.day]: row.bars } };
  const capital = 10000;
  const liveFills = replayLiveFills(symbolBars, row.day, capital);
  const hist = await histBook(symbolBars, capital, row.day);
  assert.equal(liveFills.length, 1);
  assert.equal(liveFills[0].side, 'S');
  assert.equal(hist.trades.length, 1);
  assert.equal(hist.trades[0].symbol, liveFills[0].symbol);
  assert.equal(hist.trades[0].side, 'S');
  assert.equal(hist.trades[0].entryPx, Math.round(liveFills[0].fillPx * 100) / 100);
  assert.equal(hist.trades[0].stopPx, Math.round(liveFills[0].stopPx * 100) / 100);
  assert.equal(hist.trades[0].qty, liveFills[0].qty);
  assert.equal(hist.trades[0].exitReason, 'TARGET');
  assert.equal(liveExit(symbolBars, liveFills[0], row.day), 'TARGET');
});

test('One day short stop matches live subsequentResolved SL', async () => {
  const row = shortCrowdDay({
    '09:50': { o: 97.4, h: 97.5, l: 96.6, c: 96.7 },
    '09:55': { o: 96.7, h: 99.1, l: 96.5, c: 99 },
    '15:15': { o: 99, h: 99.2, l: 98.8, c: 99 },
  });
  const symbolBars = { AAA: { [row.prev]: row.prevBars, [row.day]: row.bars } };
  const capital = 10000;
  const liveFills = replayLiveFills(symbolBars, row.day, capital);
  const hist = await histBook(symbolBars, capital, row.day);
  assert.equal(liveFills.length, 1);
  assert.equal(liveFills[0].side, 'S');
  assert.equal(hist.trades.length, 1);
  assert.equal(hist.trades[0].side, 'S');
  assert.equal(hist.trades[0].exitReason, 'SL');
  assert.equal(liveExit(symbolBars, liveFills[0], row.day), 'SL');
});

test('Live today clip and One day of today report the same session window', () => {
  const { reportWindow } = require('./jobs');
  const oneDay = reportWindow({ from: '2026-10-29', to: '2026-10-29', liveToday: false });
  const liveToday = reportWindow({ from: '2026-10-22', to: '2026-10-29', liveToday: true });
  assert.deepEqual(oneDay, liveToday);
});
