/**
 * Fast all-three (Nifty+Bank+Crude) daily-green DNA hunt — Paper≡Live path.
 * Run on droplet: node scripts/all3-fast.js
 */
require('dotenv').config();
process.chdir(require('path').join(__dirname, '..'));
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const {
  NIFTY_50_INSTRUMENT,
  BANK_NIFTY_INSTRUMENT,
  CRUDE_OIL_MINI_INSTRUMENT,
  createTrapStrategy,
  replayPaperOnIndex,
  replayPaperOnCrude,
  resolveCrudeStrategyProfile,
  resolveCrudeProfileDayLossPts,
  resolveCrudeOilMiniFuturesToken,
} = require('../live/strategy-core.cjs');
const market = require('../live/kite-market');
const { liveGreenTrapExtras } = require('../live/dna-live-green');
const { filterTradesLivePath, livePathReplayOpts } = require('../live/live-path');

const LOG = '/tmp/all3-fast.log';
const FROM = '2026-07-13';
const TO = '2026-08-11';

function log(...a) {
  const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  fs.appendFileSync(LOG, `${s}\n`);
  console.log(s);
}

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const dayOf = (t) => String(t.entryTime).slice(0, 10);
const netOf = (t) => Math.round(t.netOptionPnlRs ?? t.optionPnlRs ?? 0);

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
    (await db.collection('kite_auth').findOne({ _id: '6a6dcaba3b1d88570bc6fcba' })) ||
    (await db.collection('kite_auth').findOne({}));
  const a = `token ${dec(doc.apiKeyEnc)}:${dec(doc.accessTokenEnc)}`;
  await c.close();
  return a;
}

function trapInit(cfg, instrumentId) {
  const bank = /bank/i.test(instrumentId);
  const extras = {
    ...liveGreenTrapExtras(),
    piercePts: cfg.pierce ?? 20,
    bankPiercePts: cfg.bankPierce ?? 40,
    profitLockArmRs: cfg.arm ?? 100,
    profitLockLockRs: cfg.lock ?? 50,
    profitLockGivebackRs: cfg.give ?? 50,
    optionStandDownRs: cfg.stand ?? 350,
  };
  return {
    maxTradesPerDay: bank ? cfg.bankMax ?? cfg.max ?? 3 : cfg.max ?? 3,
    targetRMultiple: cfg.r ?? 3.5,
    extras,
    dayProfitLockPts: 0,
    dayStopPts: 0,
    dayProfitLockRs: Math.round((cfg.dayLockRs || 3000) * 0.5),
    dayStopRs: Math.round((cfg.dayStopRs || 2950) * 0.5),
  };
}

function discover(candles, instruments, instrument, kind, cfg) {
  const livePath = livePathReplayOpts({
    rejectEstimatedPremium: true,
    fillFrictionPremium: 0.5,
  });
  const base = {
    instrumentId: instrument.id,
    instrumentName: instrument.name,
    kind,
    candles,
    fromDate: FROM,
    toDate: TO,
    instruments,
    forceCloseOpen: true,
    lotsMultiplier: 1,
    enableKutty: false,
    kuttyAlone: false,
    livePath,
  };
  const needed = new Set();
  const make = () => {
    const s = createTrapStrategy();
    s.initialize(trapInit(cfg, instrument.id));
    return s;
  };
  replayPaperOnIndex({
    ...base,
    optionCandlesByToken: new Map(),
    neededOptionTokens: needed,
    strategy: make(),
  });
  return needed;
}

function replayIdx(candles, instruments, instrument, kind, cfg, optMap) {
  const livePath = livePathReplayOpts({
    rejectEstimatedPremium: true,
    fillFrictionPremium: cfg.friction ?? 0.5,
  });
  const base = {
    instrumentId: instrument.id,
    instrumentName: instrument.name,
    kind,
    candles,
    fromDate: FROM,
    toDate: TO,
    instruments,
    forceCloseOpen: true,
    lotsMultiplier: 1,
    enableKutty: false,
    kuttyAlone: false,
    livePath,
  };
  const make = () => {
    const s = createTrapStrategy();
    s.initialize(trapInit(cfg, instrument.id));
    return s;
  };
  return (
    replayPaperOnIndex({
      ...base,
      optionCandlesByToken: optMap,
      neededOptionTokens: new Set(),
      strategy: make(),
    }).trades || []
  );
}

