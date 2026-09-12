'use strict';
const assert = require('assert');
const {
  specGrid,
  simulate,
  simulateDay,
  searchSpecs,
  runDiscover,
  simulateInsideDay,
  searchInsideDay,
  allocateDesk,
  allocateMonth,
  summarize,
  specStillAlive,
  ENGINE,
  STRATEGY_FAMILY,
  RETIRED_FAMILIES,
  BOOKS,
} = require('./paper-discover');
const { parseKiteFunds } = require('./kite-market');

const kitePocket = parseKiteFunds({
  status: 'success',
  data: {
    equity: { net: 81234.5, available: { cash: 50000, live_balance: 61200.4 } },
    commodity: { net: 1500, available: { cash: 1500 } },
  },
});
assert.strictEqual(kitePocket.capitalRs, 61200);
assert.strictEqual(kitePocket.equityCash, 61200);
assert.strictEqual(kitePocket.equityNet, 81235);
assert.strictEqual(kitePocket.commodityCash, 1500);

assert.ok(specGrid().some((s) => s.mode === 'regime' && s.family === 'or-regime'));
assert.ok(specGrid().length > 8);
assert.strictEqual(ENGINE, 'paper-desk');
assert.ok(RETIRED_FAMILIES.includes('vwap-impulse'));
assert.ok(BOOKS.bank.token);
assert.strictEqual(BOOKS.crude.lotSize, 10);
assert.ok(!/genie|trap|ee-wait|order-flow|vwap-impulse/i.test(ENGINE));

function bar(date, hm, o, h, l, c, volume = 1000) {
  const hh = String(Math.floor(hm / 100)).padStart(2, '0');
  const mm = String(hm % 100).padStart(2, '0');
  return { date: `${date}T${hh}:${mm}:00+0530`, open: o, high: h, low: l, close: c, volume };
}

function failHighDay(date) {
  const out = [];
  let minutes = 9 * 60 + 15;
  const end = 15 * 60 + 30;
  let px = 25000;
  while (minutes <= end) {
    const hm = Math.floor(minutes / 60) * 100 + (minutes % 60);
    let open = px;
    let close = px;
    let high = px + 6;
    let low = px - 6;
    if (hm < 930) {
      close = 25005;
      high = 25012;
      low = 24988;
      open = 25000;
    } else if (hm === 935) {
      open = 25010;
      close = 25040;
      high = 25042;
      low = 25008;
    } else if (hm === 940) {
      open = 25038;
      close = 25008;
      high = 25040;
      low = 25005;
    } else {
      close = px - 8;
      open = px;
      high = px + 2;
      low = close - 2;
    }
    out.push(bar(date, hm, open, high, low, close));
    px = close;
    minutes += 5;
  }
  return out;
}

const train = [];
for (let d = 1; d <= 31; d += 1) {
  train.push(...failHighDay(`2026-08-${String(d).padStart(2, '0')}`));
}
for (let d = 1; d <= 10; d += 1) {
  train.push(...failHighDay(`2026-09-${String(d).padStart(2, '0')}`));
}
const test = failHighDay('2026-09-11');
const candles = [...train, ...test];

const found = searchSpecs(candles, { trainFrom: '2026-08-01', trainTo: '2026-08-10', lots: 1 });
assert.ok(found && found.spec && !found.sitOut);
assert.ok(found.totals.trades >= 5);
assert.ok(found.totals.profitFactor >= 1.5);
assert.ok(found.totals.grossProfitRs >= found.totals.grossLossRs);

const testTrades = simulate(candles, found.spec, { fromDate: '2026-09-11', toDate: '2026-09-11', lots: 1 });
assert.ok(testTrades.length >= 1);
assert.ok(testTrades.length <= 1);
assert.strictEqual(testTrades[0].direction, 'PE');

const morning = candles.filter((c) => {
  const m = /T(\d{2}):(\d{2})/.exec(String(c.date));
  if (!m || String(c.date).slice(0, 10) !== '2026-09-11') return false;
  return Number(m[1]) * 100 + Number(m[2]) <= 1000;
});
const liveState = simulateDay(morning, found.spec, 1, BOOKS.nifty, { withOpen: true, flattenOpen: false });
assert.ok(Array.isArray(liveState.trades));
assert.ok(liveState.open, 'mid-session paper/live must keep the same open trade');
assert.ok(liveState.open.dir < 0);

