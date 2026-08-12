const store = require('./live.store');
const { runBacktest } = require('./backtest');
const {
  APP_BUILD,
  APP_VERSION,
  AUTOBOT_ALLOW_CRUDE,
  AUTOBOT_ALLOW_BANK,
  DAILY_3K_PRESET,
  DAY_PROFIT_LOCK_RS,
  STRICT_DAY_STOP_RS,
  LIVE_GREEN_DNA,
  LIVE_CRUDE_GREEN_DNA,
} = require('./daily-desk-defaults');

async function health(_req, res) {
  const t = LIVE_GREEN_DNA.trap;
  const ops = LIVE_GREEN_DNA.liveOps;
  const c = LIVE_CRUDE_GREEN_DNA.signal;
  res.json({
    status: 'ok',
    service: 'palagai-live-control',
    note: 'Server Live — All3 Treasure · Nifty+Bank Pivot S/R + Crude Session-OR · Unlimited · Zero-red · Paper≡Live',
    version: APP_VERSION,
    appBuild: APP_BUILD,
    dnaId: LIVE_GREEN_DNA.id,
    crudeDnaId: LIVE_CRUDE_GREEN_DNA.id,
    crudeDefault: 'live-crude-green',
    bankAllowed: AUTOBOT_ALLOW_BANK,
    crudeAllowed: AUTOBOT_ALLOW_CRUDE,
    paperLivePath: true,
    bankOnlyAfterNifty: !!ops.bankOnlyAfterNifty,
    crudeDna: AUTOBOT_ALLOW_CRUDE
      ? `Professional · after NSE · OR${c.minOrWidth}–${c.maxOrWidth} · ${c.entryStart}–${c.entryEnd} · SL${c.stopPts}/TP${c.targetPts} · confirm ${c.requireConfirm ? 'ON' : 'OFF'} · trail ₹${c.profitLockArmRs}→₹${c.profitLockLockRs} · max${c.maxTradesDay || '∞'}`
      : 'OFF — Autobot will not trade Crude',
    trapDna: `Professional · Pivot${t.pivotStrength || 3} · perfectSL · ${t.trapMode || 'trap'} · pierce ${t.piercePts}/B${t.bankPiercePts} · confirm≥${t.minConfirmBody || 0}pt · risk ${t.minRiskPts || 0}-${t.maxRiskPts || 0}pt · ${t.targetRMultiple || 0}R · max${t.maxTradesPerDay || '∞'}/book`,
    dayProfitLockRsBase: DAY_PROFIT_LOCK_RS,
    strictDayStopRsBase: STRICT_DAY_STOP_RS,
    liveOps: { ...ops, ...LIVE_CRUDE_GREEN_DNA.liveOps },
    antiChurn: {
      crudeCooldownMin: 20,
      indexCooldownMin: 12,
      crudeMaxTradesDay: 3,
      indexMaxTradesDay: 3,
      bookDayLossStopRs: 500,
      deskDayLossStopRs: 900,
      note: 'Live re-runs every 60s; guards block re-entry churn + hard-stop on day loss.',
    },
    research: {
      index: LIVE_GREEN_DNA.research,
      crude: LIVE_CRUDE_GREEN_DNA.research,
      greenPath:
        'Professional DNA: confirmed pivot S/R reversal (index) + confirmed OR breakout (crude), 2–2.5R targets, breakeven trail, max 2–3 trades/book/day, cooldown, per-book & desk daily loss stops + day profit lock. Validate in paper.',
      dailyBand: LIVE_GREEN_DNA.dailyBand,
    },
    defaults: DAILY_3K_PRESET,
  });
}

function userId(req) {
  return req.user?.id || 'anonymous';
}

async function status(req, res) {
  res.json(store.statusFor(userId(req)));
}

async function events(req, res) {
  const s = store.statusFor(userId(req));
  res.json({ events: s.events || [] });
}

async function defaults(_req, res) {
  res.json({
    version: APP_VERSION,
    appBuild: APP_BUILD,
    preset: DAILY_3K_PRESET,
    dayProfitLockRsBase: DAY_PROFIT_LOCK_RS,
    strictDayStopRsBase: STRICT_DAY_STOP_RS,
    checkboxHint:
      DAY_PROFIT_LOCK_RS > 0
        ? `₹${DAY_PROFIT_LOCK_RS.toLocaleString('en-IN')} × lots (1→₹3k · 3→₹9k)`
        : 'Treasure DNA — no day profit lock / stop (S/R + perfect SL)',
    /** Autobot UI should render these books (Crude is server-forced ON). */
    books: {
      nifty: true,
      bank: AUTOBOT_ALLOW_BANK,
      crude: AUTOBOT_ALLOW_CRUDE,
      bankAllowed: AUTOBOT_ALLOW_BANK,
      crudeAllowed: AUTOBOT_ALLOW_CRUDE,
      deskLots: DAILY_3K_PRESET.niftyLots,
      crudeStrategy: 'live-crude-green',
      crudeWindow: '16:00–21:00 IST (hard gate 15:15)',
      bankOnlyAfterNifty: !!LIVE_GREEN_DNA.liveOps.bankOnlyAfterNifty,
      label: 'Treasure · Nifty + Bank + Crude (unlimited · no band)',
      capitalLots: {
        under75k: 1,
        from75k: 2,
        perLakhAbove: 1,
        at6L: 6,
        cap: 10,
        note: 'One deskLots for Nifty+Bank+Crude — Crude has no private lots',
      },
    },
    uiHint:
      'Treasure DNA: Pivot S/R + perfect SL, unlimited trades, no day lock/band. Capital ladder → shared deskLots. Send capitalRs; Stop→Start.',
  });
}

async function start(req, res) {
  const out = await store.start(userId(req), req.body || {});
  res.json(out);
}

async function stop(req, res) {
  const out = await store.stop(userId(req));
  res.json(out);
}

async function putAuth(req, res) {
  const out = await store.putAuth(userId(req), req.body || {});
  res.json(out);
}

/**
 * Paper backtest — replays a From→To range server-side and returns trades + P&L.
 * The browser supplies its Kite session via X-Kite-Authorization (read-only,
 * historical data only — no orders are placed).
 */
async function backtest(req, res) {
  // Prefer the browser's Kite session header; fall back to the server-stored
  // token (pushed via Push Kite token) so Paper works like Live.
  const authorization =
    req.headers['x-kite-authorization'] ||
    req.headers['x-kite-authorisation'] ||
    (await store.getAuthorizationFor(userId(req)));
  if (!authorization) {
    res.status(400).json({
      status: 'error',
      message: 'Kite session required — Get Token (or Push Kite token to server), then retry Paper.',
    });
    return;
  }
  const body = req.body || {};
  const out = await runBacktest({
    authorization,
    fromDate: body.fromDate,
    toDate: body.toDate,
    config: body,
  });
  res.json(out);
}

module.exports = { health, status, events, defaults, start, stop, putAuth, backtest };