function replayCru(candles, instruments, cfg, optMap, discoverOnly) {
  const profile = resolveCrudeStrategyProfile('live-crude-green');
  const tradeParams = {
    ...profile,
    minOrWidth: cfg.crudeMinOr ?? 40,
    maxOrWidth: cfg.crudeMaxOr ?? 60,
    stopPts: cfg.crudeSl ?? 30,
    morningTargetPts: cfg.crudeTp ?? 80,
    eveningTargetPts: cfg.crudeTp ?? 80,
    maxEveningTradesDay: 1,
    firstWinLock: true,
    profitLockArmRs: cfg.crudeArm ?? 350,
    profitLockLockRs: cfg.crudeLock ?? 180,
  };
  const dayLossStopPts = resolveCrudeProfileDayLossPts(tradeParams, true);
  const base = {
    instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
    instrumentName: 'Crude Mini',
    candles,
    fromDate: FROM,
    toDate: TO,
    instruments,
    forceCloseOpen: true,
    lotsMultiplier: 1,
    dayLossStopPts,
    enableMorning: false,
    enableEvening: true,
    tradeParams,
  };
  const needed = new Set();
  replayPaperOnCrude({
    ...base,
    optionCandlesByToken: new Map(),
    neededOptionTokens: needed,
  });
  if (discoverOnly) return { needed, trades: [] };
  return {
    needed,
    trades:
      replayPaperOnCrude({
        ...base,
        optionCandlesByToken: optMap,
        neededOptionTokens: new Set(),
      }).trades || [],
  };
}

function score(trades, deskLock) {
  const kept = filterTradesLivePath(trades, {
    maxOpenLegs: 1,
    dayProfitLockRs: deskLock,
    dayStopRs: 2950,
    rejectEstimatedPremium: true,
  });
  const byDay = new Map();
  for (const t of kept) {
    const d = dayOf(t);
    const row = byDay.get(d) || { date: d, net: 0, n: 0, books: new Set() };
    row.net += netOf(t);
    row.n += 1;
    row.books.add(t.instrumentId);
    byDay.set(d, row);
  }
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    days,
    green: days.filter((d) => d.net > 0).length,
    red: days.filter((d) => d.net < 0).length,
    net: days.reduce((s, d) => s + d.net, 0),
    worst: days.length ? Math.min(...days.map((d) => d.net)) : 0,
    trades: kept.length,
    hasN: days.some((d) => d.books.has('nifty-50')),
    hasB: days.some((d) => d.books.has('bank-nifty')),
    hasC: days.some((d) => d.books.has('crude-oil-mini')),
  };
}

function firstWinIndexThenCrude(trades) {
  const sorted = [...trades].sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));
  const out = [];
  let day = null;
  let indexWon = false;
  let openUntil = null;
  for (const t of sorted) {
    const d = dayOf(t);
    if (d !== day) {
      day = d;
      indexWon = false;
      openUntil = null;
    }
    const isCrude = t.instrumentId === 'crude-oil-mini';
    if (!isCrude && indexWon) continue;
    const entry = String(t.entryTime);
    const exit = String(t.exitTime || t.entryTime);
    if (openUntil && entry < openUntil) continue;
    out.push(t);
    openUntil = exit;
    if (!isCrude && netOf(t) > 0) indexWon = true;
  }
  return out;
}

function niftyPriority(trades) {
  const sorted = [...trades].sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));
  const out = [];
  let day = null;
  let niftyNet = 0;
  let openUntil = null;
  for (const t of sorted) {
    const d = dayOf(t);
    if (d !== day) {
      day = d;
      niftyNet = 0;
      openUntil = null;
    }
    const entry = String(t.entryTime);
    const exit = String(t.exitTime || t.entryTime);
    if (openUntil && entry < openUntil) continue;
    if (t.instrumentId === 'bank-nifty' && niftyNet > 0) continue;
    out.push(t);
    openUntil = exit;
    if (t.instrumentId === 'nifty-50') niftyNet += netOf(t);
  }
  return out;
}

