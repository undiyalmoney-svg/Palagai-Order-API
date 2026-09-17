'use strict';
/**
 * Prove 15.4 vs 15.5 month option ₹ on the same Kite 5m cache.
 *   node scripts/sr-profit-prove-15-5.js /tmp/sr-month-candles.json
 */
const fs = require('fs');
const { runSrBreakout } = require('../live/sr-breakout');
const { mapTrade, BOOKS } = require('../live/sr-desk');
const {
  exitOptsFor, LOT_UNITS, DAY_LOSS_STOP_RS, MAX_TRADES_PER_DAY, STRATEGY_VERSION,
} = require('../live/sr-strategy-config');
const { SPEC } = require('../live/sr-live');

const CACHE = process.argv[2] || '/tmp/sr-month-candles.json';
const MONTHS = [
  { id: '2026-06', from: '2026-06-01', to: '2026-06-30' },
  { id: '2026-07', from: '2026-07-01', to: '2026-07-31' },
  { id: '2026-08', from: '2026-08-01', to: '2026-08-31' },
  { id: '2026-09', from: '2026-09-01', to: '2026-09-15' },
];

function pf(p, l) { return l > 0 ? Math.round((p / l) * 100) / 100 : (p > 0 ? 99 : 0); }

function runBook(key, candles, from, to, patch) {
  const book = BOOKS[key];
  const perPoint = book.unitsPerLot;
  const base = exitOptsFor(key, 1);
  const merged = { ...base, ...(patch[key] || {}) };
  if (patch.maxTradesPerDay === 1) {
    /* 15.4 overlay */
  }
  const maxTrades = patch.maxTradesPerDay != null ? patch.maxTradesPerDay : MAX_TRADES_PER_DAY;
  if (patch.giveOff) {
    merged.giveUpBar = 0;
    merged.giveUpMinPts = 0;
  }
  if (patch.giveOn) {
    merged.giveUpBar = 4;
    merged.giveUpMinPts = 12;
  }
  if (patch.sessionAlignOff) merged.sessionAlign = false;
  if (patch.legacyStructure) {
    merged.structureExit = true;
    merged.minStructurePts = key === 'nifty' ? 40 : 80;
  }
  if (patch.bankCut2500 && key === 'banknifty') {
    merged.stopPts = 2500 / perPoint;
  }
  const { trades } = runSrBreakout(candles || [], {
    entryPts: book.entryPts, trendBars: 20, gapLo: book.gapLo, gapHi: book.gapHi,
    targetByScore: book.targetByScore, maxTradesPerDay: maxTrades,
    dayLossStop: DAY_LOSS_STOP_RS / perPoint, dayProfitTarget: 0, reportFromDate: from,
    ...book.session, ...merged,
  });
  const mapped = [];
  for (const t of trades || []) {
    if (t.date < from || t.date > to) continue;
    const row = mapTrade(t, book, 1, perPoint, null);
    mapped.push({
      date: t.date, book: book.id, option: t.option, exitReason: t.exitReason,
      entryTime: t.entryTime, exitTime: t.exitTime, net: row.netOptionPnlRs,
    });
  }
  return mapped;
}

function score(candles, patch) {
  const months = {};
  let all = [];
  for (const m of MONTHS) {
    let tr = [];
    for (const key of ['nifty', 'banknifty']) tr = tr.concat(runBook(key, candles[key], m.from, m.to, patch));
    months[m.id] = tr;
    all = all.concat(tr);
  }
  function buck(ts) {
    let p = 0, l = 0, n = 0;
    const by = { nifty: 0, bank: 0 };
    const reasons = {};
    const sep15 = [];
    for (const t of ts) {
      const o = Number(t.net) || 0;
      n += o;
      if (o > 0) p += o; else if (o < 0) l += Math.abs(o);
      by[t.book] = (by[t.book] || 0) + o;
      reasons[t.exitReason] = reasons[t.exitReason] || { n: 0, rs: 0 };
      reasons[t.exitReason].n += 1;
      reasons[t.exitReason].rs += o;
      if (t.date === '2026-09-15') sep15.push({ book: t.book, option: t.option, reason: t.exitReason, net: Math.round(o), in: t.entryTime, out: t.exitTime });
    }
    return {
      net: Math.round(n), profit: Math.round(p), loss: Math.round(l), pf: pf(p, l),
      nifty: Math.round(by.nifty || 0), bank: Math.round(by.bank || 0), n: ts.length,
      reasons: Object.fromEntries(Object.entries(reasons).map(([k, v]) => [k, { n: v.n, rs: Math.round(v.rs) }])),
      sep15,
    };
  }
  const tot = buck(all);
  return {
    jun: buck(months['2026-06']).net,
    jul: buck(months['2026-07']).net,
    aug: buck(months['2026-08']).net,
    sep: buck(months['2026-09']).net,
    ...tot,
    augClose: buck(months['2026-08']).reasons.CLOSE || { n: 0, rs: 0 },
  };
}

