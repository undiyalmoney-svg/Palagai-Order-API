'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSchedule, pairClosedTrades, previousIsoWeek, lastTradingDayOfIsoWeek, resolvePaperPeriod, stampSuggestions } = require('../services/desk');

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

test('suggestions are buy tomorrow, and sell today only while the cash session is open', () => {
  const book = {
    buy: [{ symbol: 'NIACL', qty: 3 }],
    sell: [{ symbol: 'RECLTD', qty: 1 }],
  };
  const open = stampSuggestions(book, new Date('2026-10-06T05:30:00Z')); // Tue 11:00 IST
  assert.equal(open.buyTomorrow[0].whenLabel, 'Buy tomorrow');
  assert.equal(open.sellToday[0].symbol, 'RECLTD');
  assert.equal(open.sellToday[0].whenLabel, 'Sell today');
  assert.equal(open.sellTomorrow.length, 0);

  const after = stampSuggestions(book, new Date('2026-10-06T11:00:00Z')); // Tue 16:30 IST
  assert.equal(after.buyTomorrow.length, 1);
  assert.equal(after.sellToday.length, 0);
  assert.equal(after.sellTomorrow[0].whenLabel, 'Sell tomorrow');

  const sunday = stampSuggestions(book, new Date('2026-10-04T04:30:00Z'));
  assert.equal(sunday.sellTomorrow[0].whenLabel, 'Sell tomorrow');
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
  assert.equal(closed[0].pnl, 200);
  assert.equal(closed[0].entryTime, '09:15 IST');
  assert.equal(closed[0].exitTime, '09:15 IST');
});

test('pairClosedTrades P&L matches in/out prices across partial lots', () => {
  const closed = pairClosedTrades([
    { side: 'BUY', symbol: 'MOTHERSON', date: '2026-07-07', price: 145.4, qty: 11, cost: 2 },
    { side: 'SELL', symbol: 'MOTHERSON', date: '2026-08-10', price: 169.9, qty: 11, cost: 3, pnl: 999 },
    { side: 'BUY', symbol: 'MOTHERSON', date: '2026-08-11', price: 168.6, qty: 62, cost: 8 },
    { side: 'SELL', symbol: 'MOTHERSON', date: '2026-09-30', price: 160.25, qty: 62, cost: 10, pnl: 837 },
  ]);
  assert.equal(closed.length, 2);
  assert.equal(closed[0].entryPrice, 145.4);
  assert.equal(closed[0].qty, 11);
  assert.equal(closed[1].entryDate, '2026-08-11');
  assert.equal(closed[1].entryPrice, 168.6);
  assert.equal(closed[1].qty, 62);
  assert.ok(closed[1].pnl < 0, `down-move must be a loss, got ${closed[1].pnl}`);
});

test('previousIsoWeek is the week before the given date', () => {
  assert.equal(previousIsoWeek('2026-09-30'), '2026-W39');
});

function fakePanel(from, to) {
  const { addDays, isTradingDay } = require('../utils/dates');
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isTradingDay(d)) dates.push(d);
  return {
    dates,
    lastIndex: dates.length - 1,
    indexOnOrBefore(date) {
      let ans = -1;
      for (let i = 0; i < dates.length; i += 1) if (dates[i] <= date) ans = i;
      return ans;
    },
  };
}

test('paper period filters honour last week, last year and custom dates', () => {
  const panel = fakePanel('2024-01-01', '2026-10-02');
  const week = resolvePaperPeriod(panel, { period: 'last_week' });
  assert.equal(week.period, 'last_week');
  assert.ok(week.to <= panel.dates[panel.lastIndex]);
  const { daysBetween, isoWeekKey } = require('../utils/dates');
  assert.ok(daysBetween(week.from, week.to) <= 6, `last week must not be stretched (${week.from} → ${week.to})`);
  assert.equal(isoWeekKey(week.from), isoWeekKey(week.to));

  const year = resolvePaperPeriod(panel, { period: 'last_year' });
  assert.equal(year.period, 'last_year');
  assert.ok(year.from.startsWith('2025-01'));
  assert.ok(year.to.startsWith('2025-12'));

  const custom = resolvePaperPeriod(panel, { from: '2026-09-01', to: '2026-09-10', period: 'custom' });
  assert.equal(custom.period, 'custom');
  assert.ok(daysBetween(custom.from, custom.to) <= 10, `custom dates must stick (${custom.from} → ${custom.to})`);
});
