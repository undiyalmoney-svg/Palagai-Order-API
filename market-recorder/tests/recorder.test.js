'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
process.env.RECORDER_DIR = tmp;
process.env.RECORDER_DB = path.join(tmp, 'test.sqlite');

const { open } = require('../db');
const { Recorder } = require('../recorder');
const { summarize, ranges } = require('../summary');
const universe = require('../universe');
const { impliedVol, bsPrice, greeks } = require('../iv');
const { istMinute, parseKiteStamp, istDate } = require('../time');

const HEADER = 'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange';

function csvFor(exchange) {
  const lines = [HEADER];
  let t = { NFO: 1000, BFO: 2000, MCX: 3000 }[exchange];
  const addOpts = (name, exch, step, base, exp, lot, seg) => {
    for (let k = -6; k <= 6; k += 1) {
      for (const ty of ['CE', 'PE']) {
        t += 1;
        lines.push(`${t},1,${name}${exp.replace(/-/g, '')}${base + k * step}${ty},"${name}",0,${exp},${base + k * step},0.05,${lot},${ty},${seg},${exch}`);
      }
    }
  };
  if (exchange === 'NFO') {
    lines.push('100,1,NIFTY26NOVFUT,"NIFTY",0,2026-11-23,0,0.1,65,FUT,NFO-FUT,NFO');
    lines.push('101,1,NIFTY26DECFUT,"NIFTY",0,2026-12-29,0,0.1,65,FUT,NFO-FUT,NFO');
    lines.push('200,1,BANKNIFTY26NOVFUT,"BANKNIFTY",0,2026-11-23,0,0.1,30,FUT,NFO-FUT,NFO');
    lines.push('201,1,BANKNIFTY26DECFUT,"BANKNIFTY",0,2026-12-29,0,0.1,30,FUT,NFO-FUT,NFO');
    addOpts('NIFTY', 'NFO', 50, 23400, '2026-11-03', 65, 'NFO-OPT');
    addOpts('NIFTY', 'NFO', 50, 23400, '2026-11-09', 65, 'NFO-OPT');
    addOpts('BANKNIFTY', 'NFO', 100, 55000, '2026-11-23', 30, 'NFO-OPT');
  } else if (exchange === 'BFO') {
    lines.push('300,1,SENSEX26NOVFUT,"SENSEX",0,2026-11-26,0,0.2,20,FUT,BFO-FUT,BFO');
    addOpts('SENSEX', 'BFO', 100, 75100, '2026-11-05', 20, 'BFO-OPT');
  } else if (exchange === 'MCX') {
    lines.push('400,1,CRUDEOILM26NOVFUT,"CRUDEOILM",0,2026-11-19,0,1,1,FUT,MCX-FUT,MCX');
    lines.push('401,1,CRUDEOILM26DECFUT,"CRUDEOILM",0,2026-12-18,0,1,1,FUT,MCX-FUT,MCX');
    lines.push('402,1,CRUDEOIL26NOVFUT,"CRUDEOIL",0,2026-11-19,0,1,100,FUT,MCX-FUT,MCX');
    addOpts('CRUDEOILM', 'MCX', 50, 9350, '2026-11-17', 1, 'MCX-OPT');
  }
  return lines.join('\n');
}
const ALL_ROWS = ['NFO', 'BFO', 'MCX'].flatMap((e) => universe.parseInstruments(csvFor(e)));