const candles = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
const paperEqLive = JSON.stringify(exitOptsFor('nifty')) === JSON.stringify(SPEC.nifty.opts)
  && JSON.stringify(exitOptsFor('banknifty')) === JSON.stringify(SPEC.banknifty.opts);
const v14 = score(candles, { maxTradesPerDay: 1, giveOff: true, sessionAlignOff: true, legacyStructure: true, bankCut2500: true, banknifty: { timeStopBars: 6 } });
const v15 = score(candles, { giveOn: true, sessionAlignOff: true, legacyStructure: true, bankCut2500: true, banknifty: { timeStopBars: 6 } });
const v16 = score(candles, { giveOn: true, legacyStructure: true, bankCut2500: true, banknifty: { timeStopBars: 6 } });
const v17 = score(candles, { giveOn: true, legacyStructure: true, bankCut2500: true });
const v18 = score(candles, { giveOn: true });
const v19 = score(candles, {});
const out = {
  strategyVersion: STRATEGY_VERSION,
  maxTradesPerDay: MAX_TRADES_PER_DAY,
  paperEqualsLive: paperEqLive,
  bankTimeStopBars: exitOptsFor('banknifty').timeStopBars,
  niftyTimeStopBars: exitOptsFor('nifty').timeStopBars,
  bankSessionAlign: !!exitOptsFor('banknifty').sessionAlign,
  niftySessionAlign: !!exitOptsFor('nifty').sessionAlign,
  niftyGive: { bar: exitOptsFor('nifty').giveUpBar, min: exitOptsFor('nifty').giveUpMinPts },
  bankGive: { bar: exitOptsFor('banknifty').giveUpBar, min: exitOptsFor('banknifty').giveUpMinPts },
  structureExit: !!exitOptsFor('nifty').structureExit,
  bankStopPts: exitOptsFor('banknifty').stopPts,
  before_15_4: v14,
  after_15_5: v15,
  after_15_6: v16,
  after_15_7: v17,
  after_15_8: v18,
  after_15_9: v19,
};
console.log(JSON.stringify(out, null, 2));
if (STRATEGY_VERSION !== 'sr-breakout.2026-09-17.1') process.exit(1);
if (!paperEqLive) process.exit(2);
if (!exitOptsFor('banknifty').sessionAlign) process.exit(6);
if (exitOptsFor('nifty').sessionAlign) process.exit(7);
if (exitOptsFor('banknifty').timeStopBars !== 8) process.exit(10);
if (exitOptsFor('nifty').timeStopBars !== 6) process.exit(11);
if (exitOptsFor('nifty').structureExit) process.exit(13);
if (exitOptsFor('banknifty').structureExit) process.exit(14);
if (Math.abs(exitOptsFor('banknifty').stopPts - 3500 / 30) > 1e-9) process.exit(15);
if (exitOptsFor('nifty').giveUpBar !== 0 || exitOptsFor('banknifty').giveUpBar !== 0) process.exit(17);
if (v19.aug < 0) {
  console.error('15.9 August red', v19.aug);
  process.exit(3);
}
if ((v19.augClose && v19.augClose.n) > 0) {
  console.error('15.9 August CLOSE bleed', v19.augClose);
  process.exit(18);
}
if (v19.net <= v18.net) {
  console.error('15.9 must beat 15.8 on this cache', v19.net, v18.net);
  process.exit(4);
}
