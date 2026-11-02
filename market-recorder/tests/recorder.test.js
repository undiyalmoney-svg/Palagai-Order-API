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
const { impliedVol, bsPrice } = require('../iv');
const { istMinute, parseKiteStamp, istDate } = require('../time');

const HEADER = 'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange';
function csv() {
  const lines = [HEADER];
  lines.push('100,1,NIFTY26NOVFUT,"NIFTY",0,2026-11-23,0,0.1,65,FUT,NFO-FUT,NFO');
  lines.push('101,1,NIFTY26DECFUT,"NIFTY",0,2026-12-29,0,0.1,65,FUT,NFO-FUT,NFO');
  lines.push('200,1,BANKNIFTY26NOVFUT,"BANKNIFTY",0,2026-11-23,0,0.1,30,FUT,NFO-FUT,NFO');
  lines.push('201,1,BANKNIFTY26DECFUT,"BANKNIFTY",0,2026-12-29,0,0.1,30,FUT,NFO-FUT,NFO');
  let t = 1000;
  for (const [name, step, base, exp] of [['NIFTY', 50, 23400, '2026-11-03'], ['NIFTY', 50, 23400, '2026-11-09'], ['BANKNIFTY', 100, 55000, '2026-11-23']]) {
    for (let k = -6; k <= 6; k += 1) {
      for (const ty of ['CE', 'PE']) {
        t += 1;
        lines.push(`${t},1,${name}${exp.replace(/-/g, '')}${base + k * step}${ty},"${name}",0,${exp},${base + k * step},0.05,${name === 'NIFTY' ? 65 : 30},${ty},NFO-OPT,NFO`);
      }
    }
  }
  return lines.join('\n');
}