function quoteFactory(state) {
  return async (_auth, keys) => {
    state.calls += 1;
    state.keysSeen.push(keys.length);
    if (keys.length > 500) throw new Error('quote batch exceeds Kite limit of 500');
    if (state.fail) {
      const e = new Error(state.fail.message);
      e.kind = state.fail.kind;
      e.status = state.fail.status;
      throw e;
    }
    const out = {};
    for (const k of keys) {
      const base = { instrument_token: state.tokens.get(k) || 1, timestamp: state.stamp, last_trade_time: state.ltt, ohlc: { open: 100, high: 110, low: 90, close: 95 } };
      if (k === 'NSE:NIFTY 50') out[k] = { ...base, instrument_token: 256265, last_price: 23407, ohlc: { open: 23300, high: 23420, low: 23290, close: 23250 } };
      else if (k === 'NSE:NIFTY BANK') out[k] = { ...base, instrument_token: 260105, last_price: 55020, ohlc: { open: 54900, high: 55050, low: 54800, close: 54850 } };
      else if (k === 'BSE:SENSEX') out[k] = { ...base, instrument_token: 265, last_price: 75120, ohlc: { open: 75000, high: 75200, low: 74900, close: 74950 } };
      else if (k === 'NSE:INDIA VIX') out[k] = { ...base, instrument_token: 264969, last_price: 15.5 };
      else if (k === 'MCX:CRUDEOILM26NOVFUT') out[k] = { ...base, instrument_token: 400, last_price: 9352, volume: 500, oi: 900, depth: { buy: [{ price: 9351, quantity: 5, orders: 1 }], sell: [{ price: 9353, quantity: 4, orders: 1 }] } };
      else if (k === 'MCX:CRUDEOILM26DECFUT') out[k] = { ...base, instrument_token: 401, last_price: 9340, volume: 100, oi: 200, depth: { buy: [{ price: 9339, quantity: 5, orders: 1 }], sell: [{ price: 9341, quantity: 4, orders: 1 }] } };
      else
        out[k] = {
          ...base,
          last_price: 120,
          volume: state.volume,
          oi: state.oi,
          oi_day_high: state.oi + 10,
          oi_day_low: state.oi - 10,
          buy_quantity: 1000,
          sell_quantity: 900,
          average_price: 118,
          depth: { buy: [{ price: 119.5, quantity: 100, orders: 2 }, { price: 119, quantity: 50, orders: 1 }], sell: [{ price: 120.5, quantity: 75, orders: 1 }] },
        };
    }
    return out;
  };
}

// 09:20:03 IST on Tue 2026-11-03: NSE/BSE groups active, MCX active too.
const T_0920 = '2026-11-03T03:50:03Z';
const T_2000 = '2026-11-03T14:30:03Z';

function setup(startIso = T_0920) {
  fs.rmSync(path.join(tmp, 'raw'), { recursive: true, force: true });
  const db = open(':memory:');
  const tokens = new Map(ALL_ROWS.map((r) => [`${r.exchange}:${r.symbol}`, r.token]));
  const state = { calls: 0, keysSeen: [], stamp: '2026-11-03 09:20:01', ltt: '2026-11-03 09:19:58', volume: 1000, oi: 5000, tokens, fail: null };
  const auth = { header: 'token k:t' };
  const clock = { now: new Date(startIso) };
  const rec = new Recorder(db, { getAuth: () => auth, quote: quoteFactory(state), instrumentsCsv: async (_a, ex) => csvFor(ex), now: () => clock.now });
  return { db, rec, state, clock, auth };
}

test('parses only the configured futures and options and excludes the big CRUDEOIL contract', () => {
  const mcx = universe.parseInstruments(csvFor('MCX'));
  assert.ok(mcx.every((r) => r.underlying === 'CRUDEOILM'));
  assert.equal(mcx.filter((r) => r.kind === 'FUT').length, 2);
  const nfo = universe.parseInstruments(csvFor('NFO'));
  assert.ok(nfo.every((r) => r.underlying === 'NIFTY' || r.underlying === 'BANKNIFTY'));
  assert.equal(universe.parseInstruments(csvFor('BFO')).find((r) => r.kind === 'FUT').lotSize, 20);
});

test('option universe is ATM +/-3 strikes, CE and PE, nearest expiry; expiry day adds the next expiry', () => {
  const rows = universe.parseInstruments(csvFor('NFO'));
  assert.deepEqual(universe.chooseContracts(rows, '2026-11-02', 'NIFTY').optionExpiries, ['2026-11-03']);
  assert.deepEqual(universe.chooseContracts(rows, '2026-11-03', 'NIFTY').optionExpiries, ['2026-11-03', '2026-11-09']);
  const list = universe.optionsAround(rows, 'NIFTY', ['2026-11-03'], () => 23407, 50);
  assert.equal(list.length, 14);
  assert.deepEqual([...new Set(list.map((o) => o.rel))].sort((a, b) => a - b), [-3, -2, -1, 0, 1, 2, 3]);
  assert.equal(list.find((o) => o.rel === 0).strike, 23400);
});

test('crude options are priced off the future whose expiry covers the option expiry', () => {
  const rows = universe.parseInstruments(csvFor('MCX'));
  const c = universe.chooseContracts(rows, '2026-11-03', 'CRUDEOILM');
  assert.equal(universe.underlyingFutureFor(c.futs, '2026-11-17').symbol, 'CRUDEOILM26NOVFUT');
  assert.equal(universe.underlyingFutureFor(c.futs, '2026-12-16').symbol, 'CRUDEOILM26DECFUT');
});

