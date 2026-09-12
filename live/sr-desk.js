'use strict';
/**
 * Trade Bot desk = the walk-forward S/R engine (Nifty + Bank only).
 * Not the straddle desk. Paper ₹ is index points × lot (same unit as the
 * measured OOS window). Live still buys one ATM CE or PE.
 */
const defaultMarket = require('./kite-market');
const { runSrBreakout } = require('./sr-breakout');
const {
  exitOptsFor,
  LOT_UNITS,
  DAY_LOSS_STOP_RS,
  DAY_PROFIT_TARGET_RS,
  STRATEGY_ID,
  STRATEGY_VERSION,
} = require('./sr-strategy-config');

const ENGINE = 'sr-desk';
const CHARGE_RS = 20;

const BOOKS = {
  nifty: {
    id: 'nifty',
    key: 'nifty',
    name: 'Nifty 50',
    token: '256265',
    unitsPerLot: LOT_UNITS.nifty,
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' },
    entryPts: 27,
    gapLo: 100,
    gapHi: 175,
    targetByScore: { 1: 20, 2: 25, 3: 30 },
  },
  banknifty: {
    id: 'bank',
    key: 'banknifty',
    name: 'Bank Nifty',
    token: '260105',
    unitsPerLot: LOT_UNITS.banknifty,
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' },
    entryPts: 60,
    gapLo: 275,
    gapHi: 465,
    targetByScore: { 1: 40, 2: 50, 3: 60 },
  },
};

function shiftDays(iso, delta) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function summarize(trades) {
  let wins = 0;
  let losses = 0;
  let grossProfitRs = 0;
  let grossLossRs = 0;
  let net = 0;
  let pts = 0;
  for (const t of trades || []) {
    const n = Number(t.netOptionPnlRs) || 0;
    net += n;
    pts += Number(t.indexPoints) || 0;
    if (n > 0) {
      wins += 1;
      grossProfitRs += n;
    } else if (n < 0) {
      losses += 1;
      grossLossRs += Math.abs(n);
    }
  }
  const pf = grossLossRs > 0 ? grossProfitRs / grossLossRs : wins ? 99 : 0;
  return {
    trades: (trades || []).length,
    wins,
    losses,
    grossProfitRs: Math.round(grossProfitRs),
    grossLossRs: Math.round(grossLossRs),
    netRs: Math.round(net),
    optionNetRs: Math.round(net + CHARGE_RS * (trades || []).length),
    optionNetAfterChargesRs: Math.round(net),
    underlyingPoints: Math.round(pts * 100) / 100,
    profitFactor: Math.round(pf * 100) / 100,
    winRate: (trades || []).length ? Math.round((wins / trades.length) * 100) / 100 : 0,
    expectancyRs: (trades || []).length ? Math.round(net / trades.length) : 0,
  };
}

function mapTrade(t, book, lots, perPoint) {
  const pts = Number(t.points) || 0;
  const optionPnlRs = Math.round(pts * perPoint);
  const chargesRs = CHARGE_RS * Math.max(1, lots);
  const direction = t.option || (t.side === 'BUY' ? 'CE' : 'PE');
  const selectedInstrument = `${book.name} ATM ${direction}`;
  const entryPrice = t.entryPrice == null ? null : Number(t.entryPrice);
  const exitPrice = t.exitPrice == null ? null : Number(t.exitPrice);
  return {
    instrumentName: book.name,
    instrumentId: book.id,
    selectedInstrument,
    side: 'BUY',
    sideLabel: `${direction} BUY`,
    direction,
    optionSymbol: `${selectedInstrument} (index×lot)`,
    entryTime: `${t.date}T${t.entryTime || '09:45'}:00+0530`,
    exitTime: t.exitTime ? `${t.date}T${t.exitTime}:00+0530` : null,
    exitReason: t.exitReason,
    open: t.exitReason === 'CLOSE' && !!t.openAtFill,
    entryPrice,
    exitPrice,
    indexEntry: entryPrice,
    indexExit: exitPrice,
    indexPoints: pts,
    optionPnlRs,
    netOptionPnlRs: optionPnlRs - chargesRs,
    chargesRs,
    liveWouldTake: true,
    allocated: true,
    pnlSource: 'index_x_lot_sr',
    lots,
    spec: { engine: ENGINE, strategy: STRATEGY_ID, version: STRATEGY_VERSION },
  };
}

function instrumentRow(book, trades) {
  const tot = summarize(trades);
  return {
    id: book.id,
    instrumentName: book.name,
    status: tot.trades ? 'taken' : 'waiting',
    trades: tot.trades,
    wins: tot.wins,
    losses: tot.losses,
    grossProfitRs: tot.grossProfitRs,
    grossLossRs: tot.grossLossRs,
    netRs: tot.netRs,
    riskRs: DAY_LOSS_STOP_RS,
    why: tot.trades
      ? `Taken · ${book.name} S/R ×${trades[0]?.lots || 1}`
      : `No ${book.name} S/R print yet — waiting for a with-trend wall break.`,
  };
}

async function loadCandles(market, authorization, book, fromDate, toDate, deps) {
  if (deps.candlesByKey && Object.prototype.hasOwnProperty.call(deps.candlesByKey, book.key)) {
    return deps.candlesByKey[book.key] || [];
  }
  const warmupFrom = shiftDays(fromDate, -12);
  return market.fetchHistorical5m(authorization, book.token, warmupFrom, toDate, {
    chunkGapMs: deps.chunkGapMs ?? (deps.candlesByKey ? 0 : 3000),
  });
}

