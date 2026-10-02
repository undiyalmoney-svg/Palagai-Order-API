'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chartProtectiveLevels, hitPlannedLevel, restingSellIds, atmExitFields, atmStopFields } = require('./levels');
const { decideFillAction, SL_GRACE_MS } = require('./flatten');
const store = require('./store');

test('25% stop and 0.5R target match the Charts tab', () => {
  assert.deepEqual(chartProtectiveLevels(200), { stop: 150, target: 225 });
  assert.equal(hitPlannedLevel(150, { stop: 150, target: 225 }), 'LOSS');
  assert.equal(hitPlannedLevel(225, { stop: 150, target: 225 }), 'PROFIT');
  assert.equal(hitPlannedLevel(200, { stop: 150, target: 225 }), null);
  assert.equal(hitPlannedLevel(149, { stop: 150, target: 225 }), 'LOSS');
});

test('resting MIS sells are the ones that must be cancelled before exit', () => {
  const orders = [
    { order_id: '1', tradingsymbol: 'NIFTY25CE', transaction_type: 'SELL', status: 'TRIGGER PENDING', product: 'MIS' },
    { order_id: '2', tradingsymbol: 'NIFTY25CE', transaction_type: 'SELL', status: 'COMPLETE', product: 'MIS' },
    { order_id: '3', tradingsymbol: 'OTHER', transaction_type: 'SELL', status: 'OPEN', product: 'MIS' },
  ];
  assert.deepEqual(restingSellIds(orders, 'NIFTY25CE'), ['1']);
});

test('exit is a market sell tagged PALAGAI_CHART_EXIT; stop is SL not a second target', () => {
  const fill = { instrument: 'CRUDEOILM25CE', exchange: 'MCX', qty: 1 };
  assert.equal(atmExitFields(fill).order_type, 'MARKET');
  assert.equal(atmExitFields(fill).tag, 'PALAGAI_CHART_EXIT');
  assert.equal(atmStopFields(fill, 40).order_type, 'SL');
  assert.equal(atmStopFields(fill, 40).tag, 'PALAGAI_CHART_SL');
  assert.ok(Number(atmStopFields(fill, 40).price) < Number(atmStopFields(fill, 40).trigger_price));
});

test('does not flatten during the 15s after an SL is placed', () => {
  const fill = { instrument: 'X', stop: 150, target: 225 };
  const map = new Map([['X', 1_000]]);
  assert.equal(decideFillAction(fill, 225, 1_000 + SL_GRACE_MS - 1, map).action, 'wait');
  assert.equal(decideFillAction(fill, 225, 1_000 + SL_GRACE_MS + 1, map).action, 'flatten');
  assert.equal(decideFillAction(fill, 225, 1_000 + SL_GRACE_MS + 1, map).reason, 'PROFIT');
});

test('store marks the NSE book on a fill and locks it after drop', () => {
  const empty = store.empty('2026-10-02');
  assert.equal(empty.enabled, false);
  const next = store.upsertFill(empty, {
    instrument: 'NIFTY25OCT24500CE',
    book: 'nifty',
    qty: 65,
    entry: 200,
    stop: 150,
    target: 225,
  });
  assert.equal(next.nseBook, 'nifty');
  assert.equal(next.placed.nifty, true);
  const gone = store.dropFill(next, 'NIFTY25OCT24500CE');
  assert.equal(gone.done.nifty, true);
  assert.equal(gone.fills.length, 0);
});

const rules = require('./rules');
const { parseChartInstrumentsCsv, resolveCrudeOilMiniFutures } = require('./instruments');

function emptyDay() {
  return {
    date: '2026-10-02',
    nseBook: null,
    placed: { nifty: false, bank: false, crude: false },
    done: { nifty: false, bank: false, crude: false },
  };
}

function allow(over = {}) {
  return rules.decideProtectAuto({
    book: 'nifty',
    type: 'BUY',
    liveDay: true,
    marketOpen: true,
    busy: false,
    htfTrend: 'bullish',
    istTime: '10:15',
    day: emptyDay(),
    openBooks: [],
    ...over,
  });
}

test('Protect lets the first HTF-aligned index BUY through after 09:50', () => {
  assert.equal(allow().allow, true);
});

test('Protect sits out sideways 5m and a BUY against a bearish 5m', () => {
  assert.equal(allow({ htfTrend: 'sideways' }).allow, false);
  assert.equal(allow({ htfTrend: null }).allow, false);
  assert.equal(allow({ htfTrend: 'bearish' }).allow, false);
  assert.equal(rules.htfAllowsProtect('SELL', 'bearish'), true);
});

test('Protect skips open chop and the last 15 minutes on the index', () => {
  assert.equal(rules.inProtectWindow('nifty', '09:49'), false);
  assert.equal(rules.inProtectWindow('bank', '09:50'), true);
  assert.equal(rules.inProtectWindow('nifty', '15:15'), false);
  assert.equal(allow({ istTime: '09:30' }).allow, false);
});

test('Protect keeps Crude off during NSE hours and arms it after 15:30', () => {
  assert.equal(rules.inProtectWindow('crude', '11:00'), false);
  assert.equal(rules.inProtectWindow('crude', '15:30'), true);
  assert.equal(rules.inProtectWindow('crude', '21:00'), false);
  assert.equal(allow({ book: 'crude', type: 'SELL', htfTrend: 'bearish', istTime: '11:00' }).allow, false);
  assert.equal(allow({ book: 'crude', type: 'SELL', htfTrend: 'bearish', istTime: '19:10' }).allow, true);
});

