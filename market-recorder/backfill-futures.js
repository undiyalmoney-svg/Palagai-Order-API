'use strict';

// Pull Kite 1-minute history (with open interest for futures) for every futures contract that is still listed,
// plus the index spot, into hist_bars. Expired contracts cannot be fetched, so the history has a
// hard limit (about 3 months per contract) and far-month contracts are thin in their early life.
// Usage: KITE_AUTH="token key:token" RECORDER_DIR=... node market-recorder/backfill-futures.js [days]
const config = require('./config');
const { open } = require('./db');
const kite = require('./kite');
const universe = require('./universe');
const { istDate } = require('./time');

const auth = process.env.KITE_AUTH;
if (!auth) {
  console.error('set KITE_AUTH="token apikey:accesstoken"');
  process.exit(1);
}
const maxDays = Number(process.argv[2] || 200);

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

async function pull(db, token, label, interval, oi) {
  const ins = db.prepare('INSERT OR IGNORE INTO hist_bars (token, interval, ts, open, high, low, close, volume, oi, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  let cur = new Date();
  const stop = new Date(Date.now() - maxDays * 86400000);
  let total = 0;
  while (cur > stop) {
    const from = new Date(Math.max(cur.getTime() - 59 * 86400000, stop.getTime()));
    let candles;
    try {
      candles = await kite.historical(auth, token, interval, `${fmt(from)} 09:00:00`, `${fmt(cur)} 15:59:59`, { oi });
    } catch (e) {
      console.log(label, 'stop:', e.message);
      break;
    }
    if (!candles.length) break;
    const stamp = new Date().toISOString();
    db.transaction(() => {
      for (const c of candles) ins.run(token, interval, c[0].slice(0, 19).replace('T', ' '), c[1], c[2], c[3], c[4], c[5] ?? null, oi ? c[6] ?? null : null, stamp);
    })();
    total += candles.length;
    cur = new Date(from.getTime() - 86400000);
  }
  console.log(label, token, interval, 'rows', total);
}

(async () => {
  const db = open(config.dbFile);
  const csv = await kite.instrumentsCsv(auth, 'NFO');
  const rows = universe.parseInstruments(csv).filter((r) => r.kind === 'FUT');
  const today = istDate();
  for (const r of rows.filter((x) => x.expiry >= today)) {
    db.prepare('INSERT OR IGNORE INTO instruments (token, symbol, underlying, kind, expiry, strike, lot_size, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?)').run(
      r.token, r.symbol, r.underlying, 'FUT', r.expiry, 0, r.lotSize, today, today);
    await pull(db, r.token, r.symbol, 'minute', true);
  }
  for (const [name, c] of Object.entries(config.indices)) {
    db.prepare('INSERT OR IGNORE INTO instruments (token, symbol, underlying, kind, first_seen, last_seen) VALUES (?,?,?,?,?,?)').run(c.spotToken, c.spot, name, 'SPOT', today, today);
    await pull(db, c.spotToken, c.spot, 'minute', false);
  }
  db.prepare('INSERT OR IGNORE INTO instruments (token, symbol, underlying, kind, first_seen, last_seen) VALUES (?,?,?,?,?,?)').run(config.vix.token, config.vix.key, 'INDIAVIX', 'VIX', today, today);
  await pull(db, config.vix.token, config.vix.key, 'day', false);
  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
