'use strict';
/**
 * S/R REAL-OPTION OBSERVATION ENGINE — PAPER / DATA COLLECTION ONLY.
 *
 * Purpose (Buildia phase): whenever the *validated underlying* S/R-breakout
 * signal fires, capture the REAL option-market snapshot (bid/ask/OI/volume,
 * real premium path) so a genuine option backtest can be run later on ACTUAL
 * premiums — never a delta proxy, never P&L inferred from index points.
 *
 * HARD RULES honoured here:
 *   - Underlying strategy is NOT changed or re-optimised — we import the same
 *     engine (runSrBreakout) and the same per-instrument defaults.
 *   - NO broker order is ever placed. This module only reads market data and
 *     appends observation rows to a local JSONL log.
 *   - Missing option fields (e.g. IV, absent from Kite /quote) are marked
 *     UNAVAILABLE, never filled.
 *   - Daily caps (3 trades, ±₹3,500) gate whether a signal becomes a paper
 *     ENTRY record vs an ARMED/skipped note.
 *
 * Storage: append-only JSONL at sr-observations/observations.jsonl (gitignored).
 * Records are keyed by SIGNAL_ID and updated in place as the path fills.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const market = require('./kite-market');
const { runSrBreakout } = require('./sr-breakout');
const { EXECUTION_MODE } = require('./sr-execution-guard');

// Approved paper exit rule (configurable). Loser is NOT held to premium-zero;
// the option premium is a risk boundary, not the normal stop.
const MAX_HOLD_BARS = Number(process.env.SR_MAX_HOLD_BARS || 12); // 12 x 5m = 60 min

/** Zerodha options round-trip cost (buy+sell), rupees. Real model, not a guess. */
function optionCosts(entryPrem, exitPrem, qty) {
  const brokerage = 40;                              // ₹20 buy + ₹20 sell
  const turnover = (entryPrem + exitPrem) * qty;
  const txn = 0.0003503 * turnover;                  // NSE txn charge (approx)
  const stt = 0.000625 * exitPrem * qty;             // STT 0.0625% on sell premium
  const stamp = 0.00003 * entryPrem * qty;           // stamp on buy
  const gst = 0.18 * (brokerage + txn);
  return Math.round(brokerage + txn + stt + stamp + gst);
}

const DIR = path.join(__dirname, '..', 'sr-observations');
const LOG = path.join(DIR, 'observations.jsonl');
const MIN_SAMPLE = 30;          // first-validation threshold (Buildia spec)
const LOT_DAY_LOSS = 3500, LOT_DAY_PROFIT = 3500, MAX_TRADES_DAY = 3;