test('one tick records VIX, three spots, all futures and ATM+/-3 options for NIFTY, BANKNIFTY, SENSEX and CRUDEOILM', async () => {
  const { db, rec, state, clock } = setup();
  const r = await rec.tick(clock.now);
  assert.equal(r.status, 'OK');
  assert.deepEqual(r.groups.sort(), ['BANKNIFTY', 'CRUDEOILM', 'NIFTY', 'SENSEX']);
  // 1 VIX + 3 spots + 7 futures, then 28 (NIFTY, two expiries) + 14 + 14 + 14 options
  assert.equal(db.prepare('SELECT COUNT(*) c FROM quotes').get().c, 11 + 70);
  assert.equal(state.calls, 2);
  assert.ok(state.keysSeen.every((n) => n <= 500));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM instruments WHERE underlying='CRUDEOILM' AND kind IN ('CE','PE')").get().c, 14);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM instruments WHERE underlying='CRUDEOIL'").get().c, 0);
  assert.equal(db.prepare("SELECT status, groups FROM minutes").get().groups, 'NIFTY,BANKNIFTY,SENSEX,CRUDEOILM');
});

test('crude options use the matching future as reference and carry Black-76 IV and Greeks', async () => {
  const { db, rec, clock } = setup();
  await rec.tick(clock.now);
  const ce = db.prepare(`SELECT q.* FROM quotes q JOIN instruments i ON i.token=q.token WHERE i.underlying='CRUDEOILM' AND i.kind='CE' AND q.rel_strike=0`).get();
  assert.equal(ce.atm_ref, 9352);
  assert.equal(ce.spot_ref, 9350, 'IV reference is the parity forward from the option book, not the future LTP');
  assert.ok(ce.iv_calc > 0.05 && ce.iv_calc < 3, `iv ${ce.iv_calc}`);
  assert.ok(ce.delta > 0 && ce.delta < 1);
  assert.ok(ce.theta_day < 0);
  const pe = db.prepare(`SELECT q.* FROM quotes q JOIN instruments i ON i.token=q.token WHERE i.underlying='SENSEX' AND i.kind='PE' AND q.rel_strike=0`).get();
  assert.ok(pe.delta < 0 && pe.delta > -1);
  assert.ok(pe.gamma > 0 && pe.vega_1pct > 0);
});

test('a crude future locked at its circuit limit does not corrupt IV: the reference comes from put-call parity', async () => {
  const { db, rec, state, clock } = setup();
  const base = quoteFactory(state);
  rec.quote = async (a, keys) => {
    const out = await base(a, keys);
    for (const [k, q] of Object.entries(out)) {
      if (k.startsWith('MCX:CRUDEOILM2026') && k.endsWith('CE')) q.depth = { buy: [{ price: 421, quantity: 5, orders: 1 }], sell: [{ price: 423, quantity: 5, orders: 1 }] };
      if (k.startsWith('MCX:CRUDEOILM2026') && k.endsWith('PE')) q.depth = { buy: [{ price: 516, quantity: 5, orders: 1 }], sell: [{ price: 518, quantity: 5, orders: 1 }] };
      if (k === 'MCX:CRUDEOILM26NOVFUT') { q.last_price = 9339; q.lower_circuit_limit = 9339; q.depth = { buy: [{ price: 0, quantity: 0, orders: 0 }], sell: [{ price: 9339, quantity: 3000, orders: 100 }] }; }
    }
    return out;
  };
  await rec.tick(clock.now);
  const ce = db.prepare(`SELECT q.* FROM quotes q JOIN instruments i ON i.token=q.token WHERE i.underlying='CRUDEOILM' AND i.kind='CE' AND q.rel_strike=0`).get();
  assert.equal(ce.spot_ref, 9350 + 422 - 517);
  assert.equal(ce.atm_ref, 9339);
  const fut = db.prepare('SELECT lower_circuit, bid1, ask1 FROM quotes WHERE token=400').get();
  assert.equal(fut.lower_circuit, 9339);
  assert.equal(fut.bid1, null);
});

test('only the sessions that are open are fetched: at 20:00 IST only crude is recorded and NSE is not touched', async () => {
  const { db, rec, state, clock } = setup(T_2000);
  state.stamp = '2026-11-03 20:00:01';
  const r = await rec.tick(clock.now);
  assert.equal(r.status, 'OK');
  assert.deepEqual(r.groups, ['CRUDEOILM']);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM instruments WHERE underlying IN ('NIFTY','BANKNIFTY','SENSEX')").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM quotes WHERE token=264969").get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM quotes').get().c, 2 + 14);
});