function trendHoldDay(date) {
  const out = [];
  let minutes = 9 * 60 + 15;
  const end = 15 * 60 + 30;
  let px = 25000;
  while (minutes <= end) {
    const hm = Math.floor(minutes / 60) * 100 + (minutes % 60);
    let open = px;
    let close = px;
    let high = px + 6;
    let low = px - 6;
    if (hm < 945) {
      close = 25005;
      high = 25018;
      low = 24988;
      open = 25000;
    } else if (hm === 945) {
      open = 25010;
      close = 25055;
      high = 25058;
      low = 25008;
    } else {
      close = px + 12;
      open = px;
      high = close + 2;
      low = px - 1;
    }
    out.push(bar(date, hm, open, high, low, close));
    px = close;
    minutes += 5;
  }
  return out;
}

const regimeSpec = specGrid().find((s) => s.mode === 'regime');
const orbTrades = simulateDay(trendHoldDay('2026-09-11'), regimeSpec, 1, BOOKS.nifty);
assert.ok(orbTrades.length === 1, 'VWAP-aligned ORB takes one continuation trade');
assert.strictEqual(orbTrades[0].direction, 'CE');
assert.ok(orbTrades[0].netOptionPnlRs > 0);
assert.strictEqual(simulateDay(trendHoldDay('2026-09-08'), regimeSpec, 1, BOOKS.nifty).length, 0, 'regime skips Tuesday');

function failThenRun(date) {
  const out = [];
  let minutes = 9 * 60 + 15;
  const end = 15 * 60 + 30;
  let px = 25000;
  while (minutes <= end) {
    const hm = Math.floor(minutes / 60) * 100 + (minutes % 60);
    let open = px;
    let close = px;
    let high = px + 6;
    let low = px - 6;
    if (hm < 930) {
      close = 25005;
      high = 25012;
      low = 24988;
      open = 25000;
    } else if (hm === 935) {
      open = 25010;
      close = 25040;
      high = 25042;
      low = 25008;
    } else if (hm === 940) {
      open = 25038;
      close = 25008;
      high = 25040;
      low = 25005;
    } else {
      close = px + 40;
      open = px;
      high = close + 2;
      low = px - 1;
    }
    out.push(bar(date, hm, open, high, low, close));
    px = close;
    minutes += 5;
  }
  return out;
}

const blown = [...train, ...failThenRun('2026-09-12')];
const stopTrades = simulate(blown, found.spec, { fromDate: '2026-09-12', toDate: '2026-09-12', lots: 1 });
assert.ok(stopTrades.length >= 1);
assert.strictEqual(stopTrades[0].exitReason, 'stop');
assert.ok(Math.abs(stopTrades[0].indexPoints) <= (found.spec.stopPts || 20) + 0.01);

const daily = [];
let px = 100;
for (let d = 1; d <= 40; d += 1) {
  const date = `2026-07-${String(((d - 1) % 28) + 1).padStart(2, '0')}`;
  const month = d <= 28 ? '07' : '08';
  const day = d <= 28 ? d : d - 28;
  const iso = `2026-${month}-${String(day).padStart(2, '0')}`;
  if (d % 3 === 1) {
    daily.push({ date: iso, open: px, high: px + 10, low: px - 10, close: px + 4, volume: 1e6 });
    px += 4;
  } else if (d % 3 === 2) {
    daily.push({ date: iso, open: px, high: px + 3, low: px - 3, close: px + 1, volume: 1e6 });
    px += 1;
  } else {
    daily.push({ date: iso, open: px, high: px + 12, low: px - 1, close: px + 10, volume: 1e6 });
    px += 10;
  }
}
daily.push({ date: '2026-09-09', open: px, high: px + 10, low: px - 10, close: px + 2, volume: 1e6 });
daily.push({ date: '2026-09-10', open: px + 2, high: px + 5, low: px - 5, close: px + 3, volume: 1e6 });
daily.push({ date: '2026-09-11', open: px + 4, high: px + 16, low: px + 3, close: px + 14, volume: 1e6 });
const stockFound = searchInsideDay(daily, {
  trainFrom: '2026-07-01',
  trainTo: '2026-09-10',
  lots: 1,
  symbol: 'RELIANCE',
});
assert.ok(stockFound.spec);
const stockDay = simulateInsideDay(daily, stockFound.spec, {
  fromDate: '2026-09-11',
  toDate: '2026-09-11',
  lots: 1,
  symbol: 'RELIANCE',
});
assert.ok(stockDay.length >= 1);
assert.ok(stockDay[0].riskRs1 > 0);

