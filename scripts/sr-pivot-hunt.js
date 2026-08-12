/**
 * Pivot S/R + perfect-SL A/B vs window swing — classic live-path score.
 */
require('dotenv').config();
process.chdir(require('path').join(__dirname, '..'));
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const {
  NIFTY_50_INSTRUMENT,
  BANK_NIFTY_INSTRUMENT,
  createTrapStrategy,
  replayPaperOnIndex,
} = require('../live/strategy-core.cjs');
const market = require('../live/kite-market');
const { liveGreenTrapExtras } = require('../live/dna-live-green');
const { filterTradesLivePath } = require('../live/live-path');

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
function getEncKey() {
  return crypto
    .createHash('sha256')
    .update(String(process.env.LIVE_AUTH_SECRET || 'palagai-dev-only'))
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

(async () => {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const doc = await c
    .db(process.env.MONGODB_DB || 'palagai')
    .collection('kite_auth')
    .findOne({ _id: '6a6dcaba3b1d88570bc6fcba' });
  const auth = `token ${dec(doc.apiKeyEnc)}:${dec(doc.accessTokenEnc)}`;
  await c.close();
  const instruments = await market.fetchInstruments(auth);
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

  async function book(candles, instrument, kind, extras) {
    const bank = /bank/i.test(instrument.id);
    const init = {
      maxTradesPerDay: bank ? 2 : 3,
      targetRMultiple: 3.5,
      extras: { ...liveGreenTrapExtras(), ...extras },
      dayProfitLockPts: 0,
      dayStopPts: 0,
      dayProfitLockRs: 1250,
      dayStopRs: 1475,
    };
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

  const cfgs = [
    {
      label: 'WINDOW_slPad2',
      extras: {
        srMethod: 'window',
        swingLb: 5,
        perfectSweepSl: false,
        slPadPts: 2,
        trapMode: 'both',
        piercePts: 20,
        bankPiercePts: 60,
        orConfluencePts: 0,
      },
    },
    {
      label: 'WINDOW_perfectSL',
      extras: {
        srMethod: 'window',
        swingLb: 5,
        perfectSweepSl: true,
        slPadPts: 1,
        trapMode: 'both',
        piercePts: 20,
        bankPiercePts: 60,
        orConfluencePts: 0,
      },
    },
    {
      label: 'PIVOT2_perfectSL',
      extras: {
        srMethod: 'pivot',
        pivotStrength: 2,
        perfectSweepSl: true,
        slPadPts: 1,
        trapMode: 'both',
        piercePts: 20,
        bankPiercePts: 60,
        orConfluencePts: 0,
      },
    },
    {
      label: 'PIVOT3_perfectSL',
      extras: {
        srMethod: 'pivot',
        pivotStrength: 3,
        perfectSweepSl: true,
        slPadPts: 1,
        trapMode: 'both',
        piercePts: 20,
        bankPiercePts: 60,
        orConfluencePts: 0,
      },
    },
  ];

  for (const cfg of cfgs) {
    const n = await book(niftyC, NIFTY_50_INSTRUMENT, 'nifty', cfg.extras);
    const b = await book(bankC, BANK_NIFTY_INSTRUMENT, 'banknifty', cfg.extras);
    const kept = filterTradesLivePath([...n, ...b], {
      maxOpenLegs: 1,
      dayProfitLockRs: 2500,
      dayStopRs: 2950,
      rejectEstimatedPremium: true,
      bankOnlyAfterNifty: true,
      bankOnlyAfterNiftyGreen: false,
      winStreakToBand: false,
      indexFirstWinLock: false,
      deskGreenLockRs: 0,
    });
    const by = new Map();
    for (const t of kept) {
      const d = dayOf(t);
      const r = by.get(d) || { date: d, net: 0, n: 0 };
      r.net += netOf(t);
      r.n += 1;
      by.set(d, r);
    }
    const days = [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
    const green = days.filter((d) => d.net > 0).length;
    const red = days.filter((d) => d.net < 0).length;
    const inBand = days.filter((d) => d.net >= 750 && d.net <= 2000).length;
    const net = days.reduce((s, d) => s + d.net, 0);
    const avg = days.length ? Math.round(net / days.length) : 0;
    console.log(
      JSON.stringify({
        label: cfg.label,
        days: days.length,
        green,
        red,
        inBand,
        net,
        avg,
        rows: days,
      }),
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
