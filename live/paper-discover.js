'use strict';
/**
 * Paper strategy discovery — not Genie, Trap, S/R, ee-wait, or order-flow.
 *
 * Family: session VWAP impulse.
 * After the open, a 5m bar that expands away from session VWAP must be
 * confirmed by the next closes holding that side of VWAP. Exit on VWAP
 * giveback, a point stop, a time stop, or 15:15 IST.
 *
 * Search uses sessions strictly before From. The returned trades are only
 * inside From→To (how that found spec would have acted on the dates you pick).
 */

const defaultMarket = require('./kite-market');

const ENGINE = 'vwap-impulse';
const STRATEGY_FAMILY = 'session-vwap-impulse';
const NIFTY_TOKEN = 256265;
const NIFTY_LOT_SIZE = 65;
const LOOKBACK_CAL_DAYS = 25;
const CHARGE_RS = 20;

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

function inSession(bar) {
  const hm = barHm(bar);
  return hm >= 915 && hm <= 1530;
}

function hmPlus(hm, minutes) {
  const h = Math.floor(Number(hm) / 100);
  const m = Number(hm) % 100;
  const tot = h * 60 + m + Number(minutes);
  return Math.floor(tot / 60) * 100 + (tot % 60);
}

function sessionBars(all, date) {
  return (all || []).filter((b) => barDate(b) === date && inSession(b));
}

