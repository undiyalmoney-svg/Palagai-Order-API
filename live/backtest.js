/**
 * Server-side Paper backtest — Paper ≡ Live path.
 *
 * Replays the SAME strategy engine (strategy-core.cjs) over a From→To date
 * range with live-path gates (reject estimated, fill friction, one-leg desk
 * filter, option-₹ day lock) so Autobot Paper matches broker reality.
 *
 * Read-only: fetches historical candles via kite-market; never places orders.
 */
const {
  NIFTY_50_INSTRUMENT,
  BANK_NIFTY_INSTRUMENT,
  CRUDE_OIL_MINI_INSTRUMENT,
  createTrapStrategy,
  createGenieStrategy,
  replayPaperOnIndex,
  replayPaperOnCrude,
  resolveCrudeStrategyProfile,
  resolveCrudeProfileDayLossPts,
  resolveCrudeOilMiniFuturesToken,
} = require('./strategy-core.cjs');
const defaultMarket = require('./kite-market');
const {
  normalizeStartConfig,
  indexDayRiskOverrides,
  riskStatusLabels,
  DAY_PROFIT_LOCK_RS,
  STRICT_DAY_STOP_RS,
} = require('./daily-desk-defaults');
const { LIVE_GREEN_DNA, liveGreenTrapExtras } = require('./dna-live-green');
const {
  filterTradesLivePath,
  livePathReplayOpts,
  DEFAULT_LIVE_PATH,
} = require('./live-path');

/** Warm-up days before `fromDate` so indicators have history at the window start. */
const LOOKBACK_DAYS = 12;

function addDaysIso(isoDate, delta) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function tradeDateOf(ts) {
  return String(ts || '').slice(0, 10);
}

/** Net ₹ for a trade — charges-adjusted when available, else gross, else 0. */
function tradeNetRs(t) {
  if (t.netOptionPnlRs != null) return t.netOptionPnlRs;
  if (t.optionPnlRs != null) return t.optionPnlRs;
  return 0;
}

function round0(n) {
  return Math.round(Number(n) || 0);
}

function summarize(trades) {
  let optionNetRs = 0;
  let optionNetAfterChargesRs = 0;
  let wins = 0;
  let losses = 0;
  for (const t of trades) {
    const gross = t.optionPnlRs != null ? t.optionPnlRs : 0;
    const net = tradeNetRs(t);
    optionNetRs += gross;
    optionNetAfterChargesRs += net;
    if (net > 0) wins += 1;
    else if (net < 0) losses += 1;
  }
  return {
    trades: trades.length,
    wins,
    losses,
    optionNetRs: round0(optionNetRs),
    optionNetAfterChargesRs: round0(optionNetAfterChargesRs),
  };
}

