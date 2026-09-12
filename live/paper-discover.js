'use strict';
/**
 * Paper desk — not Genie / Trap / S/R / Find / VWAP-impulse.
 *
 * Books: Nifty 50 + Bank Nifty 5m (Kite), Crude Oil Mini 5m (Kite MCX),
 * and liquid Nifty-100 cash (free NSE daily).
 *
 * Intraday: ORB (close beyond 15/30m opening range) plus a long/short ATM
 * straddle check (index × lot proxy vs estimated premium). Regime fade/hold
 * stays in the walk-forward grid. Stocks: inside-day vs daily straddle.
 * Capital: 2% per trade, 6% day stop.
 */

const defaultMarket = require('./kite-market');
const { fetchEquityDaily, fetchNifty100Symbols, mapPool } = require('./nse-equity-history');
const { monthStartIso, monthKey, roundMtd, nextDayCap } = require('./month-guard');

const ENGINE = 'paper-desk';
const STRATEGY_FAMILY = 'orb-vs-straddle';
const RETIRED_FAMILIES = ['session-vwap-impulse', 'vwap-impulse'];
const GAP_SKIP_PCT = 1;
const REGIME_LAST_ENTRY_CASH = 1030;

const NIFTY_TOKEN = 256265;
const BANK_TOKEN = 260105;
const LOOKBACK_CAL_DAYS = 25;
const STOCK_LOOKBACK_CAL_DAYS = 90;
const CHARGE_RS = 20;
const MAX_STOCK_TRADES = 4;
const MAX_STOCK_SCAN = 30;
const MAX_FUNDED_TRADES = 6;
const DEFAULT_CAPITAL_RS = 40000;
const RISK_PER_TRADE_PCT = 0.02;
const DAY_RISK_PCT = 0.06;
const STOCK_NAME_CAPITAL_FRAC = 0.25;
const MIN_INDEX_TRAIN_PF = 1.5;
const MIN_STOCK_TRAIN_PF = 1.25;
const MIN_WIN_RATE = 0.55;
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
  for (const orMinutes of [15, 30]) {
    for (const minOrWidth of book.minOrWidth) {
      for (const stopPts of book.stopPts) {
        for (const targetR of [1.5, 2]) {
          grid.push({
            engine: ENGINE,
            family: 'orb',
            mode: 'orb',
            orMinutes,
            bufferPts: 0,
            minOrWidth,
            stopPts,
            targetR,
            holdBars: 24,
            beR: BE_R,
          });
        }
      }
    }
  }
  for (const minOrWidth of book.minOrWidth) {
    for (const stopPts of book.stopPts) {
      grid.push({
        engine: ENGINE,
        family: 'or-regime',
        mode: 'regime',
        orMinutes: 30,
        bufferPts: 0,
        minOrWidth,
        stopPts,
        targetR: 1.5,
        holdBars: 16,
        beR: BE_R,
        skipLargeGap: true,
        skipTuesday: true,
      });
    }
  }
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
  if (spec?.mode === 'regime') return book.sessionStart >= 1600 ? 1800 : REGIME_LAST_ENTRY_CASH;
  if (spec?.mode === 'orb') return book.sessionStart >= 1600 ? 2000 : 1430;
  if (spec?.mode !== 'fade') return book.lastEntry;
  return book.sessionStart >= 1600 ? 1800 : 1130;
}

function atmPremiumPts(book, spot, orWidth) {
  const s = Number(spot) || 0;
  const w = Number(orWidth) || 0;
  if (book.id === 'bank') return Math.max(120, Math.round(s * 0.004), Math.round(w * 0.55));
  if (book.id === 'crude') return Math.max(8, Math.round(s * 0.004), Math.round(w * 0.55));
  return Math.max(60, Math.round(s * 0.0035), Math.round(w * 0.55));
}

