'use strict';

/**
 * Local proof that Daily Profit stays in batches of 10 and finishes.
 * Uses covering cache + instrumentMap so Kite is never called.
 */
const { openDatabase, putCachedBars } = require('../orb-backtest/store');
const { loadUniverseBars } = require('../orb-backtest/load-bars');
const { runDailyProfit } = require('./pipeline');

function sessionBars(day, close = 100) {
  const out = [];
  for (let m = 9 * 60 + 15; m <= 15 * 60 + 15; m += 5) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const drift = (m - (9 * 60 + 15)) * 0.002;
    out.push({
      t,
      day,
      o: close + drift,
      h: close + drift + 0.4,
      l: close + drift - 0.3,
      c: close + drift + 0.15,
      v: 1000,
    });
  }
  return out;
}

function daysBetween(from, to) {
  const out = [];
  const start = Date.parse(`${from}T00:00:00+05:30`);
  const end = Date.parse(`${to}T00:00:00+05:30`);
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t + 5.5 * 3600000);
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    out.push(iso);
  }
  return out;
}

async function main() {
  const from = '2026-09-15';
  const to = '2026-10-16';
  const days = daysBetween(from, to);
  const symbols = Array.from({ length: 80 }, (_, i) => `SYM${String(i + 1).padStart(3, '0')}`);
  const db = openDatabase(':memory:');
  const inst = new Map();
  for (const symbol of symbols) {
    const bars = {};
    for (const day of days) bars[day] = sessionBars(day, 80 + (symbol.charCodeAt(3) % 40));
    putCachedBars(db, symbol, '2026-08-31', '2026-10-27', bars);
    inst.set(symbol, { instrumentToken: 1, tradingSymbol: symbol, exchange: 'NSE', instrumentType: 'EQ' });
  }

  const batchesSeen = new Set();
  const t0 = Date.now();
  const loaded = await loadUniverseBars({
    authorization: 'token unused',
    from,
    to,
    db,
    symbols,
    batchSize: 10,
    instrumentMap: inst,
    onProgress: (p) => {
      if (p.batch) batchesSeen.add(p.batch);
    },
  });
  const loadMs = Date.now() - t0;
  const t1 = Date.now();
  const out = await runDailyProfit({
    symbolBars: loaded.symbolBars,
    capital: 10000,
    budget: 12,
  });
  const simMs = Date.now() - t1;

  const report = {
    ok: loaded.cacheHits === 80 && loaded.withBars === 80 && out.liveOrders === false,
    names: loaded.withBars,
    cacheHits: loaded.cacheHits,
    batches: [...batchesSeen].sort((a, b) => a - b),
    batchCount: batchesSeen.size,
    days: days.length,
    loadMs,
    simMs,
    totalMs: Date.now() - t0,
    candidatesEvaluated: out.candidatesEvaluated,
    recommended: out.recommended ? out.recommended.name : null,
    noRobust: out.noRobust || null,
    liveOrders: out.liveOrders,
    engineVersion: out.engineVersion,
  };
  console.log(JSON.stringify(report, null, 2));
  db.close();
  if (!report.ok) process.exit(1);
  if (report.batchCount !== 8) {
    console.error(`expected 8 batches of 10 for 80 names, got ${report.batchCount}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
