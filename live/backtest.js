/**
 * Server-side Paper backtest — Trade Desk parity.
 *
 * Replays the SAME strategy engine (strategy-core.cjs) over a From→To date
 * range and returns closed trades + P&L totals, so the Auto Bot "Paper" mode
 * shows the same results table the browser Trade Desk shows — but computed on
 * the DigitalOcean backend.
 *
 * Read-only: fetches historical candles via kite-market; never places orders.
 * The data provider is injectable (`deps.market`) so it can be unit-tested
 * without a live Kite session.
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
} = require('./daily-desk-defaults');

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
  return (
    indexDayRiskOverrides({
      instrumentId,
      enableNifty: !!cfg.enableNifty,
      enableBank: !!cfg.enableBank,
      dayProfitLock: !!cfg.dayProfitLock,
      strictDayStop: !!cfg.strictDayStop,
    }) || {}
  );
}

/**
 * Run a Paper backtest for [fromDate, toDate] with the given desk config.
 * @param {{authorization:string, fromDate:string, toDate:string, config:object}} args
 * @param {{market?:object, instruments?:Array}} [deps]
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
  const emptyOpt = new Map();
  const needed = new Set();

  const books = [];
  const allTrades = [];

  if (cfg.enableNifty) {
    const candles = await market.fetchHistorical5m(
      authorization,
      NIFTY_50_INSTRUMENT.instrumentToken,
      warmFrom,
      toDate,
    );
    const strategy = createTrapStrategy();
    strategy.initialize(trapInitOverrides(cfg, NIFTY_50_INSTRUMENT.id));
    const replay = replayPaperOnIndex({
      instrumentId: NIFTY_50_INSTRUMENT.id,
      instrumentName: NIFTY_50_INSTRUMENT.name,
      kind: 'nifty',
      candles,
      fromDate,
      toDate,
      instruments,
      optionCandlesByToken: emptyOpt,
      neededOptionTokens: needed,
      forceCloseOpen: true,
      lotsMultiplier: cfg.niftyLots || 1,
      strategy,
      enableKutty: false,
      kuttyAlone: false,
    });
    allTrades.push(...(replay.trades || []));
    books.push(bookSummary('Nifty Trap', replay));
  }

  if (cfg.enableBank) {
    const candles = await market.fetchHistorical5m(
      authorization,
      BANK_NIFTY_INSTRUMENT.instrumentToken,
      warmFrom,
      toDate,
    );
    const genie = cfg.bankStrategy === 'genie';
    const strategy = genie ? createGenieStrategy() : createTrapStrategy();
    if (genie) strategy.initialize();
    else strategy.initialize(trapInitOverrides(cfg, BANK_NIFTY_INSTRUMENT.id));
    const replay = replayPaperOnIndex({
      instrumentId: BANK_NIFTY_INSTRUMENT.id,
      instrumentName: BANK_NIFTY_INSTRUMENT.name,
      kind: 'banknifty',
      candles,
      fromDate,
      toDate,
      instruments,
      optionCandlesByToken: emptyOpt,
      neededOptionTokens: needed,
      forceCloseOpen: true,
      lotsMultiplier: cfg.bankLots || 1,
      strategy,
      enableKutty: false,
      kuttyAlone: false,
    });
    allTrades.push(...(replay.trades || []));
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
      const profile = cfg.crudeStrategy === 'all-green' ? 'all-green' : 'selective';
      const tradeParams = resolveCrudeStrategyProfile(profile);
      const dayLossStopPts = resolveCrudeProfileDayLossPts(tradeParams, !!cfg.strictDayStop);
      const replay = replayPaperOnCrude({
        instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
        instrumentName: `Crude Mini (${crudeFuture.tradingSymbol || 'CRUDEOILM'})`,
        candles,
        fromDate,
        toDate,
        instruments,
        optionCandlesByToken: emptyOpt,
        neededOptionTokens: needed,
        forceCloseOpen: true,
        lotsMultiplier: cfg.crudeLots || 1,
        dayLossStopPts,
        enableMorning: tradeParams.defaultEnableMorning,
        enableEvening: tradeParams.defaultEnableEvening,
        tradeParams,
      });
      allTrades.push(...(replay.trades || []));
      books.push(bookSummary(tradeParams.profileId === 'selective' ? 'Crude Selective' : `Crude ${tradeParams.label}`, replay));
    }
  }

  allTrades.sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));

  return {
    fromDate,
    toDate,
    config: cfg,
    riskLabels: riskStatusLabels(cfg),
    books,
    totals: summarize(allTrades),
    dayStats: dayBreakdown(allTrades),
    trades: allTrades,
  };
}

module.exports = { runBacktest, summarize, dayBreakdown, addDaysIso };
