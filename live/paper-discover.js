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
 * After the scan, capital allocates: 2% stop per trade, 4% day stop, max two
 * books. Stops cap at 1R, fade skips wide ORs, stale 5-session edges sit out.
 */

const defaultMarket = require('./kite-market');
const { fetchEquityDaily, fetchNifty100Symbols, mapPool } = require('./nse-equity-history');

const ENGINE = 'paper-desk';
const STRATEGY_FAMILY = 'or-desk-plus-inside-day';
const RETIRED_FAMILIES = ['session-vwap-impulse', 'vwap-impulse'];

const NIFTY_TOKEN = 256265;
const BANK_TOKEN = 260105;
const LOOKBACK_CAL_DAYS = 25;
const STOCK_LOOKBACK_CAL_DAYS = 90;
const CHARGE_RS = 20;
const MAX_STOCK_TRADES = 2;
const MAX_STOCK_SCAN = 30;
const MAX_FUNDED_TRADES = 2;
const DEFAULT_CAPITAL_RS = 40000;
const RISK_PER_TRADE_PCT = 0.02;
const DAY_RISK_PCT = 0.04;
const STOCK_NAME_CAPITAL_FRAC = 0.25;
const MIN_INDEX_TRAIN_PF = 1.5;
const MIN_STOCK_TRAIN_PF = 1.2;
const MIN_WIN_RATE = 0.4;
const RECENT_SESSIONS = 5;
const BE_R = 0.75;
const FADE_OR_STOP_MULT = 2.2;
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
            for (const targetR of [2, 2.5]) {
              grid.push({
                engine: ENGINE,
                family: mode === 'fade' ? 'opening-range-failure' : 'opening-range-hold',
                mode,
                orMinutes,
                bufferPts,
                minOrWidth,
                stopPts,
                targetR,
                holdBars: 8,
                beR: BE_R,
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

function entryCutoffHm(spec, book) {
  if (spec?.mode !== 'fade') return book.lastEntry;
  return book.sessionStart >= 1600 ? 1800 : 1130;
}

function exitPrice(open, exitBar, reason) {
  const spec = open.spec || {};
  const stop = Number(spec.stopPts) || 0;
  const dir = open.dir;
  if (reason === 'stop' && stop > 0) return open.entryClose - dir * stop;
  if (reason === 'breakeven') return open.entryClose;
  if (String(reason).includes('target') && stop > 0) {
    return open.entryClose + dir * stop * (Number(spec.targetR) || 2);
  }
  return Number(exitBar.close);
}

function closeTrade(open, exitBar, reason, lots, book) {
  const L = Math.max(1, Math.floor(Number(lots)) || 1);
  const px = exitPrice(open, exitBar, reason);
  const points = (px - open.entryClose) * open.dir;
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
    indexExit: px,
    indexPoints: Math.round(points * 100) / 100,
    optionPnlRs,
    netOptionPnlRs: optionPnlRs - chargesRs,
    chargesRs,
    liveWouldTake: true,
    pnlSource: 'index_x_lot',
    spec: open.spec,
    lots: L,
    riskRs1: Math.max(0, Number(open.spec?.stopPts) || 0) * book.lotSize,
  };
}

function simulateDay(dayBars, spec, lots, book) {
  const bars = dayBars || [];
  const or = openingRange(bars, spec, book);
  if (!or || !(or.width >= spec.minOrWidth)) return [];
  if (spec.mode === 'fade' && or.width > spec.stopPts * FADE_OR_STOP_MULT) return [];
  const lastEntry = entryCutoffHm(spec, book);
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
      if (!open.beArmed && favor >= spec.stopPts * (spec.beR || BE_R)) open.beArmed = true;
      let reason = null;
      if (adverse >= spec.stopPts) reason = 'stop';
      else if (open.beArmed && adverse >= 0) reason = 'breakeven';
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
    if (hm < or.endHm || hm > lastEntry) continue;
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
        beArmed: false,
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
      beArmed: false,
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
  const n = (trades || []).length;
  return {
    trades: n,
    wins,
    losses,
    optionNetRs: Math.round(optionNetRs),
    optionNetAfterChargesRs: Math.round(optionNetAfterChargesRs),
    underlyingPoints: Math.round(underlyingPoints * 100) / 100,
    profitFactor: Math.round(pf * 100) / 100,
    winRate: n ? Math.round((wins / n) * 100) / 100 : 0,
    expectancyRs: n ? Math.round(optionNetAfterChargesRs / n) : 0,
  };
}

function scoreTrades(trades) {
  const s = summarize(trades);
  if (s.trades < 5) return Number.NEGATIVE_INFINITY;
  if (s.profitFactor < MIN_INDEX_TRAIN_PF) return Number.NEGATIVE_INFINITY;
  if (s.winRate < MIN_WIN_RATE) return Number.NEGATIVE_INFINITY;
  if (s.optionNetAfterChargesRs <= 0) return Number.NEGATIVE_INFINITY;
  return s.optionNetAfterChargesRs * Math.min(3, s.profitFactor) + s.wins * 15 + s.expectancyRs;
}

function scoreStockTrades(trades) {
  const s = summarize(trades);
  if (s.trades < 3) return Number.NEGATIVE_INFINITY;
  if (s.profitFactor < MIN_STOCK_TRAIN_PF && s.profitFactor !== 99) return Number.NEGATIVE_INFINITY;
  if (s.optionNetAfterChargesRs <= 0) return Number.NEGATIVE_INFINITY;
  return s.optionNetAfterChargesRs + s.wins * 10;
}

function scaleClosedTrade(t, lots) {
  const from = Math.max(1, Number(t.lots) || 1);
  const to = Math.max(1, Math.floor(Number(lots)) || 1);
  const r = to / from;
  const optionPnlRs = (Number(t.optionPnlRs) || 0) * r;
  const chargesRs = (Number(t.chargesRs) || 0) * r;
  return {
    ...t,
    lots: to,
    optionPnlRs,
    chargesRs,
    netOptionPnlRs: optionPnlRs - chargesRs,
    allocated: true,
    liveWouldTake: true,
  };
}

function tradeRiskRs1(t) {
  const tagged = Number(t?.riskRs1);
  if (tagged > 0) return tagged;
  const lots = Math.max(1, Number(t?.lots) || 1);
  const stopPts = Math.abs(Number(t?.spec?.stopPts) || 0);
  if (stopPts > 0 && t?.pnlSource === 'index_x_lot') {
    const units = Math.abs(Number(t.optionPnlRs) || 0) / Math.max(0.0001, Math.abs(Number(t.indexPoints) || 0) * lots);
    return stopPts * units;
  }
  if (t?.pnlSource === 'cash_shares') {
    return Math.abs((Number(t.indexEntry) || 0) - (Number(t.indexExit) || 0)) || 1;
  }
  return 0;
}

function edgePerRisk(c) {
  return (Number(c.trainScore) || 0) / Math.max(1, Number(c.riskRs1) || 1);
}

/**
 * Scan is 1-lot. Capital then picks vehicles: 2% stop budget per trade,
 * 4% stop budget for the day. Index 1-lot stops that do not fit are skipped
 * (no forced Nifty/Bank). Stocks/crude size up when the stop is cheap.
 * Same-day Nifty + Bank in the same CE/PE keep the stronger walk-forward book.
 */
function allocateDesk({
  books = [],
  capitalRs = DEFAULT_CAPITAL_RS,
  maxLots = 1,
  riskPerTradePct = RISK_PER_TRADE_PCT,
  dayRiskPct = DAY_RISK_PCT,
} = {}) {
  const capital = Math.max(10_000, Math.floor(Number(capitalRs) || DEFAULT_CAPITAL_RS));
  const lotCap = Math.max(1, Math.floor(Number(maxLots) || 1));
  const perTrade = capital * riskPerTradePct;
  const dayBudget = capital * dayRiskPct;
  const raw = [];
  for (const book of books || []) {
    const trainScore = Number(book.train?.optionNetAfterChargesRs) || 0;
    const trainPf = Number(book.train?.profitFactor) || 0;
    for (const t of book.trades || []) {
      raw.push({
        trade: t,
        bookId: book.id,
        bookLabel: book.label || book.id,
        trainScore,
        trainPf,
        riskRs1: tradeRiskRs1(t),
      });
    }
  }

  const fundable = [];
  const skipped = [];

  for (const c of raw) {
    const risk1 = Number(c.riskRs1) || 0;
    if (!(risk1 > 0)) {
      skipped.push({
        instrumentName: c.trade.instrumentName,
        bookId: c.bookId,
        direction: c.trade.direction,
        riskRs1: 0,
        reason: 'no-stop',
        detail: 'No measurable stop — skipped',
      });
      continue;
    }
    let lots = Math.floor(perTrade / risk1);
    if (c.bookId === 'stocks' || c.trade.pnlSource === 'cash_shares') {
      const entry = Math.abs(Number(c.trade.indexEntry) || 0);
      if (entry > 0) {
        const maxShares = Math.floor((capital * STOCK_NAME_CAPITAL_FRAC) / entry);
        lots = Math.min(lots, Math.max(0, maxShares));
      }
    } else {
      lots = Math.min(lots, lotCap);
    }
    if (lots < 1) {
      skipped.push({
        instrumentName: c.trade.instrumentName,
        bookId: c.bookId,
        direction: c.trade.direction,
        riskRs1: Math.round(risk1),
        reason: 'stop-too-wide',
        detail: `1-lot stop ₹${Math.round(risk1)} > 2% of capital ₹${Math.round(perTrade)}`,
      });
      continue;
    }
    fundable.push({ ...c, lots, risk1 });
  }

  const quality = [];
  for (const c of fundable) {
    const minPf = c.bookId === 'stocks' ? MIN_STOCK_TRAIN_PF : MIN_INDEX_TRAIN_PF;
    if (c.trainPf > 0 && c.trainPf < minPf) {
      skipped.push({
        instrumentName: c.trade.instrumentName,
        bookId: c.bookId,
        direction: c.trade.direction,
        riskRs1: Math.round(c.risk1),
        reason: 'weak-train',
        detail: `Walk-forward PF ${c.trainPf} below ${minPf} — sit out`,
      });
      continue;
    }
    quality.push(c);
  }

  const indexIds = new Set(['nifty', 'bank']);
  const winners = new Map();
  const dropped = new Set();
  for (const c of quality) {
    if (!indexIds.has(c.bookId)) continue;
    const key = `${String(c.trade.entryTime || '').slice(0, 10)}|${c.trade.direction || ''}`;
    const prev = winners.get(key);
    if (!prev) {
      winners.set(key, c);
      continue;
    }
    if (edgePerRisk(c) > edgePerRisk(prev) || (edgePerRisk(c) === edgePerRisk(prev) && c.trainScore > prev.trainScore)) {
      dropped.add(prev);
      winners.set(key, c);
    } else {
      dropped.add(c);
    }
  }
  for (const c of dropped) {
    skipped.push({
      instrumentName: c.trade.instrumentName,
      bookId: c.bookId,
      direction: c.trade.direction,
      riskRs1: Math.round(c.riskRs1),
      reason: 'correlated-index',
      detail: 'Same-day Nifty and Bank same CE/PE — kept the stronger walk-forward book',
    });
  }

  const pool = quality.filter((c) => !dropped.has(c));
  pool.sort((a, b) => {
    const ea = (Number(a.trainScore) || 0) * Math.max(1, a.lots || 1);
    const eb = (Number(b.trainScore) || 0) * Math.max(1, b.lots || 1);
    if (eb !== ea) return eb - ea;
    return (b.trainPf || 0) - (a.trainPf || 0);
  });

  const taken = [];
  let dayRiskUsed = 0;

  for (const c of pool) {
    let lots = c.lots;
    let risk = lots * c.risk1;
    while (lots >= 1 && dayRiskUsed + risk > dayBudget + 1e-6) {
      lots -= 1;
      risk = lots * c.risk1;
    }
    if (lots < 1) {
      skipped.push({
        instrumentName: c.trade.instrumentName,
        bookId: c.bookId,
        direction: c.trade.direction,
        riskRs1: Math.round(c.risk1),
        reason: 'day-risk-full',
        detail: `Day stop budget ₹${Math.round(dayBudget)} already used ₹${Math.round(dayRiskUsed)}`,
      });
      continue;
    }
    dayRiskUsed += risk;
    taken.push({
      ...scaleClosedTrade(c.trade, lots),
      skipReason: undefined,
      allocation: {
        bookId: c.bookId,
        lots,
        riskRs: Math.round(risk),
        trainScore: Math.round(c.trainScore),
      },
    });
    if (taken.length >= MAX_FUNDED_TRADES) break;
  }

  const takenKeys = new Set(taken.map((t) => `${t.allocation?.bookId}|${t.entryTime}`));
  const alreadySkip = new Set(skipped.map((s) => `${s.bookId}|${s.instrumentName}`));
  for (const c of pool) {
    if (takenKeys.has(`${c.bookId}|${c.trade.entryTime}`)) continue;
    if (alreadySkip.has(`${c.bookId}|${c.trade.instrumentName}`)) continue;
    skipped.push({
      instrumentName: c.trade.instrumentName,
      bookId: c.bookId,
      direction: c.trade.direction,
      riskRs1: Math.round(c.risk1),
      reason: 'not-top-edge',
      detail: `Only the top ${MAX_FUNDED_TRADES} walk-forward books are funded`,
    });
  }

  taken.sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));
  return {
    capitalRs: capital,
    maxLots: lotCap,
    riskPerTradePct,
    dayRiskPct,
    riskPerTradeRs: Math.round(perTrade),
    dayRiskRs: Math.round(dayBudget),
    dayRiskUsedRs: Math.round(dayRiskUsed),
    taken: taken.map((t) => ({
      instrumentName: t.instrumentName,
      bookId: t.allocation?.bookId,
      direction: t.direction,
      lots: t.lots,
      riskRs: t.allocation?.riskRs,
    })),
    skipped,
    trades: taken,
    totals: summarize(taken),
  };
}

