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
    note: 'Server Live — Pivot S/R · Perfect SL · Band ₹750–2000 · Paper≡Live',
    version: APP_VERSION,
    appBuild: APP_BUILD,
    dnaId: LIVE_GREEN_DNA.id,
    crudeDnaId: LIVE_CRUDE_GREEN_DNA.id,
    crudeDefault: 'live-crude-green',
    bankAllowed: AUTOBOT_ALLOW_BANK,
    crudeAllowed: AUTOBOT_ALLOW_CRUDE,
    paperLivePath: true,
    bankOnlyAfterNifty: true,
    crudeDna: AUTOBOT_ALLOW_CRUDE
      ? `after NSE · OR${c.minOrWidth}–${c.maxOrWidth} · ${c.entryStart}–${c.entryEnd} · SL${c.stopPts}/TP${c.targetPts} · trail ₹${c.profitLockArmRs}→₹${c.profitLockLockRs} · max${c.maxTradesDay} · first-win · no index-session overlap`
      : 'OFF — Autobot will not trade Crude',
    trapDna: `S/R Trap · swing${t.swingLb || 5} · mode ${t.trapMode || 'both'} · pierce ${t.piercePts}/B${t.bankPiercePts} · peak ₹${t.profitLockArmRs}/${t.profitLockLockRs}/${t.profitLockGivebackRs} · max${t.maxTradesPerDay} · ${t.targetRMultiple}R · stand-down ₹${ops.optionStandDownRs} · one-leg`,
    dayProfitLockRsBase: DAY_PROFIT_LOCK_RS,
    strictDayStopRsBase: STRICT_DAY_STOP_RS,
    liveOps: { ...ops, ...LIVE_CRUDE_GREEN_DNA.liveOps },
    research: {
      index: LIVE_GREEN_DNA.research,
      crude: LIVE_CRUDE_GREEN_DNA.research,
      greenPath:
        'Daily Band Loop: Nifty→Bank(after Nifty green)→lock ₹750/₹2000→no dig after green→Crude if still <₹750.',
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
    checkboxHint: `₹${DAY_PROFIT_LOCK_RS.toLocaleString('en-IN')} × lots (1→₹3k · 3→₹9k)`,
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
      bankOnlyAfterNifty: true,
      label: 'Nifty → Bank (after Nifty) → Crude after NSE',
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
      'Capital ladder → shared deskLots (Nifty=Bank=Crude): <₹75k→1, ₹75k+→2, then ≈₹1L per lot (₹6L→6, max 10). Auto-update all lot fields when capital changes; send capitalRs; Stop→Start.',
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
