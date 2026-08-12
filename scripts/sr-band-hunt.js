/**
 * S/R Daily-Band hunt — Paper≡Live path on droplet Kite auth.
 * Sweeps trapMode / swingLb / pierce / OR+PDHL confluence.
 * Goal: max days with dayNet in [750, 2000], then green%, then net.
 */
require('dotenv').config();
process.chdir(require('path').join(__dirname, '..'));
const fs = require('fs');
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
} = require('../live/strategy-core.cjs');
const market = require('../live/kite-market');
const { liveGreenTrapExtras } = require('../live/dna-live-green');
const { filterTradesLivePath } = require('../live/live-path');

const FROM = '2026-07-13';
const TO = '2026-08-11';
const BAND_MIN = 750;
const BAND_MAX = 2000;

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
  if (!doc?.apiKeyEnc) throw new Error('no kite_auth');
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
    trapMode: cfg.mode,
    swingLb: cfg.swingLb,
    orConfluencePts: cfg.orConf || 0,
    pdhlConfluencePts: cfg.pdhlConf || 0,
    profitLockArmRs: 100,
    profitLockLockRs: 50,
    profitLockGivebackRs: 50,
    optionStandDownRs: cfg.stand,
    bounceOrPierceMult: 0,
    bounceOrPierceCap: 0,
  };
  return {
    maxTradesPerDay: bank ? cfg.bankMax : cfg.max,
    targetRMultiple: 3.5,
    extras,
    dayProfitLockPts: 0,
    dayStopPts: 0,
    dayProfitLockRs: Math.round(2000 * 0.5),
    dayStopRs: Math.round(2950 * 0.5),
  };
}

async function book(auth, instruments, candles, instrument, kind, init) {
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
  };
  const needed = new Set();
  replayPaperOnIndex({
    ...base,
    optionCandlesByToken: new Map(),
    neededOptionTokens: needed,
    strategy: (() => {
      const s = createTrapStrategy();
      s.initialize(init);
      return s;
    })(),
  });
  const opt = new Map();
  for (const tok of needed) {
    try {
      opt.set(tok, await market.fetchHistorical5m(auth, tok, addDays(FROM, -2), TO));
    } catch {
      opt.set(tok, []);
    }
  }
  return (
    replayPaperOnIndex({
      ...base,
      optionCandlesByToken: opt,
      neededOptionTokens: new Set(),
      strategy: (() => {
        const s = createTrapStrategy();
        s.initialize(init);
        return s;
      })(),
    }).trades || []
  );
}

function score(label, trades) {
  const kept = filterTradesLivePath(trades, {
    maxOpenLegs: 1,
    dayProfitLockRs: 2000,
    dayStopRs: 2950,
    rejectEstimatedPremium: true,
    bankOnlyAfterNifty: true,
    bankOnlyAfterNiftyGreen: true,
    winStreakToBand: true,
    deskGreenLockRs: 750,
    indexFirstWinLock: false,
  });
  const byDay = new Map();
  for (const t of kept) {
    const d = dayOf(t);
    const row = byDay.get(d) || { date: d, net: 0, n: 0 };
    row.net += netOf(t);
    row.n += 1;
    byDay.set(d, row);
  }
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const green = days.filter((d) => d.net > 0).length;
  const red = days.filter((d) => d.net < 0).length;
  const inBand = days.filter((d) => d.net >= BAND_MIN && d.net <= BAND_MAX).length;
  const net = days.reduce((s, d) => s + d.net, 0);
  const avg = days.length ? Math.round(net / days.length) : 0;
  return {
    label,
    days: days.length,
    green,
    red,
    inBand,
    bandPct: days.length ? Math.round((inBand / days.length) * 1000) / 10 : 0,
    net,
    avg,
    worst: days.length ? Math.min(...days.map((d) => d.net)) : 0,
    best: days.length ? Math.max(...days.map((d) => d.net)) : 0,
    dayRows: days,
  };
}

