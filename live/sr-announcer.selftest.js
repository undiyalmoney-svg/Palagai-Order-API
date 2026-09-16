'use strict';
/**
 * Spoken announcer copy from wall / spot / trade — same 5m chart payload.
 */
const assert = require('assert');
const { runSrBreakout } = require('./sr-breakout');
const { bookChartPayload } = require('./sr-structure');
const { exitOptsFor } = require('./sr-strategy-config');
const {
  announceFromChart, announcerFromDesk, mergeAnnouncer, wallLine, NEAR, FAR,
} = require('./sr-announcer');

function hmStr(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
function sessionBars(iso, priceAt, untilMin) {
  const out = [];
  const end = untilMin == null ? 15 * 60 + 25 : untilMin;
  for (let min = 9 * 60 + 15; min <= end; min += 5) {
    const px = priceAt(min);
    out.push({ date: `${iso}T${hmStr(min)}:00+05:30`, open: px.o, high: px.h, low: px.l, close: px.c });
  }
  return out;
}

const warmup = [];
for (let d = 1; d <= 8; d++) {
  let px = 24000;
  warmup.push(...sessionBars(`2026-08-${String(d).padStart(2, '0')}`, () => {
    const o = px;
    const c = px + 0.2;
    px = c;
    return { o, c, h: Math.max(o, c) + 0.5, l: Math.min(o, c) - 0.5 };
  }));
}
const iso = '2026-08-11';
function withRetestPx(min) {
  if (min < 10 * 60 + 45) {
    const lo = 24000 + (min % 10) * 0.2;
    return { o: lo + 10, c: lo + 12, h: 24080, l: 24000 };
  }
  if (min === 10 * 60 + 45) return { o: 24070, c: 24120, h: 24125, l: 24090 };
  if (min === 10 * 60 + 50) return { o: 24118, c: 24110, h: 24122, l: 24095 };
  if (min === 10 * 60 + 55) return { o: 24110, c: 24130, h: 24135, l: 24100 };
  if (min === 11 * 60) return { o: 24125, c: 24115, h: 24130, l: 24080 };
  if (min === 11 * 60 + 5) return { o: 24115, c: 24170, h: 24180, l: 24110 };
  return { o: 24170, c: 24190, h: 24200, l: 24160 };
}
function noRetestPx(min) {
  if (min < 10 * 60 + 45) {
    const lo = 24000 + (min % 10) * 0.2;
    return { o: lo + 10, c: lo + 12, h: 24080, l: 24000 };
  }
  if (min === 10 * 60 + 45) return { o: 24070, c: 24120, h: 24125, l: 24090 };
  if (min === 10 * 60 + 50) return { o: 24120, c: 24140, h: 24150, l: 24110 };
  if (min === 10 * 60 + 55) return { o: 24140, c: 24155, h: 24160, l: 24130 };
  return { o: 24160, c: 24180, h: 24190, l: 24150 };
}

const base = {
  entryPts: 27, trendBars: 20, gapLo: 0, gapHi: 1e9,
  maxTradesPerDay: 1, reportFromDate: iso,
  entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15',
};

const at = '2026-08-11T05:30:00.000Z';

{
  const line = wallLine(24072, 24080, 24000, { near: NEAR.nifty, far: FAR.nifty });
  assert.match(line, /Resistance is there/, line);
}
{
  const line = wallLine(24070, 24080, 24000, { near: NEAR.nifty, far: FAR.nifty });
  assert.match(line, /Support is far away/, line);
}

const morning = warmup.concat(sessionBars(iso, withRetestPx, 10 * 60 + 40));
const morningChart = bookChartPayload(morning, [], {
  id: 'nifty', label: 'Nifty 50', sessionDay: iso, fromHm: '09:15', toHm: '15:15',
});
const morningAnn = announceFromChart(morningChart, { at, book: 'nifty' });
assert.ok(/Waiting for breakout/i.test(morningAnn.text), morningAnn.text);
assert.ok(/Support is (there|far away|\d+ pts away)/i.test(morningAnn.text), morningAnn.text);
assert.strictEqual(morningAnn.state, 'wait_breakout');

const emptyAnn = announceFromChart(bookChartPayload([], [], { id: 'nifty', label: 'Nifty 50' }), { at });
assert.strictEqual(emptyAnn.text, 'No setups yet this session.');
assert.strictEqual(emptyAnn.state, 'no_setup');

const waitConfirmBars = warmup.concat(sessionBars(iso, noRetestPx, 10 * 60 + 50));
const waitChart = bookChartPayload(waitConfirmBars, [], {
  id: 'nifty', label: 'Nifty 50', sessionDay: iso, fromHm: '09:15', toHm: '15:15',
});
const waitAnn = announceFromChart(waitChart, { at, book: 'nifty' });
assert.strictEqual(waitAnn.text, 'Waiting for confirm / retest.');
assert.strictEqual(waitAnn.state, 'wait_confirm');

const retestDay = warmup.concat(sessionBars(iso, withRetestPx));
const paperNifty = runSrBreakout(retestDay, { ...base, ...exitOptsFor('nifty') });
assert.ok(paperNifty.trades.length >= 1);
const t = paperNifty.trades[0];
assert.strictEqual(t.option, 'CE');

const untilFill = warmup.concat(sessionBars(iso, withRetestPx, 11 * 60));
const { trades: fillTrades } = runSrBreakout(untilFill, { ...base, ...exitOptsFor('nifty') });
const fillChart = bookChartPayload(untilFill, fillTrades, {
  id: 'nifty', label: 'Nifty 50', sessionDay: iso, fromHm: '09:15', toHm: '15:15',
});
const fillAnn = announceFromChart(fillChart, { at, book: 'nifty', nowHm: '11:05' });
assert.strictEqual(fillAnn.text, 'Entered CE.');
assert.strictEqual(fillAnn.state, 'in_trade');

const peChart = bookChartPayload(untilFill, fillTrades.map((row) => ({ ...row, option: 'PE', side: 'SELL', dir: -1 })), {
  id: 'bank', label: 'Bank Nifty', sessionDay: iso,
});
assert.strictEqual(announceFromChart(peChart, { at, nowHm: '11:05' }).text, 'Entered PE.');

const fullChart = bookChartPayload(retestDay, paperNifty.trades, {
  id: 'nifty', label: 'Nifty 50', sessionDay: iso, fromHm: '09:15', toHm: '15:15',
});
const doneAnn = announceFromChart(fullChart, { at, nowHm: '15:20' });
assert.ok(/^Out /i.test(doneAnn.text), doneAnn.text);
assert.ok(/TIME|stop|give-up/i.test(doneAnn.text), doneAnn.text);
assert.strictEqual(doneAnn.state, 'out');

const bankPaper = runSrBreakout(retestDay, { ...base, ...exitOptsFor('banknifty'), sessionAlign: false });
const desk = announcerFromDesk({
  books: [
    fullChart,
    bookChartPayload(retestDay, bankPaper.trades, {
      id: 'bank', label: 'Bank Nifty', sessionDay: iso, fromHm: '09:15', toHm: '15:15',
    }),
  ],
}, { at, nowHm: '15:20' });
assert.ok(desk.nifty.text);
assert.ok(desk.banknifty.text);
assert.ok(desk.nifty.at);
assert.ok(desk.banknifty.state);

const first = mergeAnnouncer(null, desk, Date.parse(at));
const same = mergeAnnouncer(first, {
  nifty: { ...desk.nifty, at: '2026-08-11T05:30:10.000Z' },
  banknifty: { ...desk.banknifty, at: '2026-08-11T05:30:10.000Z' },
}, Date.parse(at) + 10_000);
assert.strictEqual(same.nifty.at, first.nifty.at, 'dedup: identical line keeps at');
assert.strictEqual(same.nifty.text, first.nifty.text);

const aged = mergeAnnouncer(first, {
  nifty: { ...desk.nifty, at: '2026-08-11T05:31:05.000Z' },
  banknifty: { ...desk.banknifty, at: '2026-08-11T05:31:05.000Z' },
}, Date.parse(at) + 65_000);
assert.strictEqual(aged.nifty.at, '2026-08-11T05:31:05.000Z', 'clock can move after a minute');

const changed = mergeAnnouncer(first, {
  nifty: { at: '2026-08-11T05:30:20.000Z', text: 'Entered CE.', state: 'in_trade' },
  banknifty: desk.banknifty,
}, Date.parse(at) + 20_000);
assert.strictEqual(changed.nifty.text, 'Entered CE.');
assert.strictEqual(changed.nifty.at, '2026-08-11T05:30:20.000Z');

console.log('sr-announcer.selftest: ok', {
  morning: morningAnn.text,
  wait: waitAnn.text,
  fill: fillAnn.text,
  pe: 'Entered PE.',
  done: doneAnn.text,
  empty: emptyAnn.text,
});
