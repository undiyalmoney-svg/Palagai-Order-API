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

const toMin = (k) => Number(k.slice(11, 13)) * 60 + Number(k.slice(14, 16));
const toKey = (date, m) => `${date} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Anchor instrument whose exchange timestamp defines the live session: the spot index, or the front future for MCX. */
function anchorToken(db, name, g) {
  if (g.spot) {
    const r = db.prepare('SELECT token FROM instruments WHERE kind=? AND underlying=?').get('SPOT', name);
    return r ? r.token : null;
  }
  const r = db.prepare('SELECT token FROM instruments WHERE kind=? AND underlying=? ORDER BY expiry LIMIT 1').get('FUT', name);
  return r ? r.token : null;
}

/**
 * Completeness for one underlying on one IST date. The expected session is DERIVED from the data (minutes in which the
 * anchor's exchange timestamp advanced inside its session window), never a hardcoded count: NSE changed F&O hours in 2026
 * and MCX crude closes at 23:30 or 23:55 depending on US daylight saving.
 */
function summarizeGroup(db, date, name, g) {
  const like = `${date}%`;
  const token = anchorToken(db, name, g);
  const rows = token
    ? db.prepare('SELECT minute_key, exch_ts, stale_s FROM quotes WHERE token=? AND minute_key LIKE ? ORDER BY minute_key').all(token, like)
    : [];
  const lo = `${String(Math.floor(g.session[0] / 60)).padStart(2, '0')}:${String(g.session[0] % 60).padStart(2, '0')}`;
  const hi = `${String(Math.floor(g.session[1] / 60)).padStart(2, '0')}:${String(g.session[1] % 60).padStart(2, '0')}`;
  const live = rows.filter((r) => r.exch_ts && r.exch_ts.slice(0, 10) === date && r.exch_ts.slice(11, 16) >= lo && r.exch_ts.slice(11, 16) <= hi && Number(r.stale_s) < config.staleSeconds);
  const observed = live.map((r) => r.minute_key);
  const first = observed[0] || null;
  const last = observed[observed.length - 1] || null;
  const expected = [];
  if (first) for (let m = toMin(first); m <= toMin(last); m += 1) expected.push(toKey(date, m));
  const have = new Set(observed);
  const missing = expected.filter((k) => !have.has(k));
  const attempted = new Set(
    db.prepare('SELECT minute_key, groups, status FROM minutes WHERE minute_key LIKE ?').all(like)
      .filter((m) => (m.status === 'OK' || m.status === 'PARTIAL') && (m.groups || '').split(',').includes(name))
      .map((m) => m.minute_key),
  );
  const status = !first ? (rows.length ? 'NO_FRESH_SESSION_DATA' : 'NO_DATA') : missing.length === 0 ? 'COMPLETE' : 'GAPS';

  const perToken = db
    .prepare(
      `SELECT i.symbol, i.kind, COUNT(*) n, SUM(CASE WHEN q.volume IS NOT NULL AND q.volume=0 THEN 1 ELSE 0 END) zero_vol,
         SUM(CASE WHEN q.ltt_changed=0 THEN 1 ELSE 0 END) ltt_unchanged, SUM(CASE WHEN q.stale_s>? THEN 1 ELSE 0 END) stale,
         SUM(CASE WHEN q.bid1 IS NULL OR q.ask1 IS NULL THEN 1 ELSE 0 END) no_book, MIN(q.oi) oi_min, MAX(q.oi) oi_max,
         COUNT(DISTINCT q.oi) oi_distinct, SUM(CASE WHEN q.iv_calc IS NOT NULL THEN 1 ELSE 0 END) iv_rows
       FROM quotes q JOIN instruments i ON i.token=q.token WHERE q.minute_key LIKE ? AND i.underlying=? GROUP BY i.token ORDER BY i.kind, i.symbol`,
    )
    .all(config.staleSeconds, like, name);
  const futs = perToken.filter((r) => r.kind === 'FUT');
  const anomalies = futs.filter((r) => r.n > 30 && r.oi_distinct <= 1).map((r) => `${r.symbol}: OI constant`);
  const opts = perToken.filter((r) => r.kind === 'CE' || r.kind === 'PE');
  const optRows = opts.reduce((s, r) => s + r.n, 0);
  const noBook = opts.reduce((s, r) => s + r.no_book, 0);
  return {
    status,
    derived_session: { first, last, expected_minutes: expected.length, observed_minutes: observed.length },
    missing_minutes: missing.length,
    missing_pct: expected.length ? Math.round((missing.length / expected.length) * 10000) / 100 : null,
    missing_ranges: ranges(missing).slice(0, 40),
    attempted_but_no_fresh_anchor: missing.filter((k) => attempted.has(k)).length,
    option_rows: optRows,
    option_rows_without_two_sided_book_pct: optRows ? Math.round((noBook / optRows) * 10000) / 100 : null,
    anomalies,
    per_instrument: perToken,
  };
}

function diskInfo(db, date) {
  let diskFreeMb = null;
  try {
    const st = fs.statfsSync(config.dir);
    diskFreeMb = Math.round((st.bavail * st.bsize) / 1048576);
  } catch {
    /* older node */
  }
  const sizeMb = (f) => {
    try {
      return fs.statSync(f).size / 1048576;
    } catch {
      return 0;
    }
  };
  let rawMb = 0;
  try {
    for (const f of fs.readdirSync(config.rawDir)) rawMb += sizeMb(path.join(config.rawDir, f));
  } catch {
    /* none yet */
  }
  const dbMb = sizeMb(config.dbFile) + sizeMb(`${config.dbFile}-wal`);
  const days = db.prepare("SELECT COUNT(DISTINCT substr(minute_key,1,10)) d FROM minutes WHERE status IN ('OK','PARTIAL')").get().d || 0;
  const usedMb = dbMb + rawMb;
  const perDayMb = days ? usedMb / days : null;
  return {
    disk_free_mb: diskFreeMb,
    db_size_mb: Math.round(dbMb * 10) / 10,
    raw_size_mb: Math.round(rawMb * 10) / 10,
    recorded_days: days,
    avg_mb_per_recorded_day: perDayMb == null ? null : Math.round(perDayMb * 10) / 10,
    projected_trading_days_left: perDayMb && diskFreeMb != null ? Math.floor(diskFreeMb / perDayMb) : null,
    low_disk: diskFreeMb != null && diskFreeMb < config.minFreeDiskMb,
  };
}

function summarize(db, date, only = null) {
  const like = `${date}%`;
  const minutes = db.prepare('SELECT status FROM minutes WHERE minute_key LIKE ?').all(like);
  const byStatus = {};
  for (const m of minutes) byStatus[m.status] = (byStatus[m.status] || 0) + 1;
  const groups = {};
  for (const [name, g] of Object.entries(config.groups)) {
    if (only && !only.includes(name)) continue;
    groups[name] = summarizeGroup(db, date, name, g);
  }
  const statuses = Object.values(groups).map((x) => x.status);
  const overall = statuses.every((s) => s === 'COMPLETE') ? 'COMPLETE' : statuses.some((s) => s === 'GAPS') ? 'GAPS' : statuses.every((s) => s === 'NO_DATA') ? (minutes.length ? 'NO_SESSION_OR_NO_DATA' : 'NOT_RUN') : 'PARTIAL_GROUPS';
  return {
    date,
    status: overall,
    minute_status_counts: byStatus,
    rows: db.prepare('SELECT COUNT(*) c FROM quotes WHERE minute_key LIKE ?').get(like).c,
    groups,
    ...diskInfo(db, date),
    generated_at: new Date().toISOString(),
  };
}

function writeSummary(db, date, only = null, suffix = '') {
  const s = summarize(db, date, only);
  fs.mkdirSync(config.summaryDir, { recursive: true });
  fs.writeFileSync(path.join(config.summaryDir, `${date}${suffix}.json`), JSON.stringify(s, null, 2));
  return s;
}

module.exports = { summarize, summarizeGroup, writeSummary, ranges };
