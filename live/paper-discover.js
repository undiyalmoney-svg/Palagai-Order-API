'use strict';
/**
 * Paper desk — not Genie / Trap / S/R / Find / VWAP-impulse.
 *
 * Books: Nifty 50 + Bank Nifty 5m (Kite), Crude Oil Mini 5m (Kite MCX),
 * and liquid Nifty-100 cash (free NSE daily).
 *
 * Intraday family: opening-range fade OR hold (walk-forward picks per book).
 * Stocks: inside-day breakout on NSE daily.
 * A book that cannot show a walk-forward edge sits out (no forced trades).
 */

const defaultMarket = require('./kite-market');
const { fetchEquityDaily, mapPool } = require('./nse-equity-history');

const ENGINE = 'paper-desk';
const STRATEGY_FAMILY = 'or-desk-plus-inside-day';
const RETIRED_FAMILIES = ['session-vwap-impulse', 'vwap-impulse'];

const NIFTY_TOKEN = 256265;
const BANK_TOKEN = 260105;
const LOOKBACK_CAL_DAYS = 25;
const STOCK_LOOKBACK_CAL_DAYS = 90;
const CHARGE_RS = 20;
const MAX_STOCK_TRADES = 3;
const LIQUID_STOCKS = [
  'RELIANCE',
  'HDFCBANK',
  'ICICIBANK',
  'INFY',
  'TCS',
  'SBIN',
  'BHARTIARTL',
  'ITC',
  'LT',
  'AXISBANK',
  'KOTAKBANK',
  'HINDUNILVR',
];

const BOOKS = {
  nifty: {
    id: 'nifty',
    name: 'NIFTY 50',
    token: NIFTY_TOKEN,
    lotSize: 65,
    sessionStart: 915,
    sessionEnd: 1530,
    squareOff: 1515,
    lastEntry: 1415,
    orAnchor: 915,
    stopPts: [20, 35],
    minOrWidth: [15, 25],
  },
  bank: {
    id: 'bank',
    name: 'Bank Nifty',
    token: BANK_TOKEN,
    lotSize: 30,
    sessionStart: 915,
    sessionEnd: 1530,
    squareOff: 1515,
    lastEntry: 1415,
    orAnchor: 915,
    stopPts: [50, 90],
    minOrWidth: [40, 80],
  },
  crude: {
    id: 'crude',
    name: 'Crude Oil Mini',
    token: null,
    lotSize: 10,
    sessionStart: 1600,
    sessionEnd: 2130,
    squareOff: 2115,
    lastEntry: 2030,
    orAnchor: 1600,
    stopPts: [8, 14],
    minOrWidth: [6, 12],
  },
};

function addDaysIso(isoDate, delta) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function barDate(bar) {
  return String(bar?.date || bar?.entryTime || '').slice(0, 10);
}

function barHm(bar) {
  const s = String(bar?.date || '');
  const m = /T(\d{2}):(\d{2})/.exec(s);
  if (!m) return 0;
  return Number(m[1]) * 100 + Number(m[2]);
}

function hmPlus(hm, minutes) {
  const h = Math.floor(Number(hm) / 100);
  const m = Number(hm) % 100;
  const tot = h * 60 + m + Number(minutes);
  return Math.floor(tot / 60) * 100 + (tot % 60);
}

function inBookSession(bar, book) {
  const hm = barHm(bar);
  return hm >= book.sessionStart && hm <= book.sessionEnd;
}

function sessionBars(all, date, book) {
  return (all || []).filter((b) => barDate(b) === date && inBookSession(b, book));
}