function isoWeekday(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function sessionVwap(bars, upto) {
  let pv = 0;
  let vol = 0;
  const end = Math.max(0, Math.min(upto, (bars || []).length - 1));
  for (let i = 0; i <= end; i += 1) {
    const b = bars[i];
    const typical = (Number(b.high) + Number(b.low) + Number(b.close)) / 3;
    const v = Math.max(1, Number(b.volume) || 1);
    pv += typical * v;
    vol += v;
  }
  return vol ? pv / vol : Number(bars[end]?.close) || 0;
}

function overnightGapPct(bars, prevClose) {
  if (!(Number(prevClose) > 0) || !(bars || []).length) return 0;
  const open = Number(bars[0].open);
  if (!(open > 0)) return 0;
  return (Math.abs(open - Number(prevClose)) / Number(prevClose)) * 100;
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

function manageOpen(open, bar, i, spec, lots, book) {
  const held = i - open.entryIndex;
  const adverse = (open.entryClose - Number(bar.close)) * open.dir;
  const favor = (Number(bar.close) - open.entryClose) * open.dir;
  if (!open.beArmed && favor >= spec.stopPts * (spec.beR || BE_R)) open.beArmed = true;
  let reason = null;
  if (adverse >= spec.stopPts) reason = 'stop';
  else if (open.beArmed && adverse >= 0) reason = 'breakeven';
  else if (favor >= spec.stopPts * spec.targetR) reason = `${spec.targetR}R target`;
  else if (held >= spec.holdBars) reason = 'time stop';
  else if (barHm(bar) >= book.squareOff) reason = `square-off ${book.squareOff}`;
  if (!reason) return { open, trade: null };
  return { open: null, trade: closeTrade(open, bar, reason, lots, book) };
}

function simulateRegimeDay(bars, spec, lots, book, opts = {}) {
  const empty = opts.withOpen ? { trades: [], open: null } : [];
  if (spec.skipTuesday && isoWeekday(barDate(bars[0] || {})) === 2) return empty;
  const or = openingRange(bars, spec, book);
  if (!or || !(or.width >= spec.minOrWidth)) return empty;
  if (spec.skipLargeGap !== false && overnightGapPct(bars, opts.prevClose) > GAP_SKIP_PCT) return empty;
  const lastEntry = entryCutoffHm(spec, book);
  const stopPts = Math.max(1, Math.min(spec.stopPts, Math.round(Math.max(spec.stopPts, or.width * 0.45))));
  const liveSpec = { ...spec, stopPts, targetR: spec.targetR || 1.5 };
  let broke = 0;
  let open = null;
  const trades = [];
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const hm = barHm(bar);
    if (open) {
      const step = manageOpen(open, bar, i, liveSpec, lots, book);
      open = step.open;
      if (step.trade) {
        trades.push(step.trade);
        break;
      }
      continue;
    }
    if (hm < or.endHm || hm > lastEntry) continue;
    const vwap = sessionVwap(bars, i);
    const close = Number(bar.close);
    if (!broke) {
      const up = close > or.high + spec.bufferPts;
      const down = close < or.low - spec.bufferPts;
      if (up && close > vwap) {
        open = { dir: 1, spec: liveSpec, entryClose: close, entryTime: bar.date, entryIndex: i, beArmed: false, play: 'orb-vwap' };
        continue;
      }
      if (down && close < vwap) {
        open = { dir: -1, spec: liveSpec, entryClose: close, entryTime: bar.date, entryIndex: i, beArmed: false, play: 'orb-vwap' };
        continue;
      }
      if (up) broke = 1;
      else if (down) broke = -1;
      else {
        const prev = bars[i - 1];
        if (prev) {
          const prevV = sessionVwap(bars, i - 1);
          if (Number(prev.close) > prevV && Number(bar.low) <= vwap && close > vwap) {
            open = { dir: 1, spec: liveSpec, entryClose: close, entryTime: bar.date, entryIndex: i, beArmed: false, play: 'vwap-pullback' };
          } else if (Number(prev.close) < prevV && Number(bar.high) >= vwap && close < vwap) {
            open = { dir: -1, spec: liveSpec, entryClose: close, entryTime: bar.date, entryIndex: i, beArmed: false, play: 'vwap-pullback' };
          }
        }
      }
      continue;
    }
    const failed =
      (broke > 0 && close < or.high) || (broke < 0 && close > or.low);
    if (!failed) continue;
    open = {
      dir: -broke,
      spec: liveSpec,
      entryClose: close,
      entryTime: bar.date,
      entryIndex: i,
      beArmed: false,
      play: 'failed-break',
    };
  }
  if (open && bars.length) {
    const last = bars[bars.length - 1];
    const flatten = opts.flattenOpen !== false || barHm(last) >= book.squareOff;
    if (flatten) {
      trades.push(closeTrade(open, last, 'session end', lots, book));
      open = null;
    }
  }
  if (opts.withOpen) return { trades, open };
  return trades;
}

function closeStraddleTrade(open, exitBar, reason, lots, book) {
  const L = Math.max(1, Math.floor(Number(lots)) || 1);
  const move = Math.abs(Number(exitBar.close) - open.entryClose);
  const premBoth = (Number(open.premiumPts) || 0) * 2;
  const pts = open.straddle === 'short' ? premBoth - move : move - premBoth;
  const optionPnlRs = pts * book.lotSize * L;
  const chargesRs = CHARGE_RS * 2 * L;
  const long = open.straddle !== 'short';
  return {
    instrumentName: book.name,
    instrumentId: book.id,
    side: long ? 'BUY' : 'SELL',
    direction: long ? 'LONG-STRADDLE' : 'SHORT-STRADDLE',
    optionSymbol: `${book.name} ATM CE+PE`,
    entryTime: open.entryTime,
    exitTime: exitBar.date,
    exitReason: reason,
    indexEntry: open.entryClose,
    indexExit: Number(exitBar.close),
    indexPoints: Math.round(pts * 100) / 100,
    optionPnlRs,
    netOptionPnlRs: optionPnlRs - chargesRs,
    chargesRs,
    liveWouldTake: true,
    pnlSource: 'index_x_lot_straddle',
    spec: open.spec,
    lots: L,
    premiumPts: open.premiumPts,
    riskRs1: premBoth * book.lotSize,
  };
}

function simulateOrbDay(bars, spec, lots, book, opts = {}) {
  const empty = opts.withOpen ? { trades: [], open: null } : [];
  const or = openingRange(bars, spec, book);
  if (!or || !(or.width >= spec.minOrWidth)) return empty;
  const lastEntry = entryCutoffHm(spec, book);
  const stopPts = Math.max(1, Math.min(spec.stopPts, Math.round(Math.max(spec.stopPts, or.width * 0.5))));
  const liveSpec = { ...spec, stopPts };
  let open = null;
  const trades = [];
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const hm = barHm(bar);
    if (open) {
      const step = manageOpen(open, bar, i, liveSpec, lots, book);
      open = step.open;
      if (step.trade) {
        trades.push(step.trade);
        break;
      }
      continue;
    }
    if (hm < or.endHm || hm > lastEntry) continue;
    const close = Number(bar.close);
    if (close > or.high + spec.bufferPts) {
      open = { dir: 1, spec: liveSpec, entryClose: close, entryTime: bar.date, entryIndex: i, beArmed: false, play: 'orb' };
    } else if (close < or.low - spec.bufferPts) {
      open = { dir: -1, spec: liveSpec, entryClose: close, entryTime: bar.date, entryIndex: i, beArmed: false, play: 'orb' };
    }
  }
  if (open && bars.length) {
    const last = bars[bars.length - 1];
    const flatten = opts.flattenOpen !== false || barHm(last) >= book.squareOff;
    if (flatten) {
      trades.push(closeTrade(open, last, 'session end', lots, book));
      open = null;
    }
  }
  if (opts.withOpen) return { trades, open };
  return trades;
}

