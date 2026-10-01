'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSchedule, pairClosedTrades, previousIsoWeek, lastTradingDayOfIsoWeek } = require('../services/desk');

test('weekly buy scan is the last trading day of the ISO week after 16:00 IST', () => {
  const wedMorning = new Date('2026-09-30T04:00:00Z'); // Wed 09:30 IST, before 16:00
  const s = buildSchedule('WEEKLY', wedMorning);
  assert.equal(s.buy.date, '2026-10-01');
  assert.equal(s.buy.time, '16:00 IST');
  assert.equal(s.fillTime, '09:15 IST');
  assert.match(s.buy.instruction, /last trading day of the week/);
  assert.match(s.sell.instruction, /HOLD/);
  assert.ok(s.holdRule);
});

test('after Friday 16:00 the next weekly buy scan is the following week', () => {
  const fridayEvening = new Date('2026-09-25T11:00:00Z'); // Fri 16:30 IST
  const s = buildSchedule('WEEKLY', fridayEvening);
  assert.equal(s.buy.date, '2026-10-01');
  assert.equal(lastTradingDayOfIsoWeek('2026-10-05'), '2026-10-09');
});

test('daily horizon: buy and sell both next unused trading day after 16:00', () => {
  const afterClose = new Date('2026-09-30T11:00:00Z'); // Wed 16:30 IST
  const s = buildSchedule('DAILY', afterClose);
  assert.equal(s.buy.date, '2026-10-01');
  assert.equal(s.sell.date, '2026-10-01');
});

test('pairClosedTrades joins each buy to its later sell', () => {
  const closed = pairClosedTrades([
    { side: 'BUY', symbol: 'AAA', date: '2026-01-05', price: 100, qty: 10, reason: 'enter' },
    { side: 'SELL', symbol: 'AAA', date: '2026-02-10', price: 120, qty: 10, pnl: 180, pnlPct: 0.18, holdingDays: 36, reason: 'trail', trigger: 'TRAILING_STOP' },
  ]);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].entryDate, '2026-01-05');
  assert.equal(closed[0].exitDate, '2026-02-10');
  assert.equal(closed[0].holdingDays, 36);
  assert.equal(closed[0].pnl, 180);
  assert.equal(closed[0].entryTime, '09:15 IST');
  assert.equal(closed[0].exitTime, '09:15 IST');
});

test('previousIsoWeek is the week before the given date', () => {
  assert.equal(previousIsoWeek('2026-09-30'), '2026-W39');
});
