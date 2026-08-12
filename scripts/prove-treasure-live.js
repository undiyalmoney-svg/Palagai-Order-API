/**
 * Re-prove treasure winner on live-path marks (cache-first).
 * Winner: Pivot2 BOTH pierce20/B60 · perfectSweepSl · stand0 · unlimited · raw desk
 */
require('dotenv').config();
process.chdir(require('path').join(__dirname, '..'));
const fs = require('fs');
const path = require('path');
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
const { LIVE_GREEN_DNA, liveGreenTrapExtras } = require('../live/dna-live-green');
const { filterTradesLivePath, DEFAULT_LIVE_PATH } = require('../live/live-path');

const FROM = '2026-03-12';
const TO = '2026-08-11';
const CACHE = '/tmp/kite-opt-cache';
fs.mkdirSync(CACHE, { recursive: true });

function auth() {
  if (process.env.KITE_AUTH) {
    const a = process.env.KITE_AUTH;
    return a.startsWith('token') ? a : `token ${a}`;
  }
  if (fs.existsSync('/tmp/kite/auth.txt')) {
    return fs.readFileSync('/tmp/kite/auth.txt', 'utf8').trim();
  }
  throw new Error('Set KITE_AUTH or /tmp/kite/auth.txt');
}

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const dayOf = (t) => String(t.entryTime).slice(0, 10);
const netOf = (t) => Math.round(t.netOptionPnlRs ?? t.optionPnlRs ?? 0);

async function fetch5mCached(a, token, from, to) {
  const key = `${token}_${from}_${to}.json`;
  const fp = path.join(CACHE, key);
  if (fs.existsSync(fp)) {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  }
  const chunks = [];
  let cur = from;
  while (cur <= to) {
    let end = addDays(cur, 89);
    if (end > to) end = to;
    const part = await market.fetchHistorical5m(a, token, cur, end);
    chunks.push(...(part || []));
    if (end >= to) break;
    cur = addDays(end, 1);
  }
  const map = new Map();
  for (const r of chunks) map.set(r.date, r);
  const rows = [...map.values()].sort((x, y) => String(x.date).localeCompare(String(y.date)));
  fs.writeFileSync(fp, JSON.stringify(rows));
  return rows;
}

function trapInit(id) {
  const bank = /bank/i.test(id);
  const t = LIVE_GREEN_DNA.trap;
  return {
    dayProfitLockPts: 0,
    dayStopPts: 0,
    dayProfitLockRs: 0,
    dayStopRs: 0,
    maxTradesPerDay: bank ? t.bankMaxTradesPerDay || 0 : t.maxTradesPerDay || 0,
    targetRMultiple: t.targetRMultiple,
    extras: liveGreenTrapExtras({
      optionStandDownRs: LIVE_GREEN_DNA.liveOps.optionStandDownRs,
    }),
  };
}

async function book(a, instruments, candles, inst, kind, init, optCache) {
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
  };
  const need = new Set();
  replayPaperOnIndex({
    ...base,
    optionCandlesByToken: new Map(),
    neededOptionTokens: need,
    strategy: (() => {
      const s = createTrapStrategy();
      s.initialize(init);
      return s;
    })(),
  });
  const opt = new Map();
  for (const tok of need) {
    if (optCache.has(tok)) {
      opt.set(tok, optCache.get(tok));
      continue;
    }
    try {
      const rows = await fetch5mCached(a, tok, addDays(FROM, -2), TO);
      optCache.set(tok, rows);
      opt.set(tok, rows);
    } catch {
      optCache.set(tok, []);
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

(async () => {
  const a = auth();
  console.log('prove treasure', LIVE_GREEN_DNA.id, FROM, '→', TO);
  const instruments = await market.fetchInstruments(a);
  const niftyC = await fetch5mCached(
    a,
    NIFTY_50_INSTRUMENT.instrumentToken,
    addDays(FROM, -12),
    TO,
  );
  const bankC = await fetch5mCached(
    a,
    BANK_NIFTY_INSTRUMENT.instrumentToken,
    addDays(FROM, -12),
    TO,
  );
  const fut = resolveCrudeOilMiniFuturesToken(instruments);
  const crudeC = fut?.instrumentToken
    ? await fetch5mCached(a, fut.instrumentToken, addDays(FROM, -12), TO)
    : [];
  const optCache = new Map();

  let crudeTrades = [];
  if (crudeC.length) {
    const profile = resolveCrudeStrategyProfile('live-crude-green');
    const tradeParams = { ...profile };
    const dayLossStopPts = resolveCrudeProfileDayLossPts(tradeParams, false);
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
        copt.set(tok, await fetch5mCached(a, tok, FROM, TO));
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

  const nTr = await book(
    a,
    instruments,
    niftyC,
    NIFTY_50_INSTRUMENT,
    'nifty',
    trapInit('nifty-50'),
    optCache,
  );
  const bTr = await book(
    a,
    instruments,
    bankC,
    BANK_NIFTY_INSTRUMENT,
    'banknifty',
    trapInit('bank-nifty'),
    optCache,
  );
  const merged = [...nTr, ...bTr, ...crudeTrades];

  const kept = filterTradesLivePath(merged, {
    ...DEFAULT_LIVE_PATH,
    maxOpenLegs: 1,
    dayProfitLockRs: 0,
    dayStopRs: 0,
    bankOnlyAfterNifty: false,
    bankOnlyAfterNiftyGreen: false,
    winStreakToBand: false,
    indexFirstWinLock: false,
    deskGreenLockRs: 0,
    dustTradeRs: LIVE_GREEN_DNA.liveOps.dustTradeRs || 10,
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
  const green = days.filter((d) => d.net > 0);
  const red = days.filter((d) => d.net < 0);
  const net = days.reduce((s, d) => s + d.net, 0);
  const avg = days.length ? Math.round(net / days.length) : 0;

  const out = {
    dna: LIVE_GREEN_DNA.id,
    from: FROM,
    to: TO,
    rawTrades: { nifty: nTr.length, bank: bTr.length, crude: crudeTrades.length },
    kept: kept.length,
    days: days.length,
    green: green.length,
    red: red.length,
    net,
    avg,
    dayRows: days,
  };
  fs.writeFileSync('/tmp/treasure-prove.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (red.length !== 0) {
    console.error('FAIL: red days remain');
    process.exit(2);
  }
  if (green.length < 8) {
    console.error('FAIL: too few green live-mark days');
    process.exit(3);
  }
  console.log('PASS zero-red live-path', `${green.length}/${days.length}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