function simulateStraddleDay(bars, spec, lots, book, opts = {}) {
  const empty = opts.withOpen ? { trades: [], open: null } : [];
  if (!(bars || []).length) return empty;
  const or = openingRange(bars, spec, book);
  const endHm = or ? or.endHm : hmPlus(book.orAnchor, spec.orMinutes || 15);
  let entryIdx = -1;
  for (let i = 0; i < bars.length; i += 1) {
    if (barHm(bars[i]) >= endHm) {
      entryIdx = i;
      break;
    }
  }
  if (entryIdx < 0) return empty;
  const entryBar = bars[entryIdx];
  const premium = atmPremiumPts(book, Number(entryBar.close), or ? or.width : 0);
  const side = spec.straddle === 'short' ? 'short' : 'long';
  const liveSpec = { ...spec, premiumPts: premium, mode: 'straddle', straddle: side };
  let open = {
    dir: 0,
    straddle: side,
    spec: liveSpec,
    entryClose: Number(entryBar.close),
    entryTime: entryBar.date,
    entryIndex: entryIdx,
    premiumPts: premium,
  };
  const trades = [];
  const shortStop = premium * 2 + Math.max(Number(spec.stopPts) || 0, Math.round(premium * 0.5));
  for (let i = entryIdx + 1; i < bars.length; i += 1) {
    const bar = bars[i];
    const hm = barHm(bar);
    const move = Math.abs(Number(bar.close) - open.entryClose);
    let reason = null;
    if (side === 'short' && move >= shortStop) reason = 'straddle stop';
    else if (hm >= book.squareOff) reason = `square-off ${book.squareOff}`;
    if (reason) {
      trades.push(closeStraddleTrade(open, bar, reason, lots, book));
      open = null;
      break;
    }
  }
  if (open && bars.length) {
    const last = bars[bars.length - 1];
    const flatten = opts.flattenOpen !== false || barHm(last) >= book.squareOff;
    if (flatten) {
      trades.push(closeStraddleTrade(open, last, 'session end', lots, book));
      open = null;
    }
  }
  if (opts.withOpen) return { trades, open };
  return trades;
}

function simulateDay(dayBars, spec, lots, book, opts = {}) {
  const bars = dayBars || [];
  const empty = opts.withOpen ? { trades: [], open: null } : [];
  if (spec?.mode === 'straddle') return simulateStraddleDay(bars, spec, lots, book, opts);
  if (spec?.mode === 'orb') return simulateOrbDay(bars, spec, lots, book, opts);
  if (spec?.mode === 'regime') return simulateRegimeDay(bars, spec, lots, book, opts);
  const or = openingRange(bars, spec, book);
  if (!or || !(or.width >= spec.minOrWidth)) return empty;
  if (spec.mode === 'fade' && or.width > spec.stopPts * FADE_OR_STOP_MULT) return empty;
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
    const last = bars[bars.length - 1];
    const flatten = opts.flattenOpen !== false || barHm(last) >= book.squareOff;
    if (flatten) {
      trades.push(closeTrade(open, last, 'session end', lots, book));
      open = null;
    }
  }
  if (opts.withOpen) return { trades, open };
  return trades;
}

function istToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function isOpenTrade(t) {
  return !!(t && (t.open || String(t.exitReason) === 'open'));
}

function executableSpec(book) {
  return {
    engine: ENGINE,
    family: 'straddle',
    mode: 'straddle',
    straddle: 'short',
    orMinutes: 15,
    stopPts: book.stopPts[0],
  };
}

function markOpenTrade(open, lastBar, lots, book) {
  if (!open || !lastBar) return null;
  const t =
    open.straddle
      ? closeStraddleTrade(open, lastBar, 'open', lots, book)
      : closeTrade(open, lastBar, 'open', lots, book);
  t.open = true;
  t.liveWouldTake = true;
  return t;
}

