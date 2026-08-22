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
  createTrapStrategyV2,
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
const { LIVE_GREEN_DNA, liveGreenTrapExtras, clampMaxTradesToDna } = require('./dna-live-green');
const {
  filterTradesLivePath,
  livePathReplayOpts,
  DEFAULT_LIVE_PATH,
} = require('./live-path');
const { archiveInstruments, instrumentsWithArchive } = require('./instrument-archive');

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
  let underlyingPoints = 0;
  const pointsByInstrument = {};
  let underlyingPointWins = 0;
  let underlyingPointLosses = 0;
  let optionMarkedTrades = 0;
  let underlyingFallbackTrades = 0;
  let wins = 0;
  let losses = 0;
  for (const t of trades) {
    const gross = t.optionPnlRs != null ? t.optionPnlRs : 0;
    const net = tradeNetRs(t);
    optionNetRs += gross;
    optionNetAfterChargesRs += net;
    const points = Number(t.indexPoints) || 0;
    underlyingPoints += points;
    if (points > 0) underlyingPointWins += 1;
    else if (points < 0) underlyingPointLosses += 1;
    const instrumentId = String(t.instrumentId || 'other');
    pointsByInstrument[instrumentId] = (pointsByInstrument[instrumentId] || 0) + points;
    if (t.optionPnlRs != null) optionMarkedTrades += 1;
    else underlyingFallbackTrades += 1;
    if (net > 0) wins += 1;
    else if (net < 0) losses += 1;
  }
  return {
    trades: trades.length,
    wins,
    losses,
    optionNetRs: round0(optionNetRs),
    optionNetAfterChargesRs: round0(optionNetAfterChargesRs),
    // Underlying proxy is intentionally separate from option net P&L.
    // It is useful for strategy research when option history is unavailable.
    underlyingPoints: round0(underlyingPoints * 100) / 100,
    underlyingPointsByInstrument: Object.fromEntries(
      Object.entries(pointsByInstrument).map(([id, points]) => [id, round0(points * 100) / 100]),
    ),
    underlyingPointWins,
    underlyingPointLosses,
    optionMarkedTrades,
    underlyingFallbackTrades,
  };
}

