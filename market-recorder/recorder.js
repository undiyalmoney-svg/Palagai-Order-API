'use strict';

const config = require('./config');
const log = require('./log');
const raw = require('./raw');
const kite = require('./kite');
const universe = require('./universe');
const { Store } = require('./store');
const { istMinute, istMinutesOfDay, istWeekday, parseKiteStamp } = require('./time');

const mm = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/**
 * Forward implied by put-call parity (Black-76, r=0): F = K + C - P from the mids of the near-ATM pairs, median over pairs.
 * A crude future locked at its circuit limit has no book and a stale last price, while the options keep trading, so the
 * future's LTP is not a safe reference for option IV; the parity forward is read from the options themselves.
 */
function parityForwards(optionEntries, data2) {
  const buckets = new Map();
  const mid = (q) => {
    const b = q?.depth?.buy?.[0]?.price;
    const a = q?.depth?.sell?.[0]?.price;
    return b > 0 && a > 0 && a >= b ? (a + b) / 2 : null;
  };
  const byKey = new Map();
  for (const e of optionEntries) {
    if (e.g.priceModel !== 'black76' || Math.abs(e.inst.rel) > 1) continue;
    const m = mid(data2[`${e.g.exchange}:${e.inst.symbol}`]);
    if (m == null) continue;
    byKey.set(`${e.name}|${e.inst.expiry}|${e.inst.strike}|${e.inst.kind}`, m);
    buckets.set(`${e.name}|${e.inst.expiry}`, new Set([...(buckets.get(`${e.name}|${e.inst.expiry}`) || []), e.inst.strike]));
  }
  const out = new Map();
  for (const [k, strikes] of buckets) {
    const f = [];
    for (const strike of strikes) {
      const c = byKey.get(`${k}|${strike}|CE`);
      const p = byKey.get(`${k}|${strike}|PE`);
      if (c != null && p != null) f.push(strike + c - p);
    }
    f.sort((x, y) => x - y);
    if (f.length) out.set(k, f[Math.floor(f.length / 2)]);
  }
  return out;
}

class Recorder {
  /**
   * deps are injectable so the tick can be tested without the network:
   *   getAuth() -> { header } | null ; quote(auth, keys) ; instrumentsCsv(auth, exchange) ; historical(...)
   */
  constructor(db, deps = {}) {
    this.db = db;
    this.store = new Store(db);
    this.getAuth = deps.getAuth;
    this.quote = deps.quote || kite.quote;
    this.instrumentsCsv = deps.instrumentsCsv || kite.instrumentsCsv;
    this.historical = deps.historical || kite.historical;
    this.now = deps.now || (() => new Date());
    this.rowsByExchange = {};
    this.rowsDate = {};
    this.contracts = {};
    this.consecutiveFailures = 0;
    this.authFailedAt = null;
    this.contextDone = new Set();
  }

  inWindow(d = this.now()) {
    const wd = istWeekday(d);
    const m = istMinutesOfDay(d);
    return wd >= 1 && wd <= 5 && m >= config.windowStartMin && m <= config.windowEndMin;
  }

  activeGroups(d = this.now()) {
    const m = istMinutesOfDay(d);
    return Object.entries(config.groups).filter(([, g]) => m >= g.session[0] && m <= g.session[1]).map(([k]) => k);
  }

  async loadExchange(auth, exchange, date) {
    if (this.rowsDate[exchange] === date) return true;
    const names = Object.values(config.groups).filter((g) => g.exchange === exchange).map((g) => g.name);
    try {
      const csv = await this.instrumentsCsv(auth, exchange);
      this.rowsByExchange[exchange] = universe.parseInstruments(csv, names);
      this.rowsDate[exchange] = date;
    } catch (e) {
      if (e.kind === 'auth') throw e;
      log.error('instruments', `${exchange}: ${e.message}`);
      return false;
    }
    for (const [name, g] of Object.entries(config.groups)) {
      if (g.exchange !== exchange) continue;
      const rows = this.rowsByExchange[exchange];
      const c = universe.chooseContracts(rows, date, g.name);
      this.contracts[name] = c;
      this.store.registerInstruments(c.futs, date);
      if (g.spot) this.store.registerSpot(g.spotToken, g.spot, name, 'SPOT', date);
      log.info('universe loaded', { date, group: name, futs: c.futs.map((f) => f.symbol), expiries: c.optionExpiries });
    }
    return true;
  }