test('Protect blocks a second fill on the same book and the other NSE book', () => {
  const niftyDone = emptyDay();
  niftyDone.nseBook = 'nifty';
  niftyDone.placed.nifty = true;
  assert.equal(allow({ day: niftyDone }).allow, false);
  assert.equal(allow({ book: 'bank', type: 'SELL', htfTrend: 'bearish', day: niftyDone }).allow, false);
  assert.equal(allow({ openBooks: ['nifty'] }).allow, false);
});

test('lots are ₹40k per index lot and Crude is 3× that band', () => {
  assert.equal(rules.lotsForChartBook('nifty', 80_000), 2);
  assert.equal(rules.lotsForChartBook('bank', 80_000), 2);
  assert.equal(rules.lotsForChartBook('crude', 80_000), 6);
  assert.equal(rules.lotsForChartBook('nifty', 0), 1);
});

test('instrument dump keeps CRUDEOILM and drops FINNIFTY', () => {
  const csv = [
    'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange',
    '1,0,NIFTY25OCT24500CE,NIFTY,0,2026-10-27,24500,0.05,65,CE,NFO-OPT,NFO',
    '2,0,FINNIFTY25OCTCE,FINNIFTY,0,2026-10-27,25000,0.05,40,CE,NFO-OPT,NFO',
    '3,0,CRUDEOILM26OCT5400CE,CRUDEOILM,0,2026-10-16,5400,0.05,10,CE,MCX-OPT,MCX',
    '4,0,CRUDEOILM26NOVFUT,CRUDEOILM,0,2026-11-17,0,1,1,FUT,MCX-FUT,MCX',
  ].join('\n');
  const rows = parseChartInstrumentsCsv(csv);
  assert.deepEqual(
    rows.map((r) => r.tradingSymbol),
    ['NIFTY25OCT24500CE', 'CRUDEOILM26OCT5400CE', 'CRUDEOILM26NOVFUT'],
  );
  const fut = resolveCrudeOilMiniFutures(rows, new Date('2026-10-02T10:00:00+05:30'));
  assert.equal(fut.tradingSymbol, 'CRUDEOILM26NOVFUT');
});

test('markPlaced locks the NSE slot before the order is sent; unmark restores it', () => {
  const locked = store.markPlaced(store.empty('2026-10-02'), 'nifty');
  assert.equal(locked.placed.nifty, true);
  assert.equal(locked.nseBook, 'nifty');
  const undone = store.unmarkPlaced(locked, 'nifty');
  assert.equal(undone.placed.nifty, false);
  assert.equal(undone.nseBook, null);
});

test('dropletPlacing is only advertised when Protect is on and the Kite session is live', () => {
  const off = store.empty('2026-10-02');
  assert.equal(store.publicView(off).dropletPlacing, false);
  off.enabled = true;
  off.sessionOk = true;
  assert.equal(store.publicView(off).dropletPlacing, true);
  assert.equal(store.publicView(off).dropletWatching, true);
});

test('SMC bundle analyzes candles and refuses a synthetic ATM', () => {
  let charts;
  try {
    charts = require('./from-charts/bundle');
  } catch (err) {
    assert.fail(`SMC bundle missing: ${err.message}`);
    return;
  }
  assert.equal(typeof charts.analyzeSmc, 'function');
  const analysis = charts.analyzeSmc({
    market: 'nifty',
    candles: [
      { date: '2026-10-02T09:15:00+05:30', open: 100, high: 101, low: 99, close: 100.5, volume: 1 },
      { date: '2026-10-02T09:16:00+05:30', open: 100.5, high: 102, low: 100, close: 101, volume: 1 },
    ],
    intervalMinutes: 1,
    now: new Date('2035-01-01T00:00:00Z'),
    live: false,
  });
  assert.ok(analysis);
  assert.ok(Array.isArray(analysis.alerts));

  const plan = charts.buildAtmOrderPlan({
    book: 'nifty',
    instruments: [],
    side: 'CE',
    spot: 24500,
    asOfDateTime: '2026-10-02T10:00:00+05:30',
    lots: 1,
  });
  assert.equal(plan.ok, false);

  const chain = [];
  for (const strike of [24400, 24500, 24600]) {
    for (const type of ['CE', 'PE']) {
      chain.push({
        instrumentToken: strike + (type === 'CE' ? 1 : 2),
        exchangeToken: 0,
        tradingSymbol: `NIFTY25OCT${strike}${type}`,
        name: 'NIFTY',
        exchange: 'NFO',
        segment: 'NFO-OPT',
        instrumentType: type,
        expiry: '2026-10-06',
        strike,
        tickSize: 0.05,
        lotSize: 65,
        lastPrice: 0,
      });
    }
  }
  const atm = charts.buildAtmOrderPlan({
    book: 'nifty',
    instruments: chain,
    side: 'CE',
    spot: 24510,
    asOfDateTime: '2026-10-02T10:30:00+05:30',
    lots: 2,
  });
  assert.equal(atm.ok, true);
  assert.equal(atm.ticket.strike, 24500);
  assert.equal(atm.ticket.quantity, 130);
  assert.equal(charts.atmOrderFields(atm.ticket).tag, 'PALAGAI_CHART');
  assert.equal(charts.atmOrderFields(atm.ticket).transaction_type, 'BUY');
});
