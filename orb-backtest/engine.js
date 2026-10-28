'use strict';

/**
 * Stock ORB desk — entry and stop from scripts/stock-orb-backtest.js.
 *
 * Opening range 09:15–09:45. 5-minute close through ORH/ORL in 09:50–14:30.
 * Stop = R, R = clamp(OR width × 0.5, 0.30%, 0.60%). Target = targetR × R (default 2).
 * Time exit 14:50. MIS charges + 0.05% fill slippage.
 *
 * Filters already in that script are kept (OR width, gap, volume, close-break, EMA20).
 * No extra trend/volume/indicator gates are added here.
 */

const { sessionDate, minutesOfDay } = require('../research/time');

const DEFAULTS = {
  orEnd: '09:45',
  entryStart: '09:50',
  entryEnd: '14:30',
  timeExit: '14:50',
  breakPct: 0.0004,
  volMult: 1.2,
  orMinPct: 0.002,
  orMaxPct: 0.03,
  maxGapPct: 0.02,
  rPctFloor: 0.003,
  rPctCeil: 0.006,
  rPctFromOr: 0.5,
  targetR: 2,
  slippage: 0.0005,
  cooldownMin: 15,
  /** ₹300 risk on the original ₹40,000 book. */
  riskFraction: 300 / 40000,
  buyPowerMultiple: 5,
};

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

function ema(prev, price, n) {
  if (prev == null) return price;
  return price * (2 / (n + 1)) + prev * (1 - 2 / (n + 1));
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

function backtestStock(symbol, barsByDay, cfg, indexDir) {
  const trades = [];
  const crosses = [];
  for (const [day, bars] of Object.entries(barsByDay)) {
    if (!bars || bars.length < 12) continue;
    const first = bars[0];
    const prevClose =
      first.o === first.c && first.o === first.l && first.o === first.h
        ? first.o
        : bars.find((b) => b.h !== b.l)?.o || first.o;
    if (!(prevClose > 0) || Math.abs(first.o - prevClose) / prevClose > cfg.maxGapPct) continue;

    const orr = bars.filter((b) => toMin(b.t) <= toMin(cfg.orEnd));
    if (orr.length < 2) continue;
    const orh = Math.max(...orr.map((b) => b.h));
    const orl = Math.min(...orr.map((b) => b.l));
    const orW = (orh - orl) / prevClose;
    if (orW < cfg.orMinPct || orW > cfg.orMaxPct) continue;
    const orAvgV = orr.reduce((s, b) => s + b.v, 0) / Math.max(1, orr.length);

    let ema20 = null;
    let position = null;
    let recordedCross = false;
    const exitTrade = (b, price, reason) => {
      const pnl = (price - position.entryPx) * position.qty * (position.side === 'L' ? 1 : -1);
      const chg = chargesRs(position.entryPx * position.qty, price * position.qty);
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
        tgtPx: roundPaise(position.tgtPx),
        qty: position.qty,
        grossRs: roundPaise(pnl),
        chargesRs: chg,
        netRs: roundPaise(pnl - chg),
        notionalRs: roundPaise(position.entryPx * position.qty),
      });
      position = null;
    };

    for (const b of bars) {
      ema20 = ema(ema20, b.c, 20);
      const m = toMin(b.t);
      if (position) {
        let done = false;
        if (position.side === 'L') {
          if (b.l <= position.stopPx) {
            exitTrade(b, position.stopPx, 'SL');
            done = true;
          } else if (b.h >= position.tgtPx) {
            exitTrade(b, position.tgtPx, 'TARGET');
            done = true;
          }
        } else if (b.h >= position.stopPx) {
          exitTrade(b, position.stopPx, 'SL');
          done = true;
        } else if (b.l <= position.tgtPx) {
          exitTrade(b, position.tgtPx, 'TARGET');
          done = true;
        }
        if (!done && m >= toMin(cfg.timeExit)) exitTrade(b, b.c, 'TIME');
        continue;
      }
      if (m < toMin(cfg.entryStart) || m > toMin(cfg.entryEnd)) continue;

      const carry = (side) => {
        const levelPx = side === 'L' ? orh : orl;
        if (b.v < orAvgV * cfg.volMult || Math.abs(b.c - levelPx) / b.c < cfg.breakPct) return;
        if (side === 'L' ? b.c <= ema20 : b.c >= ema20) return;
        if (indexDir) {
          const mdir = indexDir[day]?.[b.t];
          if (mdir != null && ((side === 'L' && mdir < 0) || (side === 'S' && mdir > 0))) return;
        }
        const rPct = Math.max(cfg.rPctFloor, Math.min(cfg.rPctCeil, orW * cfg.rPctFromOr));
        const riskPx = b.c * rPct;
        const qty = Math.max(1, Math.floor(cfg.riskPerTrade / riskPx));
        if (qty * b.c > cfg.buyPower) return;
        const entryPx = side === 'L' ? b.c * (1 + cfg.slippage) : b.c * (1 - cfg.slippage);
        const stopPx = side === 'L' ? entryPx - riskPx : entryPx + riskPx;
        const tgtPx = side === 'L' ? entryPx + riskPx * cfg.targetR : entryPx - riskPx * cfg.targetR;
        position = { side, entryPx, stopPx, tgtPx, qty, entryT: b.t };
      };
      if (b.c > orh && b.o <= orh) {
        if (!recordedCross) {
          recordedCross = true;
          crosses.push({
            symbol,
            day,
            side: 'L',
            t: b.t,
            close: roundPaise(b.c),
            orh: roundPaise(orh),
            orl: roundPaise(orl),
            orWPct: roundPaise(orW * 100),
            volume: b.v,
          });
        }
        carry('L');
      } else if (b.c < orl && b.o >= orl) {
        if (!recordedCross) {
          recordedCross = true;
          crosses.push({
            symbol,
            day,
            side: 'S',
            t: b.t,
            close: roundPaise(b.c),
            orh: roundPaise(orh),
            orl: roundPaise(orl),
            orWPct: roundPaise(orW * 100),
            volume: b.v,
          });
        }
        carry('S');
      }
    }
    if (position) {
      const last = bars[bars.length - 1];
      exitTrade(last, last.c, 'TIME');
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

function selectDeskTrades(allTrades, cfg) {
  const byDay = {};
  for (const t of allTrades) (byDay[t.day] ||= []).push(t);
  const desk = [];
  for (const day of Object.keys(byDay).sort()) {
    const list = [...byDay[day]].sort((a, b) => a.entryT.localeCompare(b.entryT) || a.symbol.localeCompare(b.symbol));
    const used = new Set();
    let cooldownUntil = '';
    for (const t of list) {
      if (used.size >= cfg.maxStocksPerDay) break;
      if (used.has(t.symbol)) continue;
      if (cooldownUntil && t.entryT < cooldownUntil) continue;
      used.add(t.symbol);
      desk.push(t);
      cooldownUntil = addMin(String(t.exitT).slice(0, 5), cfg.cooldownMin);
    }
  }
  return desk;
}

function summarize(trades, capital) {
  const wins = trades.filter((t) => t.netRs > 0);
  const losses = trades.filter((t) => t.netRs < 0);
  const net = trades.reduce((s, t) => s + t.netRs, 0);
  const notionals = trades.map((t) => t.notionalRs || t.entryPx * t.qty);
  const maxNotional = notionals.length ? Math.max(...notionals) : 0;
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
    const row = (byStock[t.symbol] ||= { symbol: t.symbol, trades: 0, wins: 0, netRs: 0 });
    row.trades += 1;
    if (t.netRs > 0) row.wins += 1;
    row.netRs += t.netRs;
  }
  const stocks = Object.values(byStock)
    .map((r) => ({
      ...r,
      netRs: roundPaise(r.netRs),
      winRate: r.trades ? r.wins / r.trades : 0,
    }))
    .sort((a, b) => b.netRs - a.netRs);

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
  };
}