// Underlying config — mirrors sr-breakout.controller INSTRUMENTS (not re-tuned).
const INSTR = {
  nifty: { name: 'Nifty 50', token: '256265', spotKey: 'NSE:NIFTY 50', root: 'NIFTY',
    step: 50, unitsPerLot: 75, entryPts: 27, gapLo: 100, gapHi: 175, targetByScore: { 1: 20, 2: 25, 3: 30 },
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' }, opt: true },
  banknifty: { name: 'Bank Nifty', token: '260105', spotKey: 'NSE:NIFTY BANK', root: 'BANKNIFTY',
    step: 100, unitsPerLot: 35, entryPts: 60, gapLo: 275, gapHi: 465, targetByScore: { 1: 40, 2: 50, 3: 60 },
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' }, opt: true },
};

function todayIso() { return new Date().toISOString().slice(0, 10); }
function shiftDays(iso, d) { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); }
const hm = (s) => String(s).slice(11, 16);

// ── raw Kite helpers (read-only) ────────────────────────────────────────────
function getJson(p, authorization) {
  return new Promise((res, rej) => {
    https.get({ hostname: 'api.kite.trade', path: p, headers: { 'X-Kite-Version': '3', Authorization: authorization } },
      (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}
function getText(p, authorization) {
  return new Promise((res, rej) => {
    https.get({ hostname: 'api.kite.trade', path: p, headers: { 'X-Kite-Version': '3', Authorization: authorization } },
      (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b)); }).on('error', rej);
  });
}

/** Build {strike|expiry -> {token,sym}} for one root+type from the NFO dump. */
async function optionMap(authorization, root, type) {
  const csv = await getText('/instruments/NFO', authorization);
  const lines = csv.trim().split('\n');
  const map = new Map(); const expiries = new Set();
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const name = (p[3] || '').replace(/"/g, '');
    const t = (p[9] || '').replace(/"/g, '');
    if (name !== root || t !== type) continue;
    const strike = Number(p[6]); const exp = (p[5] || '').replace(/"/g, '');
    map.set(strike + '|' + exp, { token: (p[0] || '').replace(/"/g, ''), sym: (p[2] || '').replace(/"/g, '') });
    expiries.add(exp);
  }
  return { map, expiries: [...expiries].sort() };
}

/** Live quote for one or more NFO/NSE keys. Returns {key -> quote}. */
async function quotes(authorization, keys) {
  const qs = keys.map((k) => 'i=' + encodeURIComponent(k)).join('&');
  const j = await getJson('/quote?' + qs, authorization);
  return j.status === 'success' ? j.data : {};
}
function snapFromQuote(q) {
  if (!q) return null;
  const bid = q.depth?.buy?.[0]?.price ?? null;
  const ask = q.depth?.sell?.[0]?.price ?? null;
  const spread = bid != null && ask != null ? +(ask - bid).toFixed(2) : null;
  return {
    ltp: q.last_price ?? null, bid, ask, spread,
    volume: q.volume ?? null, oi: q.oi ?? null,
    iv: 'UNAVAILABLE', // Kite /quote does not expose IV
  };
}

// ── persistence ──────────────────────────────────────────────────────────────
function loadRecords() {
  try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
}
function saveRecords(recs) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(LOG, recs.map((r) => JSON.stringify(r)).join('\n') + (recs.length ? '\n' : ''));
}

/**
 * observe(authorization, {instruments, lots})
 * Detects today's underlying signals, captures the real option snapshot + path
 * for each, updates open records, enforces daily caps, returns a dashboard.
 */
async function observe(authorization, opts = {}) {
  const today = todayIso();
  const keys = Array.isArray(opts.instruments) && opts.instruments.length ? opts.instruments : ['nifty', 'banknifty'];
  const lots = Math.max(1, Number(opts.lots) || 1);
  const all = loadRecords();
  const perInstrument = [];

  for (const key of keys) {
    const spec = INSTR[key];
    if (!spec) { perInstrument.push({ key, error: 'unknown or option-discovery not wired (index only for now)' }); continue; }
    const dq = [];
    try {
      // 1) underlying signals today (with warm-up so morning signals appear)
      const bars = await market.fetchHistorical5m(authorization, spec.token, shiftDays(today, -12), today);
      const b5 = bars.map((x) => ({ date: x.date, open: x.open, high: x.high, low: x.low, close: x.close }));
      const { trades } = runSrBreakout(b5, {
        entryPts: spec.entryPts, trendBars: 20, gapLo: spec.gapLo, gapHi: spec.gapHi,
        targetByScore: spec.targetByScore, maxTradesPerDay: MAX_TRADES_DAY,
        dayLossStop: LOT_DAY_LOSS / (spec.unitsPerLot * lots), dayProfitTarget: LOT_DAY_PROFIT / (spec.unitsPerLot * lots),
        reportFromDate: today, ...spec.session,
      });

      // spot + intraday underlying path (for underlying MFE/MAE)
      const day5 = b5.filter((x) => String(x.date).slice(0, 10) === today);
      const optType = 'CE'; // long side today; PE branch handled per-signal below

      let optState = null; // lazy option map per (type) fetch
      for (const t of trades) {
        const SIGNAL_ID = `${key}|${t.date}|${t.entryTime}`;
        let rec = all.find((r) => r.SIGNAL_ID === SIGNAL_ID);
        const dir = t.side === 'BUY' ? 1 : -1;
        const type = dir > 0 ? 'CE' : 'PE';

        // daily cap: count today's ENTRY records for this instrument
        const todaysEntries = all.filter((r) => r.instrument === key && r.timestamp.slice(0, 10) === today && r.option_entry_price != null);
        const dayPnl = todaysEntries.reduce((a, r) => a + (r.net_PnL || 0), 0);
        const capped = todaysEntries.length >= MAX_TRADES_DAY || dayPnl <= -LOT_DAY_LOSS || dayPnl >= LOT_DAY_PROFIT;

        // resolve option contract if not already recorded
        if (!rec) {
          if (!optState || optState.type !== type) optState = { type, ...(await optionMap(authorization, spec.root, type)) };
          const spot = t.entryPrice; // underlying entry ≈ spot at signal
          const atm = Math.round(spot / spec.step) * spec.step;
          const expiry = optState.expiries.find((e) => e >= today) || null;
          const candStrikes = dir > 0 ? [atm - spec.step, atm, atm + spec.step] : [atm + spec.step, atm, atm - spec.step];
          const candKeys = [];
          const candMeta = [];
          for (const strike of candStrikes) {
            const found = optState.map.get(strike + '|' + expiry);
            if (found) { candKeys.push('NFO:' + found.sym); candMeta.push({ strike, sym: found.sym, token: found.token }); }
          }
          if (!candKeys.length) { dq.push(`no ${type} contracts for ${spec.root} exp ${expiry}`); continue; }
          const qmap = await quotes(authorization, candKeys.concat([spec.spotKey]));
          // build candidate snapshots + rank (liquidity high, spread low, near ATM)
          const cands = candMeta.map((m) => {
            const s = snapFromQuote(qmap['NFO:' + m.sym]);
            const spreadPct = s && s.ltp ? (s.spread ?? 0) / s.ltp : 1;
            const moneyness = m.strike === atm ? 'ATM' : (dir > 0 ? (m.strike < atm ? 'ITM' : 'OTM') : (m.strike > atm ? 'ITM' : 'OTM'));
            return { ...m, moneyness, snap: s, spreadPct,
              rank: (s?.oi || 0) / 1e6 - spreadPct * 20 - Math.abs(m.strike - atm) / spec.step * 0.5 };
          }).filter((c) => c.snap && c.snap.ltp);
          if (!cands.length) { dq.push(`no live quotes for ${type} candidates`); continue; }
          cands.sort((a, b) => b.rank - a.rank);
          const pick = cands[0];
          const fill = pick.snap.ask ?? pick.snap.ltp; // realistic BUY fill = ask
          const spot50 = qmap[spec.spotKey]?.last_price ?? spot;

          rec = {
            SIGNAL_ID, timestamp: `${t.date}T${t.entryTime}`, instrument: key, instrument_name: spec.name,
            underlying_price: spot, direction: type === 'CE' ? 'LONG' : 'SHORT',
            wall: t.level, break_price: t.entryPrice, retest_price: null, trigger: `15m close ${dir > 0 ? '>' : '<'} ${t.level} body>=${spec.entryPts}, with-trend`,
            underlying_entry: t.entryPrice, target_1: dir > 0 ? t.entryPrice + t.target : t.entryPrice - t.target,
            target_2: dir > 0 ? t.entryPrice + t.target + 10 : t.entryPrice - t.target - 10,
            underlying_invalidation: dir > 0 ? t.level - 16 : t.level + 16,
            score: t.confidence, confidence: t.confidence, market_regime: 'live',
            option_symbol: pick.sym, option_token: pick.token, option_expiry: expiry, option_strike: pick.strike, option_type: type,
            option_moneyness: pick.moneyness, option_entry_timestamp: `${t.date}T${t.entryTime}`,
            option_entry_price: capped ? null : fill, option_bid: pick.snap.bid, option_ask: pick.snap.ask,
            option_spread: pick.snap.spread, option_volume: pick.snap.volume, option_OI: pick.snap.oi, option_IV: 'UNAVAILABLE',
            quantity: spec.unitsPerLot * lots, lot_size: spec.unitsPerLot,
            spot_at_entry: spot50, status: capped ? 'ARMED-CAPPED' : 'OPEN',
            candidates: cands.map((c) => ({ strike: c.strike, moneyness: c.moneyness, ltp: c.snap.ltp, bid: c.snap.bid, ask: c.snap.ask, spread: c.snap.spread, oi: c.snap.oi })),
            underlying_MFE: null, underlying_MAE: null, option_MFE: null, option_MAE: null,
            adverse_before_favorable: null, virtual_tracks: null,
            exit_timestamp: null, exit_price: null, gross_PnL: null, net_PnL: null, exit_reason: capped ? 'daily-cap: not entered' : null,
            data_quality: 'ok', data_source: 'kite',
          };
          all.push(rec);
        }

        // 2) update the real path (underlying + option 5m) for OPEN records
        if (rec.option_entry_price != null && rec.exit_price == null) {
          // underlying path after entry
          const uAfter = day5.filter((x) => hm(x.date) > t.entryTime && hm(x.date) <= spec.session.squareOffHm);
          if (uAfter.length) {
            let umfe = 0, umae = 0;
            for (const x of uAfter) { umfe = Math.max(umfe, dir * (x.high - t.entryPrice)); umae = Math.min(umae, dir * (x.low - t.entryPrice)); }
            rec.underlying_MFE = +umfe.toFixed(1); rec.underlying_MAE = +umae.toFixed(1);
          }
          // option path (real 5m) — genuine premium excursion + virtual tracks
          try {
            const ob = rec.option_token ? (await market.fetchHistorical5m(authorization, rec.option_token, today, today)) || [] : [];
            const oAfter = ob.filter((x) => hm(x.date) > t.entryTime && hm(x.date) <= spec.session.squareOffHm)
              .map((x) => ({ hm: hm(x.date), o: x.open, h: x.high, l: x.low, c: x.close }));
            if (oAfter.length) {
              const e = rec.option_entry_price;
              let omfe = 0, omae = 0, tMfe = 0, tMae = 0;
              oAfter.forEach((x, i) => { const f = x.h - e, a = x.l - e; if (f > omfe) { omfe = f; tMfe = i; } if (a < omae) { omae = a; tMae = i; } });
              rec.option_MFE = +omfe.toFixed(2); rec.option_MAE = +omae.toFixed(2);
              rec.adverse_before_favorable = tMae < tMfe;
              // virtual exit tracks (research; do not act) — real option prices
              const uHit = (T) => { const b = uAfter.find((x) => dir * (x.high - t.entryPrice) >= T); return b ? hm(b.date) : null; };
              const optAt = (hhmm) => { const b = oAfter.find((x) => x.hm >= hhmm); return b ? b.c : oAfter[oAfter.length - 1].c; };
              const pctExit = (p) => { const b = oAfter.find((x) => x.h >= e * (1 + p)); return b ? +(e * (1 + p)).toFixed(2) : null; };
              rec.virtual_tracks = {
                A_underlyingT1: uHit(t.target) ? optAt(uHit(t.target)) : null,
                B_underlyingT2: uHit(t.target + 10) ? optAt(uHit(t.target + 10)) : null,
                C_option_plus10pct: pctExit(0.10), D_option_plus20pct: pctExit(0.20), E_option_plus30pct: pctExit(0.30),
                close: oAfter[oAfter.length - 1].c,
              };

              // ── APPROVED PAPER EXIT (real prices) — closes the record ──────
              // First of: Target 1 hit, structural failure, or max holding time;
              // else, once the session is over, square-off. Never premium-zero.
              let exitIdx = -1, reason = null;
              for (let i = 0; i < uAfter.length; i++) {
                const ub = uAfter[i];
                const tgtHit = dir > 0 ? ub.high >= rec.target_1 : ub.low <= rec.target_1;
                const failed = dir > 0 ? ub.close < rec.underlying_invalidation : ub.close > rec.underlying_invalidation;
                if (tgtHit) { exitIdx = i; reason = 'TARGET_1'; break; }
                if (failed) { exitIdx = i; reason = 'STRUCTURAL_FAILURE'; break; }
                if (i >= MAX_HOLD_BARS - 1) { exitIdx = i; reason = 'MAX_HOLDING_TIME'; break; }
              }
              const sessionOver = uAfter.length && uAfter[uAfter.length - 1].hm >= spec.session.squareOffHm;
              if (exitIdx >= 0 || sessionOver) {
                const exitHm = exitIdx >= 0 ? uAfter[exitIdx].hm : uAfter[uAfter.length - 1].hm;
                if (!reason) reason = 'SESSION_CLOSE';
                const exitPrem = optAt(exitHm);               // real option premium at exit bar
                const gross = Math.round((exitPrem - e) * rec.quantity);
                const cost = optionCosts(e, exitPrem, rec.quantity);
                rec.exit_timestamp = `${today}T${exitHm}`;
                rec.exit_price = exitPrem; rec.exit_reason = reason;
                rec.gross_PnL = gross; rec.estimated_costs = cost; rec.net_PnL = gross - cost;
                rec.holding_bars = (exitIdx >= 0 ? exitIdx + 1 : uAfter.length);
                rec.status = 'CLOSED';
              }
            } else { rec.data_quality = 'option-path-missing'; }
          } catch (e) { rec.data_quality = 'option-fetch-error'; }
        }
      }
      perInstrument.push({ key, name: spec.name, signalsToday: trades.length, dataQuality: dq });
    } catch (e) {
      perInstrument.push({ key, name: spec.name, error: String(e.message || e) });
    }
  }

  saveRecords(all);
  return { today, perInstrument, dashboard: dashboard(all, today) };
}

function dashboard(all, today) {
  const entered = all.filter((r) => r.option_entry_price != null);
  const closed = entered.filter((r) => r.net_PnL != null);
  const wins = closed.filter((r) => r.net_PnL > 0);
  const todays = all.filter((r) => r.timestamp.slice(0, 10) === today);
  const optMfe = entered.filter((r) => r.option_MFE != null).map((r) => r.option_MFE);
  const optMae = entered.filter((r) => r.option_MAE != null).map((r) => r.option_MAE);
  const med = (a) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
  const mean = (a) => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null;
  // real P&L stats from CLOSED paper records
  const nets = closed.map((r) => r.net_PnL);
  const winNets = nets.filter((x) => x > 0), lossNets = nets.filter((x) => x <= 0);
  const grossWin = winNets.reduce((a, b) => a + b, 0), grossLoss = Math.abs(lossNets.reduce((a, b) => a + b, 0));
  const todayClosed = todays.filter((r) => r.net_PnL != null);
  const dayPnl = todayClosed.reduce((a, r) => a + r.net_PnL, 0);
  // max drawdown on the cumulative net-P&L curve
  let peak = 0, run = 0, maxDD = 0;
  for (const r of closed) { run += r.net_PnL; peak = Math.max(peak, run); maxDD = Math.min(maxDD, run - peak); }
  return {
    today: {
      signals: todays.length, paperEntries: todays.filter((r) => r.option_entry_price != null).length,
      armed: todays.filter((r) => String(r.status).startsWith('ARMED')).length,
      open: todays.filter((r) => r.status === 'OPEN').length,
      closed: todayClosed.length, dayPnl: Math.round(dayPnl),
      brake: todayClosed.length >= 3 ? 'MAX_TRADES' : dayPnl >= LOT_DAY_PROFIT ? 'PROFIT_LIMIT' : dayPnl <= -LOT_DAY_LOSS ? 'LOSS_LIMIT' : null,
    },
    cumulative: {
      totalSignals: all.length, optionTradesRecorded: entered.length, closed: closed.length,
      wins: wins.length, losses: closed.length - wins.length,
      winRate: closed.length ? Math.round(100 * wins.length / closed.length) : null,
      grossPnL: Math.round(nets.reduce((a, b) => a + b, 0)), netPnL: Math.round(nets.reduce((a, b) => a + b, 0)),
      avgWin: winNets.length ? Math.round(mean(winNets)) : null, avgLoss: lossNets.length ? Math.round(mean(lossNets)) : null,
      profitFactor: grossLoss ? +(grossWin / grossLoss).toFixed(2) : null,
      expectedValue: closed.length ? Math.round(nets.reduce((a, b) => a + b, 0) / closed.length) : null,
      maxDrawdown: Math.round(maxDD),
    },
    optionStats: {
      avgOptionMFE: mean(optMfe), medOptionMFE: med(optMfe),
      avgOptionMAE: mean(optMae), medOptionMAE: med(optMae),
      note: 'IV UNAVAILABLE from Kite quote; exits still virtual (collection phase)',
    },
    collection: {
      signalsRecorded: all.length, optionTradesRecorded: entered.length,
      minSampleForFirstValidation: MIN_SAMPLE, recommended: 50,
      optionEdgeStatus: entered.length === 0 ? 'UNTESTED' : entered.length < MIN_SAMPLE ? 'COLLECTING DATA' : 'PRELIMINARY',
    },
    executionMode: EXECUTION_MODE, liveBrokerOrders: 'DISABLED',
  };
}

/**
 * Manual LIVE position confirmation. The system NEVER assumes a broker fill —
 * the user confirms their own real entry/exit. Records user fields separately
 * from the simulated paper fields, so nothing is fabricated.
 */
function confirmLiveEntry(signalId, { price, quantity, timestamp } = {}) {
  const all = loadRecords();
  const rec = all.find((r) => r.SIGNAL_ID === signalId);
  if (!rec) return { ok: false, error: 'unknown SIGNAL_ID' };
  if (price == null || !Number.isFinite(Number(price))) return { ok: false, error: 'a real entry price is required (no fabricated fill)' };
  rec.user_entered = true;
  rec.user_entry_price = Number(price);
  rec.user_quantity = quantity != null ? Number(quantity) : rec.quantity;
  rec.user_entry_timestamp = timestamp || new Date().toISOString();
  rec.user_position_state = 'USER_ENTERED';
  saveRecords(all);
  return { ok: true, record: rec };
}
function confirmLiveExit(signalId, { price, timestamp, reason } = {}) {
  const all = loadRecords();
  const rec = all.find((r) => r.SIGNAL_ID === signalId);
  if (!rec) return { ok: false, error: 'unknown SIGNAL_ID' };
  if (!rec.user_entered) return { ok: false, error: 'position was never confirmed as entered' };
  if (price == null || !Number.isFinite(Number(price))) return { ok: false, error: 'a real exit price is required (no fabricated fill)' };
  const qty = rec.user_quantity || rec.quantity;
  const gross = Math.round((Number(price) - rec.user_entry_price) * qty);
  const cost = optionCosts(rec.user_entry_price, Number(price), qty);
  rec.user_exit_price = Number(price);
  rec.user_exit_timestamp = timestamp || new Date().toISOString();
  rec.user_exit_reason = reason || 'manual';
  rec.user_gross_PnL = gross; rec.user_net_PnL = gross - cost;
  rec.user_position_state = 'CLOSED';
  saveRecords(all);
  return { ok: true, record: rec };
}

/** Full permanent history (newest first). Read-only. */
function history() { return loadRecords().slice().reverse(); }

module.exports = {
  observe, loadRecords, dashboard, history,
  confirmLiveEntry, confirmLiveExit, optionCosts, INSTR,
};