function specStillAlive(bars, spec, { trainFrom, trainTo, lots, book }) {
  const dates = uniqueDates(bars, book).filter((d) => {
    if (trainFrom && d < trainFrom) return false;
    if (trainTo && d > trainTo) return false;
    return true;
  }).slice(-RECENT_SESSIONS);
  if (dates.length < 3) return true;
  const trades = [];
  for (const d of dates) {
    trades.push(...simulateDay(sessionBars(bars, d, book), spec, lots, book));
  }
  const s = summarize(trades);
  return s.trades > 0 && s.optionNetAfterChargesRs > 0;
}

function searchSpecs(bars, { trainFrom, trainTo, lots, book } = {}) {
  const profile = book || BOOKS.nifty;
  const grid = specGrid(profile);
  let best = null;
  for (const spec of grid) {
    if (RETIRED_FAMILIES.includes(spec.family) || RETIRED_FAMILIES.includes(spec.engine)) continue;
    const trades = simulate(bars, spec, { fromDate: trainFrom, toDate: trainTo, lots, book: profile });
    const score = scoreTrades(trades);
    if (!Number.isFinite(score)) continue;
    if (!specStillAlive(bars, spec, { trainFrom, trainTo, lots, book: profile })) continue;
    const row = { spec, trades, totals: summarize(trades), score };
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
      lots: L,
      riskRs1: Math.abs(entry - stop),
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

function pickCrudeMiniFromCsv(csv) {
  const lines = String(csv || '').split(/\r?\n/);
  const futs = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',');
    if (cols.length < 12) continue;
    const token = Number(String(cols[0] || '').replace(/"/g, '')) || 0;
    const sym = String(cols[2] || '').replace(/"/g, '').toUpperCase();
    const type = String(cols[9] || '').replace(/"/g, '').toUpperCase();
    const expiry = String(cols[5] || '').replace(/"/g, '');
    if (!/^CRUDEOILM/.test(sym) || type !== 'FUT' || !token) continue;
    futs.push({ token, symbol: sym, expiry });
  }
  futs.sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));
  const today = new Date().toISOString().slice(0, 10);
  return futs.find((f) => !f.expiry || f.expiry >= today) || futs[0] || null;
}

async function loadBookCandles(market, authorization, book, warmFrom, toDate, deps) {
  if (deps.candlesByBook && Object.prototype.hasOwnProperty.call(deps.candlesByBook, book.id)) {
    return deps.candlesByBook[book.id];
  }
  let token = book.token;
  let symbol = book.name;
  if (book.id === 'crude') {
    if (typeof market.fetchInstrumentsCsv === 'function') {
      const csv = await market.fetchInstrumentsCsv(authorization, 'MCX');
      const fut = pickCrudeMiniFromCsv(csv);
      if (!fut) throw new Error('No CRUDEOILM future on the Kite MCX list');
      token = fut.token;
      symbol = fut.symbol;
    } else {
      throw new Error('No CRUDEOILM future on the Kite MCX list');
    }
  }
  const candles = await market.fetchHistorical5m(authorization, token, warmFrom, toDate);
  return { candles, token, symbol };
}

async function resolveStockSymbols(deps) {
  if (Array.isArray(deps.stockSymbols) && deps.stockSymbols.length) return deps.stockSymbols;
  try {
    const listed = await fetchNifty100Symbols();
    const seen = new Set();
    const out = [];
    for (const raw of [...LIQUID_STOCKS, ...(listed || [])]) {
      const s = String(raw || '').trim().toUpperCase();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= MAX_STOCK_SCAN) break;
    }
    return out.length ? out : LIQUID_STOCKS;
  } catch {
    return LIQUID_STOCKS;
  }
}

async function loadStocks(fromDate, toDate, lots, deps) {
  if (deps.stockSeries) return deps.stockSeries;
  const symbols = await resolveStockSymbols(deps);
  const series = await mapPool(symbols, 4, async (symbol) => {
    try {
      const out = await fetchEquityDaily({ symbol, fromDate, toDate });
      return { symbol, historical: out.historical || [], error: null };
    } catch (err) {
      return { symbol, historical: [], error: err.message || String(err) };
    }
  });
  return series;
}


async function runDiscover({ authorization, fromDate, toDate, lots, capitalRs }, deps = {}) {
  if (!fromDate || !toDate || fromDate > toDate) {
    const err = new Error('Valid fromDate ≤ toDate (YYYY-MM-DD) required');
    err.status = 400;
    throw err;
  }
  const market = deps.market || defaultMarket;
  const maxLots = Math.max(1, Math.floor(Number(lots)) || 1);
  const capital = Math.max(10_000, Math.floor(Number(capitalRs) || DEFAULT_CAPITAL_RS));
  const L = 1;
  const warmFrom = addDaysIso(fromDate, -LOOKBACK_CAL_DAYS);
  const trainTo = addDaysIso(fromDate, -1);
  const stockFrom = addDaysIso(fromDate, -STOCK_LOOKBACK_CAL_DAYS);

  const bookIds = ['nifty', 'bank', 'crude'];
  const books = [];
  const allTrades = [];
  let stockPayload = { source: 'nse-daily', universe: 'nifty-100', scanned: 0, taken: [], rows: [] };

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
    const stockRows = ranked.slice(0, 15).map((r) => ({
      symbol: r.symbol,
      sitOut: !!r.sitOut,
      spec: r.spec,
      train: summarize(r.trainTrades || []),
      day: r.totals,
      trades: (r.trades || []).length,
    }));
    books.push({
      id: 'stocks',
      label: 'Nifty 100 stocks (NSE daily)',
      sitOut: taken.length === 0,
      specText: taken.length
        ? taken.map((r) => `${r.symbol} inside-day ${r.spec.targetR}R`).join(', ')
        : 'sit-out (no walk-forward edge on scanned names)',
      train: summarize(ranked.flatMap((r) => r.trainTrades || [])),
      trainTrades: ranked.flatMap((r) => r.trainTrades || []),
      totals: summarize(stockTrades),
      trades: stockTrades,
      data: 'nse-daily',
      scanned: series.length,
    });
    allTrades.push(...stockTrades);
    stockPayload = {
      source: 'nse-daily',
      universe: 'nifty-100',
      scanned: series.length,
      taken: taken.map((r) => r.symbol),
      rows: stockRows,
    };
  } catch (err) {
    stockNote = err.message || String(err);
    books.push({
      id: 'stocks',
      label: 'Nifty 100 stocks (NSE daily)',
      sitOut: true,
      error: stockNote,
      totals: summarize([]),
      trades: [],
    });
    stockPayload = { source: 'nse-daily', universe: 'nifty-100', scanned: 0, taken: [], rows: [], error: stockNote };
  }

  allTrades.sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));
  const allocation = allocateDesk({ books, capitalRs: capital, maxLots });
  const totals = allocation.totals;
  const takenTrades = allocation.trades;

  return {
    fromDate,
    toDate,
    engine: ENGINE,
    strategy: STRATEGY_FAMILY,
    skipped: RETIRED_FAMILIES,
    capitalRs: capital,
    maxLots,
    allocation,
    specText: allocation.taken.length
      ? allocation.taken.map((t) => `${t.instrumentName} ×${t.lots}`).join(' · ')
      : 'Capital sat out (scan had setups the 2%/4% stop budget would not fund)',
    books,
    stocks: stockPayload,
    train: {
      fromDate: warmFrom,
      toDate: trainTo,
      totals: summarize(books.flatMap((b) => b.trainTrades || [])),
    },
    note:
      'Scan every book, then fund at most two highest walk-forward edges. Stops are capped at 1R, winners arm breakeven at 0.75R, fades skip wide opening ranges, and a spec that went red in the last 5 sessions sits out. 2%/4% capital rails still apply. This cuts losers; it is not a profit guarantee. Live money is not attached yet.',
    scanTotals: summarize(allTrades),
    totals,
    liveTotals: totals,
    trades: takenTrades,
    message: takenTrades.length
      ? undefined
      : allTrades.length
        ? 'Scan found setups, but capital would not fund any 1-lot stop (raise capital, or the cheap book had no signal).'
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
  DEFAULT_CAPITAL_RS,
  RISK_PER_TRADE_PCT,
  DAY_RISK_PCT,
  addDaysIso,
  specGrid,
  simulate,
  simulateInsideDay,
  summarize,
  searchSpecs,
  searchInsideDay,
  allocateDesk,
  scaleClosedTrade,
  runDiscover,
  describeSpec,
  pickCrudeMiniFromCsv,
};
