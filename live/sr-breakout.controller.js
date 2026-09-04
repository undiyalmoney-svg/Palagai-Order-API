'use strict';
/**
 * S/R Breakout — Paper controller. RESEARCH / PAPER ONLY.
 * Fetches historical 5-min candles (read-only, via the pushed Kite token) and
 * runs the sr-breakout engine. Places NO orders; imports nothing from the live
 * order path. "Start Paper today" works because it fetches today's candles.
 */
const https = require('https');
const market = require('./kite-market');
const store = require('./live.store');
const { runSrBreakout } = require('./sr-breakout');
const { observe, history: obsHistory, confirmLiveEntry, confirmLiveExit } = require('./sr-observe');
const collector = require('./sr-collector');
const { auditDay } = require('./sr-debug');

function userId(req) { return req.user?.id || 'anonymous'; }

// Instrument registry. NIFTY 50 / NIFTY BANK have fixed index tokens; Crude Oil
// Mini is an MCX monthly future resolved to its front month at request time.
const INSTRUMENTS = {
  nifty: {
    key: 'nifty', name: 'Nifty 50', token: '256265', unitsPerLot: 75,
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' },
    entryPts: 27, gapLo: 100, gapHi: 175, targetByScore: { 1: 20, 2: 25, 3: 30 },
  },
  banknifty: {
    key: 'banknifty', name: 'Bank Nifty', token: '260105', unitsPerLot: 35,
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' },
    entryPts: 60, gapLo: 275, gapHi: 465, targetByScore: { 1: 40, 2: 50, 3: 60 },
  },
  crude: {
    // PROVISIONAL / under observation — only ~80 days of history, not enough to
    // trust. Stricter defaults (bigger candle, no new entries in the thin late-US
    // session) turn it from bleeding to green in-sample; the forward paper run is
    // what actually validates it. Bank Nifty + Nifty 50 are the proven books.
    key: 'crude', name: 'Crude Oil Mini', token: null, unitsPerLot: 10, // token resolved at runtime
    session: { entryStartHm: '09:30', entryEndHm: '20:00', squareOffHm: '23:20' },
    entryPts: 50, gapLo: 78, gapHi: 130, targetByScore: { 1: 20, 2: 25, 3: 30 },
  },
};

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** GET /instruments/MCX (CSV) directly — fetchInstruments only returns NSE/NFO. */
function fetchMcxCsv(authorization) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: 'api.kite.trade', path: '/instruments/MCX', headers: { 'X-Kite-Version': '3', Authorization: authorization } },
      (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve(b)); }).on('error', reject);
  });
}

