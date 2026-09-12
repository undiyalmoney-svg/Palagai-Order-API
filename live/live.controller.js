const store = require('./live.store');
const srLive = require('./sr-live');
const { runSrDesk } = require('./sr-desk');
const { parseTradeBotWindow } = require('./trade-bot-dates');
const { getOptionOhlcAndPrice } = require('./option-ohlc');
const { findEntryExitWait, getLastFound, parseUniverse } = require('./ee-wait-research');
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
    note: 'Trade Bot paper/live: Nifty + Bank S/R wall-break (walk-forward). Not a straddle. Paper ₹ is index×lot. Live buys one ATM CE or PE. Day ±₹3,500. Crude off.',
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
    trapDna: `Professional · Nifty 50 · Pivot${t.pivotStrength || 3} · perfectSL · ${t.trapMode || 'trap'} · pierce ${t.piercePts} · confirm≥${t.minConfirmBody || 0}pt · risk ${t.minRiskPts || 0}-${t.maxRiskPts || 0}pt · ${t.targetRMultiple || 0}R · max${t.maxTradesPerDay || '∞'} · peak ₹${t.profitLockArmRs}/${t.profitLockLockRs} · ${ops.chargeCoverMultiple || 0}× charges`,
    dayProfitLockRsBase: DAY_PROFIT_LOCK_RS,
    strictDayStopRsBase: STRICT_DAY_STOP_RS,
    liveOps: { ...ops, ...LIVE_CRUDE_GREEN_DNA.liveOps },
    antiChurn: {
      crudeCooldownMin: 20,
      indexCooldownMin: 12,
            crudeMaxTradesDay: 0,
      indexMaxTradesDay: 0,
      bookDayLossStopRs: '500 × lots',
      deskDayLossStopRs: '900 × lots',
      note: 'Loss stops scale with lots → worst-case daily loss is bounded & predictable when you expand. Guards also block 60s re-entry churn.',
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
  const uid = userId(req);
  const sr = srLive.status(uid);
  if (sr && sr.running) {
    res.json({
      ...store.statusFor(uid),
      ...sr,
      status: 'running',
      liveMoney: true,
      realOrders: true,
    });
    return;
  }
  res.json(store.statusFor(uid));
}

async function events(req, res) {
  const s = store.statusFor(userId(req));
  res.json({ events: s.events || [] });
}

async function funds(req, res) {
  const authorization = await kiteAuthorization(req);
  if (!authorization) {
    res.status(400).json({
      status: 'error',
      message: 'Kite session required — Get Token, then retry.',
    });
    return;
  }
  const { fetchUserMargins } = require('./kite-market');
  try {
    const out = await fetchUserMargins(authorization);
    res.json({ status: 'ok', fetchedAt: new Date().toISOString(), ...out });
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message || String(err) });
  }
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
    /** Autobot UI should render Nifty only (Bank/Crude are hard-off). */
    books: {
      nifty: true,
      bank: AUTOBOT_ALLOW_BANK,
      crude: AUTOBOT_ALLOW_CRUDE,
      bankAllowed: AUTOBOT_ALLOW_BANK,
      crudeAllowed: AUTOBOT_ALLOW_CRUDE,
      deskLots: DAILY_3K_PRESET.niftyLots,
      niftyLots: DAILY_3K_PRESET.niftyLots,
      bankLots: DAILY_3K_PRESET.bankLots,
      crudeLots: DAILY_3K_PRESET.crudeLots,
      crudeStrategy: 'live-crude-green',
      crudeWindow: '16:00–21:00 IST (hard gate 15:15)',
      bankOnlyAfterNifty: !!LIVE_GREEN_DNA.liveOps.bankOnlyAfterNifty,
      niftyMaxTradesDay: DAILY_3K_PRESET.niftyMaxTradesDay,
      bankMaxTradesDay: DAILY_3K_PRESET.bankMaxTradesDay,
      crudeMaxTradesDay: DAILY_3K_PRESET.crudeMaxTradesDay,
      deskMaxTradesDay: DAILY_3K_PRESET.deskMaxTradesDay,
      label: 'Nifty 50 · lots from UI',
      capitalLots: {
        perRs: 40000,
        at40k: 1,
        at80k: 2,
        at1_2L: 3,
        at2L: 5,
        cap: 10,
        note: 'Send lots / niftyLots on Start (integer ≥ 1, cap 10). If omitted, capitalRs maps ~1 lot per ₹40k. Stop→Start.',
        tradeCounts:
          'Send niftyMaxTradesDay on Start (0 = unlimited). Stop→Start to apply.',
      },
    },
    uiHint:
      'Lots: lots / niftyLots (integer ≥ 1, cap 10; capitalRs is fallback). Trade counts: niftyMaxTradesDay (0 = unlimited). Stop→Start.',
  });
}

async function kiteAuthorization(req) {
  return (
    req.headers['x-kite-authorization'] ||
    req.headers['x-kite-authorisation'] ||
    (await store.getAuthorizationFor(userId(req)))
  );
}