function simulate(bars, spec, { fromDate, toDate, lots, book, asOfDate } = {}) {
  const profile = book || BOOKS.nifty;
  const asOf = asOfDate || istToday();
  const dates = uniqueDates(bars, profile).filter((d) => {
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    if (d > asOf) return false;
    return true;
  });
  const trades = [];
  for (let i = 0; i < dates.length; i += 1) {
    const d = dates[i];
    let prevClose;
    if (i > 0) {
      const prevBars = sessionBars(bars, dates[i - 1], profile);
      if (prevBars.length) prevClose = Number(prevBars[prevBars.length - 1].close);
    }
    const dayBars = sessionBars(bars, d, profile);
    const liveDay = d === asOf;
    const pastSquareOff = dayBars.length && barHm(dayBars[dayBars.length - 1]) >= profile.squareOff;
    const flatten = !liveDay || pastSquareOff;
    const result = simulateDay(dayBars, spec, lots, profile, {
      prevClose,
      withOpen: true,
      flattenOpen: flatten,
    });
    const dayTrades = result.trades || [];
    if (!flatten && result.open) {
      const marked = markOpenTrade(result.open, dayBars[dayBars.length - 1], lots, profile);
      if (marked) dayTrades.push(marked);
    }
    trades.push(...dayTrades);
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
  const net = Math.round(optionNetAfterChargesRs);
  return {
    trades: n,
    wins,
    losses,
    grossProfitRs: Math.round(winRs),
    grossLossRs: Math.round(lossRs),
    netRs: net,
    optionNetRs: Math.round(optionNetRs),
    optionNetAfterChargesRs: net,
    underlyingPoints: Math.round(underlyingPoints * 100) / 100,
    profitFactor: Math.round(pf * 100) / 100,
    winRate: n ? Math.round((wins / n) * 100) / 100 : 0,
    expectancyRs: n ? Math.round(optionNetAfterChargesRs / n) : 0,
  };
}

function isStockBookId(id) {
  return id === 'stocks' || String(id || '').startsWith('stock:');
}

function isRedTrade(t) {
  return String(t?.exitReason) === 'stop' || (Number(t?.netOptionPnlRs) || 0) < 0;
}

function scoreTrades(trades) {
  const s = summarize(trades);
  if (s.trades < 5) return Number.NEGATIVE_INFINITY;
  if (s.profitFactor < MIN_INDEX_TRAIN_PF) return Number.NEGATIVE_INFINITY;
  if (s.winRate < MIN_WIN_RATE) return Number.NEGATIVE_INFINITY;
  if (s.optionNetAfterChargesRs <= 0) return Number.NEGATIVE_INFINITY;
  if (s.losses > 0 && s.losses / s.trades > 0.3) return Number.NEGATIVE_INFINITY;
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
 * 6% stop budget for the day. Index 1-lot stops that do not fit are skipped
 * (no forced Nifty/Bank). Stocks/crude size up when the stop is cheap.
 * Same-day Nifty + Bank in the same CE/PE keep the stronger walk-forward book.
 * A name whose last train trade was red is not funded.
 */
function allocateDesk({
  books = [],
  capitalRs = DEFAULT_CAPITAL_RS,
  maxLots = 1,
  riskPerTradePct = RISK_PER_TRADE_PCT,
  dayRiskPct = DAY_RISK_PCT,
  dayRiskRs = null,
  maxFunded = MAX_FUNDED_TRADES,
} = {}) {
  const capital = Math.max(1_000, Math.floor(Number(capitalRs) || DEFAULT_CAPITAL_RS));
  const lotCap = Math.max(1, Math.floor(Number(maxLots) || 1));
  const perTrade = capital * riskPerTradePct;
  const dayBudget =
    dayRiskRs == null ? capital * dayRiskPct : Math.max(0, Number(dayRiskRs) || 0);
  const fundedCap = Math.max(0, Math.floor(Number(maxFunded) ?? MAX_FUNDED_TRADES));
  const raw = [];
  for (const book of books || []) {
    const trainScore = Number(book.train?.optionNetAfterChargesRs) || 0;
    const trainPf = Number(book.train?.profitFactor) || 0;
    const trainTrades = book.trainTrades || [];
    const lastTrain = trainTrades[trainTrades.length - 1];
    const lastTrainRed = lastTrain ? isRedTrade(lastTrain) : false;
    for (const t of book.trades || []) {
      raw.push({
        trade: t,
        bookId: book.id,
        bookLabel: book.label || book.id,
        trainScore,
        trainPf,
        lastTrainRed,
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
    if (isStockBookId(c.bookId) || c.trade.pnlSource === 'cash_shares') {
      const entry = Math.abs(Number(c.trade.indexEntry) || 0);
      if (entry > 0) {
        const maxShares = Math.floor((capital * STOCK_NAME_CAPITAL_FRAC) / entry);
        lots = Math.min(lots, Math.max(0, maxShares));
      }
    } else {
      lots = Math.min(lots, lotCap);
    }
    const isStraddle = String(c.trade.pnlSource || '').includes('straddle') || c.trade.spec?.mode === 'straddle';
    if (isStraddle) {
      lots = Math.min(1, lotCap);
      fundable.push({ ...c, lots, risk1 });
      continue;
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
    const minPf = isStockBookId(c.bookId) ? MIN_STOCK_TRAIN_PF : MIN_INDEX_TRAIN_PF;
    const isStraddle = String(c.trade.pnlSource || '').includes('straddle') || c.trade.spec?.mode === 'straddle';
    if (!isStraddle && c.trainPf > 0 && c.trainPf < minPf) {
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
    if (!isStraddle && c.lastTrainRed) {
      skipped.push({
        instrumentName: c.trade.instrumentName,
        bookId: c.bookId,
        direction: c.trade.direction,
        riskRs1: Math.round(c.risk1),
        reason: 'last-train-red',
        detail: 'Last walk-forward trade was a loss — sit out this name',
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
    if (String(c.trade.pnlSource || '').includes('straddle') || c.trade.spec?.mode === 'straddle') continue;
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
    const ea = (Number(a.trainScore) || 0) * Math.max(1, a.trainPf || 1);
    const eb = (Number(b.trainScore) || 0) * Math.max(1, b.trainPf || 1);
    if (eb !== ea) return eb - ea;
    return (b.trainPf || 0) - (a.trainPf || 0);
  });
  const diversified = [];
  const seenBook = new Set();
  for (const c of pool) {
    if (seenBook.has(c.bookId)) continue;
    seenBook.add(c.bookId);
    diversified.push(c);
  }
  for (const c of pool) {
    if (!diversified.includes(c)) diversified.push(c);
  }

  const taken = [];
  let dayRiskUsed = 0;

  for (const c of diversified) {
    const liveOpenStraddle =
      isOpenTrade(c.trade) &&
      (String(c.trade.pnlSource || '').includes('straddle') || c.trade.spec?.mode === 'straddle');
    let lots = c.lots;
    let risk = lots * c.risk1;
    while (lots >= 1 && dayRiskUsed + risk > dayBudget + 1e-6) {
      lots -= 1;
      risk = lots * c.risk1;
    }
    if (lots < 1 && liveOpenStraddle) {
      lots = 1;
      risk = c.risk1;
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
    if (taken.length >= fundedCap && !liveOpenStraddle) {
      skipped.push({
        instrumentName: c.trade.instrumentName,
        bookId: c.bookId,
        direction: c.trade.direction,
        riskRs1: Math.round(c.risk1),
        reason: 'not-top-edge',
        detail:
          fundedCap < 1
            ? 'Month locked at flat — no new risk (red month not allowed)'
            : `Only the top ${fundedCap} setups are funded`,
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
        detail: fundedCap < 1
          ? 'Month locked at flat — no new risk (red month not allowed)'
          : `Only the top ${fundedCap} setups are funded`,
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
    monthCap: {
      dayRiskRs: Math.round(dayBudget),
      maxFunded: fundedCap,
    },
  };
}

function tradeDay(t) {
  return String(t?.entryTime || t?.date || '').slice(0, 10);
}

function allocateMonth({
  books = [],
  capitalRs = DEFAULT_CAPITAL_RS,
  maxLots = 1,
  fromDate,
  toDate,
} = {}) {
  const capital = Math.max(1_000, Math.floor(Number(capitalRs) || DEFAULT_CAPITAL_RS));
  const monthFrom = monthStartIso(fromDate);
  const dayBudget = capital * DAY_RISK_PCT;
  const perTrade = capital * RISK_PER_TRADE_PCT;
  const prior = [];
  for (const book of books || []) {
    for (const t of book.monthTrades || book.trades || []) {
      const day = tradeDay(t);
      if (day >= monthFrom && day < fromDate) prior.push(t);
    }
  }
  let mtd = roundMtd(summarize(prior).optionNetAfterChargesRs);
  let hadTrade = prior.length > 0;
  const taken = [];
  const skipped = [];
  const days = [];
  let d = fromDate;
  while (d && toDate && d <= toDate) {
    const cap = nextDayCap({
      mtdRs: mtd,
      hadTrade,
      dayBudgetRs: dayBudget,
      riskPerTradeRs: perTrade,
      targetR: 1.5,
    });
    const dayBooks = (books || []).map((b) => ({
      ...b,
      trades: (b.monthTrades || b.trades || []).filter((t) => tradeDay(t) === d),
    }));
    const alloc = allocateDesk({
      books: dayBooks,
      capitalRs: capital,
      maxLots,
      dayRiskRs: cap.capRs,
      maxFunded: cap.maxTrades,
    });
    const mappedSkip = (alloc.skipped || []).map((s) => {
      if (cap.mode === 'month-locked') {
        return {
          ...s,
          reason: 'month-locked',
          detail: 'Month is flat after being green — lock. Red days were allowed; a red month is not.',
        };
      }
      if (cap.mode === 'protect-green' && (s.reason === 'day-risk-full' || s.reason === 'not-top-edge')) {
        return {
          ...s,
          reason: 'month-floor',
          detail: `Today’s stop budget is month P&L ₹${mtd} so a red day cannot turn the month red`,
        };
      }
      if (cap.mode === 'recover-red') {
        return {
          ...s,
          reason: s.reason === 'day-risk-full' ? 'month-recover' : s.reason,
          detail: s.reason === 'day-risk-full'
            ? `Recovery size only ₹${Math.round(cap.capRs)} (1.5R would flatten month P&L ₹${mtd})`
            : s.detail,
        };
      }
      return s;
    });
    skipped.push(...mappedSkip);
    taken.push(...(alloc.trades || []));
    const closedDay = (alloc.trades || []).filter((t) => !isOpenTrade(t));
    const dayNet = roundMtd(summarize(closedDay).optionNetAfterChargesRs);
    if ((alloc.trades || []).length) hadTrade = true;
    mtd = roundMtd(mtd + dayNet);
    days.push({
      date: d,
      mode: cap.mode,
      capRs: Math.round(cap.capRs),
      dayNetRs: dayNet,
      mtdRs: mtd,
      taken: (alloc.taken || []).length,
    });
    d = addDaysIso(d, 1);
  }
  taken.sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));
  const last = days[days.length - 1] || {};
  return {
    capitalRs: capital,
    maxLots: Math.max(1, Math.floor(Number(maxLots) || 1)),
    riskPerTradePct: RISK_PER_TRADE_PCT,
    dayRiskPct: DAY_RISK_PCT,
    riskPerTradeRs: Math.round(perTrade),
    dayRiskRs: last.capRs != null ? last.capRs : Math.round(dayBudget),
    dayRiskUsedRs: Math.round(taken.reduce((s, t) => s + (Number(t.allocation?.riskRs) || 0), 0)),
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
    month: {
      key: monthKey(fromDate),
      fromDate: monthFrom,
      mtdRs: mtd,
      hadTrade,
      locked: hadTrade && mtd === 0,
      mode: last.mode || (hadTrade && mtd === 0 ? 'month-locked' : 'month-open'),
      rule: 'Red days allowed. After the month is green, a day cannot risk more than month P&L. Flat month locks. Red month is not accepted — recovery only while MTD is red.',
      days,
    },
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
  if (!trades.length) return false;
  return !isRedTrade(trades[trades.length - 1]);
}

function searchSpecs(bars, { trainFrom, trainTo, lots, book } = {}) {
  const profile = book || BOOKS.nifty;
  const grid = specGrid(profile);
  let best = null;
  let sawScore = false;
  let lastRed = false;
  for (const spec of grid) {
    if (RETIRED_FAMILIES.includes(spec.family) || RETIRED_FAMILIES.includes(spec.engine)) continue;
    const trades = simulate(bars, spec, { fromDate: trainFrom, toDate: trainTo, lots, book: profile });
    const score = scoreTrades(trades);
    if (!Number.isFinite(score)) continue;
    sawScore = true;
    if (!specStillAlive(bars, spec, { trainFrom, trainTo, lots, book: profile })) {
      lastRed = true;
      continue;
    }
    const row = { spec, trades, totals: summarize(trades), score };
    if (!best || row.score > best.score) best = row;
  }
  if (!best || !Number.isFinite(best.score)) {
    let sitOutReason = 'weak-train';
    if (lastRed) sitOutReason = 'last-train-red';
    else if (!sawScore) sitOutReason = 'weak-train';
    return { spec: null, totals: summarize([]), sitOut: true, sitOutReason };
  }
  return { ...best, sitOut: false, sitOutReason: undefined };
}

function explainIndexBook(book, { candles, found, trades, error } = {}) {
  if (error) {
    if (book.id === 'crude') {
      return `Crude Mini failed to load: ${error}. Needs Kite MCX CRUDEOILM future (16:00–21:30 IST).`;
    }
    return `${book.name} failed to load: ${error}`;
  }
  const rows = Array.isArray(candles) ? candles : candles?.candles || [];
  if (!rows.length) {
    if (book.id === 'crude') {
      return 'No Crude Mini 5m bars. Get Token; Crude only has an evening book (16:00–21:30 IST), not the cash session.';
    }
    return `No ${book.name} 5m bars from Kite. Get Token and retry.`;
  }
  if (found?.sitOut) {
    if (found.sitOutReason === 'last-train-red') {
      return `${book.name} sit-out: last walk-forward trade was red.`;
    }
    if (book.id === 'crude') {
      return 'Crude Mini sit-out: walk-forward edge too weak (need ~5 train trades, PF ≥ 1.5, last train green). Evening book only.';
    }
    return `${book.name} sit-out: walk-forward edge too weak (need ~5 train trades, PF ≥ 1.5, 55% wins, last train green).`;
  }
  if (!(trades || []).length) {
    if (book.id === 'crude') {
      return 'No Crude Mini OR signal on this date (weekend/holiday, or no evening fade/hold). Crude does not trade 09:15–15:30.';
    }
    return `No ${book.name} 15m OR yet — wait until 09:30 IST, then sell ATM CE+PE. Paper/live do not wait for the close.`;
  }
  return `${book.name} printed a setup — capital may still skip a 1-lot stop that is wider than 2%.`;
}

function stampCoreBooks(books, allocation) {
  const core = new Set(['nifty', 'bank', 'crude']);
  for (const b of books || []) {
    if (!core.has(b.id)) continue;
    const taken = (allocation.taken || []).filter((t) => t.bookId === b.id);
    const skip = (allocation.skipped || []).find((s) => s.bookId === b.id);
    if (taken.length) {
      b.status = 'funded';
      b.why = `Funded ${taken.map((t) => `${t.instrumentName} ×${t.lots}`).join(', ')}`;
    } else if (skip) {
      b.status = 'skipped';
      b.why = skip.detail || skip.reason;
      if (skip.reason === 'stop-too-wide' && b.id === 'bank') {
        b.why +=
          ' Bank 1-lot stop is typically ₹1,500–₹2,700 (50–90 pts × ₹30). 2% of ~₹30k is ~₹600, so Bank is listed here as skipped, not missing.';
      }
      if (skip.reason === 'stop-too-wide' && b.id === 'nifty') {
        b.why +=
          ' Nifty 1-lot stop is typically ₹1,300–₹2,275 (20–35 pts × ₹65). Raise capital if you want the index 1-lot.';
      }
    } else if (b.sitOut) {
      b.status = 'sit-out';
    } else if (!(b.trades || []).length) {
      b.status = 'no-signal';
    } else {
      b.status = 'scanned';
    }
  }
  return books;
}

function describeSpec(spec, book) {
  if (!spec) return `${book?.name || 'book'} sit-out (no walk-forward edge)`;
  if (spec.mode === 'orb') {
    return `${book?.name || ''} ORB · ${spec.orMinutes}m range, stop ${spec.stopPts}pt, ${spec.targetR}R`.trim();
  }
  if (spec.mode === 'straddle') {
    return `${book?.name || ''} ${spec.straddle === 'short' ? 'short' : 'long'} ATM straddle · after ${spec.orMinutes || 15}m OR`.trim();
  }
  if (spec.mode === 'regime') {
    return (
      `${book?.name || ''} regime · OR ${spec.orMinutes}m then one play ` +
      `(VWAP ORB / failed-break fade / VWAP pullback) · stop ${spec.stopPts}pt · ${spec.targetR}R · last entry ${book?.sessionStart >= 1600 ? '18:00' : '10:30'}`
    ).trim();
  }
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
    const last = trades[trades.length - 1];
    if (last && isRedTrade(last)) continue;
    const row = { spec, trades, totals: summarize(trades), score: scoreStockTrades(trades), symbol };
    if (!best || row.score > best.score) best = row;
  }
  if (!best || !Number.isFinite(best.score)) return { spec: null, sitOut: true, totals: summarize([]), symbol };
  return { ...best, sitOut: false };
}

function simulateStockStraddle(bars, { fromDate, toDate, lots, symbol, side } = {}) {
  const L = Math.max(1, Math.floor(Number(lots)) || 1);
  const rows = (bars || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const trades = [];
  const short = side === 'short';
  for (const day of rows) {
    const d = String(day.date).slice(0, 10);
    if (fromDate && d < fromDate) continue;
    if (toDate && d > toDate) continue;
    const open = Number(day.open);
    const close = Number(day.close);
    if (!(open > 0)) continue;
    const premium = Math.max(2, open * 0.008);
    const move = Math.abs(close - open);
    const pts = short ? premium * 2 - move : move - premium * 2;
    const optionPnlRs = pts * L;
    const chargesRs = Math.max(1, Math.round(open * L * 0.001 * 2));
    trades.push({
      instrumentName: symbol || 'STOCK',
      instrumentId: 'stock',
      side: short ? 'SELL' : 'BUY',
      direction: short ? 'SHORT-STRADDLE' : 'LONG-STRADDLE',
      optionSymbol: `${symbol} ATM CE+PE`,
      entryTime: `${d}T09:15:00+0530`,
      exitTime: `${d}T15:30:00+0530`,
      exitReason: 'close',
      indexEntry: open,
      indexExit: close,
      indexPoints: Math.round(pts * 100) / 100,
      optionPnlRs,
      netOptionPnlRs: optionPnlRs - chargesRs,
      chargesRs,
      liveWouldTake: true,
      pnlSource: 'cash_straddle_proxy',
      lots: L,
      premiumPts: premium,
    });
  }
  return trades;
}

function pickVictory(rows) {
  const list = (rows || []).filter(Boolean);
  if (!list.length) return null;
  return list.slice().sort((a, b) => {
    const aEdge = (a.totals?.wins || 0) - (a.totals?.losses || 0);
    const bEdge = (b.totals?.wins || 0) - (b.totals?.losses || 0);
    if (bEdge !== aEdge) return bEdge - aEdge;
    const aNet = a.totals?.optionNetAfterChargesRs || 0;
    const bNet = b.totals?.optionNetAfterChargesRs || 0;
    if (bNet !== aNet) return bNet - aNet;
    return (b.totals?.winRate || 0) - (a.totals?.winRate || 0);
  })[0];
}

function compareIndexBook(candles, book, { fromDate, toDate, lots } = {}) {
  const L = Math.max(1, Math.floor(Number(lots)) || 1);
  const orbSpecs = [
    {
      engine: ENGINE,
      family: 'orb',
      mode: 'orb',
      orMinutes: 15,
      bufferPts: 0,
      minOrWidth: book.minOrWidth[0],
      stopPts: book.stopPts[0],
      targetR: 1.5,
      holdBars: 24,
      beR: BE_R,
    },
    {
      engine: ENGINE,
      family: 'orb',
      mode: 'orb',
      orMinutes: 30,
      bufferPts: 0,
      minOrWidth: book.minOrWidth[0],
      stopPts: book.stopPts[1] || book.stopPts[0],
      targetR: 2,
      holdBars: 24,
      beR: BE_R,
    },
  ];
  const orbTried = orbSpecs.map((spec) => {
    const trades = simulate(candles, spec, { fromDate, toDate, lots: L, book });
    return { id: `orb-${spec.orMinutes}`, label: `ORB ${spec.orMinutes}m`, spec, trades, totals: summarize(trades) };
  });
  const bestOrb = pickVictory(orbTried) || orbTried[0];
  const longSpec = { engine: ENGINE, family: 'straddle', mode: 'straddle', straddle: 'long', orMinutes: 15, stopPts: book.stopPts[0] };
  const shortSpec = { engine: ENGINE, family: 'straddle', mode: 'straddle', straddle: 'short', orMinutes: 15, stopPts: book.stopPts[0] };
  const longTrades = simulate(candles, longSpec, { fromDate, toDate, lots: L, book });
  const shortTrades = simulate(candles, shortSpec, { fromDate, toDate, lots: L, book });
  const rows = [
    { id: 'orb', label: bestOrb.label, spec: bestOrb.spec, trades: bestOrb.trades, totals: bestOrb.totals },
    { id: 'straddle-long', label: 'Long straddle', spec: longSpec, trades: longTrades, totals: summarize(longTrades) },
    { id: 'straddle-short', label: 'Short straddle', spec: shortSpec, trades: shortTrades, totals: summarize(shortTrades) },
  ];
  const winner = pickVictory(rows);
  return { bookId: book.id, label: book.name, rows, winnerId: winner?.id, winnerLabel: winner?.label, variants: orbTried };
}

function compareStocks(series, { fromDate, toDate, lots } = {}) {
  const L = Math.max(1, Math.floor(Number(lots)) || 1);
  const inside = [];
  const long = [];
  const short = [];
  for (const row of series || []) {
    if (!row.historical || row.historical.length < 5) continue;
    inside.push(
      ...simulateInsideDay(row.historical, { engine: ENGINE, family: 'inside-day', targetR: 1.5, minRisk: 2 }, {
        fromDate,
        toDate,
        lots: L,
        symbol: row.symbol,
      }),
    );
    long.push(
      ...simulateStockStraddle(row.historical, { fromDate, toDate, lots: L, symbol: row.symbol, side: 'long' }),
    );
    short.push(
      ...simulateStockStraddle(row.historical, { fromDate, toDate, lots: L, symbol: row.symbol, side: 'short' }),
    );
  }
  const rows = [
    { id: 'orb', label: 'Inside-day (stock ORB analog)', trades: inside, totals: summarize(inside) },
    { id: 'straddle-long', label: 'Long straddle', trades: long, totals: summarize(long) },
    { id: 'straddle-short', label: 'Short straddle', trades: short, totals: summarize(short) },
  ];
  const winner = pickVictory(rows);
  return { bookId: 'stocks', label: 'Nifty-100 stocks', rows, winnerId: winner?.id, winnerLabel: winner?.label };
}

function compareAll(payload) {
  const books = payload.books || [];
  const votes = {};
  for (const b of books) {
    if (!b.winnerId) continue;
    votes[b.winnerId] = (votes[b.winnerId] || 0) + 1;
  }
  let overallId = null;
  let overallVotes = 0;
  for (const [id, n] of Object.entries(votes)) {
    if (n > overallVotes) {
      overallId = id;
      overallVotes = n;
    }
  }
  const label = {
    orb: 'ORB',
    'straddle-long': 'Long straddle',
    'straddle-short': 'Short straddle',
  }[overallId] || overallId;
  const perBook = books.map((b) => ({
    book: b.label,
    bookId: b.bookId,
    winner: b.winnerLabel,
    winnerId: b.winnerId,
    totals: (b.rows || []).find((r) => r.id === b.winnerId)?.totals,
  }));
  return {
    fromDate: payload.fromDate,
    toDate: payload.toDate,
    books,
    overall: overallId
      ? {
          strategy: label,
          strategyId: overallId,
          booksWon: overallVotes,
          books: perBook,
        }
      : null,
    rule: 'Victory = more wins than losses first, then higher net ₹, then win rate. Overall winner is the strategy that wins the most books (Nifty, Bank, stocks). Index straddle uses ATM CE+PE premium proxy (not a live option chain). Stocks straddle is daily |open−close| vs 0.8% premium on 1 share.',
  };
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


async function resolvePaperCapital(authorization, capitalRs, deps, market) {
  const fetchFn = deps.fetchUserMargins || market.fetchUserMargins;
  let kiteFunds = deps.kiteFunds || null;
  if (!kiteFunds && typeof fetchFn === 'function' && authorization) {
    try {
      kiteFunds = await fetchFn(authorization);
    } catch (err) {
      kiteFunds = { source: 'kite', error: err.message || String(err), capitalRs: 0 };
    }
  }
  const fromKite = Math.floor(Number(kiteFunds?.capitalRs) || 0);
  const fromUi = Math.floor(Number(capitalRs) || 0);
  const capital =
    fromKite > 0 ? fromKite : Math.max(10_000, fromUi || DEFAULT_CAPITAL_RS);
  return { capital, kiteFunds: kiteFunds || null };
}

async function runDiscover({ authorization, fromDate, toDate, lots, capitalRs }, deps = {}) {
  if (!fromDate || !toDate || fromDate > toDate) {
    const err = new Error('Valid fromDate ≤ toDate (YYYY-MM-DD) required');
    err.status = 400;
    throw err;
  }
  const asOf = deps.asOfDate || istToday();
  const market = deps.market || defaultMarket;
  const maxLots = Math.max(1, Math.floor(Number(lots)) || 1);
  const { capital, kiteFunds } = await resolvePaperCapital(authorization, capitalRs, deps, market);
  const L = 1;
  const monthFrom = monthStartIso(fromDate);
  const warmFrom = addDaysIso(fromDate, -LOOKBACK_CAL_DAYS);
  const trainTo = addDaysIso(fromDate, -1);
  const stockFrom = addDaysIso(fromDate, -STOCK_LOOKBACK_CAL_DAYS);

  const bookIds = ['nifty', 'bank', 'crude'];
  const books = [];
  const allTrades = [];
  const compareBooks = [];
  let stockPayload = { source: 'nse-daily', universe: 'nifty-100', scanned: 0, taken: [], rows: [] };

  for (const id of bookIds) {
    const book = BOOKS[id];
    try {
      const loaded = await loadBookCandles(market, authorization, book, warmFrom, toDate, deps);
      const candles = loaded.candles || loaded;
      if (id === 'nifty' || id === 'bank') {
        compareBooks.push(compareIndexBook(candles, book, { fromDate, toDate, lots: L }));
      }
      if (id === 'crude') {
        books.push({
          id: book.id,
          label: book.name,
          vehicle: loaded.symbol || book.name,
          sitOut: true,
          sitOutReason: 'not-on-desk',
          spec: null,
          specText: 'Not on the live desk',
          train: summarize([]),
          trainTrades: [],
          totals: summarize([]),
          trades: [],
          data: 'kite-5m',
          token: loaded.token || book.token,
          bars: Array.isArray(candles) ? candles.length : 0,
          status: 'sit-out',
          why: 'Live/paper desk is Nifty + Bank short straddle after the 15m opening range. Crude is not on this path.',
        });
        continue;
      }
      const spec = executableSpec(book);
      const trainTrades = simulate(candles, spec, {
        fromDate: warmFrom,
        toDate: trainTo,
        lots: L,
        book,
        asOfDate: asOf,
      });
      const found = {
        spec,
        sitOut: false,
        trades: trainTrades,
        totals: summarize(trainTrades),
      };
      const monthTrades = simulate(candles, spec, {
        fromDate: monthFrom,
        toDate,
        lots: L,
        book,
        asOfDate: asOf,
      });
      const trades = monthTrades.filter((t) => {
        const day = tradeDay(t);
        return day >= fromDate && day <= toDate;
      });
      const why = explainIndexBook(book, { candles, found, trades });
      books.push({
        id: book.id,
        label: book.name,
        vehicle: loaded.symbol || book.name,
        sitOut: !!found.sitOut,
        sitOutReason: found.sitOutReason,
        spec: found.spec,
        specText: describeSpec(found.spec, book),
        train: found.totals,
        trainTrades: found.trades || [],
        totals: summarize(trades),
        trades,
        monthTrades,
        data: 'kite-5m',
        token: loaded.token || book.token,
        bars: Array.isArray(candles) ? candles.length : 0,
        status: found.sitOut ? 'sit-out' : trades.length ? 'scanned' : 'no-signal',
        why,
      });
      allTrades.push(...trades);
    } catch (err) {
      const why = explainIndexBook(book, { error: err.message || String(err) });
      books.push({
        id: book.id,
        label: book.name,
        sitOut: true,
        error: err.message || String(err),
        totals: summarize([]),
        trades: [],
        status: 'error',
        why,
      });
    }
  }

  let stockNote = '';
  try {
    const stockDoneTo = toDate < asOf ? toDate : addDaysIso(asOf, -1);
    const series = await loadStocks(stockFrom, stockDoneTo, L, deps);
    compareBooks.push(compareStocks(series, { fromDate, toDate: stockDoneTo, lots: L }));
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
      const monthTrades = simulateInsideDay(row.historical, found.spec, {
        fromDate: monthFrom,
        toDate: stockDoneTo,
        lots: L,
        symbol: row.symbol,
      });
      const trades = monthTrades.filter((t) => {
        const day = tradeDay(t);
        return day >= fromDate && day <= toDate;
      });
      ranked.push({
        ...found,
        trainTrades: found.trades,
        trades,
        monthTrades,
        totals: summarize(trades),
      });
    }
    ranked.sort((a, b) => b.score - a.score);
    const taken = ranked.filter((r) => r.trades.length).slice(0, MAX_STOCK_TRADES);
    const stockTrades = [];
    for (const row of taken) {
      stockTrades.push(...row.trades);
      books.push({
        id: `stock:${row.symbol}`,
        label: row.symbol,
        vehicle: row.symbol,
        sitOut: false,
        spec: row.spec,
        specText: `${row.symbol} inside-day/NR squeeze ${row.spec.targetR}R`,
        train: summarize(row.trainTrades || []),
        trainTrades: row.trainTrades || [],
        totals: row.totals,
        trades: row.trades,
        monthTrades: row.monthTrades || row.trades,
        data: 'nse-daily',
      });
    }
    const stockRows = ranked.slice(0, 15).map((r) => ({
      symbol: r.symbol,
      sitOut: !!r.sitOut,
      spec: r.spec,
      train: summarize(r.trainTrades || []),
      day: r.totals,
      trades: (r.trades || []).length,
    }));
    if (!taken.length) {
      books.push({
        id: 'stocks',
        label: 'Nifty 100 stocks (NSE daily)',
        sitOut: true,
        specText: 'sit-out (no walk-forward edge on scanned names)',
        train: summarize(ranked.flatMap((r) => r.trainTrades || [])),
        trainTrades: ranked.flatMap((r) => r.trainTrades || []),
        totals: summarize([]),
        trades: [],
        data: 'nse-daily',
        scanned: series.length,
      });
    }
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
  const allocation = allocateMonth({ books, capitalRs: capital, maxLots, fromDate, toDate });
  const compare = compareAll({ fromDate, toDate, books: compareBooks });
  stampCoreBooks(books, allocation);
  const totals = allocation.totals;
  const takenTrades = allocation.trades;
  const coreBooks = books.filter((b) => b.id === 'nifty' || b.id === 'bank' || b.id === 'crude');

  return {
    fromDate,
    toDate,
    engine: ENGINE,
    strategy: STRATEGY_FAMILY,
    skipped: RETIRED_FAMILIES,
    capitalRs: capital,
    maxLots,
    kiteFunds,
    allocation,
    month: allocation.month,
    compare,
    specText: allocation.taken.length
      ? allocation.taken.map((t) => `${t.instrumentName} ×${t.lots}`).join(' · ')
      : 'Capital sat out (scan had setups the 2%/6% stop budget would not fund)',
    books,
    coreBooks,
    stocks: stockPayload,
    train: {
      fromDate: warmFrom,
      toDate: trainTo,
      totals: summarize(books.flatMap((b) => b.trainTrades || [])),
    },
    note:
      'Desk: short ATM straddle on Nifty and Bank the moment the 15-minute opening range ends (~09:30). Paper today shows that trade as OPEN until square-off — it does not wait for the close to “find” it. Live uses the same 5m path and sells ATM CE+PE then. Late start does not chase. Stocks stay paper on completed days only.',
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
  simulateDay,
  simulateInsideDay,
  simulateOrbDay,
  simulateStraddleDay,
  simulateStockStraddle,
  compareIndexBook,
  compareStocks,
  compareAll,
  pickVictory,
  atmPremiumPts,
  sessionBars,
  summarize,
  searchSpecs,
  searchInsideDay,
  specStillAlive,
  isRedTrade,
  explainIndexBook,
  stampCoreBooks,
  allocateDesk,
  allocateMonth,
  nextDayCap,
  monthStartIso,
  scaleClosedTrade,
  executableSpec,
  istToday,
  isOpenTrade,
  runDiscover,
  resolvePaperCapital,
  describeSpec,
  pickCrudeMiniFromCsv,
};