/** Resolve the front-month CRUDEOILM future token (earliest expiry >= today). */
async function resolveCrudeToken(authorization) {
  const csv = await fetchMcxCsv(authorization);
  const lines = csv.trim().split('\n');
  // Roll on expiry day: require expiry strictly AFTER today (date-only), so on
  // the contract's expiry date we trade the NEXT expiry, not the expiring one.
  const t = new Date(); const todayMid = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const fut = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const sym = (p[2] || '').replace(/"/g, '');
    const type = (p[9] || '').replace(/"/g, '');
    if (!/^CRUDEOILM/.test(sym) || type !== 'FUT') continue;
    const exp = parseExpiry(sym, (p[5] || '').replace(/"/g, ''));
    if (exp && exp > todayMid) fut.push({ token: String(p[0]).replace(/"/g, ''), sym, exp });
  }
  fut.sort((a, b) => a.exp - b.exp);
  if (!fut.length) throw new Error('No live CRUDEOILM future found');
  return { token: fut[0].token, symbol: fut[0].sym };
}
function parseExpiry(sym, expiryField) {
  if (expiryField) { const d = new Date(expiryField); if (!isNaN(d)) return d; }
  const m = /(\d{2})([A-Z]{3})/.exec(sym || '');
  if (m) return new Date(2000 + Number(m[1]), MONTHS[m[2]] ?? 0, 28);
  return null;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function shiftDays(iso, delta) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10); }

/**
 * POST /live/sr-breakout
 * body: { instruments:['nifty'|'banknifty'|'crude'], fromDate, toDate,
 *         entryPts?, bigPts?, targetPts?, cutHm?, lotSize? }
 * When fromDate/toDate == today, it fetches today's candles → today's results.
 */
async function srBreakout(req, res) {
  const authorization =
    req.headers['x-kite-authorization'] ||
    req.headers['x-kite-authorisation'] ||
    (await store.getAuthorizationFor(userId(req)));
  if (!authorization) {
    res.status(400).json({ status: 'error', message: 'Kite session required — Get Token (or Push Kite token), then retry Paper.' });
    return;
  }
  const body = req.body || {};
  const keys = Array.isArray(body.instruments) && body.instruments.length ? body.instruments : ['nifty'];
  const fromDate = body.fromDate || todayIso();
  const toDate = body.toDate || todayIso();

  const results = [];
  for (const key of keys) {
    const spec = INSTRUMENTS[key];
    if (!spec) { results.push({ key, error: 'unknown instrument' }); continue; }
    try {
      let token = spec.token;
      let contract = spec.name;
      if (key === 'crude') { const r = await resolveCrudeToken(authorization); token = r.token; contract = r.symbol; }
      // Fetch ~12 calendar days of warm-up before fromDate so S/R + trend are
      // primed; those bars build context but produce no reported trades.
      const warmupFrom = shiftDays(fromDate, -12);
      const candles = await market.fetchHistorical5m(authorization, token, warmupFrom, toDate);
      const entryPts = numOr(body.entryPts, spec.entryPts);
      const lots = Math.max(1, numOr(body.lots, 1));
      const unitsPerLot = spec.unitsPerLot;
      const perPoint = unitsPerLot * lots;                // ₹ per point
      // Daily risk stops arrive in ₹ from the UI; convert to points for the engine.
      const dayLossStop = numOr(body.dayLossStopRs, 0) > 0 ? numOr(body.dayLossStopRs, 0) / perPoint : 0;
      const dayProfitTarget = numOr(body.dayProfitTargetRs, 0) > 0 ? numOr(body.dayProfitTargetRs, 0) / perPoint : 0;
      const maxTradesPerDay = Math.max(1, numOr(body.maxTradesPerDay, 3));
      const { trades, summary } = runSrBreakout(candles, {
        entryPts, trendBars: 20, gapLo: spec.gapLo, gapHi: spec.gapHi, targetByScore: spec.targetByScore,
        maxTradesPerDay, dayLossStop, dayProfitTarget, reportFromDate: fromDate, ...spec.session,
      });
      // ₹ = points × unitsPerLot × lots (futures-equivalent; option premium differs).
      const rupees = (pts) => Math.round(pts * perPoint);
      const tradesR = trades.map((t) => ({ ...t, instrument: spec.name, contract, rupees: rupees(t.points) }));
      results.push({
        key, name: spec.name, contract, token, candles: candles.length,
        params: { entryPts, gapLo: spec.gapLo, gapHi: spec.gapHi, targetByScore: spec.targetByScore, lots, unitsPerLot, maxTradesPerDay, dayLossStopRs: numOr(body.dayLossStopRs, 0), dayProfitTargetRs: numOr(body.dayProfitTargetRs, 0) },
        summary: {
          ...summary,
          totalProfitRupees: rupees(summary.profitPoints),
          totalLossRupees: rupees(summary.lossPoints),
          netRupees: rupees(summary.grossPoints),
          grossRupees: rupees(summary.grossPoints),
        },
        trades: tradesR,
      });
    } catch (e) {
      results.push({ key, name: spec.name, error: String(e.message || e) });
    }
  }
  res.json({ status: 'ok', mode: 'paper', fromDate, toDate, isToday: toDate === todayIso(), ranAt: new Date().toISOString(), results });
}

function numOr(v, d) { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? n : d; }

/**
 * POST /live/sr-observe  — REAL-OPTION OBSERVATION (paper data collection).
 * Detects today's validated underlying signals and captures the real option
 * snapshot + price path for each. Places NO orders. body: { instruments?, lots? }
 */
async function srObserve(req, res) {
  const authorization =
    req.headers['x-kite-authorization'] ||
    req.headers['x-kite-authorisation'] ||
    (await store.getAuthorizationFor(userId(req)));
  if (!authorization) {
    res.status(400).json({ status: 'error', message: 'Kite session required — Get Token (or Push Kite token), then retry.' });
    return;
  }
  const body = req.body || {};
  try {
    const out = await observe(authorization, { instruments: body.instruments, lots: numOr(body.lots, 1) });
    res.json({ status: 'ok', mode: 'observe', ...out });
  } catch (e) {
    res.status(500).json({ status: 'error', message: String(e.message || e) });
  }
}

/**
 * GET /live/sr-observe/status — collector heartbeat + dashboard (read-only).
 * Lazily boots the backend collector (singleton-guarded) so it self-heals after
 * a process restart even before the trading worker touches it. No orders.
 */
function srObserveStatus(req, res) {
  try { collector.boot(); } catch (e) { /* boot is best-effort */ }
  res.json({ status: 'ok', ...collector.status() });
}

/**
 * POST /live/sr-breakout/debug — candle-by-candle audit for a day ("Why no
 * trade?"). Read-only; does not change the strategy or thresholds. Shows every
 * completed 15-min candle with the gate trace + rejection reason, plus the
 * intrabar developing-state trace. body: { instruments?, date? }
 */
async function srDebug(req, res) {
  const authorization =
    req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] ||
    (await store.getAuthorizationFor(userId(req)));
  if (!authorization) { res.status(400).json({ status: 'error', message: 'Kite session required — Get Token, then retry.' }); return; }
  const body = req.body || {};
  const date = body.date || todayIso();
  const keys = Array.isArray(body.instruments) && body.instruments.length ? body.instruments : ['nifty'];
  const results = [];
  for (const key of keys) {
    const spec = INSTRUMENTS[key];
    if (!spec) { results.push({ key, error: 'unknown instrument' }); continue; }
    try {
      let token = spec.token, contract = spec.name;
      if (key === 'crude') { const r = await resolveCrudeToken(authorization); token = r.token; contract = r.symbol; }
      const candles = await market.fetchHistorical5m(authorization, token, shiftDays(date, -12), date);
      const b5 = candles.map((x) => ({ date: x.date, open: x.open, high: x.high, low: x.low, close: x.close }));
      // Entry window is overridable per request so a qualifying open/close candle
      // can be inspected — the strategy default (spec.session) is unchanged.
      const session = {
        entryStartHm: body.entryStartHm || spec.session.entryStartHm,
        entryEndHm: body.entryEndHm || spec.session.entryEndHm,
        squareOffHm: body.squareOffHm || spec.session.squareOffHm,
      };
      const audit = auditDay(b5, { entryPts: numOr(body.entryPts, spec.entryPts), trendBars: 20, ...session }, date);
      results.push({ key, name: spec.name, contract, ...audit });
    } catch (e) { results.push({ key, name: spec.name, error: String(e.message || e) }); }
  }
  res.json({ status: 'ok', date, results });
}

/** GET /live/sr-observe/history — full permanent observation + paper history. */
function srObserveHistory(req, res) {
  res.json({ status: 'ok', records: obsHistory() });
}

/**
 * POST /live/sr-observe/confirm — user confirms their OWN real Live entry.
 * The system never assumes a fill. body: { signalId, price, quantity?, timestamp? }
 * No broker order is placed here — this only records what the user did in Kite.
 */
function srLiveConfirm(req, res) {
  const b = req.body || {};
  if (!b.signalId) { res.status(400).json({ status: 'error', message: 'signalId required' }); return; }
  const out = confirmLiveEntry(String(b.signalId), { price: b.price, quantity: b.quantity, timestamp: b.timestamp });
  res.status(out.ok ? 200 : 400).json({ status: out.ok ? 'ok' : 'error', ...out });
}

/** POST /live/sr-observe/exit — user confirms their OWN real Live exit. */
function srLiveExit(req, res) {
  const b = req.body || {};
  if (!b.signalId) { res.status(400).json({ status: 'error', message: 'signalId required' }); return; }
  const out = confirmLiveExit(String(b.signalId), { price: b.price, timestamp: b.timestamp, reason: b.reason });
  res.status(out.ok ? 200 : 400).json({ status: out.ok ? 'ok' : 'error', ...out });
}

module.exports = {
  srBreakout, srObserve, srObserveStatus, srObserveHistory, srLiveConfirm, srLiveExit, srDebug, INSTRUMENTS,
};
