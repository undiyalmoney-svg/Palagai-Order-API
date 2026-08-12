/**
 * All3 treasure live-path P&L — past ~3 months.
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
  resolveCrudeStrategyProfile,
} = require('../live/strategy-core.cjs');
const market = require('../live/kite-market');
const {
  LIVE_GREEN_DNA,
  liveGreenTrapExtras,
  liveGreenBankTrapExtras,
} = require('../live/dna-live-green');
const { liveCrudeGreenProfileOverrides } = require('../live/dna-live-crude-green');
const { filterTradesLivePath, DEFAULT_LIVE_PATH } = require('../live/live-path');

const FROM = process.env.FROM || '2026-05-12';
const TO = process.env.TO || '2026-08-12';
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
    extras: bank ? liveGreenBankTrapExtras() : liveGreenTrapExtras(),
  };
}

async function bookIndex(a, instruments, candles, inst, kind, optCache) {
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
  const init = trapInit(inst.id);
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

async function bookCrude(a, instruments, candles, optCache) {
  const tradeParams = {
    ...resolveCrudeStrategyProfile('live-crude-green'),
    ...liveCrudeGreenProfileOverrides(),
  };
  const base = {
    instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
    instrumentName: 'Crude',
    candles,
    fromDate: FROM,
    toDate: TO,
    instruments,
    forceCloseOpen: true,
    lotsMultiplier: 1,
    dayLossStopPts: 0,
    enableMorning: false,
    enableEvening: true,
    tradeParams,
  };
  const need = new Set();
  replayPaperOnCrude({
    ...base,
    optionCandlesByToken: new Map(),
    neededOptionTokens: need,
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
    replayPaperOnCrude({
      ...base,
      optionCandlesByToken: opt,
      neededOptionTokens: new Set(),
    }).trades || []
  );
}

(async () => {
  const a = auth();
  log('All3 treasure 3m', FROM, '→', TO);
  const instruments = await market.fetchInstruments(a);
  const crudeInstruments = instruments.filter((i) =>
    /CRUDEOILM/i.test(String(i.tradingsymbol || i.tradingSymbol || '')),
  );
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
  const crudeC = await fetch5mCached(a, fut.instrumentToken, addDays(FROM, -12), TO);
  log('candles', niftyC.length, bankC.length, crudeC.length);

  log('books…');
  const nTr = await bookIndex(a, instruments, niftyC, NIFTY_50_INSTRUMENT, 'nifty', optCache);
  log('nifty trades', nTr.length);
  const bTr = await bookIndex(a, instruments, bankC, BANK_NIFTY_INSTRUMENT, 'banknifty', optCache);
  log('bank trades', bTr.length);
  const cTr = await bookCrude(a, crudeInstruments, crudeC, optCache);
  log('crude trades', cTr.length);

  // Anti-churn guard (mirror live): per-book max trades/day + cooldown.
  function applyGuard(trades, { indexMax = 3, crudeMax = 2, indexCdMin = 12, crudeCdMin = 20 } = {}) {
    const sorted = [...trades].sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));
    const st = {};
    const out = [];
    for (const t of sorted) {
      const id = String(t.instrumentId || '').toLowerCase();
      const book = id.includes('crude') ? 'crude' : id.includes('bank') ? 'bank' : 'nifty';
      const kkey = book + dayOf(t);
      st[kkey] = st[kkey] || { n: 0, lastExit: 0 };
      const s = st[kkey];
      const max = book === 'crude' ? crudeMax : indexMax;
      const cd = book === 'crude' ? crudeCdMin : indexCdMin;
      if (s.n >= max) continue;
      const em = Date.parse(t.entryTime);
      if (s.lastExit && (em - s.lastExit) / 60000 < cd) continue;
      out.push(t);
      s.n++;
      s.lastExit = Date.parse(t.exitTime || t.entryTime);
    }
    return out;
  }

  const bandMin = Number(LIVE_GREEN_DNA.liveOps.deskGreenLockRs) || 0;
  const kept0 = filterTradesLivePath([...nTr, ...bTr, ...cTr], {
    ...DEFAULT_LIVE_PATH,
    maxOpenLegs: 1,
    dayProfitLockRs: 0,
    dayStopRs: 0,
    bankOnlyAfterNifty: false,
    bankOnlyAfterNiftyGreen: false,
    winStreakToBand: false,
    indexFirstWinLock: false,
    deskGreenLockRs: bandMin, // ₹1,000/day target lock
    dustTradeRs: 10,
  });
  const kept = applyGuard(kept0);

  const byDay = new Map();
  for (const t of kept) {
    const d = dayOf(t);
    const row = byDay.get(d) || { date: d, net: 0, n: 0, nifty: 0, bank: 0, crude: 0 };
    const n = netOf(t);
    row.net += n;
    row.n += 1;
    const id = String(t.instrumentId || '');
    if (id.includes('bank')) row.bank += n;
    else if (id.includes('crude')) row.crude += n;
    else row.nifty += n;
    byDay.set(d, row);
  }
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const green = days.filter((d) => d.net > 0);
  const red = days.filter((d) => d.net < 0);
  const net = days.reduce((s, d) => s + d.net, 0);
  const avg = days.length ? Math.round(net / days.length) : 0;
  const byBook = {
    nifty: days.reduce((s, d) => s + d.nifty, 0),
    bank: days.reduce((s, d) => s + d.bank, 0),
    crude: days.reduce((s, d) => s + d.crude, 0),
  };

  const out = {
    from: FROM,
    to: TO,
    lots: 1,
    path: 'live-path · one-leg · reject estimated · dust ₹10 · treasure DNA',
    days: days.length,
    green: green.length,
    red: red.length,
    flat: days.length - green.length - red.length,
    net,
    avg,
    worst: days.length ? Math.min(...days.map((d) => d.net)) : 0,
    best: days.length ? Math.max(...days.map((d) => d.net)) : 0,
    byBook,
    greenRate: days.length ? Math.round((green.length / days.length) * 1000) / 10 : 0,
    dayRows: days,
  };
  fs.writeFileSync('/tmp/all3-treasure-3m.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  log('wrote /tmp/all3-treasure-3m.json');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