const cheapStock = {
  instrumentName: 'HINDUNILVR',
  instrumentId: 'stock',
  direction: 'LONG',
  entryTime: '2026-09-11T15:15:00+0530',
  optionPnlRs: 8,
  chargesRs: 1,
  netOptionPnlRs: 7,
  lots: 1,
  riskRs1: 10,
  indexEntry: 2500,
  pnlSource: 'cash_shares',
};
const wideNifty = {
  instrumentName: 'NIFTY 50',
  instrumentId: 'nifty',
  direction: 'PE',
  entryTime: '2026-09-11T09:40:00+0530',
  optionPnlRs: -1300,
  chargesRs: 20,
  netOptionPnlRs: -1320,
  lots: 1,
  riskRs1: 1300,
  spec: { stopPts: 20 },
  pnlSource: 'index_x_lot',
};
const wideBank = {
  instrumentName: 'Bank Nifty',
  instrumentId: 'bank',
  direction: 'PE',
  entryTime: '2026-09-11T09:41:00+0530',
  optionPnlRs: -2700,
  chargesRs: 20,
  netOptionPnlRs: -2720,
  lots: 1,
  riskRs1: 2700,
  spec: { stopPts: 90 },
  pnlSource: 'index_x_lot',
};
const cheapCrude = {
  instrumentName: 'Crude Oil Mini',
  instrumentId: 'crude',
  direction: 'CE',
  entryTime: '2026-09-11T17:05:00+0530',
  optionPnlRs: 80,
  chargesRs: 20,
  netOptionPnlRs: 60,
  lots: 1,
  riskRs1: 80,
  spec: { stopPts: 8 },
  pnlSource: 'index_x_lot',
};

const smallCap = allocateDesk({
  capitalRs: 40000,
  maxLots: 2,
  books: [
    { id: 'nifty', label: 'NIFTY 50', train: { optionNetAfterChargesRs: 12000, profitFactor: 2.3 }, trades: [wideNifty] },
    { id: 'bank', label: 'Bank Nifty', train: { optionNetAfterChargesRs: 8000, profitFactor: 1.8 }, trades: [wideBank] },
    { id: 'crude', label: 'Crude Oil Mini', train: { optionNetAfterChargesRs: 4000, profitFactor: 2 }, trades: [cheapCrude] },
    { id: 'stocks', label: 'stocks', train: { optionNetAfterChargesRs: 1500, profitFactor: 1.4 }, trades: [cheapStock] },
  ],
});
assert.ok(smallCap.skipped.some((s) => s.bookId === 'nifty' && s.reason === 'stop-too-wide'));
assert.ok(smallCap.skipped.some((s) => s.bookId === 'bank' && s.reason === 'stop-too-wide'));
assert.ok(smallCap.taken.some((t) => t.bookId === 'crude'));
assert.ok(smallCap.taken.some((t) => t.bookId === 'stocks'));
assert.ok(smallCap.taken.length >= 2);
assert.ok(!smallCap.taken.some((t) => t.bookId === 'nifty'));

const bigCap = allocateDesk({
  capitalRs: 200000,
  maxLots: 2,
  books: [
    { id: 'nifty', label: 'NIFTY 50', train: { optionNetAfterChargesRs: 12000, profitFactor: 2.3 }, trades: [wideNifty] },
    { id: 'crude', label: 'Crude Oil Mini', train: { optionNetAfterChargesRs: 400, profitFactor: 1.05 }, trades: [cheapCrude] },
  ],
});
assert.ok(bigCap.taken.some((t) => t.bookId === 'nifty' && t.lots >= 1));
assert.ok(bigCap.skipped.some((s) => s.bookId === 'crude' && s.reason === 'weak-train'));

const crowded = allocateDesk({
  capitalRs: 400000,
  maxLots: 2,
  books: [
    { id: 'nifty', label: 'NIFTY 50', train: { optionNetAfterChargesRs: 20000, profitFactor: 2.5 }, trades: [wideNifty] },
    { id: 'crude', label: 'Crude Oil Mini', train: { optionNetAfterChargesRs: 9000, profitFactor: 2 }, trades: [cheapCrude] },
    { id: 'stocks', label: 'stocks', train: { optionNetAfterChargesRs: 1500, profitFactor: 1.4 }, trades: [cheapStock] },
  ],
});
assert.ok(crowded.taken.length >= 3);
assert.ok(crowded.taken.some((t) => t.bookId === 'nifty'));
assert.ok(crowded.taken.some((t) => t.bookId === 'crude'));
assert.ok(crowded.taken.some((t) => t.bookId === 'stocks'));

