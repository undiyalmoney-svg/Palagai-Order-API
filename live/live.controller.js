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
    note: 'Server Live — Pivot S/R · lots from UI capital',
    version: APP_VERSION,
    appBuild: APP_BUILD,
    dnaId: LIVE_GREEN_DNA.id,
    crudeDnaId: LIVE_CRUDE_GREEN_DNA.id,
    crudeDefault: 'live-crude-green',
    bankAllowed: AUTOBOT_ALLOW_BANK,
    crudeAllowed: AUTOBOT_ALLOW_CRUDE,
    paperLivePath: true,
    bankOnlyAfterNifty: LIVE_GREEN_DNA.liveOps.bankOnlyAfterNifty === true,
    crudeDna: AUTOBOT_ALLOW_CRUDE
      ? `after NSE · OR${c.minOrWidth}–${c.maxOrWidth} · ${c.entryStart}–${c.entryEnd} · SL${c.stopPts}/TP${c.targetPts} · trail ₹${c.profitLockArmRs}→₹${c.profitLockLockRs} · max${c.maxTradesDay} · first-win · no index-session overlap`
      : 'OFF — Autobot will not trade Crude',
    trapDna: `Pivot S/R · ${t.entryTimeStart}–${t.entryTimeEnd} · max N${t.maxTradesPerDay}/B${t.bankMaxTradesPerDay} · trail ₹${t.profitLockArmRs}/₹${t.profitLockLockRs}`,
    dayProfitLockRsBase: DAY_PROFIT_LOCK_RS,
    strictDayStopRsBase: STRICT_DAY_STOP_RS,
    liveOps: { ...ops, ...LIVE_CRUDE_GREEN_DNA.liveOps },
    research: {
      index: LIVE_GREEN_DNA.research,
      crude: LIVE_CRUDE_GREEN_DNA.research,
      greenPath:
        'Friday pivot S/R (v8). Fade-bar off. Lots from capitalRs. Crude off.',
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
    checkboxHint: `₹${DAY_PROFIT_LOCK_RS.toLocaleString('en-IN')} desk lock · lots from capitalRs`,
    /** Autobot UI should render these books (Crude is server-forced ON). */
    books: {
      nifty: true,
      bank: AUTOBOT_ALLOW_BANK,
      crude: AUTOBOT_ALLOW_CRUDE,
      bankAllowed: AUTOBOT_ALLOW_BANK,
      crudeAllowed: AUTOBOT_ALLOW_CRUDE,
      deskLots: DAILY_3K_PRESET.niftyLots,
      niftyLots: DAILY_3K_PRESET.niftyLots,
      bankLots: DAILY_3K_PRESET.bankLots,
      crudeStrategy: 'live-crude-green',
      crudeWindow: '16:00–21:00 IST (hard gate 15:15)',
      bankOnlyAfterNifty: LIVE_GREEN_DNA.liveOps.bankOnlyAfterNifty === true,
      label: 'Pivot S/R · ₹40k → Nifty 1×2 · Bank 2×1 · send capitalRs',
      capitalLots: {
        per40k: 1,
        at40k: { niftyLots: 1, bankLots: 2, niftyTrades: 2, bankTrades: 1 },
        at80k: { niftyLots: 2, bankLots: 2, niftyTrades: 2, bankTrades: 1 },
        at120k: { niftyLots: 3, bankLots: 3, niftyTrades: 2, bankTrades: 1 },
        at160k: { niftyLots: 4, bankLots: 4, niftyTrades: 2, bankTrades: 1 },
        at200k: { niftyLots: 5, bankLots: 5, niftyTrades: 2, bankTrades: 1 },
        cap: 10,
        note: 'Send capitalRs on Start. 1 Nifty lot per ₹40k. ₹40k Bank is 2 lots; from ₹80k Bank matches Nifty. Trades stay Nifty 2 / Bank 1.',
      },
    },
    uiHint:
      'Send capitalRs on Start. ₹40k → N1/B2 · ₹80k → N2/B2 · ₹1.2L → N3/B3. Nifty 2 trades, Bank 1. Stop→Start.',
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