  async tick(at = this.now()) {
    const minuteKey = istMinute(at);
    const date = minuteKey.slice(0, 10);
    const t0 = Date.now();
    const active = this.activeGroups(at);
    if (!active.length) return { status: 'NO_GROUP_ACTIVE', minuteKey };
    if (this.store.hasMinute(minuteKey)) return { status: 'ALREADY_DONE', minuteKey };

    const auth = this.getAuth();
    if (!auth) {
      this.store.recordMinute({ minute_key: minuteKey, fetch_ts: minuteKey, status: 'NO_AUTH', error: 'no Kite session available', groups: active.join(',') });
      return { status: 'NO_AUTH', minuteKey };
    }
    try {
      const live = [];
      for (const name of active) {
        const ok = await this.loadExchange(auth.header, config.groups[name].exchange, date);
        if (ok && this.contracts[name]) live.push(name);
      }
      if (!live.length) throw Object.assign(new Error('no instrument universe available'), { kind: 'http' });

      const keys1 = [];
      const needVix = live.some((n) => config.groups[n].spot);
      if (needVix) keys1.push(config.vix.key);
      for (const name of live) {
        const g = config.groups[name];
        if (g.spot) keys1.push(g.spot);
        for (const f of this.contracts[name].futs) keys1.push(`${g.exchange}:${f.symbol}`);
      }
      const data1 = await this.quote(auth.header, keys1);
      const fetch1 = this.now();

      const refs = {};
      const optionEntries = [];
      const used = [];
      for (const name of live) {
        const g = config.groups[name];
        const c = this.contracts[name];
        const refFor = (expiry) => {
          if (g.spot) return data1[g.spot]?.last_price;
          const f = universe.underlyingFutureFor(c.futs, expiry);
          return f ? data1[`${g.exchange}:${f.symbol}`]?.last_price : undefined;
        };
        const front = c.futs[0] ? data1[`${g.exchange}:${c.futs[0].symbol}`] : null;
        if ((g.spot && !data1[g.spot]?.last_price) || (!g.spot && !front?.last_price)) {
          log.error('NO_SPOT', `${name} reference price missing`, { minuteKey });
          continue;
        }
        used.push(name);
        refs[name] = g.spot ? data1[g.spot].last_price : front.last_price;
        const list = universe.optionsAround(this.rowsByExchange[g.exchange], g.name, c.optionExpiries, refFor, g.step);
        for (const o of list) optionEntries.push({ inst: o, name, g });
      }
      if (!used.length) {
        this.store.recordMinute({ minute_key: minuteKey, fetch_ts: minuteKey, status: 'NO_SPOT', error: 'reference price missing for every group', groups: active.join(',') });
        return { status: 'NO_SPOT', minuteKey };
      }

      const optKeys = optionEntries.map((e) => `${e.g.exchange}:${e.inst.symbol}`);
      const data2 = optKeys.length ? await this.quote(auth.header, optKeys) : {};
      const fetch2 = this.now();

      raw.append(date, { minute_key: minuteKey, groups: used, fetch_ts_1: fetch1.toISOString(), fetch_ts_2: fetch2.toISOString(), market: data1, options: data2 });

      const instMap = new Map();
      for (const e of optionEntries) instMap.set(e.inst.token, { ...e.inst, priceModel: e.g.priceModel, expiryMin: e.g.expiryMin });

      const entries1 = [];
      const add = (key, extra = {}) => {
        if (data1[key]) entries1.push({ q: data1[key], ...extra });
      };
      if (needVix) {
        this.store.registerSpot(config.vix.token, config.vix.key, 'INDIAVIX', 'VIX', date);
        add(config.vix.key);
      }
      for (const name of used) {
        const g = config.groups[name];
        if (g.spot) add(g.spot);
        for (const f of this.contracts[name].futs) add(`${g.exchange}:${f.symbol}`, { spotRef: g.spot ? data1[g.spot]?.last_price : null });
      }
      const s1 = this.store.recordBatch({ minuteKey, fetchDate: fetch1, entries: entries1, instMap });

      this.store.registerInstruments(optionEntries.map((e) => e.inst), date);
      const forwards = parityForwards(optionEntries, data2);
      const entries2 = [];
      for (const e of optionEntries) {
        const q = data2[`${e.g.exchange}:${e.inst.symbol}`];
        if (!q) continue;
        const fwd = e.g.priceModel === 'black76' ? forwards.get(`${e.name}|${e.inst.expiry}`) : null;
        entries2.push({ q, rel: e.inst.rel, atmRef: e.inst.refPrice, spotRef: fwd || e.inst.refPrice });
      }
      const s2 = this.store.recordBatch({ minuteKey, fetchDate: fetch2, entries: entries2, instMap });

      const requested = keys1.length + optKeys.length;
      const recorded = s1.recorded + s2.recorded;
      const anchor = config.groups[used[0]].spot ? data1[config.groups[used[0]].spot] : data1[`${config.groups[used[0]].exchange}:${this.contracts[used[0]].futs[0].symbol}`];
      const spotTs = parseKiteStamp(anchor?.timestamp);
      const status = recorded + s1.duplicates + s2.duplicates >= requested && used.length === live.length ? 'OK' : 'PARTIAL';
      this.store.recordMinute({
        minute_key: minuteKey,
        fetch_ts: fetch1.toISOString(),
        status,
        n_requested: requested,
        n_recorded: recorded,
        latency_ms: Date.now() - t0,
        spot_stale_s: spotTs == null ? null : (fetch1.getTime() - spotTs) / 1000,
        duplicates_ignored: s1.duplicates + s2.duplicates,
        groups: used.join(','),
      });
      this.consecutiveFailures = 0;
      this.authFailedAt = null;
      this.maybeContext(date, minuteKey, data1, used, at);
      return { status, minuteKey, recorded, requested, groups: used };
    } catch (e) {
      this.consecutiveFailures += 1;
      const auth403 = e.kind === 'auth';
      const status = auth403 ? 'AUTH_FAILED' : 'HTTP_ERROR';
      if (auth403) this.authFailedAt = Date.now();
      log.error(status, e.message, { minuteKey, httpStatus: e.status });
      this.store.recordMinute({ minute_key: minuteKey, fetch_ts: minuteKey, status, latency_ms: Date.now() - t0, error: String(e.message).slice(0, 300), groups: active.join(',') });
      return { status, minuteKey, error: e.message };
    }
  }

