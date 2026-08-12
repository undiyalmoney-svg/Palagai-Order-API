/**
 * Refine around winner: sor SL20/TP60 OR40-60 confirm OFF.
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
  resolveCrudeOilMiniFuturesToken,
} = require('../live/strategy-core.cjs');
const market = require('../live/kite-market');
const { LIVE_GREEN_DNA, liveGreenTrapExtras } = require('../live/dna-live-green');
const { filterTradesLivePath, DEFAULT_LIVE_PATH } = require('../live/live-path');

const FROM = '2026-03-12';
const TO = '2026-08-11';
const LIVE_FROM = '2026-07-01';
const CACHE = '/tmp/kite-opt-cache';
fs.mkdirSync(CACHE, { recursive: true });
const log = (...a) =>
  process.stderr.write(
    a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n',
  );

function auth() {
  if (process.env.KITE_AUTH) {
    const a = process.env.KITE_AUTH;
    return a.startsWith('token') ? a : `token ${a}`;
  }
  return fs.readFileSync('/tmp/kite/auth.txt', 'utf8').trim();
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
  if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  const chunks = [];
  let cur = from;
  while (cur <= to) {
    let end = addDays(cur, 89);
    if (end > to) end = to;
    chunks.push(...((await market.fetchHistorical5m(a, token, cur, end)) || []));
    if (end >= to) break;
    cur = addDays(end, 1);
  }
  const map = new Map();
  for (const r of chunks) map.set(r.date, r);
  const rows = [...map.values()].sort((x, y) => String(x.date).localeCompare(String(y.date)));
  fs.writeFileSync(fp, JSON.stringify(rows));
  return rows;
}

function scoreLive(trades) {
  const kept = filterTradesLivePath(trades, {
    ...DEFAULT_LIVE_PATH,
    maxOpenLegs: 1,
    dayProfitLockRs: 0,
    dayStopRs: 0,
    bankOnlyAfterNifty: false,
    bankOnlyAfterNiftyGreen: false,
    winStreakToBand: false,
    indexFirstWinLock: false,
    deskGreenLockRs: 0,
    dustTradeRs: 10,
  });
  const byDay = new Map();
  for (const t of kept) {
    const d = dayOf(t);
    const row = byDay.get(d) || { date: d, net: 0, n: 0, crude: 0, index: 0 };
    const n = netOf(t);
    row.net += n;
    row.n += 1;
    if (String(t.instrumentId || '').includes('crude')) row.crude += n;
    else row.index += n;
    byDay.set(d, row);
  }
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const crudeDays = days.filter((d) => d.crude !== 0);
  const crudeNet = days.reduce((s, d) => s + d.crude, 0);
  const net = days.reduce((s, d) => s + d.net, 0);
  return {
    days: days.length,
    green: days.filter((d) => d.net > 0).length,
    red: days.filter((d) => d.net < 0).length,
    net,
    avg: days.length ? Math.round(net / days.length) : 0,
    worst: days.length ? Math.min(...days.map((d) => d.net)) : 0,
    best: days.length ? Math.max(...days.map((d) => d.net)) : 0,
    crudeDays: crudeDays.length,
    crudeGreen: crudeDays.filter((d) => d.crude > 0).length,
    crudeRed: crudeDays.filter((d) => d.crude < 0).length,
    crudeNet,
    crudeAvg: crudeDays.length ? Math.round(crudeNet / crudeDays.length) : 0,
    dayRows: days,
  };
}

function base(o = {}) {
  return {
    profileId: 'crude-treasure',
    label: 'Crude Treasure',
    stopPts: 20,
    morningTargetPts: 60,
    eveningTargetPts: 60,
    targetRMultiple: 0,
    dayLossStopPts: 0,
    strictDayLossPts: 0,
    dayProfitLockPts: 0,
    entryMode: 'session-or',
    requireConfirm: false,
    firstWinLock: false,
    eveningEntryStart: '16:00',
    eveningEntryEnd: '21:00',
    sessionOrStart: '09:00',
    sessionOrEnd: '09:30',
    minOrWidth: 40,
    maxOrWidth: 60,
    breakBufferPts: 0,
    maxEveningTradesDay: 0,
    defaultEnableMorning: false,
    defaultEnableEvening: true,
    piercePts: 8,
    trapEntryStyle: 'both',
    profitLockArmRs: 350,
    profitLockLockRs: 180,
    profitLockGivebackRs: 170,
    slConfirmCutoffEnabled: false,
    slConfirmCutoffFracR: 0.55,
    slConfirmCutoffMaxMfeR: 0.75,
    slConfirmSoftRs: 700,
    ...o,
  };
}

async function bookIndex(a, instruments, candles, inst, kind, optCache) {
  const t = LIVE_GREEN_DNA.trap;
  const bank = /bank/i.test(inst.id);
  const init = {
    dayProfitLockPts: 0,
    dayStopPts: 0,
    dayProfitLockRs: 0,
    dayStopRs: 0,
    maxTradesPerDay: bank ? t.bankMaxTradesPerDay || 0 : t.maxTradesPerDay || 0,
    targetRMultiple: t.targetRMultiple,
    extras: liveGreenTrapExtras(),
  };
  const baseP = {
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
    ...baseP,
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
    if (optCache.has(tok)) opt.set(tok, optCache.get(tok));
    else {
      try {
        const rows = await fetch5mCached(a, tok, addDays(FROM, -2), TO);
        optCache.set(tok, rows);
        opt.set(tok, rows);
      } catch {
        optCache.set(tok, []);
        opt.set(tok, []);
      }
    }
  }
  return (
    replayPaperOnIndex({
      ...baseP,
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

async function bookCrude(a, instruments, candles, tp, optCache) {
  const baseP = {
    instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
    instrumentName: 'Crude',
    candles,
    fromDate: LIVE_FROM,
    toDate: TO,
    instruments,
    forceCloseOpen: true,
    lotsMultiplier: 1,
    dayLossStopPts: 0,
    enableMorning: false,
    enableEvening: true,
    tradeParams: tp,
  };
  const need = new Set();
  replayPaperOnCrude({
    ...baseP,
    optionCandlesByToken: new Map(),
    neededOptionTokens: need,
  });
  const opt = new Map();
  for (const tok of need) {
    if (optCache.has(tok)) opt.set(tok, optCache.get(tok));
    else {
      try {
        const rows = await fetch5mCached(a, tok, addDays(LIVE_FROM, -2), TO);
        optCache.set(tok, rows);
        opt.set(tok, rows);
      } catch {
        optCache.set(tok, []);
        opt.set(tok, []);
      }
    }
  }
  return (
    replayPaperOnCrude({
      ...baseP,
      optionCandlesByToken: opt,
      neededOptionTokens: new Set(),
    }).trades || []
  );
}

(async () => {
  const a = auth();
  const instruments = await market.fetchInstruments(a);
  const crudeInstruments = instruments.filter((i) => {
    const s = String(i.tradingsymbol || i.tradingSymbol || '');
    return /CRUDEOILM/i.test(s);
  });
  const optCache = new Map();
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
  const crudeCfull = await fetch5mCached(a, fut.instrumentToken, addDays(FROM, -12), TO);
  const warm = addDays(LIVE_FROM, -5);
  const crudeC = crudeCfull.filter((c) => String(c.date).slice(0, 10) >= warm);

  log('index…');
  const indexTrades = [
    ...(await bookIndex(a, instruments, niftyC, NIFTY_50_INSTRUMENT, 'nifty', optCache)),
    ...(await bookIndex(a, instruments, bankC, BANK_NIFTY_INSTRUMENT, 'banknifty', optCache)),
  ];

  const cands = [
    { id: 'WIN_20_60_or40-60_c0_tr350', tp: base() },
    {
      id: '20_60_or40-60_c0_tr0',
      tp: base({ profitLockArmRs: 0, profitLockLockRs: 0, profitLockGivebackRs: 0 }),
    },
    { id: '15_50_or40-60_c0', tp: base({ stopPts: 15, eveningTargetPts: 50, morningTargetPts: 50 }) },
    { id: '15_60_or40-60_c0', tp: base({ stopPts: 15, eveningTargetPts: 60, morningTargetPts: 60 }) },
    { id: '20_50_or40-60_c0', tp: base({ stopPts: 20, eveningTargetPts: 50, morningTargetPts: 50 }) },
    { id: '20_70_or40-60_c0', tp: base({ stopPts: 20, eveningTargetPts: 70, morningTargetPts: 70 }) },
    { id: '20_80_or40-60_c0', tp: base({ stopPts: 20, eveningTargetPts: 80, morningTargetPts: 80 }) },
    { id: '25_75_or40-60_c0', tp: base({ stopPts: 25, eveningTargetPts: 75, morningTargetPts: 75 }) },
    { id: '30_80_or40-60_c0', tp: base({ stopPts: 30, eveningTargetPts: 80, morningTargetPts: 80 }) },
    {
      id: '20_60_or40-60_c0_1515',
      tp: base({ eveningEntryStart: '15:15', eveningEntryEnd: '22:00' }),
    },
    {
      id: '20_60_or35-65_c0',
      tp: base({ minOrWidth: 35, maxOrWidth: 65 }),
    },
    {
      id: '20_60_or40-60_c0_buf2',
      tp: base({ breakBufferPts: 2 }),
    },
    {
      id: '20_60_or40-60_c0_tr250',
      tp: base({ profitLockArmRs: 250, profitLockLockRs: 120, profitLockGivebackRs: 130 }),
    },
  ];

  const results = [];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const crudeTrades = await bookCrude(a, crudeInstruments, crudeC, c.tp, optCache);
    const crude = scoreLive(crudeTrades);
    const all3 = scoreLive([...indexTrades, ...crudeTrades]);
    results.push({ id: c.id, tp: c.tp, crude, all3 });
    log(
      `${crude.crudeRed === 0 ? '★' : ' '} ${i + 1}/${cands.length} ${c.id} | c ${crude.crudeGreen}/${crude.crudeDays} red=${crude.crudeRed} avg=${crude.crudeAvg} | a3 ${all3.green}/${all3.days} red=${all3.red} avg=${all3.avg}`,
    );
  }

  results.sort(
    (a, b) =>
      a.crude.crudeRed - b.crude.crudeRed ||
      a.all3.red - b.all3.red ||
      b.crude.crudeDays - a.crude.crudeDays ||
      b.all3.avg - a.all3.avg ||
      b.crude.crudeAvg - a.crude.crudeAvg,
  );
  const best = results[0];
  log('\nBEST', best.id);
  log(JSON.stringify({ crude: best.crude, all3: best.all3 }, null, 2));
  fs.writeFileSync(
    '/tmp/crude-treasure-refine.json',
    JSON.stringify({ best, results }, null, 2),
  );
  log('wrote /tmp/crude-treasure-refine.json');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