/**
 * One Trade Bot run. Paper discovers a new spec for the picked dates.
 * Live money is the only switch that places Kite orders.
 */
function isResearchEngine(engine) {
  const e = String(engine || '').toLowerCase();
  return e === 'ee-wait' || e === 'order-flow' || e === 'confluence';
}

async function start(req, res) {
  const body = req.body || {};
  const window = parseTradeBotWindow(body);
  const engine = String(body.engine || '').toLowerCase();
  const universe = parseUniverse(body.universe || body.indexType);
  const researchLive = isResearchEngine(engine);
  if (researchLive && window.liveMoney && universe === 'nifty-100-stocks') {
    res.status(400).json({
      status: 'error',
      message:
        'Nifty 100 stocks is paper/research (cash OHLC). Live money still uses Nifty 50 ATM options — switch universe or uncheck Live money.',
    });
    return;
  }
  const authorization = await kiteAuthorization(req);
  if (!authorization) {
    res.status(400).json({
      status: 'error',
      message: 'Kite session required — Get Token, then Run (or push the token).',
    });
    return;
  }
  const headerAuth = String(
    req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] || '',
  );
  const tokenBits = headerAuth.replace(/^token\s+/i, '').split(':');
  if (tokenBits[0] && tokenBits.slice(1).join(':')) {
    try {
      await store.putAuth(userId(req), {
        apiKey: tokenBits[0],
        accessToken: tokenBits.slice(1).join(':'),
      });
    } catch {
      /* stored token optional when header is present */
    }
  }
  const out = await runSrDesk({
    authorization,
    fromDate: window.fromDate,
    toDate: window.toDate,
    lots: body.lots || body.niftyLots || 1,
    capitalRs: body.capitalRs || body.capital,
    capitalSource: window.liveMoney ? 'actual' : (body.capitalSource || body.fundSource),
    liveMoney: window.liveMoney,
  });
  if (window.liveMoney) {
    const lots = body.lots || body.niftyLots || 1;
    await store.stop(userId(req));
    const live = await srLive.start(userId(req), {
      instruments: ['nifty', 'banknifty'],
      lots,
      lotsByInstrument: { nifty: lots, banknifty: lots },
    });
    res.json({
      ...out,
      ...live,
      status: live.running ? 'running' : live.status,
      mode: 'live',
      liveMoney: true,
      realOrders: true,
      shadowOf: 'sr-desk',
      today: window.today,
      trades: out.trades,
      totals: out.totals,
      note:
        'Live is S/R Nifty + Bank. It buys one ATM CE or PE when the paper engine fires. It does not sell a straddle. Day ±₹3,500. Crude off.',
    });
    return;
  }
  res.json({
    ...out,
    mode: 'paper',
    liveMoney: false,
    realOrders: false,
    today: window.today,
  });
}

async function stop(req, res) {
  const uid = userId(req);
  const sr = await srLive.stop(uid);
  const storeOut = await store.stop(uid);
  const running = !!(sr && sr.running);
  res.json({
    ...storeOut,
    ...sr,
    status: running ? 'running' : 'stopped',
  });
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
  req.body = { ...(req.body || {}), liveMoney: false, realOrders: false };
  return start(req, res);
}

/**
 * Option OHLC (historical candles) and/or live price.
 * Body: tradingSymbol | instrumentToken | atm:true, fromDate, toDate,
 * today, historical, live, interval, optionType (CE|PE|BOTH).
 */
async function optionOhlc(req, res) {
  const authorization = await kiteAuthorization(req);
  const body = req.body || {};
  const wantLive = body.live === undefined ? !!authorization : body.live === true || body.live === 'true';
  const atm = body.atm === true || body.atm === 'true';
  if ((wantLive || atm) && !authorization) {
    res.status(400).json({
      status: 'error',
      message: 'Kite session required for live price or ATM lookup — Get Token, then retry.',
    });
    return;
  }
  let fromDate = body.fromDate;
  let toDate = body.toDate;
  let today = false;
  if (body.today === true || body.today === 'true') {
    const w = parseTradeBotWindow({ today: true, liveMoney: false });
    fromDate = w.fromDate;
    toDate = w.toDate;
    today = true;
  }
  const out = await getOptionOhlcAndPrice({
    authorization,
    ...body,
    fromDate,
    toDate,
  });
  res.json({ status: 'ok', today, ...out });
}

async function findEeWait(req, res) {
  const body = req.body || {};
  const out = await findEntryExitWait({
    fromDate: body.fromDate,
    toDate: body.toDate,
    lots: body.lots || body.niftyLots || 1,
    indexType: body.indexType,
    universe: body.universe,
    symbol: body.symbol,
    maxSymbols: body.maxSymbols,
  });
  res.json({ status: 'ok', ...out });
}

async function lastEeWait(_req, res) {
  res.json({ status: 'ok', found: getLastFound() });
}

module.exports = { health, status, events, funds, defaults, start, stop, putAuth, backtest, optionOhlc, findEeWait, lastEeWait };
