'use strict';
/**
 * Incremental profit hunt on top of sr-breakout.2026-09-15.4.
 * Same mapTrade BS option ₹ as the Trade Bot month view.
 *
 *   node scripts/sr-profit-grid.js /tmp/sr-profit-grid.json
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
const OUT = process.argv[2] || path.join('/tmp', 'sr-profit-grid.json');
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
const SEP15 = '2026-09-15';

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

function pf(profit, loss) {
  if (!(loss > 0)) return profit > 0 ? 99 : 0;
  return Math.round((profit / loss) * 100) / 100;
}

function bucket(trades) {
  const byReason = {};
  const byBook = {};
  let optionProfit = 0;
  let optionLoss = 0;
  let optionNet = 0;
  const losers = [];
  const sep15 = [];
  for (const t of trades) {
    const opt = Number(t.netOptionPnlRs) || 0;
    optionNet += opt;
    if (opt > 0) optionProfit += opt;
    else if (opt < 0) optionLoss += Math.abs(opt);
    const r = t.exitReason || '?';
    byReason[r] = byReason[r] || { n: 0, optionRs: 0 };
    byReason[r].n += 1;
    byReason[r].optionRs += opt;
    const b = t.book || '?';
    byBook[b] = byBook[b] || { n: 0, optionRs: 0, optionProfit: 0, optionLoss: 0 };
    byBook[b].n += 1;
    byBook[b].optionRs += opt;
    if (opt > 0) byBook[b].optionProfit += opt;
    else if (opt < 0) byBook[b].optionLoss += Math.abs(opt);
    if (opt < 0) {
      losers.push({
        date: t.date, book: b, option: t.option, exitReason: r,
        optionRs: Math.round(opt), holdMin: t.holdMin, entryTime: t.entryTime, exitTime: t.exitTime,
      });
    }
    if (t.date === SEP15) {
      sep15.push({
        book: b, option: t.option, exitReason: r, optionRs: Math.round(opt),
        entryTime: t.entryTime, exitTime: t.exitTime, holdMin: t.holdMin, indexPts: t.indexPoints,
      });
    }
  }
  losers.sort((a, b) => a.optionRs - b.optionRs);
  return {
    trades: trades.length,
    optionProfitRs: Math.round(optionProfit),
    optionLossRs: Math.round(optionLoss),
    optionNetRs: Math.round(optionNet),
    pf: pf(optionProfit, optionLoss),
    byReason: Object.fromEntries(Object.entries(byReason).map(([k, v]) => [k, {
      n: v.n, optionRs: Math.round(v.optionRs),
    }])),
    byBook: Object.fromEntries(Object.entries(byBook).map(([k, v]) => [k, {
      n: v.n,
      optionRs: Math.round(v.optionRs),
      optionProfitRs: Math.round(v.optionProfit),
      optionLossRs: Math.round(v.optionLoss),
    }])),
    worstLosers: losers.slice(0, 8),
    sep15,
    augustClose: {
      n: (byReason.CLOSE && byReason.CLOSE.n) || 0,
      optionRs: Math.round((byReason.CLOSE && byReason.CLOSE.optionRs) || 0),
    },
  };
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
  const cut = p.cutRs;
  if (cut != null) {
    if (cut > 0 && perPoint > 0) merged.stopPts = cut / perPoint;
    else delete merged.stopPts;
  }
  if (p.lockArmRs != null && perPoint > 0) merged.lockArmPts = p.lockArmRs / perPoint;
  if (p.lockAtRs != null && perPoint > 0) merged.lockAtPts = p.lockAtRs / perPoint;
  if (p.structureOff) {
    merged.structureExit = false;
    merged.minStructurePts = 0;
  }
  delete merged.cutRs;
  delete merged.lockArmRs;
  delete merged.lockAtRs;
  delete merged.structureOff;
  return merged;
}

function runBook(key, candles, from, to, patch) {
  const book = BOOKS[key];
  const perPoint = book.unitsPerLot * LOTS;
  const merged = optsFor(key, patch);
  const dayLossStop = DAY_LOSS_STOP_RS > 0 ? DAY_LOSS_STOP_RS / perPoint : 0;
  const maxTrades = patch.maxTradesPerDay != null ? patch.maxTradesPerDay : MAX_TRADES_PER_DAY;
  const { trades } = runSrBreakout(candles || [], {
    entryPts: book.entryPts,
    trendBars: 20,
    gapLo: book.gapLo,
    gapHi: book.gapHi,
    targetByScore: book.targetByScore,
    maxTradesPerDay: maxTrades,
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
      holdMin: hmToMin(t.exitTime) - hmToMin(t.entryTime),
      exitReason: t.exitReason,
      indexPoints: t.points,
      netOptionPnlRs: row.netOptionPnlRs,
      optionPnlRs: row.optionPnlRs,
      structure: t.structure || null,
    });
  }
  return mapped;
}

function scoreVariant(candlesByKey, patch) {
  const months = {};
  let all = [];
  for (const m of MONTHS) {
    let trades = [];
    for (const key of ['nifty', 'banknifty']) {
      trades = trades.concat(runBook(key, candlesByKey[key], m.from, m.to, patch));
    }
    months[m.id] = bucket(trades);
    all = all.concat(trades);
  }
  const tot = bucket(all);
  const redMonths = MONTHS.filter((m) => months[m.id].optionNetRs < 0).map((m) => m.id);
  const augClose = months['2026-08'].byReason.CLOSE || { n: 0, optionRs: 0 };
  return {
    months,
    total: tot,
    redMonths,
    augustNet: months['2026-08'].optionNetRs,
    julyNet: months['2026-07'].optionNetRs,
    sumNet: tot.optionNetRs,
    pf: tot.pf,
    optionLossRs: tot.optionLossRs,
    niftyNet: (tot.byBook.nifty && tot.byBook.nifty.optionRs) || 0,
    bankNet: (tot.byBook.bank && tot.byBook.bank.optionRs) || 0,
    augustCloseN: augClose.n,
    augustCloseRs: augClose.optionRs,
    sep15: tot.sep15,
  };
}

function rowOf(id, v) {
  return {
    id,
    jun: v.months['2026-06'].optionNetRs,
    jul: v.months['2026-07'].optionNetRs,
    aug: v.months['2026-08'].optionNetRs,
    sep: v.months['2026-09'].optionNetRs,
    sumNet: v.sumNet,
    pf: v.pf,
    loss: v.optionLossRs,
    nifty: v.niftyNet,
    bank: v.bankNet,
    redMonths: v.redMonths,
    augCloseN: v.augustCloseN,
    augCloseRs: v.augustCloseRs,
    sep15: v.sep15,
  };
}

function buildVariants() {
  const out = [{ id: 'baseline_15_4', patch: {} }];
  const times = [6, 8, 9, 12];
  for (const t of times) {
    out.push({ id: `time_${t}_both`, patch: { nifty: { timeStopBars: t }, banknifty: { timeStopBars: t } } });
    out.push({ id: `time_n${t}_b6`, patch: { nifty: { timeStopBars: t }, banknifty: { timeStopBars: 6 } } });
    out.push({ id: `time_n6_b${t}`, patch: { nifty: { timeStopBars: 6 }, banknifty: { timeStopBars: t } } });
  }
  for (const t of [8, 9, 12]) {
    for (const cut of [0, 1500, 2000, 2500, 3500]) {
      out.push({
        id: `bank_cut_${cut}_time_${t}`,
        patch: { banknifty: { cutRs: cut, timeStopBars: t } },
      });
    }
  }
  for (const cut of [0, 1500, 2000, 2500, 3500]) {
    out.push({ id: `bank_cut_${cut}_time_6`, patch: { banknifty: { cutRs: cut } } });
  }
  for (const cut of [2000, 3500, 5000]) {
    out.push({ id: `nifty_cut_${cut}`, patch: { nifty: { cutRs: cut } } });
    out.push({
      id: `nifty_cut_${cut}_time_9`,
      patch: { nifty: { cutRs: cut, timeStopBars: 9 } },
    });
  }
  out.push({ id: 'minScore_2', patch: { nifty: { minScore: 2 }, banknifty: { minScore: 2 } } });
  out.push({ id: 'minScore_2_time_9', patch: {
    nifty: { minScore: 2, timeStopBars: 9 },
    banknifty: { minScore: 2, timeStopBars: 9 },
  } });
  out.push({ id: 'minScore_n2', patch: { nifty: { minScore: 2 } } });
  out.push({ id: 'minScore_b2', patch: { banknifty: { minScore: 2 } } });

  out.push({ id: 'box_30_60', patch: { nifty: { minStructurePts: 30 }, banknifty: { minStructurePts: 60 } } });
  out.push({ id: 'box_50_100', patch: { nifty: { minStructurePts: 50 }, banknifty: { minStructurePts: 100 } } });
  out.push({ id: 'box_off', patch: { nifty: { structureOff: true }, banknifty: { structureOff: true } } });
  out.push({ id: 'box_n_off', patch: { nifty: { structureOff: true } } });
  out.push({ id: 'box_b_off', patch: { banknifty: { structureOff: true } } });
  out.push({ id: 'box_30_60_time_9', patch: {
    nifty: { minStructurePts: 30, timeStopBars: 9 },
    banknifty: { minStructurePts: 60, timeStopBars: 9 },
  } });
  out.push({ id: 'box_off_time_9', patch: {
    nifty: { structureOff: true, timeStopBars: 9 },
    banknifty: { structureOff: true, timeStopBars: 9 },
  } });

  const niftyLocks = [
    [12, 6], [15, 8], [20, 10], [25, 12], [30, 15], [40, 20], [50, 25],
  ];
  for (const [arm, at] of niftyLocks) {
    out.push({ id: `n_lock_${arm}_${at}`, patch: { nifty: { lockArmPts: arm, lockAtPts: at } } });
    out.push({ id: `n_lock_${arm}_${at}_t9`, patch: { nifty: { lockArmPts: arm, lockAtPts: at, timeStopBars: 9 } } });
  }
  const bankLocks = [
    [20, 10], [30, 15], [40, 20], [50, 25], [80, 40],
  ];
  for (const [arm, at] of bankLocks) {
    out.push({ id: `b_lock_${arm}_${at}`, patch: { banknifty: { lockArmPts: arm, lockAtPts: at } } });
    out.push({ id: `b_lock_${arm}_${at}_t9`, patch: { banknifty: { lockArmPts: arm, lockAtPts: at, timeStopBars: 9 } } });
  }
  const nLockRs = [[800, 400], [1200, 600], [1500, 800], [2000, 1000], [2500, 1200], [3000, 1500]];
  for (const [arm, at] of nLockRs) {
    out.push({ id: `n_lockRs_${arm}_${at}`, patch: { nifty: { lockArmRs: arm, lockAtRs: at } } });
  }
  const bLockRs = [[800, 400], [1200, 600], [1500, 800], [2000, 1000], [2500, 1200]];
  for (const [arm, at] of bLockRs) {
    out.push({ id: `b_lockRs_${arm}_${at}`, patch: { banknifty: { lockArmRs: arm, lockAtRs: at } } });
  }

  const give = [
    [2, 5], [2, 8], [3, 5], [3, 8], [4, 8], [4, 12],
  ];
  for (const [bar, minPts] of give) {
    out.push({ id: `n_give_${bar}_${minPts}`, patch: { nifty: { giveUpBar: bar, giveUpMinPts: minPts } } });
    out.push({ id: `b_give_${bar}_${minPts}`, patch: { banknifty: { giveUpBar: bar, giveUpMinPts: minPts } } });
    out.push({ id: `both_give_${bar}_${minPts}`, patch: {
      nifty: { giveUpBar: bar, giveUpMinPts: minPts },
      banknifty: { giveUpBar: bar, giveUpMinPts: minPts },
    } });
  }

  out.push({ id: 'max2', patch: { maxTradesPerDay: 2 } });
  out.push({ id: 'max2_time_9', patch: {
    maxTradesPerDay: 2,
    nifty: { timeStopBars: 9 },
    banknifty: { timeStopBars: 9 },
  } });
  out.push({ id: 'max2_time_12', patch: {
    maxTradesPerDay: 2,
    nifty: { timeStopBars: 12 },
    banknifty: { timeStopBars: 12 },
  } });
  return out;
}

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

function pickWinner(rows, baseline) {
  const legal = rows.filter((r) => r.aug >= 0 && r.redMonths.length === 0);
  const pool = legal.length ? legal : rows.filter((r) => r.aug >= 0);
  const ranked = [...pool].sort((a, b) =>
    (b.sumNet - a.sumNet)
    || (b.pf - a.pf)
    || (a.loss - b.loss)
    || (b.jul - a.jul));
  const best = ranked[0];
  const improved = best && best.sumNet > baseline.sumNet + 200 && best.aug >= 0;
  return { best, improved, ranked: ranked.slice(0, 15) };
}

async function main() {
  const authorization = await loadAuth();
  const candles = await loadCandles(authorization);
  const variants = buildVariants();
  const report = {
    strategyVersion: STRATEGY_VERSION,
    paperEqualsLive: JSON.stringify(exitOptsFor('nifty')) === JSON.stringify(SPEC.nifty.opts)
      && JSON.stringify(exitOptsFor('banknifty')) === JSON.stringify(SPEC.banknifty.opts),
    lots: LOTS,
    rupeeMode: 'bs_atm_weekly_like_month_ui',
    nVariants: variants.length,
    variants: {},
  };
  for (const v of variants) {
    process.stderr.write(`variant ${v.id}\n`);
    report.variants[v.id] = { patch: v.patch, ...scoreVariant(candles, v.patch) };
  }

  const rows = Object.entries(report.variants).map(([id, v]) => rowOf(id, v));
  const baseline = rows.find((r) => r.id === 'baseline_15_4');
  rows.sort((a, b) => (b.sumNet - a.sumNet) || (b.pf - a.pf) || (a.loss - b.loss));
  report.leaderboard = rows;
  report.baseline = baseline;

  const comboSeeds = [];
  const timeBest = rows.filter((r) => r.id.startsWith('time_') && r.aug >= 0).slice(0, 6);
  const bankBest = rows.filter((r) => r.id.startsWith('bank_cut_') && r.aug >= 0).slice(0, 4);
  const nCutBest = rows.filter((r) => r.id.startsWith('nifty_cut_') && r.aug >= 0).slice(0, 3);
  const boxBest = rows.filter((r) => r.id.startsWith('box_') && r.aug >= 0).slice(0, 3);
  const lockBest = rows.filter((r) => r.id.includes('lock') && r.aug >= 0 && r.sumNet > baseline.sumNet).slice(0, 6);
  const giveBest = rows.filter((r) => r.id.includes('give') && r.aug >= 0 && r.sumNet > baseline.sumNet).slice(0, 4);

  function patchOf(id) {
    return (variants.find((x) => x.id === id) || {}).patch || {};
  }
  function mergePatch(a, b) {
    const out = { ...a, ...b };
    out.nifty = { ...(a.nifty || {}), ...(b.nifty || {}) };
    out.banknifty = { ...(a.banknifty || {}), ...(b.banknifty || {}) };
    return out;
  }

  const extra = [];
  for (const t of timeBest) {
    for (const b of bankBest) {
      extra.push({ id: `${t.id}__${b.id}`, patch: mergePatch(patchOf(t.id), patchOf(b.id)) });
    }
    for (const n of nCutBest) {
      extra.push({ id: `${t.id}__${n.id}`, patch: mergePatch(patchOf(t.id), patchOf(n.id)) });
    }
    for (const x of boxBest) {
      extra.push({ id: `${t.id}__${x.id}`, patch: mergePatch(patchOf(t.id), patchOf(x.id)) });
    }
    for (const x of lockBest) {
      extra.push({ id: `${t.id}__${x.id}`, patch: mergePatch(patchOf(t.id), patchOf(x.id)) });
    }
    for (const x of giveBest) {
      extra.push({ id: `${t.id}__${x.id}`, patch: mergePatch(patchOf(t.id), patchOf(x.id)) });
    }
  }
  const seen = new Set(variants.map((v) => v.id));
  for (const v of extra) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    comboSeeds.push(v);
  }
  report.nCombos = comboSeeds.length;
  for (const v of comboSeeds) {
    process.stderr.write(`combo ${v.id}\n`);
    report.variants[v.id] = { patch: v.patch, ...scoreVariant(candles, v.patch) };
  }
  const allRows = Object.entries(report.variants).map(([id, v]) => rowOf(id, v));
  allRows.sort((a, b) => (b.sumNet - a.sumNet) || (b.pf - a.pf) || (a.loss - b.loss));
  report.leaderboard = allRows;
  const picked = pickWinner(allRows, baseline);
  report.pick = picked;
  const slim = {
    strategyVersion: report.strategyVersion,
    paperEqualsLive: report.paperEqualsLive,
    nVariants: Object.keys(report.variants).length,
    baseline,
    pick: picked,
    top20: allRows.slice(0, 20),
    vsBaseline: allRows
      .filter((r) => r.sumNet >= baseline.sumNet && r.aug >= 0)
      .slice(0, 25),
    worseThanBaselineTop: allRows.filter((r) => r.sumNet < baseline.sumNet).slice(0, 8),
    max2: allRows.filter((r) => r.id.startsWith('max2')),
    sep15_baseline: baseline.sep15,
    sep15_best: picked.best && picked.best.sep15,
  };
  fs.writeFileSync(OUT, JSON.stringify(slim, null, 2));
  fs.writeFileSync(OUT.replace('.json', '.full.json'), JSON.stringify({
    ...slim,
    leaderboard: allRows,
  }));
  console.log(JSON.stringify(slim, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
