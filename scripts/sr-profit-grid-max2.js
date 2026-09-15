'use strict';
/**
 * Second pass: max2 as base, overlay TIME/cut/give/lock/box.
 * Reject lock if 15 Sep first Nifty PE net < 700 (scratches the TIME winner).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { runSrBreakout } = require('../live/sr-breakout');
const { mapTrade, BOOKS } = require('../live/sr-desk');
const { exitOptsFor, LOT_UNITS, DAY_LOSS_STOP_RS, STRATEGY_VERSION } = require('../live/sr-strategy-config');

const OUT = process.argv[2] || '/tmp/sr-profit-grid-max2.json';
const CACHE = process.argv[3] || '/tmp/sr-month-candles.json';
const LOTS = 1;
const CHARGE_RS = 20;
const MONTHS = [
  { id: '2026-06', from: '2026-06-01', to: '2026-06-30' },
  { id: '2026-07', from: '2026-07-01', to: '2026-07-31' },
  { id: '2026-08', from: '2026-08-01', to: '2026-08-31' },
  { id: '2026-09', from: '2026-09-01', to: '2026-09-15' },
];
const SEP15 = '2026-09-15';

function pf(profit, loss) {
  if (!(loss > 0)) return profit > 0 ? 99 : 0;
  return Math.round((profit / loss) * 100) / 100;
}
function hmToMin(hm) {
  const [h, m] = String(hm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function optsFor(key, patch) {
  const p = patch[key] || {};
  const base = exitOptsFor(key, LOTS);
  const merged = { ...base, ...p };
  const units = LOT_UNITS[key] || 0;
  const perPoint = units * LOTS;
  if (p.cutRs != null) {
    if (p.cutRs > 0 && perPoint > 0) merged.stopPts = p.cutRs / perPoint;
    else delete merged.stopPts;
  }
  if (p.lockArmRs != null && perPoint > 0) merged.lockArmPts = p.lockArmRs / perPoint;
  if (p.lockAtRs != null && perPoint > 0) merged.lockAtPts = p.lockAtRs / perPoint;
  if (p.structureOff) { merged.structureExit = false; merged.minStructurePts = 0; }
  delete merged.cutRs; delete merged.lockArmRs; delete merged.lockAtRs; delete merged.structureOff;
  return merged;
}
function runBook(key, candles, from, to, patch) {
  const book = BOOKS[key];
  const perPoint = book.unitsPerLot * LOTS;
  const merged = optsFor(key, patch);
  const dayLossStop = DAY_LOSS_STOP_RS > 0 ? DAY_LOSS_STOP_RS / perPoint : 0;
  const maxTrades = patch.maxTradesPerDay != null ? patch.maxTradesPerDay : 2;
  const { trades } = runSrBreakout(candles || [], {
    entryPts: book.entryPts, trendBars: 20, gapLo: book.gapLo, gapHi: book.gapHi,
    targetByScore: book.targetByScore, maxTradesPerDay: maxTrades,
    dayLossStop, dayProfitTarget: 0, reportFromDate: from,
    ...book.session, ...merged,
  });
  const mapped = [];
  for (const t of trades || []) {
    if (t.date < from || t.date > to) continue;
    const row = mapTrade(t, book, LOTS, perPoint, null);
    mapped.push({
      date: t.date, book: book.id, option: t.option, exitReason: t.exitReason,
      entryTime: t.entryTime, exitTime: t.exitTime,
      holdMin: hmToMin(t.exitTime) - hmToMin(t.entryTime),
      netOptionPnlRs: row.netOptionPnlRs, indexPoints: t.points,
    });
  }
  return mapped;
}
function bucket(trades) {
  let optionProfit = 0, optionLoss = 0, optionNet = 0;
  const byBook = {}, byReason = {}, sep15 = [];
  for (const t of trades) {
    const opt = Number(t.netOptionPnlRs) || 0;
    optionNet += opt;
    if (opt > 0) optionProfit += opt; else if (opt < 0) optionLoss += Math.abs(opt);
    const b = t.book || '?';
    byBook[b] = byBook[b] || { n: 0, optionRs: 0 };
    byBook[b].n += 1; byBook[b].optionRs += opt;
    const r = t.exitReason || '?';
    byReason[r] = byReason[r] || { n: 0, optionRs: 0 };
    byReason[r].n += 1; byReason[r].optionRs += opt;
    if (t.date === SEP15) sep15.push({ book: b, option: t.option, exitReason: r, optionRs: Math.round(opt), holdMin: t.holdMin, entryTime: t.entryTime, exitTime: t.exitTime });
  }
  return {
    trades: trades.length, optionProfitRs: Math.round(optionProfit), optionLossRs: Math.round(optionLoss),
    optionNetRs: Math.round(optionNet), pf: pf(optionProfit, optionLoss),
    byBook: Object.fromEntries(Object.entries(byBook).map(([k, v]) => [k, { n: v.n, optionRs: Math.round(v.optionRs) }])),
    byReason: Object.fromEntries(Object.entries(byReason).map(([k, v]) => [k, { n: v.n, optionRs: Math.round(v.optionRs) }])),
    sep15,
  };
}
function score(candles, patch) {
  const months = {}; let all = [];
  for (const m of MONTHS) {
    let trades = [];
    for (const key of ['nifty', 'banknifty']) trades = trades.concat(runBook(key, candles[key], m.from, m.to, patch));
    months[m.id] = bucket(trades); all = all.concat(trades);
  }
  const tot = bucket(all);
  const augClose = months['2026-08'].byReason.CLOSE || { n: 0, optionRs: 0 };
  const sepNiftyPe = (tot.sep15.find((x) => x.book === 'nifty' && x.option === 'PE' && x.entryTime === '10:35') || tot.sep15.find((x) => x.book === 'nifty'));
  return {
    jun: months['2026-06'].optionNetRs, jul: months['2026-07'].optionNetRs,
    aug: months['2026-08'].optionNetRs, sep: months['2026-09'].optionNetRs,
    sumNet: tot.optionNetRs, pf: tot.pf, loss: tot.optionLossRs,
    nifty: (tot.byBook.nifty && tot.byBook.nifty.optionRs) || 0,
    bank: (tot.byBook.bank && tot.byBook.bank.optionRs) || 0,
    trades: tot.trades, redMonths: MONTHS.filter((m) => months[m.id].optionNetRs < 0).map((m) => m.id),
    augCloseN: augClose.n, augCloseRs: augClose.optionRs,
    sep15: tot.sep15, sep15NiftyPe: sepNiftyPe || null,
    scratchedSep15: !!(sepNiftyPe && (sepNiftyPe.exitReason === 'LOCK' || sepNiftyPe.exitReason === 'TARGET' || (sepNiftyPe.optionRs < 700 && sepNiftyPe.holdMin <= 15))),
  };
}

function variants() {
  const v = [{ id: 'max2', patch: { maxTradesPerDay: 2 } }];
  for (const t of [6, 8, 9]) {
    v.push({ id: `max2_t${t}`, patch: { maxTradesPerDay: 2, nifty: { timeStopBars: t }, banknifty: { timeStopBars: t } } });
  }
  v.push({ id: 'max2_n9_b6', patch: { maxTradesPerDay: 2, nifty: { timeStopBars: 9 } } });
  v.push({ id: 'max2_n6_b8', patch: { maxTradesPerDay: 2, banknifty: { timeStopBars: 8 } } });
  for (const cut of [1500, 2000, 2500, 3500, 0]) {
    v.push({ id: `max2_bcut${cut}`, patch: { maxTradesPerDay: 2, banknifty: { cutRs: cut } } });
  }
  for (const cut of [3500, 5000, 2000]) {
    v.push({ id: `max2_ncut${cut}`, patch: { maxTradesPerDay: 2, nifty: { cutRs: cut } } });
  }
  v.push({ id: 'max2_give_4_12', patch: { maxTradesPerDay: 2, nifty: { giveUpBar: 4, giveUpMinPts: 12 }, banknifty: { giveUpBar: 4, giveUpMinPts: 12 } } });
  v.push({ id: 'max2_bgive_2_8', patch: { maxTradesPerDay: 2, banknifty: { giveUpBar: 2, giveUpMinPts: 8 } } });
  v.push({ id: 'max2_box30', patch: { maxTradesPerDay: 2, nifty: { minStructurePts: 30 }, banknifty: { minStructurePts: 60 } } });
  v.push({ id: 'max2_boxoff', patch: { maxTradesPerDay: 2, nifty: { structureOff: true }, banknifty: { structureOff: true } } });
  v.push({ id: 'max2_score2', patch: { maxTradesPerDay: 2, nifty: { minScore: 2 }, banknifty: { minScore: 2 } } });
  v.push({ id: 'max2_nlock_20_10', patch: { maxTradesPerDay: 2, nifty: { lockArmPts: 20, lockAtPts: 10 } } });
  v.push({ id: 'max2_nlockRs_1200_600', patch: { maxTradesPerDay: 2, nifty: { lockArmRs: 1200, lockAtRs: 600 } } });
  v.push({ id: 'max2_block_50_25', patch: { maxTradesPerDay: 2, banknifty: { lockArmPts: 50, lockAtPts: 25 } } });
  v.push({ id: 'max1_give_4_12', patch: { maxTradesPerDay: 1, nifty: { giveUpBar: 4, giveUpMinPts: 12 }, banknifty: { giveUpBar: 4, giveUpMinPts: 12 } } });
  return v;
}

function main() {
  const candles = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const rows = [];
  for (const v of variants()) {
    process.stderr.write(v.id + '\n');
    const s = score(candles, v.patch);
    rows.push({ id: v.id, ...s });
  }
  rows.sort((a, b) => b.sumNet - a.sumNet);
  const legal = rows.filter((r) => r.aug >= 0 && !r.scratchedSep15 && r.augCloseN === 0);
  const out = { strategyVersion: STRATEGY_VERSION, rows, legalTop: legal.slice(0, 10) };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ legalTop: out.legalTop.map((r) => ({
    id: r.id, sum: r.sumNet, pf: r.pf, loss: r.loss, jun: r.jun, jul: r.jul, aug: r.aug, sep: r.sep,
    nifty: r.nifty, bank: r.bank, trades: r.trades, scratch: r.scratchedSep15, augC: r.augCloseN,
    sep15: r.sep15,
  })), all: rows.map((r) => ({
    id: r.id, sum: r.sumNet, pf: r.pf, loss: r.loss, jun: r.jun, jul: r.jul, aug: r.aug, sep: r.sep,
    scratch: r.scratchedSep15, augC: r.augCloseN, red: r.redMonths,
  })) }, null, 2));
}
main();
