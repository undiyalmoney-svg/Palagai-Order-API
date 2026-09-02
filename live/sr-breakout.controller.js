'use strict';
/**
 * S/R Breakout — Paper controller. RESEARCH / PAPER ONLY.
 * Fetches historical 5-min candles (read-only, via the pushed Kite token) and
 * runs the sr-breakout engine. Places NO orders; imports nothing from the live
 * order path. "Start Paper today" works because it fetches today's candles.
 */
const https = require('https');
const market = require('./kite-market');
const { runSrBreakout } = require('./sr-breakout');

// Instrument registry. NIFTY 50 / NIFTY BANK have fixed index tokens; Crude Oil
// Mini is an MCX monthly future resolved to its front month at request time.
const INSTRUMENTS = {
  nifty: {
    key: 'nifty', name: 'Nifty 50', token: '256265',
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' },
    defaults: { entryPts: 40, bigPts: 70, cutHm: '12:30', lotSize: 75 },
  },
  banknifty: {
    key: 'banknifty', name: 'Bank Nifty', token: '260105',
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' },
    defaults: { entryPts: 90, bigPts: 150, cutHm: '12:30', lotSize: 35 },
  },
  crude: {
    key: 'crude', name: 'Crude Oil Mini', token: null, // resolved at runtime
    session: { entryStartHm: '09:30', entryEndHm: '22:00', squareOffHm: '23:20' },
    defaults: { entryPts: 27, bigPts: 0, cutHm: '', lotSize: 10 },
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

/**
 * POST /live/sr-breakout
 * body: { instruments:['nifty'|'banknifty'|'crude'], fromDate, toDate,
 *         entryPts?, bigPts?, targetPts?, cutHm?, lotSize? }
 * When fromDate/toDate == today, it fetches today's candles → today's results.
 */
async function srBreakout(req, res) {
  const authorization =
    req.headers['x-kite-authorization'] ||
    req.headers['x-kite-authorisation'];
  if (!authorization) {
    res.status(400).json({ status: 'error', message: 'Kite session required — Get Token (or Push Kite token), then retry Paper.' });
    return;
  }
  const body = req.body || {};
  const keys = Array.isArray(body.instruments) && body.instruments.length ? body.instruments : ['nifty'];
  const fromDate = body.fromDate || todayIso();
  const toDate = body.toDate || todayIso();
  const targetPts = Number(body.targetPts) || 0;   // 0 = hold to close

  const results = [];
  for (const key of keys) {
    const spec = INSTRUMENTS[key];
    if (!spec) { results.push({ key, error: 'unknown instrument' }); continue; }
    try {
      let token = spec.token;
      let contract = spec.name;
      if (key === 'crude') { const r = await resolveCrudeToken(authorization); token = r.token; contract = r.symbol; }
      const candles = await market.fetchHistorical5m(authorization, token, fromDate, toDate);
      const entryPts = numOr(body.entryPts, spec.defaults.entryPts);
      const bigPts = numOr(body.bigPts, spec.defaults.bigPts);
      const cutHm = body.cutHm != null ? body.cutHm : spec.defaults.cutHm;
      const lots = Math.max(1, numOr(body.lots, 1));
      const unitsPerLot = spec.defaults.lotSize;          // standard contract size
      const { trades, summary } = runSrBreakout(candles, {
        entryPts, bigPts, targetPts, cutHm, ...spec.session,
      });
      // ₹ = points × unitsPerLot × lots (futures-equivalent; option premium differs).
      const rupees = (pts) => Math.round(pts * unitsPerLot * lots);
      const tradesR = trades.map((t) => ({ ...t, instrument: spec.name, contract, rupees: rupees(t.points) }));
      results.push({
        key, name: spec.name, contract, token, candles: candles.length,
        params: { entryPts, bigPts, targetPts, cutHm, lots, unitsPerLot },
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

module.exports = { srBreakout, INSTRUMENTS };
