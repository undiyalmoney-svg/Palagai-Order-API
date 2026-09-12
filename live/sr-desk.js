'use strict';
/**
 * Trade Bot desk = the walk-forward S/R engine (Nifty + Bank only).
 * Not the straddle desk. Paper ₹ is index points × lot (same unit as the
 * measured OOS window). Live still buys one ATM CE or PE.
 */
const { blackScholesPrice, realizedVolAnnualized } = require('./bs-option-pricer');
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
    strikeStep: 50,
    iv: 0.14,
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
    strikeStep: 100,
    iv: 0.18,
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

function atmStrike(price, step) {
  const px = Number(price);
  const st = Number(step);
  if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(st) || st <= 0) return null;
  return Math.round(px / st) * st;
}

function padClock(hm) {
  const s = String(hm || '').trim();
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) {
    const [h, m, sec] = s.split(':');
    return `${String(h).padStart(2, '0')}:${m}:${sec}`;
  }
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(':');
    return `${String(h).padStart(2, '0')}:${m}:00`;
  }
  return '';
}

function formatClock12(hm) {
  const clock = padClock(hm);
  const m = clock.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return clock || null;
  let hour = Number(m[1]);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${hour}:${m[2]}:${m[3]} ${ampm}`;
}

function toIstIso(date, hm) {
  const clock = padClock(hm);
  if (!date || !clock) return null;
  return `${date}T${clock}+0530`;
}

function clockFromStamp(stamp, hmFallback) {
  const s = String(stamp || '');
  const full = s.match(/T(\d{2}):(\d{2}):(\d{2})/) || s.match(/[ T](\d{2}):(\d{2}):(\d{2})/);
  if (full) return `${full[1]}:${full[2]}:${full[3]}`;
  return padClock(hmFallback);
}

function asIstIso(stamp, date, hm) {
  const s = String(stamp || '');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    return s.replace(/\+05:30$/, '+0530');
  }
  return toIstIso(date, hm);
}

/** Next Tuesday after `iso` (skip same-day expiry, matching live). */
function nextWeeklyExpiry(iso) {
  const [y, mo, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !mo || !d) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  let add = (2 - dt.getUTCDay() + 7) % 7;
  if (add === 0) add = 7;
  dt.setUTCDate(dt.getUTCDate() + add);
  return dt.toISOString().slice(0, 10);
}

function yearFracRemaining(dateIso, hm, expiryIso) {
  const clock = padClock(hm) || '09:45:00';
  const start = Date.parse(`${dateIso}T${clock}+05:30`);
  const end = Date.parse(`${expiryIso}T15:30:00+05:30`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 3 / 365.25;
  const days = Math.max(0.02, (end - start) / 86400000);
  return days / 365.25;
}

function dailyCloses(candles) {
  const byDay = new Map();
  for (const c of candles || []) {
    const day = String(c.date || '').slice(0, 10);
    const px = Number(c.close);
    if (day && px > 0) byDay.set(day, px);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map((row) => row[1]);
}

function mapTrade(t, book, lots, perPoint, vol) {
  const pts = Number(t.points) || 0;
  const optionPnlRs = Math.round(pts * perPoint);
  const chargesRs = CHARGE_RS * Math.max(1, lots);
  const direction = t.option || (t.side === 'BUY' ? 'CE' : 'PE');
  const indexEntry = t.entryPrice == null ? null : Number(t.entryPrice);
  const indexExit = t.exitPrice == null ? null : Number(t.exitPrice);
  const optionStrike = atmStrike(indexEntry, book.strikeStep || (book.id === 'bank' ? 100 : 50));
  const selectedInstrument =
    optionStrike != null ? `${book.name} ${optionStrike} ${direction}` : `${book.name} ATM ${direction}`;
  const entryHm = clockFromStamp(t.entryAt, t.entryHm || t.entryTime || '09:45');
  const exitHm = t.exitAt || t.exitTime || t.exitHm ? clockFromStamp(t.exitAt, t.exitHm || t.exitTime) : '';
  const expiry = nextWeeklyExpiry(t.date);
  const iv = Number(vol) > 0 ? Number(vol) : Number(book.iv) || 0.14;
  let optionEntryPremium = null;
  let optionExitPremium = null;
  if (indexEntry != null && optionStrike != null && expiry) {
    optionEntryPremium = blackScholesPrice(
      indexEntry,
      optionStrike,
      yearFracRemaining(t.date, entryHm, expiry),
      iv,
      0.065,
      direction,
    );
    if (indexExit != null && exitHm) {
      optionExitPremium = blackScholesPrice(
        indexExit,
        optionStrike,
        yearFracRemaining(t.date, exitHm, expiry),
        iv,
        0.065,
        direction,
      );
    }
  }
  return {
    instrumentName: book.name,
    instrumentId: book.id,
    selectedInstrument,
    optionStrike,
    side: 'BUY',
    sideLabel: `${direction} BUY`,
    direction,
    optionSymbol: `${selectedInstrument} (index×lot)`,
    entryHm,
    exitHm: exitHm || null,
    entryClock: formatClock12(entryHm),
    exitClock: exitHm ? formatClock12(exitHm) : null,
    entryTime: asIstIso(t.entryAt, t.date, entryHm),
    exitTime: exitHm ? asIstIso(t.exitAt, t.date, exitHm) : null,
    exitReason: t.exitReason,
    open: t.exitReason === 'CLOSE' && !!t.openAtFill,
    entryPrice: optionEntryPremium,
    exitPrice: optionExitPremium,
    optionEntryPremium,
    optionExitPremium,
    indexEntry,
    indexExit,
    expiry,
    premiumSource: optionEntryPremium != null ? 'bs_atm_weekly' : null,
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
      const closes = dailyCloses(candles);
      const iv = realizedVolAnnualized(closes, closes.length - 1, 20);
      const mapped = (trades || []).map((t) => mapTrade(t, book, L, perPoint, iv));
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
      'This desk trades only Nifty 50 and Bank Nifty (S/R wall-break, with-trend). No Crude, no stocks. Paper ₹ is index points × lot. Entry/exit prices are the ATM weekly option premium (modeled), not the index. Day brake ±₹3,500. Live buys one ATM CE or PE. Crude stays off.',
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
  atmStrike,
  nextWeeklyExpiry,
  formatClock12,
  summarize,
};
