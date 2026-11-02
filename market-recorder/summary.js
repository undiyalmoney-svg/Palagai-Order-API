'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

function ranges(keys) {
  if (!keys.length) return [];
  const toMin = (k) => Number(k.slice(11, 13)) * 60 + Number(k.slice(14, 16));
  const out = [];
  let a = keys[0];
  let prev = keys[0];
  for (let i = 1; i < keys.length; i += 1) {
    if (toMin(keys[i]) !== toMin(prev) + 1) {
      out.push(a === prev ? a.slice(11) : `${a.slice(11)}-${prev.slice(11)}`);
      a = keys[i];
    }
    prev = keys[i];
  }
  out.push(a === prev ? a.slice(11) : `${a.slice(11)}-${prev.slice(11)}`);
  return out;
}

/**
 * Completeness for one IST date. The expected session is DERIVED from the data (minutes in which the
 * NIFTY spot exchange timestamp advanced), never a hardcoded count: NSE changed F&O hours in 2026.
 */
function summarize(db, date) {
  const like = `${date}%`;
  const minutes = db.prepare('SELECT * FROM minutes WHERE minute_key LIKE ? ORDER BY minute_key').all(like);
  const byStatus = {};
  for (const m of minutes) byStatus[m.status] = (byStatus[m.status] || 0) + 1;

  const niftySpot = db.prepare('SELECT token FROM instruments WHERE kind=? AND underlying=?').get('SPOT', 'NIFTY');
  const spotRows = niftySpot
    ? db.prepare('SELECT minute_key, exch_ts, stale_s FROM quotes WHERE token=? AND minute_key LIKE ? ORDER BY minute_key').all(niftySpot.token, like)
    : [];
  const live = spotRows.filter((r) => r.exch_ts && r.exch_ts.slice(0, 10) === date && r.exch_ts.slice(11, 16) >= '09:15' && r.exch_ts.slice(11, 16) <= '15:40' && Number(r.stale_s) < config.staleSeconds);
  const sessionMinutes = live.map((r) => r.minute_key);
  const first = sessionMinutes[0] || null;
  const last = sessionMinutes[sessionMinutes.length - 1] || null;

  let expected = [];
  if (first) {
    const toKey = (m) => `${date} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const f = Number(first.slice(11, 13)) * 60 + Number(first.slice(14, 16));
    const l = Number(last.slice(11, 13)) * 60 + Number(last.slice(14, 16));
    for (let m = f; m <= l; m += 1) expected.push(toKey(m));
  }
  const have = new Set(sessionMinutes);
  const missing = expected.filter((k) => !have.has(k));
  const okMinutes = new Set(minutes.filter((m) => m.status === 'OK' || m.status === 'PARTIAL').map((m) => m.minute_key));
  const missingWithAttempt = missing.filter((k) => okMinutes.has(k));

  const perToken = db
    .prepare(
      `SELECT i.symbol, i.kind, COUNT(*) n, SUM(CASE WHEN q.volume IS NOT NULL AND q.volume=0 THEN 1 ELSE 0 END) zero_vol,
         SUM(CASE WHEN q.ltt_changed=0 THEN 1 ELSE 0 END) ltt_unchanged, SUM(CASE WHEN q.stale_s>? THEN 1 ELSE 0 END) stale,
         SUM(CASE WHEN q.bid1 IS NULL OR q.ask1 IS NULL THEN 1 ELSE 0 END) no_book, MIN(q.oi) oi_min, MAX(q.oi) oi_max,
         COUNT(DISTINCT q.oi) oi_distinct
       FROM quotes q JOIN instruments i ON i.token=q.token WHERE q.minute_key LIKE ? GROUP BY i.token ORDER BY i.kind, i.symbol`,
    )
    .all(config.staleSeconds, like);

  const futs = perToken.filter((r) => r.kind === 'FUT');
  const oiFlags = futs.filter((r) => r.n > 30 && r.oi_distinct <= 1).map((r) => `${r.symbol}: OI constant`);
  const totalRows = db.prepare('SELECT COUNT(*) c FROM quotes WHERE minute_key LIKE ?').get(like).c;
  const dayStatus = !first ? (minutes.length ? 'NO_SESSION_OR_NO_DATA' : 'NOT_RUN') : missing.length === 0 ? 'COMPLETE' : 'GAPS';

  let diskFreeMb = null;
  try {
    const st = fs.statfsSync(config.dir);
    diskFreeMb = Math.round((st.bavail * st.bsize) / 1048576);
  } catch {
    /* older node */
  }
  let dbMb = null;
  try {
    dbMb = Math.round((fs.statSync(config.dbFile).size / 1048576) * 10) / 10;
  } catch {
    /* ignore */
  }

  const out = {
    date,
    status: dayStatus,
    derived_session: { first, last, expected_minutes: expected.length, observed_minutes: sessionMinutes.length },
    missing_minutes: missing.length,
    missing_pct: expected.length ? Math.round((missing.length / expected.length) * 10000) / 100 : null,
    missing_ranges: ranges(missing).slice(0, 40),
    missing_minutes_that_were_attempted_but_had_no_fresh_spot: missingWithAttempt.length,
    minute_status_counts: byStatus,
    rows: totalRows,
    anomalies: oiFlags,
    per_instrument: perToken,
    disk_free_mb: diskFreeMb,
    db_size_mb: dbMb,
    low_disk: diskFreeMb != null && diskFreeMb < config.minFreeDiskMb,
    generated_at: new Date().toISOString(),
  };
  return out;
}

function writeSummary(db, date) {
  const s = summarize(db, date);
  fs.mkdirSync(config.summaryDir, { recursive: true });
  fs.writeFileSync(path.join(config.summaryDir, `${date}.json`), JSON.stringify(s, null, 2));
  return s;
}

module.exports = { summarize, writeSummary, ranges };
