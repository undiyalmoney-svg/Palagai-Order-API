'use strict';

function roundPaise(n) {
  return Math.round(n * 100) / 100;
}

function isoWeek(day) {
  const d = new Date(`${day}T12:00:00+05:30`);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - new Date(Date.UTC(y, 0, 1))) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

function scoreTrades(trades, capital, tradingDays) {
  const list = trades || [];
  const net = list.reduce((s, t) => s + (t.netRs || 0), 0);
  const wins = list.filter((t) => t.netRs > 0);
  const losses = list.filter((t) => t.netRs < 0);
  const grossWin = wins.reduce((s, t) => s + t.netRs, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netRs, 0));
  const byDay = {};
  for (const t of list) {
    byDay[t.day] ||= 0;
    byDay[t.day] += t.netRs;
  }
  const days = Object.keys(byDay).sort();
  let equity = capital;
  let peak = capital;
  let maxDd = 0;
  const curve = [{ day: 'start', equity: capital }];
  for (const day of days) {
    equity += byDay[day];
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
    curve.push({ day, equity: roundPaise(equity) });
  }
  const weekNet = {};
  for (const day of days) {
    const w = isoWeek(day);
    weekNet[w] ||= 0;
    weekNet[w] += byDay[day];
  }
  const weeks = Object.keys(weekNet).sort();
  const profitableDays = days.filter((d) => byDay[d] > 0).length;
  const profitableWeeks = weeks.filter((w) => weekNet[w] > 0).length;
  const sessionDays = (tradingDays && tradingDays.length ? tradingDays : days).length;
  const byStock = {};
  for (const t of list) {
    const row = (byStock[t.symbol] ||= { symbol: t.symbol, trades: 0, netRs: 0, wins: 0 });
    row.trades += 1;
    row.netRs += t.netRs;
    if (t.netRs > 0) row.wins += 1;
  }
  const stocks = Object.values(byStock)
    .map((r) => ({ ...r, netRs: roundPaise(r.netRs) }))
    .sort((a, b) => b.netRs - a.netRs);
  const absNets = stocks.map((s) => Math.abs(s.netRs));
  const absSum = absNets.reduce((s, n) => s + n, 0) || 1;
  const hhi = absNets.reduce((s, n) => s + (n / absSum) ** 2, 0);
  const notionals = list.map((t) => t.notionalRs || t.entryPx * t.qty);
  const maxNotional = notionals.length ? Math.max(...notionals) : 0;
  const expectancy = list.length ? net / list.length : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : wins.length ? 99 : 0;
  const profitable = net > 0;
  return {
    trades: list.length,
    wins: wins.length,
    losses: losses.length,
    winRate: list.length ? wins.length / list.length : 0,
    netPnl: roundPaise(net),
    returnPct: capital > 0 ? net / capital : 0,
    maxDrawdown: roundPaise(maxDd),
    profitFactor: roundPaise(profitFactor),
    expectancy: roundPaise(expectancy),
    profitableDayPct: sessionDays ? profitableDays / sessionDays : 0,
    profitableWeekPct: weeks.length ? profitableWeeks / weeks.length : 0,
    days: days.length,
    weeks: weeks.length,
    sessionDays,
    capitalUtilized: roundPaise(maxNotional),
    capitalUtilizedPct: capital > 0 ? maxNotional / capital : 0,
    stockConcentration: roundPaise(hhi),
    profitable,
    slHits: list.filter((t) => t.exitReason === 'SL').length,
    targetExits: list.filter((t) => t.exitReason === 'TARGET').length,
    eodExits: list.filter((t) => t.exitReason === 'EOD').length,
    stocks,
    equityCurve: curve,
    byDay,
    weekNet,
  };
}

function minTradesRequired(sessionDays) {
  return Math.max(5, Math.min(30, Math.floor((sessionDays || 0) * 0.5)));
}

module.exports = { scoreTrades, isoWeek, minTradesRequired, roundPaise };