function uniqueDates(bars) {
  const out = [];
  const seen = new Set();
  for (const b of bars || []) {
    const d = barDate(b);
    if (!d || seen.has(d) || !inSession(b)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

function typical(bar) {
  return (Number(bar.high) + Number(bar.low) + Number(bar.close)) / 3;
}

function runningVwap(bars) {
  let pv = 0;
  let vol = 0;
  return bars.map((b) => {
    const v = Number(b.volume) > 0 ? Number(b.volume) : 1;
    pv += typical(b) * v;
    vol += v;
    return { ...b, vwap: vol > 0 ? pv / vol : Number(b.close) };
  });
}

function impulseDir(bar, minRangePts) {
  const range = Number(bar.high) - Number(bar.low);
  if (!(range >= minRangePts)) return 0;
  const pos = range > 0 ? (Number(bar.close) - Number(bar.low)) / range : 0.5;
  const vwap = Number(bar.vwap);
  if (bar.close > vwap && bar.close > bar.open && pos >= 0.66) return 1;
  if (bar.close < vwap && bar.close < bar.open && pos <= 0.34) return -1;
  return 0;
}

function confirmed(bars, i, spec) {
  const bar = bars[i];
  if (barHm(bar) < hmPlus(915, spec.startMin)) return 0;
  if (barHm(bar) > 1415) return 0;
  const dir = impulseDir(bar, spec.minRangePts);
  if (!dir) return 0;
  const need = Math.max(1, spec.confirmBars);
  if (i + need >= bars.length) return 0;
  for (let k = 1; k <= need; k += 1) {
    const nxt = bars[i + k];
    if (!nxt) return 0;
    if (dir > 0 && !(nxt.close > nxt.vwap)) return 0;
    if (dir < 0 && !(nxt.close < nxt.vwap)) return 0;
  }
  return dir;
}

function specGrid() {
  const grid = [];
  for (const startMin of [20, 45]) {
    for (const confirmBars of [1, 2]) {
      for (const minRangePts of [8, 15]) {
        for (const holdBars of [6, 12]) {
          for (const stopPts of [20, 35]) {
            for (const givebackPts of [8, 15]) {
              grid.push({
                engine: ENGINE,
                family: STRATEGY_FAMILY,
                startMin,
                confirmBars,
                minRangePts,
                holdBars,
                stopPts,
                givebackPts,
              });
            }
          }
        }
      }
    }
  }
  return grid;
}

function closeTrade(open, exitBar, reason, lots) {
  const L = Math.max(1, Math.floor(Number(lots)) || 1);
  const points = (Number(exitBar.close) - open.entryClose) * open.dir;
  const optionPnlRs = points * NIFTY_LOT_SIZE * L;
  const chargesRs = CHARGE_RS * L;
  return {
    instrumentName: 'NIFTY 50',
    instrumentId: 'nifty-50',
    side: 'BUY',
    direction: open.dir > 0 ? 'CE' : 'PE',
    optionSymbol: open.dir > 0 ? 'NIFTY ATM CE (proxy)' : 'NIFTY ATM PE (proxy)',
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

function simulateDay(dayBars, spec, lots) {
  const bars = runningVwap(dayBars);
  const trades = [];
  let open = null;
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    if (open) {
      const held = i - open.entryIndex;
      const adverse = (open.entryClose - Number(bar.close)) * open.dir;
      const giveback =
        open.dir > 0
          ? Number(bar.close) < Number(bar.vwap) - spec.givebackPts
          : Number(bar.close) > Number(bar.vwap) + spec.givebackPts;
      let reason = null;
      if (adverse >= spec.stopPts) reason = 'stop';
      else if (giveback) reason = 'vwap giveback';
      else if (held >= spec.holdBars) reason = 'time stop';
      else if (barHm(bar) >= 1515) reason = 'square-off 15:15';
      if (reason) {
        trades.push(closeTrade(open, bar, reason, lots));
        open = null;
      }
      continue;
    }
    const dir = confirmed(bars, i, spec);
    if (!dir) continue;
    const entry = bars[i + spec.confirmBars];
    open = {
      dir,
      spec,
      entryClose: Number(entry.close),
      entryTime: entry.date,
      entryIndex: i + spec.confirmBars,
    };
    i += spec.confirmBars;
  }
  if (open && bars.length) {
    trades.push(closeTrade(open, bars[bars.length - 1], 'session end', lots));
  }
  return trades;
}

function simulate(bars, spec, { fromDate, toDate, lots } = {}) {
  const dates = uniqueDates(bars).filter((d) => {
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });
  const trades = [];
  for (const d of dates) {
    trades.push(...simulateDay(sessionBars(bars, d), spec, lots));
  }
  return trades;
}

function summarize(trades) {
  let optionNetRs = 0;
  let optionNetAfterChargesRs = 0;
  let underlyingPoints = 0;
  let wins = 0;
  let losses = 0;
  for (const t of trades || []) {
    optionNetRs += Number(t.optionPnlRs) || 0;
    optionNetAfterChargesRs += Number(t.netOptionPnlRs) || 0;
    underlyingPoints += Number(t.indexPoints) || 0;
    const net = Number(t.netOptionPnlRs) || 0;
    if (net > 0) wins += 1;
    else if (net < 0) losses += 1;
  }
  return {
    trades: (trades || []).length,
    wins,
    losses,
    optionNetRs: Math.round(optionNetRs),
    optionNetAfterChargesRs: Math.round(optionNetAfterChargesRs),
    underlyingPoints: Math.round(underlyingPoints * 100) / 100,
  };
}

function scoreTrades(trades) {
  const s = summarize(trades);
  return s.optionNetAfterChargesRs + s.wins * 10 - s.losses * 15;
}

function searchSpecs(bars, { trainFrom, trainTo, lots } = {}) {
  const grid = specGrid();
  let best = null;
  for (const spec of grid) {
    const trades = simulate(bars, spec, { fromDate: trainFrom, toDate: trainTo, lots });
    const row = { spec, trades, totals: summarize(trades), score: scoreTrades(trades) };
    if (!best || row.score > best.score || (row.score === best.score && row.totals.trades > best.totals.trades)) {
      best = row;
    }
  }
  return best;
}

function describeSpec(spec) {
  if (!spec) return '';
  return (
    `VWAP impulse after ${spec.startMin}m, confirm ${spec.confirmBars} bar(s), ` +
    `range ≥ ${spec.minRangePts}pt, hold ${spec.holdBars}×5m, stop ${spec.stopPts}pt, ` +
    `giveback ${spec.givebackPts}pt`
  );
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
  const candles =
    deps.candles ||
    (await market.fetchHistorical5m(authorization, NIFTY_TOKEN, warmFrom, toDate));
  const found = searchSpecs(candles, { trainFrom: warmFrom, trainTo, lots: L });
  const spec = found?.spec || specGrid()[0];
  const trades = simulate(candles, spec, { fromDate, toDate, lots: L });
  const totals = summarize(trades);
  const trainTotals = found?.totals || summarize([]);
  return {
    fromDate,
    toDate,
    engine: ENGINE,
    strategy: STRATEGY_FAMILY,
    spec,
    specText: describeSpec(spec),
    train: {
      fromDate: warmFrom,
      toDate: trainTo,
      totals: trainTotals,
    },
    note:
      'Paper searched a new session-VWAP impulse family on days before your From date, then applied the winner to the dates you picked. This is not Genie, Trap, S/R, or the Find scanner. ₹ = Nifty points × 65 × lots (ATM option proxy).',
    totals,
    liveTotals: totals,
    trades: trades.map((t) => ({ ...t, liveWouldTake: true })),
    message: trades.length
      ? undefined
      : 'The discovered spec had no trade on this date. Pick a session day (not a weekend).',
  };
}

module.exports = {
  ENGINE,
  STRATEGY_FAMILY,
  NIFTY_TOKEN,
  addDaysIso,
  specGrid,
  simulate,
  summarize,
  searchSpecs,
  runDiscover,
  describeSpec,
};