function uniqueDates(bars, book) {
  const out = [];
  const seen = new Set();
  for (const b of bars || []) {
    const d = barDate(b);
    if (!d || seen.has(d) || !inBookSession(b, book)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

function specGrid(book = BOOKS.nifty) {
  const grid = [];
  for (const mode of ['fade', 'hold']) {
    for (const orMinutes of [15, 30]) {
      for (const bufferPts of [0, 5]) {
        for (const minOrWidth of book.minOrWidth) {
          for (const stopPts of book.stopPts) {
            for (const targetR of [1.5, 2]) {
              grid.push({
                engine: ENGINE,
                family: mode === 'fade' ? 'opening-range-failure' : 'opening-range-hold',
                mode,
                orMinutes,
                bufferPts,
                minOrWidth,
                stopPts,
                targetR,
                holdBars: 12,
              });
            }
          }
        }
      }
    }
  }
  return grid;
}

function openingRange(bars, spec, book) {
  const endHm = hmPlus(book.orAnchor, spec.orMinutes);
  const orBars = (bars || []).filter((b) => barHm(b) < endHm && barHm(b) >= book.orAnchor);
  if (orBars.length < 2) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const b of orBars) {
    high = Math.max(high, Number(b.high));
    low = Math.min(low, Number(b.low));
  }
  return { high, low, endHm, width: high - low };
}

function closeTrade(open, exitBar, reason, lots, book) {
  const L = Math.max(1, Math.floor(Number(lots)) || 1);
  const points = (Number(exitBar.close) - open.entryClose) * open.dir;
  const optionPnlRs = points * book.lotSize * L;
  const chargesRs = CHARGE_RS * L;
  const cepe = open.dir > 0 ? 'CE' : 'PE';
  return {
    instrumentName: book.name,
    instrumentId: book.id,
    side: 'BUY',
    direction: cepe,
    optionSymbol: `${book.name} ATM ${cepe} (proxy)`,
    entryTime: open.entryTime,
    exitTime: exitBar.date,
    exitReason: reason,
    indexEntry: open.entryClose,
    indexExit: Number(exitBar.close),
    indexPoints: Math.round(points * 100) / 100,
    optionPnlRs,
    netOptionPnlRs: optionPnlRs - chargesRs,
    chargesRs,
    liveWouldTake: true,
    pnlSource: 'index_x_lot',
    spec: open.spec,
  };
}

function simulateDay(dayBars, spec, lots, book) {
  const bars = dayBars || [];
  const or = openingRange(bars, spec, book);
  if (!or || !(or.width >= spec.minOrWidth)) return [];
  let broke = 0;
  let open = null;
  const trades = [];
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const hm = barHm(bar);
    if (open) {
      const held = i - open.entryIndex;
      const adverse = (open.entryClose - Number(bar.close)) * open.dir;
      const favor = (Number(bar.close) - open.entryClose) * open.dir;
      let reason = null;
      if (adverse >= spec.stopPts) reason = 'stop';
      else if (favor >= spec.stopPts * spec.targetR) reason = `${spec.targetR}R target`;
      else if (held >= spec.holdBars) reason = 'time stop';
      else if (hm >= book.squareOff) reason = `square-off ${book.squareOff}`;
      if (reason) {
        trades.push(closeTrade(open, bar, reason, lots, book));
        open = null;
        break;
      }
      continue;
    }
    if (hm < or.endHm || hm > book.lastEntry) continue;
    if (spec.mode === 'hold') {
      if (!broke) {
        if (Number(bar.close) > or.high + spec.bufferPts) broke = 1;
        else if (Number(bar.close) < or.low - spec.bufferPts) broke = -1;
        continue;
      }
      const held =
        (broke > 0 && Number(bar.close) > or.high) || (broke < 0 && Number(bar.close) < or.low);
      if (!held) {
        broke = 0;
        continue;
      }
      open = {
        dir: broke,
        spec,
        entryClose: Number(bar.close),
        entryTime: bar.date,
        entryIndex: i,
      };
      continue;
    }
    if (!broke) {
      if (Number(bar.close) > or.high + spec.bufferPts) broke = 1;
      else if (Number(bar.close) < or.low - spec.bufferPts) broke = -1;
      continue;
    }
    const failed =
      (broke > 0 && Number(bar.close) < or.high) || (broke < 0 && Number(bar.close) > or.low);
    if (!failed) continue;
    open = {
      dir: -broke,
      spec,
      entryClose: Number(bar.close),
      entryTime: bar.date,
      entryIndex: i,
    };
  }
  if (open && bars.length) {
    trades.push(closeTrade(open, bars[bars.length - 1], 'session end', lots, book));
  }
  return trades;
}

function simulate(bars, spec, { fromDate, toDate, lots, book } = {}) {
  const profile = book || BOOKS.nifty;
  const dates = uniqueDates(bars, profile).filter((d) => {
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });
  const trades = [];
  for (const d of dates) {
    trades.push(...simulateDay(sessionBars(bars, d, profile), spec, lots, profile));
  }
  return trades;
}

function summarize(trades) {
  let optionNetRs = 0;
  let optionNetAfterChargesRs = 0;
  let underlyingPoints = 0;
  let wins = 0;
  let losses = 0;
  let winRs = 0;
  let lossRs = 0;
  for (const t of trades || []) {
    const gross = Number(t.optionPnlRs) || 0;
    const net = Number(t.netOptionPnlRs) || 0;
    optionNetRs += gross;
    optionNetAfterChargesRs += net;
    underlyingPoints += Number(t.indexPoints) || 0;
    if (net > 0) {
      wins += 1;
      winRs += net;
    } else if (net < 0) {
      losses += 1;
      lossRs += Math.abs(net);
    }
  }
  const pf = lossRs > 0 ? winRs / lossRs : wins ? 99 : 0;
  return {
    trades: (trades || []).length,
    wins,
    losses,
    optionNetRs: Math.round(optionNetRs),
    optionNetAfterChargesRs: Math.round(optionNetAfterChargesRs),
    underlyingPoints: Math.round(underlyingPoints * 100) / 100,
    profitFactor: Math.round(pf * 100) / 100,
  };
}

function scoreTrades(trades) {
  const s = summarize(trades);
  if (s.trades < 5) return Number.NEGATIVE_INFINITY;
  if (s.profitFactor < 1.2) return Number.NEGATIVE_INFINITY;
  if (s.optionNetAfterChargesRs <= 0) return Number.NEGATIVE_INFINITY;
  return s.optionNetAfterChargesRs * Math.min(3, s.profitFactor) + s.wins * 15;
}

function scoreStockTrades(trades) {
  const s = summarize(trades);
  if (s.trades < 3) return Number.NEGATIVE_INFINITY;
  if (s.optionNetAfterChargesRs <= 0) return Number.NEGATIVE_INFINITY;
  return s.optionNetAfterChargesRs + s.wins * 10;
}

function searchSpecs(bars, { trainFrom, trainTo, lots, book } = {}) {
  const profile = book || BOOKS.nifty;
  const grid = specGrid(profile);
  let best = null;
  for (const spec of grid) {
    if (RETIRED_FAMILIES.includes(spec.family) || RETIRED_FAMILIES.includes(spec.engine)) continue;
    const trades = simulate(bars, spec, { fromDate: trainFrom, toDate: trainTo, lots, book: profile });
    const row = { spec, trades, totals: summarize(trades), score: scoreTrades(trades) };
    if (!best || row.score > best.score) best = row;
  }
  if (!best || !Number.isFinite(best.score)) return { spec: null, totals: summarize([]), sitOut: true };
  return { ...best, sitOut: false };
}

function describeSpec(spec, book) {
  if (!spec) return `${book?.name || 'book'} sit-out (no walk-forward edge)`;
  const kind = spec.mode === 'hold' ? 'OR hold' : 'OR failure fade';
  return (
    `${book?.name || ''} ${kind} · ${spec.orMinutes}m, buffer ${spec.bufferPts}pt, ` +
    `stop ${spec.stopPts}pt, ${spec.targetR}R`
  ).trim();
}

function isInsideDay(inside, older) {
  return Number(inside.high) <= Number(older.high) && Number(inside.low) >= Number(older.low);
}

function simulateInsideDay(bars, spec, { fromDate, toDate, lots, symbol } = {}) {
  const L = Math.max(1, Math.floor(Number(lots)) || 1);
  const rows = (bars || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const trades = [];
  for (let i = 2; i < rows.length; i += 1) {
    const day = rows[i];
    const d = String(day.date).slice(0, 10);
    if (fromDate && d < fromDate) continue;
    if (toDate && d > toDate) continue;
    const inside = rows[i - 1];
    const older = rows[i - 2];
    if (!isInsideDay(inside, older)) continue;
    let dir = 0;
    if (Number(day.close) > Number(inside.high)) dir = 1;
    else if (Number(day.close) < Number(inside.low)) dir = -1;
    if (!dir) continue;
    const entry = dir > 0 ? Number(inside.high) : Number(inside.low);
    const stop = dir > 0 ? Number(inside.low) : Number(inside.high);
    const risk = Math.abs(entry - stop);
    if (!(risk >= (spec.minRisk || 1))) continue;
    const target = entry + dir * risk * (spec.targetR || 1.5);
    let exit = Number(day.close);
    let reason = 'close';
    if (dir > 0 && Number(day.low) <= stop) {
      exit = stop;
      reason = 'stop';
    } else if (dir < 0 && Number(day.high) >= stop) {
      exit = stop;
      reason = 'stop';
    } else if (dir > 0 && Number(day.high) >= target) {
      exit = target;
      reason = `${spec.targetR}R target`;
    } else if (dir < 0 && Number(day.low) <= target) {
      exit = target;
      reason = `${spec.targetR}R target`;
    }
    const points = (exit - entry) * dir;
    const optionPnlRs = points * L;
    const chargesRs = Math.max(1, Math.round(Math.abs(entry) * L * 0.001));
    trades.push({
      instrumentName: symbol || 'STOCK',
      instrumentId: 'stock',
      side: 'BUY',
      direction: dir > 0 ? 'LONG' : 'SHORT',
      optionSymbol: symbol,
      entryTime: `${d}T15:15:00+0530`,
      exitTime: `${d}T15:30:00+0530`,
      exitReason: reason,
      indexEntry: entry,
      indexExit: exit,
      indexPoints: Math.round(points * 100) / 100,
      optionPnlRs,
      netOptionPnlRs: optionPnlRs - chargesRs,
      chargesRs,
      liveWouldTake: true,
      pnlSource: 'cash_shares',
      spec,
    });
  }
  return trades;
}

function searchInsideDay(bars, { trainFrom, trainTo, lots, symbol } = {}) {
  const grid = [
    { engine: ENGINE, family: 'inside-day', targetR: 1.5, minRisk: 2 },
    { engine: ENGINE, family: 'inside-day', targetR: 2, minRisk: 2 },
    { engine: ENGINE, family: 'inside-day', targetR: 1.5, minRisk: 5 },
  ];
  let best = null;
  for (const spec of grid) {
    const trades = simulateInsideDay(bars, spec, {
      fromDate: trainFrom,
      toDate: trainTo,
      lots,
      symbol,
    });
    const row = { spec, trades, totals: summarize(trades), score: scoreStockTrades(trades), symbol };
    if (!best || row.score > best.score) best = row;
  }
  if (!best || !Number.isFinite(best.score)) return { spec: null, sitOut: true, totals: summarize([]), symbol };
  return { ...best, sitOut: false };
}

function pickCrudeMiniToken(instruments) {
  const rows = Array.isArray(instruments) ? instruments : [];
  const futs = [];
  for (const row of rows) {
    const sym = String(row.tradingSymbol || '').toUpperCase();
    const type = String(row.instrumentType || '').toUpperCase();
    const ex = String(row.exchange || row.segment || '').toUpperCase();
    if (!/^CRUDEOILM/.test(sym) || type !== 'FUT') continue;
    if (ex && !/MCX/.test(ex)) continue;
    futs.push({
      token: Number(row.instrumentToken) || 0,
      symbol: sym,
      expiry: String(row.expiry || ''),
    });
  }
  futs.sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));
  return futs.find((f) => f.token > 0) || null;
}