function dayBreakdown(trades) {
  const byDate = new Map();
  for (const t of trades) {
    const date = tradeDateOf(t.entryTime);
    const row = byDate.get(date) || { date, trades: 0, optionNetRs: 0 };
    row.trades += 1;
    row.optionNetRs += tradeNetRs(t);
    byDate.set(date, row);
  }
  return [...byDate.values()]
    .map((r) => ({ ...r, optionNetRs: round0(r.optionNetRs) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function bookSummary(label, replay) {
  return {
    label,
    instrumentId: replay.instrumentId,
    strategy: replay.strategyName,
    ...summarize(replay.trades || []),
  };
}

function trapInitOverrides(cfg, instrumentId) {
  const risk =
    indexDayRiskOverrides({
      instrumentId,
      enableNifty: !!cfg.enableNifty,
      enableBank: !!cfg.enableBank,
      dayProfitLock: !!cfg.dayProfitLock,
      strictDayStop: !!cfg.strictDayStop,
    }) || {};
  const extras = liveGreenTrapExtras(instrumentId);
  if (cfg.optionStandDownRs != null) {
    extras.optionStandDownRs = Number(cfg.optionStandDownRs);
  }
  const bank = /bank/i.test(String(instrumentId || ''));
  const maxTrades = bank
    ? LIVE_GREEN_DNA.trap.bankMaxTradesPerDay || LIVE_GREEN_DNA.trap.maxTradesPerDay
    : LIVE_GREEN_DNA.trap.maxTradesPerDay;
  const cut = LIVE_GREEN_DNA.trap.sessionCutTime || LIVE_GREEN_DNA.trap.entryTimeEnd;
  return {
    ...risk,
    maxTradesPerDay: maxTrades,
    targetRMultiple: LIVE_GREEN_DNA.trap.targetRMultiple,
    entryTimeStart: LIVE_GREEN_DNA.trap.entryTimeStart,
    entryTimeEnd: bank ? cut : LIVE_GREEN_DNA.trap.entryTimeEnd,
    extras,
  };
}

/** Fetch 5m option candles for the resolved ATM tokens (Trade Desk parity). */
async function fetchOptionHistories(market, authorization, tokens, from, to) {
  const map = new Map();
  for (const token of tokens) {
    if (!token || map.has(token)) continue;
    try {
      map.set(token, await market.fetchHistorical5m(authorization, token, from, to));
    } catch (err) {
      // Missing/illiquid option history → live-path rejects (no estimate credit).
      map.set(token, []);
    }
  }
  return map;
}

/**
 * Two-pass index replay with live-path entry gates.
 */
async function replayIndexBook({
  market,
  authorization,
  fromDate,
  toDate,
  warmFrom,
  instruments,
  instrument,
  kind,
  lots,
  makeStrategy,
  livePath,
}) {
  const candles = await market.fetchHistorical5m(
    authorization,
    instrument.instrumentToken,
    warmFrom,
    toDate,
  );
  const base = {
    instrumentId: instrument.id,
    instrumentName: instrument.name,
    kind,
    candles,
    fromDate,
    toDate,
    instruments,
    forceCloseOpen: true,
    lotsMultiplier: lots,
    enableKutty: false,
    kuttyAlone: false,
    livePath,
  };
  const needed = new Set();
  replayPaperOnIndex({
    ...base,
    optionCandlesByToken: new Map(),
    neededOptionTokens: needed,
    strategy: makeStrategy(),
  });
  const optionCandles = await fetchOptionHistories(market, authorization, needed, fromDate, toDate);
  return replayPaperOnIndex({
    ...base,
    optionCandlesByToken: optionCandles,
    neededOptionTokens: new Set(),
    strategy: makeStrategy(),
  });
}

/**
 * Run a Paper backtest for [fromDate, toDate] with the given desk config.
 * Paper always applies live-path desk filter unless paperLivePath:false.
 */
async function runBacktest({ authorization, fromDate, toDate, config }, deps = {}) {
  if (!fromDate || !toDate || fromDate > toDate) {
    const err = new Error('Valid fromDate ≤ toDate (YYYY-MM-DD) required');
    err.status = 400;
    throw err;
  }
  const market = deps.market || defaultMarket;
  const cfg = normalizeStartConfig(config);
  const warmFrom = addDaysIso(fromDate, -LOOKBACK_DAYS);
  const instruments = deps.instruments || (await market.fetchInstruments(authorization));
  const useLivePath = cfg.paperLivePath !== false;
  const livePath = useLivePath
    ? livePathReplayOpts({
        rejectEstimatedPremium: true,
        fillFrictionPremium: cfg.fillFrictionPremium,
      })
    : null;

  const books = [];
  const rawTrades = [];

  if (cfg.enableNifty) {
    const replay = await replayIndexBook({
      market,
      authorization,
      fromDate,
      toDate,
      warmFrom,
      instruments,
      instrument: NIFTY_50_INSTRUMENT,
      kind: 'nifty',
      lots: cfg.niftyLots || 1,
      livePath,
      makeStrategy: () => {
        const s = createTrapStrategy();
        s.initialize(trapInitOverrides(cfg, NIFTY_50_INSTRUMENT.id));
        return s;
      },
    });
    rawTrades.push(...(replay.trades || []));
    books.push(bookSummary('Nifty Trap', replay));
  }

  if (cfg.enableBank) {
    const genie = cfg.bankStrategy === 'genie';
    const replay = await replayIndexBook({
      market,
      authorization,
      fromDate,
      toDate,
      warmFrom,
      instruments,
      instrument: BANK_NIFTY_INSTRUMENT,
      kind: 'banknifty',
      lots: cfg.bankLots || 1,
      livePath,
      makeStrategy: () => {
        const s = genie ? createGenieStrategy() : createTrapStrategy();
        if (genie) s.initialize();
        else s.initialize(trapInitOverrides(cfg, BANK_NIFTY_INSTRUMENT.id));
        return s;
      },
    });
    rawTrades.push(...(replay.trades || []));
    books.push(bookSummary(`Bank ${genie ? 'Genie' : 'Trap'}`, replay));
  }

  if (cfg.enableCrude) {
    const crudeFuture = resolveCrudeOilMiniFuturesToken(instruments);
    if (crudeFuture?.instrumentToken) {
      const candles = await market.fetchHistorical5m(
        authorization,
        crudeFuture.instrumentToken,
        warmFrom,
        toDate,
      );
      const profile = cfg.crudeStrategy || 'live-crude-green';
      const tradeParams = resolveCrudeStrategyProfile(profile);
      const dayLossStopPts = resolveCrudeProfileDayLossPts(tradeParams, !!cfg.strictDayStop);
      const crudeBase = {
        instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
        instrumentName: `Crude Mini (${crudeFuture.tradingSymbol || 'CRUDEOILM'})`,
        candles,
        fromDate,
        toDate,
        instruments,
        forceCloseOpen: true,
        lotsMultiplier: cfg.crudeLots || 1,
        dayLossStopPts,
        enableMorning: tradeParams.defaultEnableMorning,
        enableEvening: tradeParams.defaultEnableEvening,
        tradeParams,
      };
      const crudeNeeded = new Set();
      replayPaperOnCrude({ ...crudeBase, optionCandlesByToken: new Map(), neededOptionTokens: crudeNeeded });
      const crudeOpt = await fetchOptionHistories(market, authorization, crudeNeeded, fromDate, toDate);
      const replay = replayPaperOnCrude({
        ...crudeBase,
        optionCandlesByToken: crudeOpt,
        neededOptionTokens: new Set(),
      });
      rawTrades.push(...(replay.trades || []));
      books.push(
        bookSummary(
          tradeParams.profileId === 'selective' ? 'Crude Selective' : `Crude ${tradeParams.label}`,
          replay,
        ),
      );
    }
  }

  rawTrades.sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));

  // Desk-level Paper≡Live: one-leg across books + option-₹ day lock/stop.
  const allTrades = useLivePath
    ? filterTradesLivePath(rawTrades, {
        ...DEFAULT_LIVE_PATH,
        maxOpenLegs: cfg.maxOpenLegs != null ? cfg.maxOpenLegs : DEFAULT_LIVE_PATH.maxOpenLegs,
        dayProfitLockRs: cfg.dayProfitLock
          ? (cfg.dayProfitLockRs != null
              ? Number(cfg.dayProfitLockRs)
              : LIVE_GREEN_DNA.dayProfitLockRs || DAY_PROFIT_LOCK_RS) *
            Math.max(1, cfg.deskLots || cfg.niftyLots || 1)
          : 0,
        dayStopRs: cfg.strictDayStop
          ? STRICT_DAY_STOP_RS * Math.max(1, cfg.deskLots || cfg.niftyLots || 1)
          : 0,
        rejectEstimatedPremium: true,
        bankOnlyAfterNifty: cfg.bankOnlyAfterNifty === true,
        bankOnlyAfterNiftyGreen: cfg.bankOnlyAfterNiftyGreen === true,
        deskMaxTradesDay:
          cfg.deskMaxTradesDay != null
            ? cfg.deskMaxTradesDay
            : DEFAULT_LIVE_PATH.deskMaxTradesDay,
        deskGreenProtectRs:
          cfg.deskGreenProtectRs != null
            ? cfg.deskGreenProtectRs
            : DEFAULT_LIVE_PATH.deskGreenProtectRs,
        allowDirection: LIVE_GREEN_DNA.trap.allowDirection || DEFAULT_LIVE_PATH.allowDirection,
        entryTimeStart: LIVE_GREEN_DNA.trap.entryTimeStart || DEFAULT_LIVE_PATH.entryTimeStart,
        entryTimeEnd:
          LIVE_GREEN_DNA.trap.sessionCutTime ||
          LIVE_GREEN_DNA.trap.entryTimeEnd ||
          DEFAULT_LIVE_PATH.entryTimeEnd,
        sessionCutTime: LIVE_GREEN_DNA.trap.sessionCutTime || '',
        peSession: LIVE_GREEN_DNA.trap.peSession || null,
        deskHaltAfterRed: LIVE_GREEN_DNA.liveOps.deskHaltAfterRed === true,
        bankOnlyAfterNiftyGreen: LIVE_GREEN_DNA.liveOps.bankOnlyAfterNiftyGreen === true,
        peSessionOnlyIfNotGreen: LIVE_GREEN_DNA.liveOps.peSessionOnlyIfNotGreen === true,
        peSessionOnlyIfBelowRs: Number(LIVE_GREEN_DNA.liveOps.peSessionOnlyIfBelowRs) || 0,
      })
    : rawTrades;

  // Book rows from filtered desk trades (not raw overlapping fiction).
  const booksLive = books.map((b) => {
    const subset = allTrades.filter((t) => t.instrumentId === b.instrumentId);
    return {
      label: b.label,
      instrumentId: b.instrumentId,
      strategy: b.strategy,
      ...summarize(subset),
    };
  });

  return {
    fromDate,
    toDate,
    config: cfg,
    riskLabels: riskStatusLabels(cfg),
    paperLivePath: useLivePath,
    books: booksLive,
    totals: summarize(allTrades),
    rawTotals: useLivePath ? summarize(rawTrades) : undefined,
    dayStats: dayBreakdown(allTrades),
    trades: allTrades,
  };
}

module.exports = { runBacktest, summarize, dayBreakdown, addDaysIso };
