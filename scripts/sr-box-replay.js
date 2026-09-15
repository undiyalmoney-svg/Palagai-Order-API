'use strict';
/**
 * Walk-forward Paper vs Live DNA on Kite 5m.
 * On droplet: node scripts/sr-box-replay.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const market = require('../live/kite-market');
const { runSrBreakout } = require('../live/sr-breakout');
const { chartPayload } = require('../live/sr-structure');
const { exitOptsFor, MAX_TRADES_PER_DAY, STRATEGY_VERSION } = require('../live/sr-strategy-config');
const { SPEC } = require('../live/sr-live');
const { BOOKS } = require('../live/sr-desk');

const OWNER = '6a6dcaba3b1d88570bc6fcba';
const DAYS = ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-15'];
const OUT = process.argv[2] || path.join('/tmp', 'sr-box-replay.json');

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

function shiftDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function slim(t) {
  return {
    date: t.date,
    option: t.option,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    exitReason: t.exitReason,
    points: t.points,
    level: t.level,
    height: t.structure && t.structure.height,
    measuredMove: t.structure && t.structure.measuredMove,
    wall: t.structure && t.structure.wall,
  };
}

async function main() {
  const authorization = await loadAuth();
  const from = shiftDays(DAYS[0], -12);
  const to = DAYS[DAYS.length - 1];
  const report = {
    strategyVersion: STRATEGY_VERSION,
    maxTradesPerDay: MAX_TRADES_PER_DAY,
    paperEqualsLive: true,
    days: DAYS,
    books: {},
  };
  for (const key of ['nifty', 'banknifty']) {
    const spec = SPEC[key];
    const book = BOOKS[key];
    const candles = await market.fetchHistorical5m(authorization, spec.token, from, to);
    const paperOpts = {
      entryPts: book.entryPts, trendBars: 20, gapLo: book.gapLo, gapHi: book.gapHi,
      targetByScore: book.targetByScore, maxTradesPerDay: MAX_TRADES_PER_DAY,
      reportFromDate: DAYS[0], ...book.session, ...exitOptsFor(key, 1),
    };
    const liveOpts = {
      entryPts: spec.entryPts, trendBars: 20, gapLo: spec.gapLo, gapHi: spec.gapHi,
      targetByScore: spec.targetByScore, maxTradesPerDay: MAX_TRADES_PER_DAY,
      reportFromDate: DAYS[0], ...spec.session, ...spec.opts,
    };
    const paper = runSrBreakout(candles || [], paperOpts);
    const live = runSrBreakout(candles || [], liveOpts);
    const same = JSON.stringify(paper.trades.map(slim)) === JSON.stringify(live.trades.map(slim));
    if (!same) report.paperEqualsLive = false;
    const byDay = {};
    for (const d of DAYS) {
      byDay[d] = paper.trades.filter((t) => t.date === d).map(slim);
    }
    report.books[key] = {
      same,
      paperOpts: exitOptsFor(key),
      liveOpts: spec.opts,
      trades: paper.trades.map(slim),
      byDay,
      chartSample: chartPayload(candles, paper.trades.filter((t) => t.date === '2026-09-15'), {
        id: book.id, label: book.name,
      }),
    };
  }
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    out: OUT,
    paperEqualsLive: report.paperEqualsLive,
    nifty: report.books.nifty.trades.length,
    bank: report.books.banknifty.trades.length,
    version: STRATEGY_VERSION,
  }, null, 2));
  if (!report.paperEqualsLive) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
