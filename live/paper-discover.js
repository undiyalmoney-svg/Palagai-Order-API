'use strict';
/**
 * Paper strategy discovery — not Genie, Trap, S/R, ee-wait, order-flow,
 * and not the retired session-VWAP impulse family.
 *
 * Active family: opening-range failure (fade).
 * Build the first N minutes of the NSE cash session. If price breaks that
 * range and then closes back inside, buy the opposite ATM proxy (failed high
 * → PE, failed low → CE). One trade per day. Stop / R-target / 15:15.
 *
 * Search uses sessions strictly before From. Trades are only inside From→To.
 */

const defaultMarket = require('./kite-market');

const ENGINE = 'or-failure';
const STRATEGY_FAMILY = 'opening-range-failure';
const RETIRED_FAMILIES = ['session-vwap-impulse', 'vwap-impulse'];
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

function specGrid() {
  const grid = [];
  for (const orMinutes of [15, 30]) {
    for (const bufferPts of [0, 5]) {
      for (const minOrWidth of [12, 20]) {
        for (const stopPts of [15, 25]) {
          for (const targetR of [1, 2]) {
            for (const holdBars of [8, 16]) {
              grid.push({
                engine: ENGINE,
                family: STRATEGY_FAMILY,
                orMinutes,
                bufferPts,
                minOrWidth,
                stopPts,
                targetR,
                holdBars,
              });
            }
          }
        }
      }
    }
  }
  return grid;
}

function openingRange(bars, orMinutes) {
  const endHm = hmPlus(915, orMinutes);
  const orBars = (bars || []).filter((b) => barHm(b) < endHm);
  if (orBars.length < 2) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const b of orBars) {
    high = Math.max(high, Number(b.high));
    low = Math.min(low, Number(b.low));
  }
  return { high, low, endHm, width: high - low };
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
  const bars = dayBars || [];
  const or = openingRange(bars, spec.orMinutes);
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
      else if (hm >= 1515) reason = 'square-off 15:15';
      if (reason) {
        trades.push(closeTrade(open, bar, reason, lots));
        open = null;
        break;
      }
      continue;
    }
    if (hm < or.endHm || hm > 1415) continue;
    if (!broke) {
      if (Number(bar.close) > or.high + spec.bufferPts) broke = 1;
      else if (Number(bar.close) < or.low - spec.bufferPts) broke = -1;
      continue;
    }
    const failed =
      (broke > 0 && Number(bar.close) < or.high) || (broke < 0 && Number(bar.close) > or.low);
    if (!failed) continue;
    const dir = -broke;
    open = {
      dir,
      spec,
      entryClose: Number(bar.close),
      entryTime: bar.date,
      entryIndex: i,
    };
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
  if (s.trades < 3) return s.optionNetAfterChargesRs - 500;
  return s.optionNetAfterChargesRs + s.wins * 20 - s.losses * 25;
}

function searchSpecs(bars, { trainFrom, trainTo, lots } = {}) {
  const grid = specGrid();
  let best = null;
  for (const spec of grid) {
    if (RETIRED_FAMILIES.includes(spec.family) || RETIRED_FAMILIES.includes(spec.engine)) continue;
    const trades = simulate(bars, spec, { fromDate: trainFrom, toDate: trainTo, lots });
    const row = { spec, trades, totals: summarize(trades), score: scoreTrades(trades) };
    if (!best || row.score > best.score) best = row;
  }
  return best;
}

function describeSpec(spec) {
  if (!spec) return '';
  return (
    `OR failure fade · ${spec.orMinutes}m range, buffer ${spec.bufferPts}pt, ` +
    `min width ${spec.minOrWidth}pt, stop ${spec.stopPts}pt, ${spec.targetR}R, ` +
    `hold ${spec.holdBars}×5m`
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
  return {
    fromDate,
    toDate,
    engine: ENGINE,
    strategy: STRATEGY_FAMILY,
    skipped: RETIRED_FAMILIES,
    spec,
    specText: describeSpec(spec),
    train: {
      fromDate: warmFrom,
      toDate: trainTo,
      totals: found?.totals || summarize([]),
    },
    note:
      'VWAP impulse was dropped. Paper now searches opening-range failure (fade a break that cannot hold) on days before From, then applies that spec to your dates. Not Genie / Trap / S/R / Find. ₹ = Nifty points × 65 × lots (ATM option proxy). Max one trade per session.',
    totals,
    liveTotals: totals,
    trades: trades.map((t) => ({ ...t, liveWouldTake: true })),
    message: trades.length
      ? undefined
      : 'The OR-failure spec had no fade on this date. Pick a session day (not a weekend).',
  };
}

module.exports = {
  ENGINE,
  STRATEGY_FAMILY,
  RETIRED_FAMILIES,
  NIFTY_TOKEN,
  addDaysIso,
  specGrid,
  simulate,
  summarize,
  searchSpecs,
  runDiscover,
  describeSpec,
};
