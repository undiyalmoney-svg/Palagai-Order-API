'use strict';

const config = require('./config');
const log = require('./log');
const raw = require('./raw');
const kite = require('./kite');
const universe = require('./universe');
const { Store } = require('./store');
const { istDate, istMinute, istMinutesOfDay, istWeekday, parseKiteStamp } = require('./time');

class Recorder {
  /**
   * deps are injectable so the tick can be tested without the network:
   *   getAuth() -> { header } | null ; quote(auth, keys) ; instrumentsCsv(auth, 'NFO') ; historical(...)
   */
  constructor(db, deps = {}) {
    this.db = db;
    this.store = new Store(db);
    this.getAuth = deps.getAuth;
    this.quote = deps.quote || kite.quote;
    this.instrumentsCsv = deps.instrumentsCsv || kite.instrumentsCsv;
    this.historical = deps.historical || kite.historical;
    this.now = deps.now || (() => new Date());
    this.rows = null;
    this.rowsDate = null;
    this.contractsByDate = {};
    this.consecutiveFailures = 0;
    this.authFailedAt = null;
    this.contextDone = new Set();
  }

  inWindow(d = this.now()) {
    const wd = istWeekday(d);
    const m = istMinutesOfDay(d);
    return wd >= 1 && wd <= 5 && m >= config.windowStartMin && m <= config.windowEndMin;
  }

  async ensureUniverse(auth, date) {
    if (this.rows && this.rowsDate === date) return;
    const csv = await this.instrumentsCsv(auth, 'NFO');
    this.rows = universe.parseInstruments(csv);
    this.rowsDate = date;
    this.instIndex = new Map(this.rows.map((r) => [r.token, r]));
    this.contracts = universe.chooseContracts(this.rows, date);
    const futs = Object.values(this.contracts).flatMap((c) => c.futs);
    this.store.registerInstruments(futs, date);
    for (const [name, c] of Object.entries(config.indices)) this.store.registerSpot(c.spotToken, c.spot, name, 'SPOT', date);
    this.store.registerSpot(config.vix.token, config.vix.key, 'INDIAVIX', 'VIX', date);
    log.info('universe loaded', { date, futs: futs.map((f) => f.symbol), expiries: Object.fromEntries(Object.entries(this.contracts).map(([k, v]) => [k, v.optionExpiries])) });
  }

  async tick(at = this.now()) {
    const minuteKey = istMinute(at);
    const date = minuteKey.slice(0, 10);
    const t0 = Date.now();
    if (this.store.hasMinute(minuteKey)) return { status: 'ALREADY_DONE', minuteKey };

    const auth = this.getAuth();
    if (!auth) {
      this.store.recordMinute({ minute_key: minuteKey, fetch_ts: minuteKey, status: 'NO_AUTH', error: 'no Kite session available' });
      return { status: 'NO_AUTH', minuteKey };
    }
    try {
      await this.ensureUniverse(auth.header, date);
      const keys1 = [config.vix.key];
      for (const c of Object.values(config.indices)) keys1.push(c.spot);
      const futKeys = [];
      for (const c of Object.values(this.contracts)) for (const f of c.futs) futKeys.push(`NFO:${f.symbol}`);
      const data1 = await this.quote(auth.header, [...keys1, ...futKeys]);
      const fetch1 = this.now();

      const spots = {};
      for (const [name, c] of Object.entries(config.indices)) spots[name] = data1[c.spot]?.last_price;
      if (!spots.NIFTY || !spots.BANKNIFTY) {
        this.store.recordMinute({ minute_key: minuteKey, fetch_ts: minuteKey, status: 'NO_SPOT', error: 'index spot missing from response' });
        return { status: 'NO_SPOT', minuteKey };
      }

      const optionEntries = [];
      const optKeys = [];
      for (const [name, c] of Object.entries(this.contracts)) {
        const list = universe.optionsAround(this.rows, name, c.optionExpiries, spots[name]);
        for (const o of list) {
          optKeys.push(`NFO:${o.symbol}`);
          optionEntries.push({ inst: o, name, atmRef: spots[name] });
        }
      }
      let data2 = {};
      if (optKeys.length) data2 = await this.quote(auth.header, optKeys);
      const fetch2 = this.now();

      raw.append(date, { minute_key: minuteKey, fetch_ts_1: fetch1.toISOString(), fetch_ts_2: fetch2.toISOString(), market: data1, options: data2 });

      const instMap = new Map(this.rows.map((r) => [r.token, r]));
      const entries1 = [];
      const addFrom = (data, key, extra = {}) => {
        const q = data[key];
        if (q) entries1.push({ q, ...extra });
      };
      addFrom(data1, config.vix.key);
      for (const [name, c] of Object.entries(config.indices)) addFrom(data1, c.spot);
      for (const [name, c] of Object.entries(this.contracts)) for (const f of c.futs) addFrom(data1, `NFO:${f.symbol}`, { spotRef: spots[name] });
      const s1 = this.store.recordBatch({ minuteKey, fetchDate: fetch1, entries: entries1, instMap });

      this.store.registerInstruments(optionEntries.map((e) => e.inst), date);
      const entries2 = [];
      for (const e of optionEntries) {
        const q = data2[`NFO:${e.inst.symbol}`];
        if (q) entries2.push({ q, rel: e.inst.rel, atmRef: e.atmRef, spotRef: e.atmRef });
      }
      const s2 = this.store.recordBatch({ minuteKey, fetchDate: fetch2, entries: entries2, instMap });

      const requested = keys1.length + futKeys.length + optKeys.length;
      const recorded = s1.recorded + s2.recorded;
      const spotTs = parseKiteStamp(data1[config.indices.NIFTY.spot]?.timestamp);
      const status = recorded + s1.duplicates + s2.duplicates >= requested ? 'OK' : 'PARTIAL';
      this.store.recordMinute({
        minute_key: minuteKey,
        fetch_ts: fetch1.toISOString(),
        status,
        n_requested: requested,
        n_recorded: recorded,
        latency_ms: Date.now() - t0,
        spot_stale_s: spotTs == null ? null : (fetch1.getTime() - spotTs) / 1000,
        duplicates_ignored: s1.duplicates + s2.duplicates,
      });
      this.consecutiveFailures = 0;
      this.authFailedAt = null;
      this.maybeContext(date, minuteKey, data1);
      return { status, minuteKey, recorded, requested };
    } catch (e) {
      this.consecutiveFailures += 1;
      const auth403 = e.kind === 'auth';
      const status = auth403 ? 'AUTH_FAILED' : 'HTTP_ERROR';
      if (auth403) this.authFailedAt = Date.now();
      log.error(status, e.message, { minuteKey, httpStatus: e.status });
      this.store.recordMinute({ minute_key: minuteKey, fetch_ts: minuteKey, status, latency_ms: Date.now() - t0, error: String(e.message).slice(0, 300) });
      return { status, minuteKey, error: e.message };
    }
  }