function dayBreakdown(trades) {
  const byDate = new Map();
  for (const t of trades) {
    const date = tradeDateOf(t.entryTime);
    const row = byDate.get(date) || {
      date,
      trades: 0,
      optionNetRs: 0,
      underlyingPoints: 0,
      optionMarkedTrades: 0,
      underlyingFallbackTrades: 0,
    };
    row.trades += 1;
    row.optionNetRs += tradeNetRs(t);
    row.underlyingPoints += Number(t.indexPoints) || 0;
    if (t.optionPnlRs != null) row.optionMarkedTrades += 1;
    else row.underlyingFallbackTrades += 1;
    byDate.set(date, row);
  }
  return [...byDate.values()]
    .map((r) => ({
      ...r,
      optionNetRs: round0(r.optionNetRs),
      underlyingPoints: round0(r.underlyingPoints * 100) / 100,
    }))
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
  const extras = liveGreenTrapExtras();
  if (cfg.optionStandDownRs != null) {
    extras.optionStandDownRs = Number(cfg.optionStandDownRs);
  }
  const bank = /bank/i.test(String(instrumentId || ''));
  const fromUi = bank ? cfg.bankMaxTradesDay : cfg.niftyMaxTradesDay;
  // Same ceiling as live (clampMaxTradesToDna) so backtests can never model a
  // looser trade budget than the desk will actually permit.
  return {
    ...risk,
    maxTradesPerDay: clampMaxTradesToDna(fromUi),
    targetRMultiple: LIVE_GREEN_DNA.trap.targetRMultiple,
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
  // Keep signals visible when historical option candles are absent.  They are
  // returned separately as underlying-proxy trades and never contribute to
  // option net P&L or the executable/live-path totals.
  const useUnderlyingFallback = config?.underlyingFallback !== false;
  const warmFrom = addDaysIso(fromDate, -LOOKBACK_DAYS);
  let instruments = deps.instruments || (await market.fetchInstruments(authorization));
  if (!deps.instruments) {
    // Seed today's snapshot into the archive, then resolve ATM options
    // against live+archived rows so past-but-since-expired weeklies inside
    // [fromDate, toDate] can still be matched by real expiry date (see
    // instrument-archive.js — resolveAtmWeeklyOption already filters by
    // expiry-vs-asOfDay, it just needs the historical row to be present).
    await archiveInstruments(instruments).catch(() => {});
    instruments = await instrumentsWithArchive(instruments);
  }
  const useLivePath = cfg.paperLivePath !== false;
  const livePath = useLivePath
    ? livePathReplayOpts({
        rejectEstimatedPremium: !useUnderlyingFallback,
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
        const s = createTrapStrategyV2();
        s.initialize(trapInitOverrides(cfg, NIFTY_50_INSTRUMENT.id));
        return s;
      },
    });
    rawTrades.push(...(replay.trades || []));
    books.push(bookSummary('Nifty Trap V2', replay));
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
      let tradeParams = resolveCrudeStrategyProfile(profile);
      if (profile === 'live-crude-green') {
        const { liveCrudeGreenProfileOverrides } = require('./dna-live-crude-green');
        tradeParams = { ...tradeParams, ...liveCrudeGreenProfileOverrides() };
      }
      if (cfg.crudeMaxTradesDay != null) {
        tradeParams.maxEveningTradesDay = Math.max(
          0,
          Math.floor(Number(cfg.crudeMaxTradesDay)) || 0,
        );
      }
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

  // Executable Paper≡Live totals: reject missing/synthetic option marks.
  const executableTrades = useLivePath
    ? filterTradesLivePath(rawTrades, {
        ...DEFAULT_LIVE_PATH,
        maxOpenLegs: cfg.maxOpenLegs != null ? cfg.maxOpenLegs : DEFAULT_LIVE_PATH.maxOpenLegs,
        dayProfitLockRs: cfg.dayProfitLock ? DAY_PROFIT_LOCK_RS : 0,
        dayStopRs: cfg.strictDayStop ? STRICT_DAY_STOP_RS : 0,
        rejectEstimatedPremium: true,
        bankOnlyAfterNifty:
          cfg.bankOnlyAfterNifty != null
            ? !!cfg.bankOnlyAfterNifty
            : LIVE_GREEN_DNA.liveOps.bankOnlyAfterNifty === true,
        bankOnlyAfterNiftyGreen:
          cfg.bankOnlyAfterNiftyGreen != null
            ? !!cfg.bankOnlyAfterNiftyGreen
            : LIVE_GREEN_DNA.liveOps.bankOnlyAfterNiftyGreen === true,
        winStreakToBand:
          cfg.winStreakToBand != null
            ? !!cfg.winStreakToBand
            : LIVE_GREEN_DNA.liveOps.winStreakToBand === true,
        indexFirstWinLock:
          cfg.indexFirstWinLock != null
            ? !!cfg.indexFirstWinLock
            : LIVE_GREEN_DNA.liveOps.indexFirstWinLock === true,
        deskGreenLockRs:
          cfg.deskGreenLockRs != null
            ? Number(cfg.deskGreenLockRs)
            : Number(LIVE_GREEN_DNA.liveOps.deskGreenLockRs) || 0,
        recoveryMaxExtra:
          cfg.recoveryMaxExtra != null
            ? Number(cfg.recoveryMaxExtra)
            : LIVE_GREEN_DNA.liveOps.recoveryMaxExtra ?? 0,
        dustTradeRs:
          cfg.dustTradeRs != null
            ? Number(cfg.dustTradeRs)
            : LIVE_GREEN_DNA.liveOps.dustTradeRs ?? 0,
      })
    : rawTrades;

  // The same strategy replay can retain missing-option trades as an
  // underlying-candle research record. Do not mix these proxy values with
  // actual option P&L, charges, or broker-comparable totals.
  const underlyingFallbackTrades = useUnderlyingFallback
    ? rawTrades.filter((t) => t.pnlSource === 'underlying_proxy')
    : [];

  // Book rows from filtered desk trades (not raw overlapping fiction).
  const booksLive = books.map((b) => {
    const subset = executableTrades.filter((t) => t.instrumentId === b.instrumentId);
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
    totals: summarize(executableTrades),
    rawTotals: useLivePath ? summarize(rawTrades) : undefined,
    dayStats: dayBreakdown(executableTrades),
    trades: executableTrades,
    underlyingFallback: {
      enabled: useUnderlyingFallback,
      note:
        'Underlying-candle points only; it is not option P&L, net P&L, rupees, or a live-executable result.',
      totals: summarize(underlyingFallbackTrades),
      dayStats: dayBreakdown(underlyingFallbackTrades),
      trades: underlyingFallbackTrades,
    },
  };
}

module.exports = { runBacktest, summarize, dayBreakdown, addDaysIso };
