/**
 * Probe filters that kill the 2 red Bank days while keeping all-three green.
 */
require('dotenv').config();
process.chdir(require('path').join(__dirname, '..'));
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

const FROM = '2026-07-13';
const TO = '2026-08-11';
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const dayOf = (t) => String(t.entryTime).slice(0, 10);
const netOf = (t) => Math.round(t.netOptionPnlRs ?? t.optionPnlRs ?? 0);
const hhmm = (t) => String(t.entryTime).slice(11, 16);

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

function trapInit(cfg, id) {
  const bank = /bank/i.test(id);
  const extras = {
    ...liveGreenTrapExtras(),
    piercePts: cfg.pierce,
    bankPiercePts: cfg.bankPierce,
    profitLockArmRs: cfg.arm,
    profitLockLockRs: cfg.lock,
    profitLockGivebackRs: cfg.give,
    optionStandDownRs: cfg.stand,
  };
  return {
    maxTradesPerDay: bank ? cfg.bankMax : cfg.max,
    targetRMultiple: 3.5,
    extras,
    dayProfitLockPts: 0,
    dayStopPts: 0,
    dayProfitLockRs: Math.round(3000 * 0.5),
    dayStopRs: Math.round(2950 * 0.5),
  };
}

function oneLeg(trades) {
  return filterTradesLivePath(trades, {
    maxOpenLegs: 1,
    dayProfitLockRs: 0,
    dayStopRs: 0,
    rejectEstimatedPremium: true,
  });
}

function stopAfterIndexLoss(trades) {
  const sorted = [...trades].sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));
  const out = [];
  let day = null;
  let lost = false;
  let openUntil = null;
  for (const t of sorted) {
    const d = dayOf(t);
    if (d !== day) {
      day = d;
      lost = false;
      openUntil = null;
    }
    const isCrude = t.instrumentId === 'crude-oil-mini';
    if (!isCrude && lost) continue;
    const entry = String(t.entryTime);
    const exit = String(t.exitTime || t.entryTime);
    if (openUntil && entry < openUntil) continue;
    out.push(t);
    openUntil = exit;
    if (!isCrude && netOf(t) < 0) lost = true;
  }
  return out;
}

function stopDayAfterAnyLoss(trades) {
  const sorted = [...trades].sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));
  const out = [];
  let day = null;
  let stopped = false;
  let openUntil = null;
  for (const t of sorted) {
    const d = dayOf(t);
    if (d !== day) {
      day = d;
      stopped = false;
      openUntil = null;
    }
    if (stopped) continue;
    const entry = String(t.entryTime);
    const exit = String(t.exitTime || t.entryTime);
    if (openUntil && entry < openUntil) continue;
    out.push(t);
    openUntil = exit;
    if (netOf(t) < 0) stopped = true;
  }
  return out;
}

function firstWinIndex(trades) {
  const sorted = [...trades].sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));
  const out = [];
  let day = null;
  let won = false;
  let openUntil = null;
  for (const t of sorted) {
    const d = dayOf(t);
    if (d !== day) {
      day = d;
      won = false;
      openUntil = null;
    }
    const isCrude = t.instrumentId === 'crude-oil-mini';
    if (!isCrude && won) continue;
    const entry = String(t.entryTime);
    const exit = String(t.exitTime || t.entryTime);
    if (openUntil && entry < openUntil) continue;
    out.push(t);
    openUntil = exit;
    if (!isCrude && netOf(t) > 0) won = true;
  }
  return out;
}

function bankAfterNifty(trades) {
  const sorted = [...trades].sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));
  const out = [];
  let day = null;
  let niftyTaken = false;
  let openUntil = null;
  for (const t of sorted) {
    const d = dayOf(t);
    if (d !== day) {
      day = d;
      niftyTaken = false;
      openUntil = null;
    }
    const entry = String(t.entryTime);
    const exit = String(t.exitTime || t.entryTime);
    if (openUntil && entry < openUntil) continue;
    if (t.instrumentId === 'bank-nifty' && !niftyTaken) continue;
    out.push(t);
    openUntil = exit;
    if (t.instrumentId === 'nifty-50') niftyTaken = true;
  }
  return out;
}

function evaluate(label, trades, deskLock = 2500) {
  const kept = filterTradesLivePath(trades, {
    maxOpenLegs: 1,
    dayProfitLockRs: deskLock,
    dayStopRs: 2950,
    rejectEstimatedPremium: true,
  });
  const byDay = new Map();
  for (const t of kept) {
    const d = dayOf(t);
    const row = byDay.get(d) || { date: d, net: 0, n: 0, books: new Set(), ts: [] };
    row.net += netOf(t);
    row.n += 1;
    row.books.add(t.instrumentId);
    row.ts.push({
      book: t.instrumentId,
      net: netOf(t),
      t: t.entryTime,
      reason: t.exitReason,
    });
    byDay.set(d, row);
  }
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const green = days.filter((d) => d.net > 0).length;
  const red = days.filter((d) => d.net < 0).length;
  const net = days.reduce((s, d) => s + d.net, 0);
  const hasN = days.some((d) => d.books.has('nifty-50'));
  const hasB = days.some((d) => d.books.has('bank-nifty'));
  const hasC = days.some((d) => d.books.has('crude-oil-mini'));
  console.log(
    `\n== ${label} red=${red} green=${green}/${days.length} net=${net} all3=${hasN && hasB && hasC}`,
  );
  for (const d of days.filter((x) => x.net < 0)) {
    console.log(' RED', d.date, d.net, JSON.stringify(d.ts));
  }
  return { label, red, green, net, hasN, hasB, hasC, days: days.length };
}

