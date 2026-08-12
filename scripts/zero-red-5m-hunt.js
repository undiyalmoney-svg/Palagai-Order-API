/**
 * Treasure hunt: last ~5 months · find S/R rules with ZERO red days.
 * No trade-cap bias in the search (max trades = 0 / unlimited).
 * Auth: KITE_AUTH env or /tmp/kite/auth.txt
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
const { liveGreenTrapExtras } = require('../live/dna-live-green');
const { filterTradesLivePath } = require('../live/live-path');

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
  // Kite caps ~100 calendar days per historical request — chunk at 90.
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

function trapInit(cfg, id) {
  const bank = /bank/i.test(id);
  const extras = {
    ...liveGreenTrapExtras(),
    piercePts: cfg.pierce,
    bankPiercePts: cfg.bankPierce,
    trapMode: cfg.mode,
    swingLb: cfg.swingLb || 5,
    srMethod: cfg.srMethod || 'pivot',
    pivotStrength: cfg.pivotStrength || 2,
    perfectSweepSl: cfg.perfectSweepSl !== false,
    slPadPts: cfg.slPad != null ? cfg.slPad : 1,
    orConfluencePts: cfg.orConf || 0,
    pdhlConfluencePts: cfg.pdhlConf || 0,
    optionStandDownRs: cfg.stand != null ? cfg.stand : 350,
    bounceOrPierceMult: 0,
    bounceOrPierceCap: 0,
    profitLockArmRs: cfg.arm || 100,
    profitLockLockRs: cfg.lock || 50,
    profitLockGivebackRs: cfg.give || 50,
  };
  return {
    // 0 = unlimited (user: no trade limits)
    maxTradesPerDay: cfg.max != null ? (bank ? cfg.bankMax ?? cfg.max : cfg.max) : 0,
    targetRMultiple: cfg.rr || 3.5,
    extras,
    dayProfitLockPts: 0,
    dayStopPts: 0,
    dayProfitLockRs: 0,
    dayStopRs: 0,
  };
}

async function book(a, instruments, candles, instrument, kind, init, optCache) {
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

function score(label, trades, desk) {
  const kept = filterTradesLivePath(trades, {
    maxOpenLegs: desk.oneLeg ? 1 : 0,
    dayProfitLockRs: desk.dayLock || 0,
    dayStopRs: desk.dayStop || 0,
    rejectEstimatedPremium: desk.rejectEst !== false,
    bankOnlyAfterNifty: !!desk.bankAfterNifty,
    bankOnlyAfterNiftyGreen: !!desk.bankAfterNiftyGreen,
    winStreakToBand: !!desk.winStreakToBand,
    indexFirstWinLock: !!desk.firstWin,
    deskGreenLockRs: desk.bandMin || 0,
    recoveryMaxExtra: 0,
    dustTradeRs: desk.dustTradeRs != null ? desk.dustTradeRs : 10,
  });
  // Optional: stop after first index loss (post-filter)
  let final = kept;
  if (desk.stopAfterIndexLoss) {
    const sorted = [...kept].sort((a, b) =>
      String(a.entryTime).localeCompare(String(b.entryTime)),
    );
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
      const isCrude = String(t.instrumentId || '').includes('crude');
      if (!isCrude && lost) continue;
      const entry = String(t.entryTime);
      const exit = String(t.exitTime || t.entryTime);
      if (openUntil && entry < openUntil) continue;
      out.push(t);
      openUntil = exit;
      if (!isCrude && netOf(t) < 0) lost = true;
    }
    final = out;
  }

  const byDay = new Map();
  for (const t of final) {
    const d = dayOf(t);
    const row = byDay.get(d) || { date: d, net: 0, n: 0, books: new Set() };
    row.net += netOf(t);
    row.n += 1;
    row.books.add(t.instrumentId);
    byDay.set(d, row);
  }
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const green = days.filter((d) => d.net > 0).length;
  const red = days.filter((d) => d.net < 0).length;
  const flat = days.length - green - red;
  const net = days.reduce((s, d) => s + d.net, 0);
  const avg = days.length ? Math.round(net / days.length) : 0;
  const inBand = days.filter((d) => d.net >= 750 && d.net <= 2000).length;
  return {
    label,
    days: days.length,
    green,
    red,
    flat,
    net,
    avg,
    inBand,
    worst: days.length ? Math.min(...days.map((d) => d.net)) : 0,
    best: days.length ? Math.max(...days.map((d) => d.net)) : 0,
    dayRows: days,
  };
}

(async () => {
  const a = auth();
  console.log('auth ok, window', FROM, '→', TO);
  const instruments = await market.fetchInstruments(a);
  console.log('instruments', instruments.length);
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
  let crudeC = [];
  if (fut?.instrumentToken) {
    crudeC = await fetch5mCached(a, fut.instrumentToken, addDays(FROM, -12), TO);
  }
  console.log('index candles', niftyC.length, bankC.length, crudeC.length);

  // Crude book once (fixed LIVE_CRUDE_GREEN)
  let crudeTrades = [];
  const optCache = new Map();
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
        const rows = await fetch5mCached(a, tok, FROM, TO);
        copt.set(tok, rows);
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
    console.log('crude trades', crudeTrades.length);
  }

  const signalCfgs = [
    { label: 'PIVOT2_both_p20_B60', srMethod: 'pivot', pivotStrength: 2, mode: 'both', pierce: 20, bankPierce: 60, max: 0, stand: 350 },
    { label: 'PIVOT2_both_p20_B40', srMethod: 'pivot', pivotStrength: 2, mode: 'both', pierce: 20, bankPierce: 40, max: 0, stand: 350 },
    { label: 'WINDOW_both_p20_B60', srMethod: 'window', mode: 'both', pierce: 20, bankPierce: 60, max: 0, stand: 350 },
    { label: 'PIVOT2_trap_p20_B60', srMethod: 'pivot', pivotStrength: 2, mode: 'trap', pierce: 20, bankPierce: 60, max: 0, stand: 350 },
    { label: 'PIVOT2_both_p20_B60_stand0', srMethod: 'pivot', pivotStrength: 2, mode: 'both', pierce: 20, bankPierce: 60, max: 0, stand: 0 },
    { label: 'PIVOT2_both_p15_B40', srMethod: 'pivot', pivotStrength: 2, mode: 'both', pierce: 15, bankPierce: 40, max: 0, stand: 350 },
    { label: 'PIVOT3_both_p20_B60', srMethod: 'pivot', pivotStrength: 3, mode: 'both', pierce: 20, bankPierce: 60, max: 0, stand: 350 },
    { label: 'PIVOT2_both_p20_B60_max3', srMethod: 'pivot', pivotStrength: 2, mode: 'both', pierce: 20, bankPierce: 60, max: 3, bankMax: 2, stand: 350 },
  ];

  const deskCfgs = [
    { id: 'raw', oneLeg: true, rejectEst: true, bankAfterNifty: false, bankAfterNiftyGreen: false, firstWin: false, stopAfterIndexLoss: false, dayLock: 0, dayStop: 0, bandMin: 0, winStreakToBand: false },
    { id: 'bankAfter', oneLeg: true, rejectEst: true, bankAfterNifty: true, bankAfterNiftyGreen: false, firstWin: false, stopAfterIndexLoss: false, dayLock: 0, dayStop: 0, bandMin: 0, winStreakToBand: false },
    { id: 'bankAfterGreen', oneLeg: true, rejectEst: true, bankAfterNifty: true, bankAfterNiftyGreen: true, firstWin: false, stopAfterIndexLoss: false, dayLock: 0, dayStop: 0, bandMin: 0, winStreakToBand: false },
    { id: 'stopAfterLoss', oneLeg: true, rejectEst: true, bankAfterNifty: true, bankAfterNiftyGreen: false, firstWin: false, stopAfterIndexLoss: true, dayLock: 0, dayStop: 0, bandMin: 0, winStreakToBand: false },
    { id: 'firstWin', oneLeg: true, rejectEst: true, bankAfterNifty: true, bankAfterNiftyGreen: false, firstWin: true, stopAfterIndexLoss: false, dayLock: 0, dayStop: 0, bandMin: 0, winStreakToBand: false },
    { id: 'bankAfter+stopLoss', oneLeg: true, rejectEst: true, bankAfterNifty: true, bankAfterNiftyGreen: false, firstWin: false, stopAfterIndexLoss: true, dayLock: 0, dayStop: 0, bandMin: 0, winStreakToBand: false },
    { id: 'bankGreen+stopLoss', oneLeg: true, rejectEst: true, bankAfterNifty: true, bankAfterNiftyGreen: true, firstWin: false, stopAfterIndexLoss: true, dayLock: 0, dayStop: 0, bandMin: 0, winStreakToBand: false },
    { id: 'firstWin+bankGreen', oneLeg: true, rejectEst: true, bankAfterNifty: true, bankAfterNiftyGreen: true, firstWin: true, stopAfterIndexLoss: false, dayLock: 0, dayStop: 0, bandMin: 0, winStreakToBand: false },
  ];

  const results = [];
  for (const sc of signalCfgs) {
    console.log('\n== signal', sc.label);
    const nTr = await book(
      a,
      instruments,
      niftyC,
      NIFTY_50_INSTRUMENT,
      'nifty',
      trapInit(sc, 'nifty-50'),
      optCache,
    );
    const bTr = await book(
      a,
      instruments,
      bankC,
      BANK_NIFTY_INSTRUMENT,
      'banknifty',
      trapInit(sc, 'bank-nifty'),
      optCache,
    );
    const merged = [...nTr, ...bTr, ...crudeTrades];
    console.log('  raw trades n/b/c', nTr.length, bTr.length, crudeTrades.length);

    for (const desk of deskCfgs) {
      const s = score(`${sc.label} | ${desk.id}`, merged, desk);
      s.signal = sc;
      s.desk = desk;
      results.push(s);
      if (s.red === 0 && s.green >= 5) {
        console.log(
          `  ★ ZERO-RED green=${s.green}/${s.days} net=${s.net} avg=${s.avg} | ${desk.id}`,
        );
      }
    }
  }

  results.sort(
    (a, b) =>
      a.red - b.red || b.green - a.green || b.net - a.net || b.avg - a.avg,
  );

  console.log('\n========== TOP 25 ==========');
  for (const r of results.slice(0, 25)) {
    console.log(
      `red=${r.red} green=${r.green}/${r.days} net=${r.net} avg=${r.avg} worst=${r.worst} inBand=${r.inBand} | ${r.label}`,
    );
  }

  const zero = results.filter((r) => r.red === 0 && r.green >= 8);
  console.log('\n========== ZERO RED (≥8 green days) ==========');
  for (const r of zero.slice(0, 15)) {
    console.log(
      `green=${r.green}/${r.days} net=${r.net} avg=${r.avg} best=${r.best} worst=${r.worst} | ${r.label}`,
    );
  }

  const best = zero[0] || results.find((r) => r.red === 0) || results[0];
  console.log('\nBEST', best.label);
  console.log('days', JSON.stringify(best.dayRows, null, 2));
  fs.writeFileSync(
    '/tmp/zero-red-5m.json',
    JSON.stringify({ FROM, TO, best, zero: zero.slice(0, 20), top: results.slice(0, 40) }, null, 2),
  );
  console.log('wrote /tmp/zero-red-5m.json');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