  anchorQuote(name, data1) {
    const g = config.groups[name];
    if (g.spot) return data1[g.spot];
    const f = this.contracts[name]?.futs?.[0];
    return f ? data1[`${g.exchange}:${f.symbol}`] : null;
  }

  /** Opening gap, open, previous-day levels and opening range, each stored once with the time it became known. */
  maybeContext(date, minuteKey, data1, used, at) {
    const m = istMinutesOfDay(at);
    for (const name of used) {
      const g = config.groups[name];
      const q = this.anchorQuote(name, data1);
      if (!q) continue;
      if (m >= g.openMin) {
        const open = q.ohlc?.open;
        const prevClose = q.ohlc?.close;
        this.db.prepare(`INSERT INTO day_context (trade_date, underlying, prev_close, open, gap, recorded_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(trade_date, underlying) DO UPDATE SET
            prev_close = COALESCE(prev_close, excluded.prev_close),
            open = COALESCE(open, excluded.open),
            gap = COALESCE(gap, excluded.gap)`).run(date, name, prevClose, open, open != null && prevClose != null ? open - prevClose : null, minuteKey);
      }
      if (m >= g.orMin && !this.contextDone.has(`${date}|${name}|or`)) {
        const r = this.db.prepare('SELECT or_high FROM day_context WHERE trade_date=? AND underlying=?').get(date, name);
        if (r && r.or_high == null) {
          this.db.prepare('UPDATE day_context SET or_high=?, or_low=?, or_asof=? WHERE trade_date=? AND underlying=?').run(q.ohlc?.high, q.ohlc?.low, minuteKey, date, name);
        }
        this.contextDone.add(`${date}|${name}|or`);
      }
    }
  }

  async fillPrevDayLevels(auth, date) {
    for (const [name, g] of Object.entries(config.groups)) {
      const token = g.spotToken || this.contracts[name]?.futs?.[0]?.token;
      if (!token) continue;
      const row = this.db.prepare('SELECT prev_high FROM day_context WHERE trade_date=? AND underlying=?').get(date, name);
      if (row && row.prev_high != null) continue;
      const d0 = new Date(Date.parse(`${date}T00:00:00Z`) - 10 * 86400000).toISOString().slice(0, 10);
      const candles = await this.historical(auth, token, 'day', `${d0} 00:00:00`, `${date} 00:00:00`);
      const prev = candles.filter((x) => x[0].slice(0, 10) < date).pop();
      if (!prev) continue;
      this.db.prepare(`INSERT INTO day_context (trade_date, underlying, prev_high, prev_low, prev_close, recorded_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(trade_date, underlying) DO UPDATE SET prev_high=excluded.prev_high, prev_low=excluded.prev_low`).run(
        date, name, prev[2], prev[3], prev[4], istMinute(this.now()));
    }
  }
}

module.exports = { Recorder, mm, parityForwards };