(async () => {
  const auth = await loadAuth();
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
  const livePath = livePathReplayOpts({
    rejectEstimatedPremium: true,
    fillFrictionPremium: 0.5,
  });

  async function book(candles, inst, kind, init) {
    const base = {
      instrumentId: inst.id,
      instrumentName: inst.name,
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
      s.initialize(init);
      return s;
    };
    replayPaperOnIndex({
      ...base,
      optionCandlesByToken: new Map(),
      neededOptionTokens: needed,
      strategy: make(),
    });
    const opt = new Map();
    for (const tok of needed) {
      try {
        opt.set(tok, await market.fetchHistorical5m(auth, tok, FROM, TO));
      } catch {
        opt.set(tok, []);
      }
    }
    return (
      replayPaperOnIndex({
        ...base,
        optionCandlesByToken: opt,
        neededOptionTokens: new Set(),
        strategy: make(),
      }).trades || []
    );
  }

  const cfg = {
    pierce: 20,
    bankPierce: 60,
    max: 3,
    bankMax: 2,
    stand: 350,
    arm: 100,
    lock: 50,
    give: 50,
  };
  console.log('loading books...');
  const nTr = await book(niftyC, NIFTY_50_INSTRUMENT, 'nifty', trapInit(cfg, 'nifty-50'));
  const bTr = await book(bankC, BANK_NIFTY_INSTRUMENT, 'banknifty', trapInit(cfg, 'bank-nifty'));
  const profile = resolveCrudeStrategyProfile('live-crude-green');
  const tradeParams = { ...profile };
  const dayLossStopPts = resolveCrudeProfileDayLossPts(tradeParams, true);
  const cbase = {
    instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
    instrumentName: 'Crude',
    candles: crudeC,
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
  const cneed = new Set();
  replayPaperOnCrude({
    ...cbase,
    optionCandlesByToken: new Map(),
    neededOptionTokens: cneed,
  });
  const copt = new Map();
  for (const tok of cneed) {
    try {
      copt.set(tok, await market.fetchHistorical5m(auth, tok, FROM, TO));
    } catch {
      copt.set(tok, []);
    }
  }
  const cTr =
    replayPaperOnCrude({
      ...cbase,
      optionCandlesByToken: copt,
      neededOptionTokens: new Set(),
    }).trades || [];
  const merged = [...nTr, ...bTr, ...cTr];
  console.log('trades n/b/c', nTr.length, bTr.length, cTr.length);

  const results = [];
  results.push(evaluate('baseline', merged, 2500));
  results.push(evaluate('stopAfterIndexLoss', stopAfterIndexLoss(oneLeg(merged)), 2500));
  results.push(evaluate('stopDayAfterAnyLoss', stopDayAfterAnyLoss(oneLeg(merged)), 2500));
  results.push(evaluate('firstWinIndex', firstWinIndex(oneLeg(merged)), 2500));
  results.push(evaluate('bankAfterNifty', bankAfterNifty(oneLeg(merged)), 2500));

  const bankAfter11 = merged.filter((t) => t.instrumentId !== 'bank-nifty' || hhmm(t) >= '11:00');
  results.push(evaluate('bankAfter11', bankAfter11, 2500));
  results.push(
    evaluate('bankAfter11+stopLoss', stopAfterIndexLoss(oneLeg(bankAfter11)), 2500),
  );

  const bank1030 = merged.filter((t) => t.instrumentId !== 'bank-nifty' || hhmm(t) >= '10:30');
  results.push(evaluate('bankAfter1030+stopLoss', stopAfterIndexLoss(oneLeg(bank1030)), 2500));

  const bank1015 = merged.filter((t) => t.instrumentId !== 'bank-nifty' || hhmm(t) >= '10:15');
  results.push(evaluate('bankAfter1015+stopLoss', stopAfterIndexLoss(oneLeg(bank1015)), 2000));

  const cfg2 = { ...cfg, stand: 200, bankMax: 1 };
  const b2 = await book(bankC, BANK_NIFTY_INSTRUMENT, 'banknifty', trapInit(cfg2, 'bank-nifty'));
  results.push(evaluate('stand200 bankMax1', [...nTr, ...b2, ...cTr], 2500));
  results.push(
    evaluate(
      'stand200 bankMax1 + stopLoss',
      stopAfterIndexLoss(oneLeg([...nTr, ...b2, ...cTr])),
      2500,
    ),
  );

  // Bank entry window DNA-style: only 10:15-14:00
  const bankWindow = merged.filter(
    (t) =>
      t.instrumentId !== 'bank-nifty' || (hhmm(t) >= '10:15' && hhmm(t) <= '14:00'),
  );
  results.push(
    evaluate('bankWindow1015-1400+stopLoss', stopAfterIndexLoss(oneLeg(bankWindow)), 2500),
  );

  // Combine: bank pierce60, bank after 10:30, firstWin index, crude evening
  results.push(
    evaluate(
      'bank1030+firstWin',
      firstWinIndex(oneLeg(bank1030)),
      2500,
    ),
  );

  // Sort promising
  const ok = results
    .filter((r) => r.hasN && r.hasB && r.hasC)
    .sort((a, b) => a.red - b.red || b.green - a.green || b.net - a.net);
  console.log('\n=== RANKED all3 ===');
  for (const r of ok) {
    console.log(
      `red=${r.red} green=${r.green}/${r.days} net=${r.net} | ${r.label}`,
    );
  }
  const zr = ok.filter((r) => r.red === 0);
  console.log('\nZERO RED all3:', zr.length ? zr[0] : 'none');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