const correlated = allocateDesk({
  capitalRs: 400000,
  maxLots: 1,
  books: [
    { id: 'nifty', label: 'NIFTY 50', train: { optionNetAfterChargesRs: 20000, profitFactor: 2.5 }, trades: [wideNifty] },
    { id: 'bank', label: 'Bank Nifty', train: { optionNetAfterChargesRs: 5000, profitFactor: 1.5 }, trades: [wideBank] },
  ],
});
assert.strictEqual(correlated.taken.length, 1);
assert.strictEqual(correlated.taken[0].bookId, 'nifty');
assert.ok(correlated.skipped.some((s) => s.reason === 'correlated-index' && s.bookId === 'bank'));

const fourNames = [];
for (const name of ['AAA', 'BBB', 'CCC', 'DDD']) {
  fourNames.push({
    ...cheapStock,
    instrumentName: name,
    entryTime: `2026-09-11T15:15:0${fourNames.length}+0530`,
  });
}
const several = allocateDesk({
  capitalRs: 40000,
  maxLots: 2,
  books: [
    { id: 'stock:AAA', label: 'AAA', train: { optionNetAfterChargesRs: 2000, profitFactor: 1.4 }, trades: [fourNames[0]] },
    { id: 'stock:BBB', label: 'BBB', train: { optionNetAfterChargesRs: 1800, profitFactor: 1.3 }, trades: [fourNames[1]] },
    { id: 'stock:CCC', label: 'CCC', train: { optionNetAfterChargesRs: 1600, profitFactor: 1.5 }, trades: [fourNames[2]] },
    { id: 'stock:DDD', label: 'DDD', train: { optionNetAfterChargesRs: 1400, profitFactor: 1.3 }, trades: [fourNames[3]] },
    { id: 'crude', label: 'Crude Oil Mini', train: { optionNetAfterChargesRs: 4000, profitFactor: 2 }, trades: [cheapCrude] },
  ],
});
assert.ok(several.taken.length >= 4, `expected several funded names, got ${several.taken.length}`);
assert.ok(several.taken.some((t) => t.bookId === 'crude'));

const oneStopTrain = [
  ...train.filter((c) => !String(c.date).startsWith('2026-09-10')),
  ...failThenRun('2026-09-10'),
];
assert.ok(
  found.spec &&
    !specStillAlive(oneStopTrain, found.spec, {
      trainFrom: '2026-08-01',
      trainTo: '2026-09-10',
      lots: 1,
      book: BOOKS.nifty,
    }),
  'last walk-forward red sits that spec out',
);

const lastRed = allocateDesk({
  capitalRs: 40000,
  maxLots: 2,
  books: [
    {
      id: 'crude',
      label: 'Crude Oil Mini',
      train: { optionNetAfterChargesRs: 4000, profitFactor: 2 },
      trainTrades: [{ netOptionPnlRs: -40, exitReason: 'stop' }],
      trades: [cheapCrude],
    },
  ],
});
assert.ok(lastRed.skipped.some((s) => s.reason === 'last-train-red'));
assert.strictEqual(lastRed.taken.length, 0);

const { nextDayCap: capFn } = require('./month-guard');
assert.strictEqual(capFn({ mtdRs: 0, hadTrade: false, dayBudgetRs: 2400, riskPerTradeRs: 800 }).mode, 'month-open');
assert.strictEqual(capFn({ mtdRs: 5000, hadTrade: true, dayBudgetRs: 2400, riskPerTradeRs: 800 }).mode, 'protect-green');
assert.strictEqual(capFn({ mtdRs: 5000, hadTrade: true, dayBudgetRs: 2400, riskPerTradeRs: 800 }).capRs, 2400);
assert.strictEqual(capFn({ mtdRs: 1000, hadTrade: true, dayBudgetRs: 2400, riskPerTradeRs: 800 }).capRs, 1000);
assert.strictEqual(capFn({ mtdRs: 0, hadTrade: true, dayBudgetRs: 2400, riskPerTradeRs: 800 }).mode, 'month-locked');
assert.strictEqual(capFn({ mtdRs: -1500, hadTrade: true, dayBudgetRs: 2400, riskPerTradeRs: 800, targetR: 1.5 }).mode, 'recover-red');
assert.strictEqual(capFn({ mtdRs: -1500, hadTrade: true, dayBudgetRs: 2400, riskPerTradeRs: 800, targetR: 1.5 }).maxTrades, 1);