test('volume/OI deltas and book fields are stored on the following minute', async () => {
  const { db, rec, state, clock } = setup();
  await rec.tick(clock.now);
  assert.equal(db.prepare('SELECT vol_delta FROM quotes WHERE token=100').get().vol_delta, null);
  state.volume = 1250;
  state.oi = 5120;
  state.stamp = '2026-11-03 09:21:02';
  state.ltt = '2026-11-03 09:20:59';
  clock.now = new Date('2026-11-03T03:51:03Z');
  assert.equal((await rec.tick(clock.now)).status, 'OK');
  const f = db.prepare('SELECT vol_delta, oi_delta, ltt_changed, bid1, ask1, bid5_qty, ask5_qty, stale_s FROM quotes WHERE token=100 AND minute_key=?').get('2026-11-03 09:21');
  assert.equal(f.vol_delta, 250);
  assert.equal(f.oi_delta, 120);
  assert.equal(f.ltt_changed, 1);
  assert.equal(f.bid1, 119.5);
  assert.equal(f.ask1, 120.5);
  assert.equal(f.bid5_qty, 150);
  assert.equal(f.ask5_qty, 75);
  assert.ok(Math.abs(f.stale_s - 1) < 1.01);
});

test('unchanged last_trade_time is preserved as ltt_changed=0, not treated as a fresh trade', async () => {
  const { db, rec, state, clock } = setup();
  await rec.tick(clock.now);
  clock.now = new Date('2026-11-03T03:51:03Z');
  state.stamp = '2026-11-03 09:21:02';
  await rec.tick(clock.now);
  assert.equal(db.prepare('SELECT ltt_changed FROM quotes WHERE token=100 AND minute_key=?').get('2026-11-03 09:21').ltt_changed, 0);
});

test('the same minute is never recorded twice', async () => {
  const { db, rec, clock } = setup();
  await rec.tick(clock.now);
  const before = db.prepare('SELECT COUNT(*) c FROM quotes').get().c;
  const r = await rec.tick(clock.now);
  assert.equal(r.status, 'ALREADY_DONE');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM quotes').get().c, before);
  const dup = rec.store.recordBatch({ minuteKey: istMinute(clock.now), fetchDate: clock.now, entries: [{ q: { instrument_token: 100, timestamp: '2026-11-03 09:20:01', ohlc: {} } }], instMap: new Map() });
  assert.equal(dup.duplicates, 1);
  assert.equal(dup.recorded, 0);
});

test('raw responses are appended, never overwritten', async () => {
  const { rec, clock } = setup();
  await rec.tick(clock.now);
  clock.now = new Date('2026-11-03T03:51:03Z');
  await rec.tick(clock.now);
  const lines = fs.readFileSync(path.join(tmp, 'raw', '2026-11-03.ndjson'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).minute_key, '2026-11-03 09:20');
  assert.ok(JSON.parse(lines[0]).options);
});

test('missing auth and expired auth are recorded as failures, not silently skipped', async () => {
  const { db, rec, state, clock } = setup();
  rec.getAuth = () => null;
  assert.equal((await rec.tick(clock.now)).status, 'NO_AUTH');
  rec.getAuth = () => ({ header: 'token k:old' });
  clock.now = new Date('2026-11-03T03:51:03Z');
  state.fail = { kind: 'auth', status: 403, message: 'Incorrect api_key or access_token' };
  assert.equal((await rec.tick(clock.now)).status, 'AUTH_FAILED');
  state.fail = { kind: 'http', status: 502, message: 'bad gateway' };
  clock.now = new Date('2026-11-03T03:52:03Z');
  assert.equal((await rec.tick(clock.now)).status, 'HTTP_ERROR');
  const st = db.prepare('SELECT status FROM minutes ORDER BY minute_key').all().map((r) => r.status);
  assert.deepEqual(st, ['NO_AUTH', 'AUTH_FAILED', 'HTTP_ERROR']);
});

test('recovers by itself once the API works again', async () => {
  const { db, rec, state, clock } = setup();
  state.fail = { kind: 'http', status: 502, message: 'bad gateway' };
  await rec.tick(clock.now);
  state.fail = null;
  clock.now = new Date('2026-11-03T03:51:03Z');
  assert.equal((await rec.tick(clock.now)).status, 'OK');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM minutes WHERE status='OK'").get().c, 1);
});