(async () => {
  fs.writeFileSync(LOG, '');
  const auth = await loadAuth();
  log('auth ok');
  const instruments = await market.fetchInstruments(auth);
  const warm = addDays(FROM, -12);
  const niftyC = await market.fetchHistorical5m(
    auth,
    NIFTY_50_INSTRUMENT.instrumentToken,
    warm,
    TO,
  );
  const bankC = await market.fetchHistorical5m(
    auth,
    BANK_NIFTY_INSTRUMENT.instrumentToken,
    warm,
    TO,
  );
  const fut = resolveCrudeOilMiniFuturesToken(instruments);
  const crudeC = await market.fetchHistorical5m(auth, fut.instrumentToken, warm, TO);
  log('candles', niftyC.length, bankC.length, crudeC.length);

  const allNeeded = new Set();
  for (const pierce of [20, 30]) {
    for (const bankPierce of [40, 60]) {
      const cfg = {
        pierce,
        bankPierce,
        max: 3,
        bankMax: 2,
        stand: 350,
        arm: 100,
        lock: 50,
        give: 50,
        r: 3.5,
        dayLockRs: 3000,
        dayStopRs: 2950,
      };
      for (const t of discover(niftyC, instruments, NIFTY_50_INSTRUMENT, 'nifty', cfg)) {
        allNeeded.add(t);
      }
      for (const t of discover(bankC, instruments, BANK_NIFTY_INSTRUMENT, 'banknifty', cfg)) {
        allNeeded.add(t);
      }
    }
  }
  for (const cv of [
    { crudeMinOr: 35, crudeMaxOr: 70 },
    { crudeMinOr: 40, crudeMaxOr: 60 },
    { crudeMinOr: 45, crudeMaxOr: 55 },
  ]) {
    for (const t of replayCru(crudeC, instruments, cv, new Map(), true).needed) {
      allNeeded.add(t);
    }
  }
  log('tokens', allNeeded.size);
  const optMap = new Map();
  let i = 0;
  for (const tok of allNeeded) {
    i += 1;
    try {
      optMap.set(tok, await market.fetchHistorical5m(auth, tok, FROM, TO));
    } catch {
      optMap.set(tok, []);
    }
    if (i % 10 === 0) log('opt', i, '/', allNeeded.size);
  }
  log('opt done', optMap.size);
  log('starting crude variants...');

  const crudeVariants = [
    {
      tag: 'c-def',
      crudeMinOr: 40,
      crudeMaxOr: 60,
      crudeSl: 30,
      crudeTp: 80,
      crudeArm: 350,
      crudeLock: 180,
    },
    {
      tag: 'c-wide',
      crudeMinOr: 35,
      crudeMaxOr: 70,
      crudeSl: 30,
      crudeTp: 80,
      crudeArm: 300,
      crudeLock: 150,
    },
    {
      tag: 'c-sl25',
      crudeMinOr: 40,
      crudeMaxOr: 60,
      crudeSl: 25,
      crudeTp: 70,
      crudeArm: 300,
      crudeLock: 150,
    },
  ];
  const crudeTrades = new Map();
  for (const cv of crudeVariants) {
    try {
      log('crude begin', cv.tag);
      const tr = replayCru(crudeC, instruments, cv, optMap).trades;
      crudeTrades.set(cv.tag, tr);
      log('crude', cv.tag, tr.length, tr.reduce((s, t) => s + netOf(t), 0));
    } catch (e) {
      log('crude ERR', cv.tag, e.stack || String(e));
      crudeTrades.set(cv.tag, []);
    }
  }

  log('starting index grid...');
  const results = [];
  let n = 0;
  for (const pierce of [20, 25, 30]) {
    for (const bankPierce of [40, 50, 60]) {
      for (const max of [1, 2, 3]) {
        for (const bankMax of [1, 2]) {
          if (bankMax > max) continue;
          for (const stand of [250, 350]) {
            for (const arm of [100, 150]) {
              const cfg = {
                pierce,
                bankPierce,
                max,
                bankMax,
                stand,
                arm,
                lock: Math.round(arm / 2),
                give: Math.round(arm / 2),
                r: 3.5,
                dayLockRs: 3000,
                dayStopRs: 2950,
                friction: 0.5,
              };
              const nTr = replayIdx(
                niftyC,
                instruments,
                NIFTY_50_INSTRUMENT,
                'nifty',
                cfg,
                optMap,
              );
              const bTr = replayIdx(
                bankC,
                instruments,
                BANK_NIFTY_INSTRUMENT,
                'banknifty',
                cfg,
                optMap,
              );
              n += 1;
              if (n % 15 === 0) log('replay', n);
              for (const cv of crudeVariants) {
                const merged = [...nTr, ...bTr, ...crudeTrades.get(cv.tag)];
                for (const deskLock of [1000, 1500, 2000, 2500, 3000]) {
                  for (const mode of ['desk', 'firstWin', 'niftyPri']) {
                    let trades = merged;
                    if (mode === 'firstWin') {
                      trades = firstWinIndexThenCrude(
                        filterTradesLivePath(merged, {
                          maxOpenLegs: 1,
                          dayProfitLockRs: 0,
                          dayStopRs: 0,
                          rejectEstimatedPremium: true,
                        }),
                      );
                    }
                    if (mode === 'niftyPri') {
                      trades = niftyPriority(
                        filterTradesLivePath(merged, {
                          maxOpenLegs: 1,
                          dayProfitLockRs: 0,
                          dayStopRs: 0,
                          rejectEstimatedPremium: true,
                        }),
                      );
                    }
                    const s = score(trades, deskLock);
                    if (!s.hasN || !s.hasB || !s.hasC) continue;
                    results.push({
                      pierce,
                      bankPierce,
                      max,
                      bankMax,
                      stand,
                      arm,
                      deskLock,
                      crude: cv.tag,
                      mode,
                      green: s.green,
                      red: s.red,
                      net: s.net,
                      worst: s.worst,
                      trades: s.trades,
                      days: s.days.length,
                      daysDetail: s.days.map((d) => ({
                        date: d.date,
                        net: d.net,
                        n: d.n,
                        books: [...d.books],
                      })),
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  results.sort((a, b) => a.red - b.red || b.green - a.green || b.net - a.net);
  log('=== TOP 40 ===');
  for (const r of results.slice(0, 40)) {
    log(
      `red=${r.red} green=${r.green}/${r.days} net=${r.net} worst=${r.worst} tr=${r.trades} | p${r.pierce}/B${r.bankPierce} max${r.max}/b${r.bankMax} stand${r.stand} arm${r.arm} dlock${r.deskLock} ${r.crude} mode=${r.mode}`,
    );
  }
  const zr = results.filter((r) => r.red === 0);
  log('zero-red', zr.length);
  const strong = zr.filter((r) => r.green >= 10).sort((a, b) => b.net - a.net);
  const best = strong[0] || zr[0] || results[0];
  log('BEST', {
    pierce: best.pierce,
    bankPierce: best.bankPierce,
    max: best.max,
    bankMax: best.bankMax,
    stand: best.stand,
    arm: best.arm,
    deskLock: best.deskLock,
    crude: best.crude,
    mode: best.mode,
    green: best.green,
    red: best.red,
    net: best.net,
    worst: best.worst,
    trades: best.trades,
    days: best.days,
  });
  log('BEST DAYS');
  for (const d of best.daysDetail) {
    log(d.date, 'net', d.net, 'n', d.n, 'books', d.books.join('+'));
  }
  fs.writeFileSync(
    '/tmp/all3-results.json',
    JSON.stringify(
      {
        best,
        top: results.slice(0, 80).map(({ daysDetail, ...x }) => x),
      },
      null,
      2,
    ),
  );
  log('DONE wrote /tmp/all3-results.json');
})().catch((e) => {
  log('ERR', e.stack || String(e));
  process.exit(1);
});