const winDay = {
  ...cheapStock,
  instrumentName: 'WIN',
  entryTime: '2026-09-02T15:15:00+0530',
  optionPnlRs: 220,
  netOptionPnlRs: 200,
  riskRs1: 200,
};
const loseDay = {
  ...cheapStock,
  instrumentName: 'LOSE',
  entryTime: '2026-09-03T15:15:00+0530',
  optionPnlRs: -200,
  netOptionPnlRs: -200,
  riskRs1: 200,
};
const guarded = allocateMonth({
  capitalRs: 40000,
  maxLots: 2,
  fromDate: '2026-09-02',
  toDate: '2026-09-03',
  books: [
    {
      id: 'stock:WIN',
      label: 'WIN',
      train: { optionNetAfterChargesRs: 4000, profitFactor: 2 },
      monthTrades: [winDay, loseDay],
      trades: [winDay, loseDay],
    },
  ],
});
assert.ok(guarded.month);
assert.ok(guarded.trades.some((t) => t.instrumentName === 'WIN'));
assert.ok(guarded.month.mtdRs >= 0, `month must not finish red, mtd=${guarded.month.mtdRs}`);
assert.ok(
  guarded.skipped.some((s) => s.reason === 'month-floor' || s.reason === 'day-risk-full' || s.reason === 'month-locked') ||
    guarded.trades.every((t) => t.instrumentName !== 'LOSE' || (Number(t.allocation?.riskRs) || 0) <= 800),
  'a full red day cannot be sized large enough to turn a green month red',
);

const split = summarize([
  { optionPnlRs: 120, netOptionPnlRs: 100, indexPoints: 2 },
  { optionPnlRs: -50, netOptionPnlRs: -70, indexPoints: -1 },
]);
assert.strictEqual(split.grossProfitRs, 100);
assert.strictEqual(split.grossLossRs, 70);
assert.strictEqual(split.netRs, 30);
assert.strictEqual(split.wins, 1);
assert.strictEqual(split.losses, 1);

runDiscover(
  {
    authorization: 'token x',
    fromDate: '2026-09-11',
    toDate: '2026-09-11',
    lots: 1,
    capitalRs: 40000,
  },
  {
    candlesByBook: { nifty: candles, bank: [], crude: [] },
    stockSeries: [{ symbol: 'RELIANCE', historical: daily }],
    fetchUserMargins: async () => ({ capitalRs: 0 }),
  },
)
  .then((out) => {
    assert.strictEqual(out.engine, ENGINE);
    assert.strictEqual(out.strategy, STRATEGY_FAMILY);
    assert.ok(out.books.some((b) => b.id === 'nifty' && b.totals.trades >= 1));
    const bankBook = out.books.find((b) => b.id === 'bank');
    const crudeBook = out.books.find((b) => b.id === 'crude');
    assert.ok(bankBook && /Bank Nifty/i.test(bankBook.why || bankBook.label));
    assert.ok(crudeBook && /Crude/i.test(crudeBook.why || crudeBook.label));
    assert.ok(out.coreBooks && out.coreBooks.length === 3);
    assert.ok(crudeBook.why && /evening|Crude Mini|16:00/i.test(crudeBook.why));
    assert.ok(out.books.some((b) => b.id === 'stocks' || String(b.id).startsWith('stock:')));
    assert.ok(out.stocks && Array.isArray(out.stocks.rows));
    assert.ok(out.stocks.scanned >= 1);
    assert.ok(out.allocation);
    assert.strictEqual(out.capitalRs, 40000);
    assert.ok(out.scanTotals.trades >= 1);
    assert.ok(
      out.allocation.skipped.some((s) => s.bookId === 'nifty' && s.reason === 'stop-too-wide') ||
        out.trades.every((t) => t.instrumentId === 'stock'),
    );
    assert.ok(out.trades.every((t) => t.allocated));
    return runDiscover(
      {
        authorization: 'token x',
        fromDate: '2026-09-11',
        toDate: '2026-09-11',
        lots: 1,
        capitalRs: 40000,
      },
      {
        candlesByBook: { nifty: candles, bank: [], crude: [] },
        stockSeries: [{ symbol: 'RELIANCE', historical: daily }],
        fetchUserMargins: async () => ({ capitalRs: 61200, source: 'kite' }),
      },
    );
  })
  .then((out) => {
    assert.strictEqual(out.capitalRs, 61200);
    assert.strictEqual(out.kiteFunds.source, 'kite');
    console.log(
      'paper-discover.selftest: ok',
      out.totals,
      out.allocation.taken.map((t) => `${t.bookId}x${t.lots}`).join(','),
      `capital=${out.capitalRs}`,
      out.books.map((b) => `${b.id}:${b.sitOut ? 'sit' : b.totals.trades}`).join(','),
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