function quoteFactory(state) {
  return async (_auth, keys) => {
    state.calls += 1;
    if (state.fail) {
      const e = new Error(state.fail.message);
      e.kind = state.fail.kind;
      e.status = state.fail.status;
      throw e;
    }
    const out = {};
    const stamp = state.stamp;
    for (const k of keys) {
      const sym = k.split(':')[1];
      const base = { instrument_token: state.tokens.get(k) || 1, timestamp: stamp, last_trade_time: state.ltt, ohlc: { open: 100, high: 110, low: 90, close: 95 } };
      if (k === 'NSE:NIFTY 50') out[k] = { ...base, instrument_token: 256265, last_price: 23407, ohlc: { open: 23300, high: 23420, low: 23290, close: 23250 } };
      else if (k === 'NSE:NIFTY BANK') out[k] = { ...base, instrument_token: 260105, last_price: 55020, ohlc: { open: 54900, high: 55050, low: 54800, close: 54850 } };
      else if (k === 'NSE:INDIA VIX') out[k] = { ...base, instrument_token: 264969, last_price: 15.5 };
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

function setup() {
  fs.rmSync(path.join(tmp, 'raw'), { recursive: true, force: true });
  const db = open(':memory:');
  const rows = universe.parseInstruments(csv());
  const tokens = new Map(rows.map((r) => [`NFO:${r.symbol}`, r.token]));
  const state = { calls: 0, stamp: '2026-11-03 09:20:01', ltt: '2026-11-03 09:19:58', volume: 1000, oi: 5000, tokens, fail: null };
  const auth = { header: 'token k:t' };
  const clock = { now: new Date('2026-11-03T03:50:03Z') }; // 09:20:03 IST
  const rec = new Recorder(db, { getAuth: () => auth, quote: quoteFactory(state), instrumentsCsv: async () => csv(), now: () => clock.now });
  return { db, rec, state, clock, auth };
}

test('parses only index futures and options', () => {
  const rows = universe.parseInstruments(csv());
  assert.equal(rows.filter((r) => r.kind === 'FUT').length, 4);
  assert.ok(rows.every((r) => r.underlying === 'NIFTY' || r.underlying === 'BANKNIFTY'));
});

test('option universe is ATM +/-3 strikes, CE and PE, nearest expiry; expiry day adds the next expiry', () => {
  const rows = universe.parseInstruments(csv());
  const normal = universe.chooseContracts(rows, '2026-11-02');
  assert.deepEqual(normal.NIFTY.optionExpiries, ['2026-11-03']);
  const expiryDay = universe.chooseContracts(rows, '2026-11-03');
  assert.deepEqual(expiryDay.NIFTY.optionExpiries, ['2026-11-03', '2026-11-09']);
  const list = universe.optionsAround(rows, 'NIFTY', ['2026-11-03'], 23407);
  assert.equal(list.length, 14);
  assert.deepEqual([...new Set(list.map((o) => o.rel))].sort((a, b) => a - b), [-3, -2, -1, 0, 1, 2, 3]);
  assert.equal(list.find((o) => o.rel === 0).strike, 23400);
});

test('a tick records spot, VIX, futures and 14 options per index, with deltas on the next minute', async () => {
  const { db, rec, state, clock } = setup();
  const r1 = await rec.tick(clock.now);
  assert.equal(r1.status, 'OK');
  const n1 = db.prepare('SELECT COUNT(*) c FROM quotes').get().c;
  assert.equal(n1, 3 + 4 + 14 * 3 /* nifty 2 expiries on expiry day + bank 1 */);
  assert.equal(db.prepare('SELECT vol_delta FROM quotes WHERE token=100').get().vol_delta, null);

  state.volume = 1250;
  state.oi = 5120;
  state.stamp = '2026-11-03 09:21:02';
  state.ltt = '2026-11-03 09:20:59';
  clock.now = new Date('2026-11-03T03:51:03Z');
  const r2 = await rec.tick(clock.now);
  assert.equal(r2.status, 'OK');
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

test('recovers by itself once auth works again', async () => {
  const { db, rec, state, clock } = setup();
  state.fail = { kind: 'http', status: 502, message: 'bad gateway' };
  await rec.tick(clock.now);
  state.fail = null;
  clock.now = new Date('2026-11-03T03:51:03Z');
  assert.equal((await rec.tick(clock.now)).status, 'OK');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM minutes WHERE status='OK'").get().c, 1);
});

test('gap detection derives the session from data and lists missing minutes', async () => {
  const { db, rec, state, clock } = setup();
  const minutes = [20, 21, 22, 25, 26];
  for (const m of minutes) {
    state.stamp = `2026-11-03 09:${m}:01`;
    clock.now = new Date(Date.UTC(2026, 10, 3, 9, m, 3) - 330 * 60000);
    await rec.tick(clock.now);
  }
  const s = summarize(db, '2026-11-03');
  assert.equal(s.derived_session.first, '2026-11-03 09:20');
  assert.equal(s.derived_session.last, '2026-11-03 09:26');
  assert.equal(s.derived_session.expected_minutes, 7);
  assert.equal(s.missing_minutes, 2);
  assert.deepEqual(s.missing_ranges, ['09:23-09:24']);
  assert.equal(s.status, 'GAPS');
});

test('day context stores open and gap from the index, with the prior close', async () => {
  const { db, rec, clock } = setup();
  await rec.tick(clock.now);
  const c = db.prepare("SELECT * FROM day_context WHERE underlying='NIFTY'").get();
  assert.equal(c.open, 23300);
  assert.equal(c.prev_close, 23250);
  assert.equal(c.gap, 50);
});

test('implied volatility round-trips and rejects impossible prices', () => {
  const p = bsPrice(23400, 23400, 5 / 365, 0.14, true);
  const iv = impliedVol(p, 23400, 23400, 5 / 365, true);
  assert.ok(Math.abs(iv - 0.14) < 1e-3);
  assert.equal(impliedVol(1, 23400, 22000, 5 / 365, true), null);
  assert.equal(impliedVol(120, 23400, 23400, 0, true), null);
});

test('range compression and kite timestamp parsing', () => {
  assert.deepEqual(ranges(['2026-11-03 09:20', '2026-11-03 09:21', '2026-11-03 09:25']), ['09:20-09:21', '09:25']);
  assert.equal(parseKiteStamp('2026-11-03 09:20:01'), Date.parse('2026-11-03T03:50:01Z'));
  assert.equal(istDate(new Date('2026-11-03T19:00:00Z')), '2026-11-04');
});