  /** Opening gap, open, previous-day levels and opening range, each stored once with the time it became known. */
  maybeContext(date, minuteKey, data1) {
    const hm = minuteKey.slice(11);
    for (const [name, c] of Object.entries(config.indices)) {
      const q = data1[c.spot];
      if (!q) continue;
      if (hm >= '09:16') {
        const open = q.ohlc?.open;
        const prevClose = q.ohlc?.close;
        this.db.prepare(`INSERT INTO day_context (trade_date, underlying, prev_close, open, gap, recorded_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(trade_date, underlying) DO UPDATE SET
            prev_close = COALESCE(prev_close, excluded.prev_close),
            open = COALESCE(open, excluded.open),
            gap = COALESCE(gap, excluded.gap)`).run(date, name, prevClose, open, open != null && prevClose != null ? open - prevClose : null, minuteKey);
      }
      if (hm >= '09:30' && !this.contextDone.has(`${date}|${name}|or`)) {
        const r = this.db.prepare('SELECT or_high FROM day_context WHERE trade_date=? AND underlying=?').get(date, name);
        if (r && r.or_high == null) {
          this.db.prepare('UPDATE day_context SET or_high=?, or_low=?, or_asof=? WHERE trade_date=? AND underlying=?').run(q.ohlc?.high, q.ohlc?.low, minuteKey, date, name);
        }
        this.contextDone.add(`${date}|${name}|or`);
      }
    }
  }

  async fillPrevDayLevels(auth, date) {
    for (const [name, c] of Object.entries(config.indices)) {
      const row = this.db.prepare('SELECT prev_high FROM day_context WHERE trade_date=? AND underlying=?').get(date, name);
      if (row && row.prev_high != null) continue;
      const to = `${date} 00:00:00`;
      const d0 = new Date(Date.parse(`${date}T00:00:00Z`) - 10 * 86400000).toISOString().slice(0, 10);
      const candles = await this.historical(auth, c.spotToken, 'day', `${d0} 00:00:00`, to);
      const prev = candles.filter((x) => x[0].slice(0, 10) < date).pop();
      if (!prev) continue;
      this.db.prepare(`INSERT INTO day_context (trade_date, underlying, prev_high, prev_low, prev_close, recorded_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(trade_date, underlying) DO UPDATE SET prev_high=excluded.prev_high, prev_low=excluded.prev_low`).run(
        date, name, prev[2], prev[3], prev[4], istMinute(this.now()));
    }
  }
}

module.exports = { Recorder };
