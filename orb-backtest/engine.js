'use strict';

/**
 * First-15 ORB + 5-minute two-low entry.
 *
 * 1. Mark 09:15–09:30 high / low from 5-minute bars (aggregated to 15 minutes).
 * 2. A later 15-minute candle must fully close beyond that range (close > high or close < low).
 *    Wicks through the level without a close beyond it do not count.
 * 3. After that close, on 5-minute bars: uptrend waits for two red candles (two lows) then a
 *    green candle — entry is that green candle's high, stop is its low. Downtrend: two green
 *    candles then a red candle — entry at its low, stop at its high.
 * 4. No automatic target. Print 30-minute mark-to-market and EOD. SL closes the whole trade.
 * 5. Max amount went is the best unrealized rupee move after fill (MFE).
 *
 * Simulated MIS only. No live orders.
 */

const { sessionDate, minutesOfDay } = require('../research/time');

const ENGINE_VERSION = '1.3.155-desk';

const DEFAULTS = {
  orEnd: '09:30',
  entryEnd: '14:30',
  timeExit: '15:15',
  slippage: 0.0005,
  cooldownMin: 0,
  riskFraction: 300 / 40000,
  buyPowerMultiple: 5,
  pullbacksNeeded: 2,
  targetR: null,
  trailAfterR: null,
  orMinPct: null,
  orMaxPct: null,
  minBreakPct: null,
  sizing: 'risk',
  rankBy: 'time',
  crowdFilter: null,
};

/** Two-month ₹10k research winner. Hard name-count cap is 8. */
const WINNER_MAX_STOCKS = 8;
const WINNER_DESK = {
  capital: 10000,
  maxStocksPerDay: 5,
  rankBy: 'stopPct',
  crowdFilter: 'skipShort',
  pullbacksNeeded: 2,
  entryEnd: '14:30',
  timeExit: '15:15',
  targetR: null,
  trailAfterR: null,
  orMinPct: null,
  orMaxPct: null,
  minBreakPct: null,
  sizing: 'risk',
};

function isWinnerPreset(input = {}) {
  const preset = String(input.preset || input.desk || '').trim();
  return preset === 'winner';
}

function applyDeskPreset(input = {}) {
  if (!isWinnerPreset(input)) return input;
  return {
    ...WINNER_DESK,
    ...input,
    rankBy: input.rankBy || WINNER_DESK.rankBy,
    crowdFilter:
      input.crowdFilter === undefined || input.crowdFilter === ''
        ? WINNER_DESK.crowdFilter
        : input.crowdFilter,
    maxStocksPerDay: Math.min(
      WINNER_MAX_STOCKS,
      Math.max(1, Math.floor(Number(input.maxStocksPerDay) || WINNER_DESK.maxStocksPerDay)),
    ),
    capital: Math.max(1000, Number(input.capital) || WINNER_DESK.capital),
  };
}

const SNAPSHOT_TIMES = [
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '12:00',
  '12:30',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:15',
];

function toMin(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return h * 60 + m;
}

