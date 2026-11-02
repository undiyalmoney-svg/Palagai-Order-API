'use strict';

const config = require('./config');
const { istStamp, parseKiteStamp } = require('./time');
const { impliedVol } = require('./iv');

const INSERT_QUOTE = `INSERT OR IGNORE INTO quotes (
  token, minute_key, fetch_ts, exch_ts, ltt, stale_s, ltt_changed,
  ltp, open, high, low, prev_close, volume, vol_delta, oi, oi_delta, oi_day_high, oi_day_low,
  buy_qty, sell_qty, avg_price, net_change,
  bid1, bid1_qty, bid1_orders, ask1, ask1_qty, ask1_orders, bid5_qty, ask5_qty,
  rel_strike, atm_ref, spot_ref, iv_calc
) VALUES (
  @token, @minute_key, @fetch_ts, @exch_ts, @ltt, @stale_s, @ltt_changed,
  @ltp, @open, @high, @low, @prev_close, @volume, @vol_delta, @oi, @oi_delta, @oi_day_high, @oi_day_low,
  @buy_qty, @sell_qty, @avg_price, @net_change,
  @bid1, @bid1_qty, @bid1_orders, @ask1, @ask1_qty, @ask1_orders, @bid5_qty, @ask5_qty,
  @rel_strike, @atm_ref, @spot_ref, @iv_calc
)`;

const num = (v) => (v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v));

function sumQty(levels) {
  if (!Array.isArray(levels)) return null;
  return levels.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
}

/** Flatten one Kite quote into the stored row. Pure; deltas are applied by the caller. */
function normalize(q, ctx) {
  const buy = q.depth?.buy || [];
  const sell = q.depth?.sell || [];
  const exchMs = parseKiteStamp(q.timestamp);
  return {
    token: q.instrument_token,
    minute_key: ctx.minuteKey,
    fetch_ts: ctx.fetchTs,
    exch_ts: q.timestamp || null,
    ltt: q.last_trade_time || null,
    stale_s: exchMs == null ? null : (ctx.fetchMs - exchMs) / 1000,
    ltp: num(q.last_price),
    open: num(q.ohlc?.open),
    high: num(q.ohlc?.high),
    low: num(q.ohlc?.low),
    prev_close: num(q.ohlc?.close),
    volume: num(q.volume),
    oi: num(q.oi),
    oi_day_high: num(q.oi_day_high),
    oi_day_low: num(q.oi_day_low),
    buy_qty: num(q.buy_quantity),
    sell_qty: num(q.sell_quantity),
    avg_price: num(q.average_price),
    net_change: num(q.net_change),
    bid1: num(buy[0]?.price) || null,
    bid1_qty: num(buy[0]?.quantity),
    bid1_orders: num(buy[0]?.orders),
    ask1: num(sell[0]?.price) || null,
    ask1_qty: num(sell[0]?.quantity),
    ask1_orders: num(sell[0]?.orders),
    bid5_qty: sumQty(buy),
    ask5_qty: sumQty(sell),
    rel_strike: ctx.rel ?? null,
    atm_ref: ctx.atmRef ?? null,
    spot_ref: ctx.spotRef ?? null,
    iv_calc: null,
  };
}

function ivFor(row, inst, fetchDate) {
  if (!inst || (inst.kind !== 'CE' && inst.kind !== 'PE') || !row.spot_ref) return null;
  if (!(row.bid1 > 0) || !(row.ask1 > 0) || row.ask1 < row.bid1) return null;
  const mid = (row.bid1 + row.ask1) / 2;
  const expiry = Date.UTC(+inst.expiry.slice(0, 4), +inst.expiry.slice(5, 7) - 1, +inst.expiry.slice(8, 10), 15, 30) - 330 * 60000;
  const T = (expiry - fetchDate.getTime()) / 86400000 / 365;
  const iv = impliedVol(mid, row.spot_ref, inst.strike, T, inst.kind === 'CE');
  return iv == null ? null : Number(iv.toFixed(4));
}

class Store {
  constructor(db) {
    this.db = db;
    this.last = new Map(); // token -> { date, volume, oi, ltt }
    this.insertQuote = db.prepare(INSERT_QUOTE);
    this.upsertInst = db.prepare(`INSERT INTO instruments (token, symbol, underlying, kind, expiry, strike, lot_size, first_seen, last_seen)
      VALUES (@token, @symbol, @underlying, @kind, @expiry, @strike, @lotSize, @date, @date)
      ON CONFLICT(token) DO UPDATE SET last_seen = excluded.last_seen`);
    this.insertMinute = db.prepare(`INSERT OR REPLACE INTO minutes
      (minute_key, fetch_ts, status, n_requested, n_recorded, latency_ms, spot_stale_s, duplicates_ignored, error)
      VALUES (@minute_key, @fetch_ts, @status, @n_requested, @n_recorded, @latency_ms, @spot_stale_s, @duplicates_ignored, @error)`);
    this.seedLast();
  }

  seedLast() {
    const rows = this.db
      .prepare(`SELECT q.token, q.minute_key, q.volume, q.oi, q.ltt FROM quotes q
        JOIN (SELECT token, MAX(minute_key) mk FROM quotes GROUP BY token) m ON m.token = q.token AND m.mk = q.minute_key`)
      .all();
    for (const r of rows) this.last.set(r.token, { date: r.minute_key.slice(0, 10), volume: r.volume, oi: r.oi, ltt: r.ltt });
  }

  registerInstruments(list, date) {
    const tx = this.db.transaction((items) => items.forEach((i) => this.upsertInst.run({ ...i, date })));
    tx(list);
  }

  registerSpot(token, symbol, underlying, kind, date) {
    this.upsertInst.run({ token, symbol, underlying, kind, expiry: null, strike: null, lotSize: null, date });
  }

  /** instMap: token -> instrument meta (for IV). entries: [{ q, rel, atmRef, spotRef }]. */
  recordBatch({ minuteKey, fetchDate, entries, instMap }) {
    const fetchTs = istStamp(fetchDate);
    const date = minuteKey.slice(0, 10);
    let recorded = 0;
    let duplicates = 0;
    const tx = this.db.transaction(() => {
      for (const e of entries) {
        const row = normalize(e.q, { minuteKey, fetchTs, fetchMs: fetchDate.getTime(), rel: e.rel, atmRef: e.atmRef, spotRef: e.spotRef });
        const prev = this.last.get(row.token);
        const same = prev && prev.date === date;
        row.vol_delta = same && row.volume != null && prev.volume != null && row.volume >= prev.volume ? row.volume - prev.volume : null;
        row.oi_delta = same && row.oi != null && prev.oi != null ? row.oi - prev.oi : null;
        row.ltt_changed = same ? (row.ltt !== prev.ltt ? 1 : 0) : null;
        row.iv_calc = ivFor(row, instMap?.get(row.token), fetchDate);
        const res = this.insertQuote.run(row);
        if (res.changes === 0) duplicates += 1;
        else {
          recorded += 1;
          this.last.set(row.token, { date, volume: row.volume, oi: row.oi, ltt: row.ltt });
        }
      }
    });
    tx();
    return { recorded, duplicates };
  }

  recordMinute(m) {
    this.insertMinute.run({ n_requested: null, n_recorded: null, latency_ms: null, spot_stale_s: null, duplicates_ignored: 0, error: null, ...m });
  }

  hasMinute(minuteKey) {
    return !!this.db.prepare('SELECT 1 FROM minutes WHERE minute_key=?').get(minuteKey);
  }
}

module.exports = { Store, normalize, ivFor };