function priorDay(day) {
  const d = new Date(`${day}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() - 1);
  return sessionDate(d);
}

function clampConfig(input = {}) {
  const capital = Math.max(1000, Math.min(10_000_000, Number(input.capital) || 40000));
  const maxStocksPerDay = Math.max(1, Math.min(50, Math.floor(Number(input.maxStocksPerDay) || 3)));
  const targetR = Math.max(0.5, Math.min(10, Number(input.targetR) || DEFAULTS.targetR));
  return {
    ...DEFAULTS,
    capital,
    maxStocksPerDay,
    targetR,
    riskPerTrade: capital * DEFAULTS.riskFraction,
    buyPower: capital * DEFAULTS.buyPowerMultiple,
  };
}

function runOrbBacktest({ symbolBars, indexBars, config }) {
  const cfg = clampConfig(config);
  const indexDir = indexBars ? indexDirection(indexBars) : null;
  const all = [];
  const crosses = [];
  for (const [symbol, barsByDay] of Object.entries(symbolBars || {})) {
    const out = backtestStock(symbol, barsByDay, cfg, indexDir);
    all.push(...out.trades);
    crosses.push(...out.crosses);
  }
  const desk = selectDeskTrades(all, cfg);
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
      targetR: cfg.targetR,
      orEnd: cfg.orEnd,
      entryStart: cfg.entryStart,
      entryEnd: cfg.entryEnd,
      timeExit: cfg.timeExit,
    },
    assumptions: [
      'Simulated MIS backtest. No live orders are placed.',
      'Opening range is 09:15–09:45 IST on 5-minute bars. Entry is a close through ORH/ORL between 09:50 and 14:30. Stop is 1R; target is configurable R multiples. Time exit 14:50.',
      'R is clamp(opening-range width × 0.5, 0.30%, 0.60%) of price. Qty sizes to ~0.75% of starting capital of risk, notional capped at 5× capital.',
      'Fill slippage 0.05%/side plus approximate Zerodha MIS charges. Existing OR-width, gap, volume, close-break and EMA20 gates from the stock ORB script are kept; no extra filters were added.',
      'ORB crossed is the first 5-minute close through ORH/ORL in the entry window, even if volume/EMA or the max-stocks desk skipped the name.',
    ],
    rawTrades: all.length,
    summary,
    trades: desk,
    crosses: crossed,
  };
}

module.exports = {
  DEFAULTS,
  barsFromCandles,
  groupByDay,
  backtestStock,
  indexDirection,
  selectDeskTrades,
  summarize,
  clampConfig,
  runOrbBacktest,
  toMin,
  hm,
};