function addMin(hm, add) {
  const t = toMin(hm) + add;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function roundPaise(n) {
  return Math.round(n * 100) / 100;
}

function hm(iso) {
  const mins = minutesOfDay(iso);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function chargesRs(buyAmt, sellAmt) {
  const brk = (x) => Math.min(20, x * 0.0003);
  const brokerage = brk(buyAmt) + brk(sellAmt);
  const exchange = (buyAmt + sellAmt) * 0.0000297;
  const stt = sellAmt * 0.00025;
  const stamp = buyAmt * 0.00003;
  const sebi = (buyAmt + sellAmt) * 0.000001;
  return roundPaise(brokerage + exchange + stt + stamp + sebi + (brokerage + exchange + sebi) * 0.18);
}

function barsFromCandles(candles) {
  const out = [];
  for (const c of candles || []) {
    const o = Number(c.open);
    const h = Number(c.high);
    const l = Number(c.low);
    const cl = Number(c.close);
    if (!(o > 0 && h > 0 && l > 0 && cl > 0)) continue;
    const t = hm(c.date);
    if (toMin(t) < toMin('09:15') || toMin(t) > toMin('15:30')) continue;
    out.push({
      t,
      day: sessionDate(c.date),
      o,
      h,
      l,
      c: cl,
      v: Number(c.volume) || 0,
    });
  }
  return out;
}

function groupByDay(bars) {
  const map = {};
  for (const b of bars) (map[b.day] ||= []).push(b);
  for (const day of Object.keys(map)) map[day].sort((a, b) => a.t.localeCompare(b.t));
  return map;
}

function bucketStart15(t) {
  const m = toMin(t);
  const open = toMin('09:15');
  if (m < open) return null;
  const start = open + Math.floor((m - open) / 15) * 15;
  return `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
}

function aggregate15(bars5) {
  const map = {};
  for (const b of bars5 || []) {
    const t = bucketStart15(b.t);
    if (!t) continue;
    const cur = map[t];
    if (!cur) {
      map[t] = { t, day: b.day, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  return Object.values(map).sort((a, b) => a.t.localeCompare(b.t));
}

function isGreen(b) {
  return b.c > b.o;
}

function isRed(b) {
  return b.c < b.o;
}

function mtmRs(side, entryPx, qty, px) {
  return (px - entryPx) * qty * (side === 'L' ? 1 : -1);
}

function backtestStock(symbol, barsByDay, cfg) {
  const trades = [];
  const crosses = [];
  for (const [day, raw] of Object.entries(barsByDay || {})) {
    if (!raw || raw.length < 12) continue;
    const bars5 = [...raw].sort((a, b) => a.t.localeCompare(b.t));
    const bars15 = aggregate15(bars5);
    if (bars15.length < 2 || bars15[0].t !== '09:15') continue;
    const first = bars15[0];
    const orh = first.h;
    const orl = first.l;
    if (!(orh > orl)) continue;
    const orWPct = roundPaise(((orh - orl) / orh) * 100);

    let bias = null;
    let confirm = null;
    for (const b15 of bars15.slice(1)) {
      if (b15.c > orh) {
        bias = 'L';
        confirm = b15;
        break;
      }
      if (b15.c < orl) {
        bias = 'S';
        confirm = b15;
        break;
      }
    }
    if (!bias || !confirm) continue;

    crosses.push({
      symbol,
      day,
      side: bias,
      t: addMin(confirm.t, 15),
      close: roundPaise(confirm.c),
      orh: roundPaise(orh),
      orl: roundPaise(orl),
      orWPct,
      volume: confirm.v,
    });

    const orW = (orh - orl) / orh;
    if (cfg.orMinPct != null && orW < cfg.orMinPct) continue;
    if (cfg.orMaxPct != null && orW > cfg.orMaxPct) continue;
    if (cfg.minBreakPct != null) {
      const level = bias === 'L' ? orh : orl;
      if (Math.abs(confirm.c - level) / confirm.c < cfg.minBreakPct) continue;
    }

    const pullbacksNeeded = Number.isFinite(cfg.pullbacksNeeded) ? cfg.pullbacksNeeded : 2;
    const scanFrom = addMin(confirm.t, 15);
    const startIdx = bars5.findIndex((b) => b.t >= scanFrom);
    if (startIdx < 0) continue;

    let pullbacks = 0;
    let pending = null;
    let position = null;
    let extremePx = null;
    const marks = [];
    const snap = new Set(SNAPSHOT_TIMES);

    const exitTrade = (b, price, reason) => {
      const pnl = mtmRs(position.side, position.entryPx, position.qty, price);
      const chg = chargesRs(position.entryPx * position.qty, price * position.qty);
      const fav =
        position.side === 'L'
          ? (extremePx - position.entryPx) * position.qty
          : (position.entryPx - extremePx) * position.qty;
      trades.push({
        symbol,
        day,
        side: position.side,
        entryT: position.entryT,
        exitT: b.t,
        exitReason: reason,
        entryPx: roundPaise(position.entryPx),
        exitPx: roundPaise(price),
        stopPx: roundPaise(position.stopPx),
        qty: position.qty,
        grossRs: roundPaise(pnl),
        chargesRs: chg,
        netRs: roundPaise(pnl - chg),
        notionalRs: roundPaise(position.entryPx * position.qty),
        maxWentRs: roundPaise(Math.max(0, fav)),
        maxWentPx: roundPaise(extremePx),
        signalT: position.signalT,
        orWPct,
        tgtPx: position.tgtPx != null ? roundPaise(position.tgtPx) : null,
        marks: marks.map((m) => ({ ...m })),
      });
      position = null;
    };

    const tryFill = (b) => {
      if (!pending) return;
      const side = pending.side;
      const hit = side === 'L' ? b.h >= pending.entryPx : b.l <= pending.entryPx;
      if (!hit) return;
      const fill = side === 'L' ? (b.o > pending.entryPx ? b.o : pending.entryPx) : b.o < pending.entryPx ? b.o : pending.entryPx;
      const riskPx = side === 'L' ? fill - pending.stopPx : pending.stopPx - fill;
      if (!(riskPx > 0)) {
        pending = null;
        return;
      }
      let qty;
      if (cfg.sizing === 'equal') {
        const notional = cfg.equalNotional || cfg.capital / Math.max(1, cfg.maxStocksPerDay || 3);
        qty = Math.max(1, Math.floor(notional / fill));
      } else {
        qty = Math.max(1, Math.floor(cfg.riskPerTrade / riskPx));
      }
      if (qty * fill > cfg.buyPower) {
        pending = null;
        return;
      }
      const entryPx = side === 'L' ? fill * (1 + cfg.slippage) : fill * (1 - cfg.slippage);
      const tgtPx =
        cfg.targetR > 0
          ? side === 'L'
            ? entryPx + riskPx * cfg.targetR
            : entryPx - riskPx * cfg.targetR
          : null;
      position = {
        side,
        entryPx,
        stopPx: pending.stopPx,
        qty,
        entryT: b.t,
        signalT: pending.signalT,
        riskPx,
        tgtPx,
      };
      extremePx = side === 'L' ? b.h : b.l;
      pending = null;
      const stopped = side === 'L' ? b.l <= position.stopPx : b.h >= position.stopPx;
      if (stopped) exitTrade(b, position.stopPx, 'SL');
    };

    for (let i = startIdx; i < bars5.length; i += 1) {
      const b = bars5[i];
      const m = toMin(b.t);

      if (position) {
        if (position.side === 'L') {
          if (b.h > extremePx) extremePx = b.h;
        } else if (b.l < extremePx) extremePx = b.l;
        const stopped = position.side === 'L' ? b.l <= position.stopPx : b.h >= position.stopPx;
        if (stopped) {
          exitTrade(b, position.stopPx, 'SL');
          break;
        }
        if (position.tgtPx != null) {
          const hitTgt = position.side === 'L' ? b.h >= position.tgtPx : b.l <= position.tgtPx;
          if (hitTgt) {
            exitTrade(b, position.tgtPx, 'TARGET');
            break;
          }
        }
        if (cfg.trailAfterR > 0 && position.riskPx > 0) {
          const favMove = position.side === 'L' ? extremePx - position.entryPx : position.entryPx - extremePx;
          if (favMove >= cfg.trailAfterR * position.riskPx) {
            if (position.side === 'L' && position.stopPx < position.entryPx) position.stopPx = position.entryPx;
            if (position.side === 'S' && position.stopPx > position.entryPx) position.stopPx = position.entryPx;
          }
        }
        if (snap.has(b.t)) {
          marks.push({
            t: b.t,
            px: roundPaise(b.c),
            mtmRs: roundPaise(mtmRs(position.side, position.entryPx, position.qty, b.c)),
            label: b.t === cfg.timeExit ? 'EOD' : b.t,
          });
        }
        if (m >= toMin(cfg.timeExit)) {
          exitTrade(b, b.c, 'EOD');
          break;
        }
        continue;
      }

      if (pending) {
        tryFill(b);
        if (!position && m >= toMin(cfg.timeExit)) break;
        if (position) {
          i -= 1;
        }
        continue;
      }

      if (m > toMin(cfg.entryEnd)) break;

      if (bias === 'L') {
        if (isRed(b)) pullbacks += 1;
        else if (isGreen(b)) {
          if (pullbacks >= pullbacksNeeded) pending = { side: 'L', entryPx: b.h, stopPx: b.l, signalT: b.t };
          pullbacks = 0;
        }
      } else if (isGreen(b)) pullbacks += 1;
      else if (isRed(b)) {
        if (pullbacks >= pullbacksNeeded) pending = { side: 'S', entryPx: b.l, stopPx: b.h, signalT: b.t };
        pullbacks = 0;
      }
    }
    if (position) {
      const last = bars5[bars5.length - 1];
      exitTrade(last, last.c, 'EOD');
    }
  }
  return { trades, crosses };
}

function indexDirection(barsByDay) {
  const mk = {};
  for (const [day, bars] of Object.entries(barsByDay || {})) {
    let cumPV = 0;
    let cumV = 0;
    const m = {};
    for (const b of bars) {
      cumPV += b.c * b.v;
      cumV += b.v;
      const vwap = cumV > 0 ? cumPV / cumV : b.c;
      m[b.t] = b.c > vwap ? 1 : b.c < vwap ? -1 : 0;
    }
    mk[day] = m;
  }
  return mk;
}

function stopPctOf(t) {
  const risk = t.side === 'L' ? t.entryPx - t.stopPx : t.stopPx - t.entryPx;
  return t.entryPx > 0 ? (100 * risk) / t.entryPx : 0;
}

function dayCrowdFromCrosses(crosses) {
  const counts = {};
  for (const c of crosses || []) {
    if (c.t !== '09:45') continue;
    const row = (counts[c.day] ||= { L: 0, S: 0 });
    if (c.side === 'L') row.L += 1;
    else if (c.side === 'S') row.S += 1;
  }
  const crowd = {};
  for (const [day, row] of Object.entries(counts)) {
    const n = row.L + row.S;
    const longPct = n ? row.L / n : 0.5;
    crowd[day] = longPct >= 0.6 ? 'L' : longPct <= 0.4 ? 'S' : 'M';
  }
  return crowd;
}

function filterByCrowd(trades, crowd, mode) {
  if (!mode) return trades;
  return (trades || []).filter((t) => {
    const c = crowd[t.day];
    if (!c) return true;
    if (mode === 'skipShort') return c !== 'S';
    if (mode === 'skipLong') return c !== 'L';
    if (mode === 'follow') return c === 'M' || t.side === c;
    return true;
  });
}

function selectDeskTrades(allTrades, cfg) {
  const byDay = {};
  for (const t of allTrades) (byDay[t.day] ||= []).push(t);
  const desk = [];
  for (const day of Object.keys(byDay).sort()) {
    const list = [...byDay[day]].sort((a, b) => {
      if (cfg.rankBy === 'orWidth') {
        return (b.orWPct || 0) - (a.orWPct || 0) || a.entryT.localeCompare(b.entryT) || a.symbol.localeCompare(b.symbol);
      }
      if (cfg.rankBy === 'stopPct') {
        return stopPctOf(b) - stopPctOf(a) || a.entryT.localeCompare(b.entryT) || a.symbol.localeCompare(b.symbol);
      }
      return a.entryT.localeCompare(b.entryT) || a.symbol.localeCompare(b.symbol);
    });
    const used = new Set();
    let cooldownUntil = '';
    for (const t of list) {
      if (used.size >= cfg.maxStocksPerDay) break;
      if (used.has(t.symbol)) continue;
      if (cfg.cooldownMin && cooldownUntil && t.entryT < cooldownUntil) continue;
      used.add(t.symbol);
      desk.push(t);
      cooldownUntil = addMin(String(t.exitT).slice(0, 5), cfg.cooldownMin || 0);
    }
  }
  return desk;
}

function markAt(trade, tm) {
  if (trade.entryT > tm) return null;
  if (trade.exitT <= tm) return { mtmRs: trade.netRs, closed: true };
  const row = (trade.marks || []).filter((m) => m.t <= tm).pop();
  if (row) return { mtmRs: row.mtmRs, closed: false };
  return { mtmRs: 0, closed: false };
}

function buildSnapshots(trades) {
  const byDay = {};
  for (const t of trades) (byDay[t.day] ||= []).push(t);
  const rows = [];
  for (const day of Object.keys(byDay).sort()) {
    for (const tm of SNAPSHOT_TIMES) {
      let net = 0;
      let slHits = 0;
      let open = 0;
      let taken = 0;
      let maxWent = 0;
      for (const tr of byDay[day]) {
        const mark = markAt(tr, tm);
        if (!mark) continue;
        taken += 1;
        net += mark.mtmRs;
        if (!mark.closed) open += 1;
        if (tr.exitReason === 'SL' && tr.exitT <= tm) slHits += 1;
        if (tr.entryT <= tm) maxWent += tr.maxWentRs || 0;
      }
      rows.push({
        day,
        t: tm,
        label: tm === '15:15' ? 'EOD' : tm,
        netRs: roundPaise(net),
        slHits,
        open,
        taken,
        maxWentRs: roundPaise(maxWent),
      });
    }
  }
  return rows;
}

function summarize(trades, capital) {
  const wins = trades.filter((t) => t.netRs > 0);
  const losses = trades.filter((t) => t.netRs < 0);
  const slHits = trades.filter((t) => t.exitReason === 'SL');
  const eod = trades.filter((t) => t.exitReason === 'EOD');
  const net = trades.reduce((s, t) => s + t.netRs, 0);
  const notionals = trades.map((t) => t.notionalRs || t.entryPx * t.qty);
  const maxNotional = notionals.length ? Math.max(...notionals) : 0;
  const maxWentRs = trades.reduce((m, t) => Math.max(m, t.maxWentRs || 0), 0);
  const byDay = {};
  for (const t of trades) {
    byDay[t.day] ||= 0;
    byDay[t.day] += t.netRs;
  }
  const days = Object.keys(byDay).sort();
  let equity = capital;
  let peak = capital;
  let maxDd = 0;
  const curve = [{ day: days[0] ? priorDay(days[0]) : null, equity: capital }].filter((r) => r.day);
  curve.push({ day: 'start', equity: capital });
  for (const day of days) {
    equity += byDay[day];
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
    curve.push({ day, equity: roundPaise(equity) });
  }
  const byStock = {};
  for (const t of trades) {
    const row = (byStock[t.symbol] ||= { symbol: t.symbol, trades: 0, wins: 0, netRs: 0, slHits: 0, maxWentRs: 0 });
    row.trades += 1;
    if (t.netRs > 0) row.wins += 1;
    if (t.exitReason === 'SL') row.slHits += 1;
    row.netRs += t.netRs;
    row.maxWentRs += t.maxWentRs || 0;
  }
  const stocks = Object.values(byStock)
    .map((r) => ({
      ...r,
      netRs: roundPaise(r.netRs),
      maxWentRs: roundPaise(r.maxWentRs),
      winRate: r.trades ? r.wins / r.trades : 0,
    }))
    .sort((a, b) => b.netRs - a.netRs);

  const eodByDay = days.map((day) => ({
    day,
    netRs: roundPaise(byDay[day]),
    trades: trades.filter((t) => t.day === day).length,
    slHits: trades.filter((t) => t.day === day && t.exitReason === 'SL').length,
    maxWentRs: roundPaise(trades.filter((t) => t.day === day).reduce((s, t) => s + (t.maxWentRs || 0), 0)),
  }));

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netPnl: roundPaise(net),
    returnPct: capital > 0 ? net / capital : 0,
    maxDrawdown: roundPaise(maxDd),
    capitalUtilized: roundPaise(maxNotional),
    capitalUtilizedPct: capital > 0 ? maxNotional / capital : 0,
    avgWin: wins.length ? roundPaise(wins.reduce((s, t) => s + t.netRs, 0) / wins.length) : 0,
    avgLoss: losses.length ? roundPaise(losses.reduce((s, t) => s + t.netRs, 0) / losses.length) : 0,
    equityCurve: curve.filter((r) => r.day !== 'start' || curve.length === 1),
    stocks,
    days: days.length,
    slHits: slHits.length,
    eodExits: eod.length,
    maxWentRs: roundPaise(maxWentRs),
    snapshots: buildSnapshots(trades),
    eod: eodByDay,
  };
}

function priorDay(day) {
  const d = new Date(`${day}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() - 1);
  return sessionDate(d);
}

function clampConfig(input = {}) {
  const src = applyDeskPreset(input);
  const capital = Math.max(1000, Math.min(10_000_000, Number(src.capital) || 40000));
  const maxStocksPerDay = Math.max(1, Math.min(50, Math.floor(Number(src.maxStocksPerDay) || 3)));
  const pullbacksNeeded = Math.max(1, Math.min(5, Math.floor(Number(src.pullbacksNeeded) || DEFAULTS.pullbacksNeeded)));
  const entryEnd = String(src.entryEnd || DEFAULTS.entryEnd);
  const timeExit = String(src.timeExit || DEFAULTS.timeExit);
  const targetR = src.targetR == null || src.targetR === '' ? null : Math.max(0.5, Math.min(10, Number(src.targetR)));
  const trailAfterR =
    src.trailAfterR == null || src.trailAfterR === '' ? null : Math.max(0.5, Math.min(10, Number(src.trailAfterR)));
  const slippage = Math.max(0, Math.min(0.01, Number(src.slippage ?? DEFAULTS.slippage)));
  const sizing = src.sizing === 'equal' ? 'equal' : 'risk';
  const rankBy = src.rankBy === 'orWidth' ? 'orWidth' : src.rankBy === 'stopPct' ? 'stopPct' : 'time';
  const crowdFilter =
    src.crowdFilter === 'skipShort' || src.crowdFilter === 'skipLong' || src.crowdFilter === 'follow'
      ? src.crowdFilter
      : null;
  return {
    ...DEFAULTS,
    capital,
    maxStocksPerDay,
    pullbacksNeeded,
    entryEnd,
    timeExit,
    targetR,
    trailAfterR,
    orMinPct: src.orMinPct == null || src.orMinPct === '' ? null : Number(src.orMinPct),
    orMaxPct: src.orMaxPct == null || src.orMaxPct === '' ? null : Number(src.orMaxPct),
    minBreakPct: src.minBreakPct == null || src.minBreakPct === '' ? null : Number(src.minBreakPct),
    sizing,
    rankBy,
    crowdFilter,
    slippage,
    equalNotional: capital / maxStocksPerDay,
    riskPerTrade: capital * DEFAULTS.riskFraction,
    buyPower: capital * DEFAULTS.buyPowerMultiple,
  };
}

function runOrbBacktest({ symbolBars, indexBars, config }) {
  const cfg = clampConfig(config);
  const all = [];
  const crosses = [];
  for (const [symbol, barsByDay] of Object.entries(symbolBars || {})) {
    const out = backtestStock(symbol, barsByDay, cfg);
    all.push(...out.trades);
    crosses.push(...out.crosses);
  }
  const crowd = dayCrowdFromCrosses(crosses);
  const filtered = filterByCrowd(all, crowd, cfg.crowdFilter);
  const desk = selectDeskTrades(filtered, cfg);
  const takenKeys = new Set(desk.map((t) => `${t.day}|${t.symbol}`));
  const qualifiedKeys = new Set(all.map((t) => `${t.day}|${t.symbol}`));
  const crossed = crosses
    .map((c) => ({
      ...c,
      qualified: qualifiedKeys.has(`${c.day}|${c.symbol}`),
      taken: takenKeys.has(`${c.day}|${c.symbol}`),
    }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.t.localeCompare(b.t) || a.symbol.localeCompare(b.symbol));
  const summary = summarize(desk, cfg.capital);
  summary.orbCrossed = crossed.length;
  summary.orbCrossedTaken = crossed.filter((c) => c.taken).length;
  return {
    simulated: true,
    liveOrders: false,
    config: {
      capital: cfg.capital,
      maxStocksPerDay: cfg.maxStocksPerDay,
      orEnd: cfg.orEnd,
      entryEnd: cfg.entryEnd,
      timeExit: cfg.timeExit,
      pullbacksNeeded: cfg.pullbacksNeeded,
      targetR: cfg.targetR,
      trailAfterR: cfg.trailAfterR,
      sizing: cfg.sizing,
      rankBy: cfg.rankBy,
      crowdFilter: cfg.crowdFilter,
      engineVersion: ENGINE_VERSION,
    },
    assumptions: [
      'Simulated MIS backtest. No live orders are placed.',
      'First 15-minute candle (09:15–09:30 IST) marks high and low. A later 15-minute candle must fully close above that high or below that low. A wick through the level without a close beyond it does not count.',
      'After the 15-minute close, 5-minute bars: uptrend waits for two red candles (two lows) then a green candle — buy the green high, stop at the green low. Downtrend waits for two green candles then a red candle — sell the red low, stop at the red high.',
      'No automatic target. Every 30 minutes the book is marked, and leftover positions exit at the 15:15 close (EOD). A stop closes the whole trade.',
      'Max amount went is the best rupee move in the trade’s favour after fill. Qty sizes to ~0.75% of starting capital of candle-range risk, notional capped at 5× capital. Fill slippage 0.05% on entry plus approximate Zerodha MIS charges.',
      'ORB crossed is every name whose 15-minute candle fully closed beyond the first 15-minute range, even if the 5-minute two-low pattern or the max-stocks desk skipped it.',
      'Optional crowdFilter uses only 09:45 full closes (knowable before most entries). skipShort sits out days whose 09:45 closes are ≤40% long. follow takes only the majority side; mixed days allow either. Optional rankBy stopPct picks the widest signal-candle stop as a percent of price, not same-day P/L.',
    ],
    rawTrades: all.length,
    summary,
    trades: desk,
    crosses: crossed,
    snapshots: summary.snapshots,
  };
}

module.exports = {
  ENGINE_VERSION,
  DEFAULTS,
  WINNER_DESK,
  WINNER_MAX_STOCKS,
  applyDeskPreset,
  SNAPSHOT_TIMES,
  barsFromCandles,
  groupByDay,
  aggregate15,
  backtestStock,
  indexDirection,
  selectDeskTrades,
  dayCrowdFromCrosses,
  filterByCrowd,
  stopPctOf,
  summarize,
  clampConfig,
  runOrbBacktest,
  toMin,
  hm,
};