test('gap detection derives each underlying session from data and lists missing minutes', async () => {
  const { db, rec, state, clock } = setup();
  for (const m of [20, 21, 22, 25, 26]) {
    state.stamp = `2026-11-03 09:${m}:01`;
    clock.now = new Date(Date.UTC(2026, 10, 3, 9, m, 3) - 330 * 60000);
    await rec.tick(clock.now);
  }
  const s = summarize(db, '2026-11-03');
  for (const name of ['NIFTY', 'BANKNIFTY', 'SENSEX', 'CRUDEOILM']) {
    const g = s.groups[name];
    assert.equal(g.derived_session.first, '2026-11-03 09:20', name);
    assert.equal(g.derived_session.expected_minutes, 7, name);
    assert.equal(g.missing_minutes, 2, name);
    assert.deepEqual(g.missing_ranges, ['09:23-09:24'], name);
    assert.equal(g.status, 'GAPS');
  }
  assert.equal(s.status, 'GAPS');
  assert.ok(s.recorded_days >= 1);
  assert.ok(s.disk_free_mb == null || s.disk_free_mb > 0);
});

test('day context stores open, gap and prior close per underlying, crude from its front future', async () => {
  const { db, rec, clock } = setup();
  await rec.tick(clock.now);
  const n = db.prepare("SELECT * FROM day_context WHERE underlying='NIFTY'").get();
  assert.equal(n.open, 23300);
  assert.equal(n.prev_close, 23250);
  assert.equal(n.gap, 50);
  assert.equal(db.prepare("SELECT open FROM day_context WHERE underlying='SENSEX'").get().open, 75000);
  assert.equal(db.prepare("SELECT underlying FROM day_context WHERE underlying='CRUDEOILM'").get().underlying, 'CRUDEOILM');
});

test('schema migration adds the Greek and group columns to a v1 database without touching its rows', () => {
  const Database = require('better-sqlite3');
  const file = path.join(tmp, 'v1.sqlite');
  const old = new Database(file);
  old.exec(`CREATE TABLE minutes (minute_key TEXT PRIMARY KEY, fetch_ts TEXT NOT NULL, status TEXT NOT NULL, n_requested INTEGER, n_recorded INTEGER, latency_ms INTEGER, spot_stale_s REAL, duplicates_ignored INTEGER DEFAULT 0, error TEXT);
    CREATE TABLE quotes (token INTEGER NOT NULL, minute_key TEXT NOT NULL, fetch_ts TEXT NOT NULL, PRIMARY KEY (token, minute_key)) WITHOUT ROWID;
    INSERT INTO minutes (minute_key, fetch_ts, status) VALUES ('2026-11-02 09:20','x','OK');
    INSERT INTO quotes VALUES (1,'2026-11-02 09:20','x');`);
  old.close();
  const db = open(file);
  const cols = db.prepare('PRAGMA table_info(quotes)').all().map((c) => c.name);
  for (const c of ['delta', 'gamma', 'theta_day', 'vega_1pct']) assert.ok(cols.includes(c), c);
  assert.ok(db.prepare('PRAGMA table_info(minutes)').all().some((c) => c.name === 'groups'));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM quotes').get().c, 1);
  db.close();
});

test('implied volatility and Greeks round-trip and reject impossible prices', () => {
  const p = bsPrice(23400, 23400, 5 / 365, 0.14, true);
  assert.ok(Math.abs(impliedVol(p, 23400, 23400, 5 / 365, true) - 0.14) < 1e-3);
  assert.equal(impliedVol(1, 23400, 22000, 5 / 365, true), null);
  assert.equal(impliedVol(120, 23400, 23400, 0, true), null);
  const g = greeks(23400, 23400, 5 / 365, 0.14, true);
  assert.ok(g.delta > 0.45 && g.delta < 0.6);
  assert.ok(g.theta_day < 0 && g.gamma > 0 && g.vega_1pct > 0);
  const gp = greeks(23400, 23400, 5 / 365, 0.14, false);
  assert.ok(Math.abs(g.delta - gp.delta - 1) < 0.1);
});

test('range compression and kite timestamp parsing', () => {
  assert.deepEqual(ranges(['2026-11-03 09:20', '2026-11-03 09:21', '2026-11-03 09:25']), ['09:20-09:21', '09:25']);
  assert.equal(parseKiteStamp('2026-11-03 09:20:01'), Date.parse('2026-11-03T03:50:01Z'));
  assert.equal(istDate(new Date('2026-11-03T19:00:00Z')), '2026-11-04');
});