async function runSrDesk({ authorization, fromDate, toDate, lots, capitalRs }, deps = {}) {
  if (!fromDate || !toDate || fromDate > toDate) {
    const err = new Error('Valid fromDate ≤ toDate (YYYY-MM-DD) required');
    err.status = 400;
    throw err;
  }
  const L = Math.max(1, Math.floor(Number(lots)) || 1);
  const market = deps.market || defaultMarket;
  let kiteFunds = null;
  if (typeof market.fetchUserMargins === 'function' && authorization && !deps.candlesByKey) {
    try {
      kiteFunds = await market.fetchUserMargins(authorization);
    } catch {
      kiteFunds = null;
    }
  }
  const capital =
    Math.floor(Number(kiteFunds?.capitalRs) || 0) > 0
      ? Math.floor(Number(kiteFunds.capitalRs))
      : Math.max(10_000, Math.floor(Number(capitalRs)) || 40000);
  const booksOut = [];
  const allTrades = [];
  const keys = ['nifty', 'banknifty'];

  for (let i = 0; i < keys.length; i += 1) {
    if (i > 0 && !deps.candlesByKey) {
      await new Promise((r) => setTimeout(r, Number(deps.bookGapMs) || 3000));
    }
    const book = BOOKS[keys[i]];
    try {
      const candles = await loadCandles(market, authorization, book, fromDate, toDate, deps);
      const perPoint = book.unitsPerLot * L;
      const dayLossStop = DAY_LOSS_STOP_RS > 0 ? DAY_LOSS_STOP_RS / perPoint : 0;
      const dayProfitTarget = DAY_PROFIT_TARGET_RS > 0 ? DAY_PROFIT_TARGET_RS / perPoint : 0;
      const { trades } = runSrBreakout(candles || [], {
        entryPts: book.entryPts,
        trendBars: 20,
        gapLo: book.gapLo,
        gapHi: book.gapHi,
        targetByScore: book.targetByScore,
        maxTradesPerDay: 3,
        dayLossStop,
        dayProfitTarget,
        reportFromDate: fromDate,
        ...book.session,
        ...exitOptsFor(book.key, L),
      });
      const mapped = (trades || []).map((t) => mapTrade(t, book, L, perPoint));
      allTrades.push(...mapped);
      booksOut.push({
        id: book.id,
        label: book.name,
        sitOut: false,
        spec: { engine: ENGINE, strategy: STRATEGY_ID },
        specText: `${book.name} S/R ${STRATEGY_VERSION} · 1 ATM ${book.name === 'Nifty 50' ? 'CE/PE' : 'CE/PE'} · day ±₹${DAY_LOSS_STOP_RS}`,
        totals: summarize(mapped),
        trades: mapped,
        bars: Array.isArray(candles) ? candles.length : 0,
        status: mapped.length ? 'taken' : 'waiting',
        why: instrumentRow(book, mapped).why,
        token: book.token,
      });
    } catch (err) {
      booksOut.push({
        id: book.id,
        label: book.name,
        sitOut: true,
        error: err.message || String(err),
        totals: summarize([]),
        trades: [],
        status: 'off',
        why: `${book.name} failed to load: ${err.message || String(err)}`,
      });
    }
  }

  booksOut.push({
    id: 'crude',
    label: 'Crude Oil Mini',
    sitOut: true,
    spec: null,
    specText: 'Not on this desk',
    totals: summarize([]),
    trades: [],
    status: 'off',
    why: 'Crude is off. This desk is the measured S/R Nifty + Bank books only.',
  });

  allTrades.sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));
  const totals = summarize(allTrades);
  const taken = booksOut
    .filter((b) => b.id === 'nifty' || b.id === 'bank')
    .filter((b) => !b.sitOut)
    .map((b) => ({
      instrumentName: b.label,
      bookId: b.id,
      direction: 'SR-BREAK',
      lots: L,
      riskRs: DAY_LOSS_STOP_RS,
    }));

  return {
    fromDate,
    toDate,
    engine: ENGINE,
    strategy: STRATEGY_ID,
    strategyVersion: STRATEGY_VERSION,
    capitalRs: capital,
    kiteFunds,
    maxLots: L,
    allocation: { taken, trades: allTrades, totals },
    specText: taken.map((t) => `${t.instrumentName} S/R ×${t.lots}`).join(' · '),
    books: booksOut,
    coreBooks: booksOut.filter((b) => b.id === 'nifty' || b.id === 'bank' || b.id === 'crude'),
    note:
      'This desk trades only Nifty 50 and Bank Nifty (S/R wall-break, with-trend). No Crude, no stocks. Paper ₹ is index points × lot. Day brake ±₹3,500. Live buys one ATM CE or PE. Crude stays off.',
    instruments: booksOut
      .filter((b) => b.id === 'nifty' || b.id === 'bank')
      .map((b) => instrumentRow({ id: b.id, name: b.label }, b.trades || [])),
    protection: {
      fundsRs: capital,
      capitalRs: capital,
      riskPerTradeRs: Math.round(capital * 0.02),
      dayRiskRs: DAY_LOSS_STOP_RS,
      dayRiskUsedRs: Math.max(0, -Math.min(0, totals.netRs)),
      stillProtectedRs: Math.max(0, capital - DAY_LOSS_STOP_RS),
      protectedFloorRs: Math.max(0, capital - DAY_LOSS_STOP_RS),
      monthMtdRs: totals.netRs,
    },
    totals,
    liveTotals: totals,
    trades: allTrades,
    message: allTrades.length
      ? undefined
      : 'No S/R print in this window (need a with-trend wall break). Run 2 months on session days.',
  };
}

module.exports = {
  ENGINE,
  BOOKS,
  runSrDesk,
  mapTrade,
  summarize,
};