(async () => {
  const auth = await loadAuth();
  const instruments = await market.fetchInstruments(auth);
  console.log('fetching index candles...');
  const niftyC = await market.fetchHistorical5m(
    auth,
    NIFTY_50_INSTRUMENT.instrumentToken,
    addDays(FROM, -12),
    TO,
  );
  const bankC = await market.fetchHistorical5m(
    auth,
    BANK_NIFTY_INSTRUMENT.instrumentToken,
    addDays(FROM, -12),
    TO,
  );
  const crudeTok = instruments.find(
    (x) =>
      x.exchange === 'MCX' &&
      x.instrumentType === 'FUT' &&
      String(x.tradingSymbol || '').toUpperCase().startsWith('CRUDEOILM'),
  );
  let crudeC = [];
  if (crudeTok) {
    crudeC = await market.fetchHistorical5m(auth, crudeTok.instrumentToken, addDays(FROM, -12), TO);
  }
  console.log('candles', niftyC.length, bankC.length, crudeC.length);

  const configs = [
    { label: 'BASE_both_sw5_p20_B60', mode: 'both', swingLb: 5, pierce: 20, bankPierce: 60, max: 3, bankMax: 2, stand: 350, orConf: 0, pdhlConf: 0 },
    { label: 'TRAP_only_sw5_p20_B60', mode: 'trap', swingLb: 5, pierce: 20, bankPierce: 60, max: 3, bankMax: 2, stand: 350, orConf: 0, pdhlConf: 0 },
    { label: 'TRAP_sw3_p20_B60', mode: 'trap', swingLb: 3, pierce: 20, bankPierce: 60, max: 3, bankMax: 2, stand: 350, orConf: 0, pdhlConf: 0 },
    { label: 'TRAP_sw8_p20_B60', mode: 'trap', swingLb: 8, pierce: 20, bankPierce: 60, max: 3, bankMax: 2, stand: 350, orConf: 0, pdhlConf: 0 },
    { label: 'TRAP_OR25_sw5', mode: 'trap', swingLb: 5, pierce: 20, bankPierce: 60, max: 3, bankMax: 2, stand: 350, orConf: 25, pdhlConf: 0 },
    { label: 'TRAP_OR40_sw5', mode: 'trap', swingLb: 5, pierce: 20, bankPierce: 60, max: 3, bankMax: 2, stand: 350, orConf: 40, pdhlConf: 0 },
    { label: 'TRAP_OR60_sw5', mode: 'trap', swingLb: 5, pierce: 20, bankPierce: 60, max: 3, bankMax: 2, stand: 350, orConf: 60, pdhlConf: 0 },
    { label: 'TRAP_PDHL40_sw5', mode: 'trap', swingLb: 5, pierce: 20, bankPierce: 60, max: 3, bankMax: 2, stand: 350, orConf: 0, pdhlConf: 40 },
    { label: 'TRAP_OR40_PDHL40', mode: 'trap', swingLb: 5, pierce: 20, bankPierce: 60, max: 3, bankMax: 2, stand: 350, orConf: 40, pdhlConf: 40 },
    { label: 'BOTH_OR40_sw5', mode: 'both', swingLb: 5, pierce: 20, bankPierce: 60, max: 3, bankMax: 2, stand: 350, orConf: 40, pdhlConf: 0 },
    { label: 'TRAP_p15_B50_OR40', mode: 'trap', swingLb: 5, pierce: 15, bankPierce: 50, max: 3, bankMax: 2, stand: 350, orConf: 40, pdhlConf: 0 },
    { label: 'TRAP_p25_B60_OR40', mode: 'trap', swingLb: 5, pierce: 25, bankPierce: 60, max: 3, bankMax: 2, stand: 350, orConf: 40, pdhlConf: 0 },
    { label: 'TRAP_OR40_max2', mode: 'trap', swingLb: 5, pierce: 20, bankPierce: 60, max: 2, bankMax: 1, stand: 350, orConf: 40, pdhlConf: 0 },
  ];

  // Preload crude once (profile fixed)
  let crudeTrades = [];
  if (crudeC.length) {
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
    replayPaperOnCrude({ ...cbase, optionCandlesByToken: new Map(), neededOptionTokens: cneed });
    const copt = new Map();
    for (const tok of cneed) {
      try {
        copt.set(tok, await market.fetchHistorical5m(auth, tok, FROM, TO));
      } catch {
        copt.set(tok, []);
      }
    }
    crudeTrades =
      replayPaperOnCrude({
        ...cbase,
        optionCandlesByToken: copt,
        neededOptionTokens: new Set(),
      }).trades || [];
  }

  const results = [];
  for (const cfg of configs) {
    console.log('run', cfg.label);
    const nTr = await book(
      auth,
      instruments,
      niftyC,
      NIFTY_50_INSTRUMENT,
      'nifty',
      trapInit(cfg, 'nifty-50'),
    );
    const bTr = await book(
      auth,
      instruments,
      bankC,
      BANK_NIFTY_INSTRUMENT,
      'banknifty',
      trapInit(cfg, 'bank-nifty'),
    );
    const s = score(cfg.label, [...nTr, ...bTr, ...crudeTrades]);
    s.cfg = cfg;
    s.rawTrades = nTr.length + bTr.length;
    results.push(s);
    console.log(
      `  green=${s.green}/${s.days} red=${s.red} inBand=${s.inBand} (${s.bandPct}%) net=${s.net} avg=${s.avg} worst=${s.worst}`,
    );
  }

  results.sort(
    (a, b) =>
      b.inBand - a.inBand ||
      a.red - b.red ||
      b.green - a.green ||
      b.net - a.net,
  );
  console.log('\n=== RANKED by days in ₹750–2000 band ===');
  for (const r of results) {
    console.log(
      `inBand=${r.inBand}/${r.days} (${r.bandPct}%) red=${r.red} green=${r.green} net=${r.net} avg=${r.avg} | ${r.label}`,
    );
  }
  const best = results[0];
  console.log('\nBEST', best.label, best.cfg);
  fs.writeFileSync('/tmp/sr-band-hunt.json', JSON.stringify({ best, results }, null, 2));
  console.log('wrote /tmp/sr-band-hunt.json');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