async function loadBookCandles(market, authorization, book, warmFrom, toDate, deps) {
  if (deps.candlesByBook && Object.prototype.hasOwnProperty.call(deps.candlesByBook, book.id)) {
    return deps.candlesByBook[book.id];
  }
  let token = book.token;
  let symbol = book.name;
  if (book.id === 'crude') {
    const instruments = deps.instruments || (await market.fetchInstruments(authorization));
    const fut = pickCrudeMiniToken(instruments);
    if (!fut) throw new Error('No CRUDEOILM future on the Kite MCX list');
    token = fut.token;
    symbol = fut.symbol;
  }
  const candles = await market.fetchHistorical5m(authorization, token, warmFrom, toDate);
  return { candles, token, symbol };
}

async function loadStocks(fromDate, toDate, lots, deps) {
  if (deps.stockSeries) return deps.stockSeries;
  const symbols = LIQUID_STOCKS;
  const series = await mapPool(symbols, 3, async (symbol) => {
    try {
      const out = await fetchEquityDaily({ symbol, fromDate, toDate });
      return { symbol, historical: out.historical || [], error: null };
    } catch (err) {
      return { symbol, historical: [], error: err.message || String(err) };
    }
  });
  return series;
}


async function runDiscover({ authorization, fromDate, toDate, lots }, deps = {}) {
  if (!fromDate || !toDate || fromDate > toDate) {
    const err = new Error('Valid fromDate ≤ toDate (YYYY-MM-DD) required');
    err.status = 400;
    throw err;
  }
  const market = deps.market || defaultMarket;
  const L = Math.max(1, Math.floor(Number(lots)) || 1);
  const warmFrom = addDaysIso(fromDate, -LOOKBACK_CAL_DAYS);
  const trainTo = addDaysIso(fromDate, -1);
  const stockFrom = addDaysIso(fromDate, -STOCK_LOOKBACK_CAL_DAYS);

  const bookIds = ['nifty', 'bank', 'crude'];
  const books = [];
  const allTrades = [];

  for (const id of bookIds) {
    const book = BOOKS[id];
    try {
      const loaded = await loadBookCandles(market, authorization, book, warmFrom, toDate, deps);
      const candles = loaded.candles || loaded;
      const found = searchSpecs(candles, { trainFrom: warmFrom, trainTo, lots: L, book });
      const trades = found.sitOut
        ? []
        : simulate(candles, found.spec, { fromDate, toDate, lots: L, book });
      books.push({
        id: book.id,
        label: book.name,
        vehicle: loaded.symbol || book.name,
        sitOut: !!found.sitOut,
        spec: found.spec,
        specText: describeSpec(found.spec, book),
        train: found.totals,
        trainTrades: found.trades || [],
        totals: summarize(trades),
        trades,
        data: 'kite-5m',
      });
      allTrades.push(...trades);
    } catch (err) {
      books.push({
        id: book.id,
        label: book.name,
        sitOut: true,
        error: err.message || String(err),
        totals: summarize([]),
        trades: [],
      });
    }
  }

  let stockNote = '';
  try {
    const series = await loadStocks(stockFrom, toDate, L, deps);
    const ranked = [];
    for (const row of series) {
      if (!row.historical || row.historical.length < 30) continue;
      const found = searchInsideDay(row.historical, {
        trainFrom: stockFrom,
        trainTo,
        lots: L,
        symbol: row.symbol,
      });
      if (found.sitOut) continue;
      const trades = simulateInsideDay(row.historical, found.spec, {
        fromDate,
        toDate,
        lots: L,
        symbol: row.symbol,
      });
      ranked.push({
        ...found,
        trainTrades: found.trades,
        trades,
        totals: summarize(trades),
      });
    }
    ranked.sort((a, b) => b.score - a.score);
    const taken = ranked.filter((r) => r.trades.length).slice(0, MAX_STOCK_TRADES);
    const stockTrades = [];
    for (const row of taken) stockTrades.push(...row.trades);
    books.push({
      id: 'stocks',
      label: 'Nifty 100 cash (liquid)',
      sitOut: taken.length === 0,
      specText: taken.length
        ? taken.map((r) => `${r.symbol} inside-day ${r.spec.targetR}R`).join(', ')
        : 'sit-out (no walk-forward edge on liquid names)',
      train: summarize(ranked.flatMap((r) => r.trainTrades || [])),
      trainTrades: ranked.flatMap((r) => r.trainTrades || []),
      totals: summarize(stockTrades),
      trades: stockTrades,
      data: 'nse-daily',
      scanned: series.length,
    });
    allTrades.push(...stockTrades);
  } catch (err) {
    stockNote = err.message || String(err);
    books.push({
      id: 'stocks',
      label: 'Nifty 100 cash (liquid)',
      sitOut: true,
      error: stockNote,
      totals: summarize([]),
      trades: [],
    });
  }

  allTrades.sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));
  const totals = summarize(allTrades);
  const active = books.filter((b) => !b.sitOut && (b.totals?.trades || 0) > 0);

  return {
    fromDate,
    toDate,
    engine: ENGINE,
    strategy: STRATEGY_FAMILY,
    skipped: RETIRED_FAMILIES,
    specText: active.map((b) => b.specText).filter(Boolean).join(' · ') || 'Desk sat out',
    books,
    train: {
      fromDate: warmFrom,
      toDate: trainTo,
      totals: summarize(books.flatMap((b) => b.trainTrades || [])),
    },
    note:
      'Desk (not Genie): Nifty + Bank + Crude Mini on Kite 5m, plus liquid Nifty-100 stocks on free NSE daily. Each book walk-forwards OR-fade vs OR-hold (stocks: inside-day). No edge in the lookback → that book sits out. ₹ for index/crude = points × lot units × lots (ATM/fut proxy). Stock ₹ = rupee move × lots. Live money is not attached yet.',
    totals,
    liveTotals: totals,
    trades: allTrades.map((t) => ({ ...t, liveWouldTake: true })),
    message: allTrades.length
      ? undefined
      : 'No book had a qualified setup on this date (weekend, sit-out, or no OR/inside-day). Pick a session day.',
  };
}

module.exports = {
  ENGINE,
  STRATEGY_FAMILY,
  RETIRED_FAMILIES,
  BOOKS,
  NIFTY_TOKEN,
  BANK_TOKEN,
  LIQUID_STOCKS,
  addDaysIso,
  specGrid,
  simulate,
  simulateInsideDay,
  summarize,
  searchSpecs,
  searchInsideDay,
  runDiscover,
  describeSpec,
  pickCrudeMiniToken,
};
