'use strict';
/**
 * Month-grid Paper DNA hunt. Loads owner Kite 5m once, then scores variants
 * with the same mapTrade BS option ₹ the Trade Bot month view uses (>14d).
 *
 * Usage on droplet:
 *   node scripts/sr-month-loss-grid.js /tmp/sr-month-loss-grid.json
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const market = require('../live/kite-market');
const { runSrBreakout } = require('../live/sr-breakout');
const { mapTrade, BOOKS } = require('../live/sr-desk');
const {
  exitOptsFor, LOT_UNITS, DAY_LOSS_STOP_RS, MAX_TRADES_PER_DAY, STRATEGY_VERSION,
} = require('../live/sr-strategy-config');
const { SPEC } = require('../live/sr-live');

const OWNER = '6a6dcaba3b1d88570bc6fcba';
const OUT = process.argv[2] || path.join('/tmp', 'sr-month-loss-grid.json');
const CACHE = process.argv[3] || path.join('/tmp', 'sr-month-candles.json');
const LOTS = 1;
const CHARGE_RS = 20;

const MONTHS = [
  { id: '2026-06', from: '2026-06-01', to: '2026-06-30' },
  { id: '2026-07', from: '2026-07-01', to: '2026-07-31' },
  { id: '2026-08', from: '2026-08-01', to: '2026-08-31' },
  { id: '2026-09', from: '2026-09-01', to: '2026-09-15' },
];
const WARM = '2026-05-18';
const END = '2026-09-15';

function getEncKey() {
  return crypto
    .createHash('sha256')
    .update(String(process.env.LIVE_AUTH_SECRET || process.env.MONGODB_PASSWORD || 'palagai-dev-only'))
    .digest();
}
function dec(p) {
  const b = Buffer.from(String(p), 'base64');
  const iv = b.subarray(0, 12);
  const tag = b.subarray(12, 28);
  const data = b.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', getEncKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

async function loadAuth() {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db(process.env.MONGODB_DB || 'palagai');
  const doc =
    (await db.collection('kite_auth').findOne({ _id: OWNER })) ||
    (await db.collection('kite_auth').findOne({}));
  const a = `token ${dec(doc.apiKeyEnc)}:${dec(doc.accessTokenEnc)}`;
  await c.close();
  return a;
}

function bucket(trades) {
  const byReason = {};
  const byBook = {};
  const byScore = {};
  let optionProfit = 0;
  let optionLoss = 0;
  let optionNet = 0;
  let indexNet = 0;
  let indexProfit = 0;
  let indexLoss = 0;
  const losers = [];
  for (const t of trades) {
    const opt = Number(t.netOptionPnlRs) || 0;
    const idx = Number(t.indexPnlRs) || 0;
    optionNet += opt;
    indexNet += idx;
    if (opt > 0) optionProfit += opt;
    else if (opt < 0) optionLoss += Math.abs(opt);
    if (idx > 0) indexProfit += idx;
    else if (idx < 0) indexLoss += Math.abs(idx);
    const r = t.exitReason || '?';
    byReason[r] = byReason[r] || { n: 0, optionRs: 0, indexRs: 0 };
    byReason[r].n += 1;
    byReason[r].optionRs += opt;
    byReason[r].indexRs += idx;
    const b = t.book || '?';
    byBook[b] = byBook[b] || { n: 0, optionRs: 0, indexRs: 0, optionProfit: 0, optionLoss: 0 };
    byBook[b].n += 1;
    byBook[b].optionRs += opt;
    byBook[b].indexRs += idx;
    if (opt > 0) byBook[b].optionProfit += opt;
    else if (opt < 0) byBook[b].optionLoss += Math.abs(opt);
    const sc = String(t.score || t.confidence || 1);
    byScore[sc] = byScore[sc] || { n: 0, optionRs: 0 };
    byScore[sc].n += 1;
    byScore[sc].optionRs += opt;
    if (opt < 0) {
      losers.push({
        date: t.date,
        book: b,
        option: t.option,
        exitReason: r,
        score: t.confidence,
        indexPts: t.indexPoints,
        indexRs: Math.round(idx),
        optionRs: Math.round(opt),
        height: t.structure && t.structure.height,
      });
    }
  }
  losers.sort((a, b) => a.optionRs - b.optionRs);
  return {
    trades: trades.length,
    optionProfitRs: Math.round(optionProfit),
    optionLossRs: Math.round(optionLoss),
    optionNetRs: Math.round(optionNet),
    indexProfitRs: Math.round(indexProfit),
    indexLossRs: Math.round(indexLoss),
    indexNetRs: Math.round(indexNet),
    byReason: Object.fromEntries(Object.entries(byReason).map(([k, v]) => [k, {
      n: v.n, optionRs: Math.round(v.optionRs), indexRs: Math.round(v.indexRs),
    }])),
    byBook: Object.fromEntries(Object.entries(byBook).map(([k, v]) => [k, {
      n: v.n,
      optionRs: Math.round(v.optionRs),
      indexRs: Math.round(v.indexRs),
      optionProfitRs: Math.round(v.optionProfit),
      optionLossRs: Math.round(v.optionLoss),
    }])),
    byScore: Object.fromEntries(Object.entries(byScore).map(([k, v]) => [k, {
      n: v.n, optionRs: Math.round(v.optionRs),
    }])),
    worstLosers: losers.slice(0, 12),
  };
}

function optsFor(key, patch) {
  const p = patch[key] || {};
  const base = exitOptsFor(key, LOTS);
  const merged = { ...base, ...p };
  const cut = p.cutRs;
  if (cut != null) {
    const units = LOT_UNITS[key] || 0;
    const perPoint = units * LOTS;
    if (cut > 0 && perPoint > 0) merged.stopPts = cut / perPoint;
    else delete merged.stopPts;
  }
  return merged;
}

function runBook(key, candles, from, to, patch) {
  const book = BOOKS[key];
  const perPoint = book.unitsPerLot * LOTS;
  const merged = optsFor(key, patch);
  const dayLossStop = DAY_LOSS_STOP_RS > 0 ? DAY_LOSS_STOP_RS / perPoint : 0;
  const { trades } = runSrBreakout(candles || [], {
    entryPts: book.entryPts,
    trendBars: 20,
    gapLo: book.gapLo,
    gapHi: book.gapHi,
    targetByScore: book.targetByScore,
    maxTradesPerDay: MAX_TRADES_PER_DAY,
    dayLossStop: patch.dayLossStopRs != null
      ? (patch.dayLossStopRs > 0 ? patch.dayLossStopRs / perPoint : 0)
      : dayLossStop,
    dayProfitTarget: 0,
    reportFromDate: from,
    ...book.session,
    ...merged,
  });
  const mapped = [];
  for (const t of trades || []) {
    if (t.date < from || t.date > to) continue;
    const row = mapTrade(t, book, LOTS, perPoint, null);
    mapped.push({
      date: t.date,
      book: book.id,
      option: t.option,
      confidence: t.confidence,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      exitReason: t.exitReason,
      indexPoints: t.points,
      indexPnlRs: Math.round((Number(t.points) || 0) * perPoint) - CHARGE_RS * LOTS,
      netOptionPnlRs: row.netOptionPnlRs,
      optionPnlRs: row.optionPnlRs,
      structure: t.structure || null,
    });
  }
  return mapped;
}

function applyDeskDayBrake(trades, capRs) {
  if (!(capRs > 0)) return trades;
  const byDay = new Map();
  const keep = [];
  const sorted = [...trades].sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
    || (a.book === 'nifty' ? -1 : 1));
  for (const t of sorted) {
    const day = t.date;
    const used = byDay.get(day) || 0;
    if (used <= -capRs) continue;
    keep.push(t);
    byDay.set(day, used + (Number(t.netOptionPnlRs) || 0));
  }
  return keep;
}

function scoreVariant(candlesByKey, patch) {
  const months = {};
  let all = [];
  for (const m of MONTHS) {
    let trades = [];
    for (const key of ['nifty', 'banknifty']) {
      trades = trades.concat(runBook(key, candlesByKey[key], m.from, m.to, patch));
    }
    if (patch.deskDayBrakeRs) trades = applyDeskDayBrake(trades, patch.deskDayBrakeRs);
    months[m.id] = bucket(trades);
    all = all.concat(trades);
  }
  const tot = bucket(all);
  const redMonths = MONTHS.filter((m) => months[m.id].optionNetRs < 0).map((m) => m.id);
  return {
    months,
    total: tot,
    redMonths,
    augustNet: months['2026-08'].optionNetRs,
    augustLoss: months['2026-08'].optionLossRs,
    sumNet: tot.optionNetRs,
  };
}

const VARIANTS = [
  { id: 'baseline', patch: {} },
  { id: 'bank_cut_3500', patch: { banknifty: { cutRs: 3500 } } },
  { id: 'bank_cut_5000', patch: { banknifty: { cutRs: 5000 } } },
  { id: 'bank_cut_2500', patch: { banknifty: { cutRs: 2500 } } },
  { id: 'bank_cut_8000', patch: { banknifty: { cutRs: 8000 } } },
  { id: 'time_6', patch: { nifty: { timeStopBars: 6 }, banknifty: { timeStopBars: 6 } } },
  { id: 'time_12', patch: { nifty: { timeStopBars: 12 }, banknifty: { timeStopBars: 12 } } },
  { id: 'bank_time_6', patch: { banknifty: { timeStopBars: 6 } } },
  { id: 'bank_time_12', patch: { banknifty: { timeStopBars: 12 } } },
  { id: 'minScore_2', patch: { nifty: { minScore: 2 }, banknifty: { minScore: 2 } } },
  { id: 'box_60_120', patch: { nifty: { minStructurePts: 60 }, banknifty: { minStructurePts: 120 } } },
  { id: 'nifty_failStop', patch: { nifty: { failStop: true } } },
  { id: 'bank_failStop', patch: { banknifty: { failStop: true } } },
  { id: 'bank_cut_5000_time_12', patch: { banknifty: { cutRs: 5000, timeStopBars: 12 } } },
  { id: 'bank_cut_5000_time_6', patch: { banknifty: { cutRs: 5000, timeStopBars: 6 } } },
  { id: 'bank_cut_5000_minScore2', patch: { nifty: { minScore: 2 }, banknifty: { cutRs: 5000, minScore: 2 } } },
  { id: 'bank_cut_3500_minScore2', patch: { nifty: { minScore: 2 }, banknifty: { cutRs: 3500, minScore: 2 } } },
  { id: 'bank_cut_5000_box_100', patch: { banknifty: { cutRs: 5000, minStructurePts: 100 } } },
  { id: 'both_cut_5000_time_12', patch: {
    nifty: { timeStopBars: 12 },
    banknifty: { cutRs: 5000, timeStopBars: 12 },
  } },
  { id: 'desk_day_brake_3500', patch: { deskDayBrakeRs: 3500 } },
  { id: 'bank_cut_5000_desk_brake', patch: { banknifty: { cutRs: 5000 }, deskDayBrakeRs: 3500 } },
  { id: 'bank_cut_5000_time12_score2', patch: {
    nifty: { minScore: 2, timeStopBars: 12 },
    banknifty: { cutRs: 5000, minScore: 2, timeStopBars: 12 },
  } },
  { id: 'time_18_bank', patch: { banknifty: { timeStopBars: 18 } } },
  { id: 'bank_cut_4000_time_12', patch: { banknifty: { cutRs: 4000, timeStopBars: 12 } } },
];

async function loadCandles(authorization) {
  if (fs.existsSync(CACHE)) {
    const cached = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (cached.from === WARM && cached.to === END && cached.nifty && cached.banknifty) {
      console.error('candles cache hit', CACHE, cached.nifty.length, cached.banknifty.length);
      return cached;
    }
  }
  const out = { from: WARM, to: END };
  for (const key of ['nifty', 'banknifty']) {
    const spec = SPEC[key];
    console.error('fetch', key, WARM, END);
    out[key] = await market.fetchHistorical5m(authorization, spec.token, WARM, END, { chunkGapMs: 250 });
    console.error('got', key, (out[key] || []).length);
  }
  fs.writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

async function main() {
  const authorization = await loadAuth();
  const candles = await loadCandles(authorization);
  const baselinePaper = exitOptsFor('nifty');
  const baselineLive = SPEC.nifty.opts;
  const report = {
    strategyVersion: STRATEGY_VERSION,
    maxTradesPerDay: MAX_TRADES_PER_DAY,
    paperEqualsLive: JSON.stringify(baselinePaper) === JSON.stringify(baselineLive),
    lots: LOTS,
    rupeeMode: 'bs_atm_weekly_like_month_ui',
    months: MONTHS,
    variants: {},
  };
  for (const v of VARIANTS) {
    console.error('variant', v.id);
    report.variants[v.id] = { patch: v.patch, ...scoreVariant(candles, v.patch) };
  }
  const rows = Object.entries(report.variants).map(([id, v]) => ({
    id,
    augNet: v.augustNet,
    augLoss: v.augustLoss,
    jun: v.months['2026-06'].optionNetRs,
    jul: v.months['2026-07'].optionNetRs,
    aug: v.months['2026-08'].optionNetRs,
    sep: v.months['2026-09'].optionNetRs,
    sumNet: v.sumNet,
    redMonths: v.redMonths,
    redCount: v.redMonths.length,
  }));
  rows.sort((a, b) => (a.redCount - b.redCount)
    || (b.augNet - a.augNet)
    || (b.sumNet - a.sumNet));
  report.leaderboard = rows;
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    out: OUT,
    paperEqualsLive: report.paperEqualsLive,
    version: STRATEGY_VERSION,
    leaderboard: rows,
    baselineAug: report.variants.baseline.months['2026-08'],
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
