/**
 * Crude Oil Mini treasure — focused live-path hunt + All3 with index treasure.
 * Window: 2026-07-01 → 2026-08-11 (option marks).
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

const log = (...a) => {
  process.stderr.write(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
};

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
  if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
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

function treasureIndexInit(id) {
  const bank = /bank/i.test(id);
  const t = LIVE_GREEN_DNA.trap;
  return {
    dayProfitLockPts: 0,
    dayStopPts: 0,
    dayProfitLockRs: 0,
    dayStopRs: 0,
    maxTradesPerDay: bank ? t.bankMaxTradesPerDay || 0 : t.maxTradesPerDay || 0,
    targetRMultiple: t.targetRMultiple,
    extras: liveGreenTrapExtras(),
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
  const init = treasureIndexInit(inst.id);
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

async function bookCrudeLive(a, instruments, candles, tradeParams, optCache) {
  const base = {
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
      const rows = await fetch5mCached(a, tok, addDays(LIVE_FROM, -2), TO);
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

function scoreLive(label, trades) {
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
  const green = days.filter((d) => d.net > 0).length;
  const red = days.filter((d) => d.net < 0).length;
  const net = days.reduce((s, d) => s + d.net, 0);
  const crudeDays = days.filter((d) => d.crude !== 0);
  const crudeNet = days.reduce((s, d) => s + d.crude, 0);
  return {
    label,
    days: days.length,
    green,
    red,
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
    kept: kept.length,
  };
}

function baseCrude(o = {}) {
  return {
    profileId: 'crude-treasure',
    label: 'Crude Treasure',
    stopPts: 30,
    morningTargetPts: 80,
    eveningTargetPts: 80,
    targetRMultiple: 0,
    dayLossStopPts: 0,
    strictDayLossPts: 0,
    dayProfitLockPts: 0,
    entryMode: 'session-or',
    requireConfirm: true,
    firstWinLock: false,
    eveningEntryStart: '16:00',
    eveningEntryEnd: '21:00',
    sessionOrStart: '09:00',
    sessionOrEnd: '09:30',
    minOrWidth: 0,
    maxOrWidth: 0,
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

function candidates() {
  const out = [];
  const add = (id, tp) => out.push({ id, tp: baseCrude(tp) });

  // Baseline DNA (locks stripped vs locked)
  add('v3_max1_fw_trail', {
    minOrWidth: 40,
    maxOrWidth: 60,
    firstWinLock: true,
    maxEveningTradesDay: 1,
  });
  add('v3_unlimited_trail', { minOrWidth: 40, maxOrWidth: 60 });
  add('v3_unlimited_notrail', {
    minOrWidth: 40,
    maxOrWidth: 60,
    profitLockArmRs: 0,
    profitLockLockRs: 0,
    profitLockGivebackRs: 0,
  });

  // Session-OR treasure variants (after NSE, unlimited)
  for (const [sl, tp] of [
    [20, 60],
    [30, 80],
    [30, 100],
    [40, 120],
    [50, 150],
    [15, 100],
  ]) {
    for (const [minW, maxW] of [
      [40, 60],
      [30, 70],
      [0, 0],
      [20, 90],
    ]) {
      for (const confirm of [true, false]) {
        add(`sor_${sl}_${tp}_or${minW}-${maxW}_c${confirm ? 1 : 0}`, {
          stopPts: sl,
          eveningTargetPts: tp,
          minOrWidth: minW,
          maxOrWidth: maxW,
          requireConfirm: confirm,
        });
      }
    }
  }

  // S/R trap (index-style) after NSE
  for (const pierce of [5, 8, 12, 20]) {
    for (const style of ['both', 'trap']) {
      add(`trap_p${pierce}_${style}_30_80`, {
        entryMode: 'trap-confirm',
        piercePts: pierce,
        trapEntryStyle: style,
        stopPts: 30,
        eveningTargetPts: 80,
        morningTargetPts: 80,
        targetRMultiple: 0,
      });
      add(`trap_p${pierce}_${style}_50_150`, {
        entryMode: 'trap-confirm',
        piercePts: pierce,
        trapEntryStyle: style,
        stopPts: 50,
        eveningTargetPts: 150,
        morningTargetPts: 150,
        targetRMultiple: 0,
      });
      add(`trap_p${pierce}_${style}_RR35`, {
        entryMode: 'trap-confirm',
        piercePts: pierce,
        trapEntryStyle: style,
        stopPts: 80,
        eveningTargetPts: 0,
        morningTargetPts: 0,
        targetRMultiple: 3.5,
      });
    }
  }

  add('trap_p8_both_RR_1515', {
    entryMode: 'trap-confirm',
    piercePts: 8,
    trapEntryStyle: 'both',
    targetRMultiple: 3.5,
    stopPts: 80,
    eveningTargetPts: 0,
    morningTargetPts: 0,
    eveningEntryStart: '15:15',
    eveningEntryEnd: '22:00',
  });
  add('trap_p12_both_RR_1515', {
    entryMode: 'trap-confirm',
    piercePts: 12,
    trapEntryStyle: 'both',
    targetRMultiple: 3.5,
    stopPts: 80,
    eveningTargetPts: 0,
    morningTargetPts: 0,
    eveningEntryStart: '15:15',
    eveningEntryEnd: '22:00',
  });

  // Selective-like trap daytime (will still be hard-gated 15:15 in live worker)
  add('selective_trap_50_200_1600', {
    entryMode: 'trap-confirm',
    piercePts: 0,
    trapEntryStyle: 'both',
    stopPts: 50,
    eveningTargetPts: 200,
    morningTargetPts: 200,
    targetRMultiple: 0,
    profitLockArmRs: 0,
    profitLockLockRs: 0,
    profitLockGivebackRs: 0,
  });

  return out;
}

(async () => {
  const a = auth();
  log('crude treasure', LIVE_FROM, '→', TO);
  const instruments = await market.fetchInstruments(a);
  // Speed: only FUT + CRUDEOILM options for ATM resolve
  const crudeInstruments = instruments.filter((i) => {
    const s = String(i.tradingsymbol || i.tradingSymbol || '');
    const seg = String(i.segment || '');
    return /CRUDEOILM/i.test(s) || /MCX/i.test(seg);
  });
  log('instruments', instruments.length, 'crudeish', crudeInstruments.length);
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
  const crudeC = crudeCfull.filter((c) => {
    const d = String(c.date).slice(0, 10);
    return d >= warm && d <= TO;
  });
  log('candles index', niftyC.length, bankC.length, 'crude', crudeC.length);

  log('index…');
  const nTr = await bookIndex(a, instruments, niftyC, NIFTY_50_INSTRUMENT, 'nifty', optCache);
  const bTr = await bookIndex(a, instruments, bankC, BANK_NIFTY_INSTRUMENT, 'banknifty', optCache);
  const indexTrades = [...nTr, ...bTr];
  const indexLive = scoreLive('INDEX', indexTrades);
  log(`index ${indexLive.green}/${indexLive.days} red=${indexLive.red} avg=${indexLive.avg}`);

  const cands = candidates();
  log('candidates', cands.length);
  const results = [];
  const t0 = Date.now();

  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const crudeTrades = await bookCrudeLive(a, crudeInstruments, crudeC, c.tp, optCache);
    const crude = scoreLive(`C|${c.id}`, crudeTrades);
    const all3 = scoreLive(`A3|${c.id}`, [...indexTrades, ...crudeTrades]);
    results.push({ id: c.id, tp: c.tp, crude, all3, raw: crudeTrades.length });
    const star =
      crude.crudeRed === 0 && crude.crudeDays >= 3
        ? '★'
        : all3.red === 0 && all3.green >= 8
          ? '◆'
          : ' ';
    log(
      `${star} ${i + 1}/${cands.length} ${((Date.now() - t0) / 1000).toFixed(0)}s ${c.id} | cRed=${crude.crudeRed} c=${crude.crudeGreen}/${crude.crudeDays} cAvg=${crude.crudeAvg} | a3Red=${all3.red} a3=${all3.green}/${all3.days} a3Avg=${all3.avg} raw=${crudeTrades.length}`,
    );
  }

  results.sort(
    (a, b) =>
      a.crude.crudeRed - b.crude.crudeRed ||
      a.all3.red - b.all3.red ||
      b.crude.crudeDays - a.crude.crudeDays ||
      b.all3.avg - a.all3.avg,
  );

  const zeroCrude = results.filter((r) => r.crude.crudeRed === 0 && r.crude.crudeDays >= 3);
  const zeroAll3 = results.filter((r) => r.all3.red === 0 && r.all3.green >= 8);

  log('\n==== ZERO CRUDE RED ====');
  for (const r of zeroCrude.slice(0, 20)) {
    log(
      `c ${r.crude.crudeGreen}/${r.crude.crudeDays} avg=${r.crude.crudeAvg} net=${r.crude.crudeNet} | a3 ${r.all3.green}/${r.all3.days} red=${r.all3.red} avg=${r.all3.avg} | ${r.id}`,
    );
  }
  log('\n==== ZERO ALL3 RED ====');
  for (const r of zeroAll3.slice(0, 20)) {
    log(
      `a3 ${r.all3.green}/${r.all3.days} avg=${r.all3.avg} net=${r.all3.net} | c ${r.crude.crudeGreen}/${r.crude.crudeDays} avg=${r.crude.crudeAvg} | ${r.id}`,
    );
  }

  const best =
    zeroAll3.sort(
      (a, b) =>
        b.crude.crudeDays - a.crude.crudeDays ||
        b.all3.avg - a.all3.avg ||
        b.crude.crudeAvg - a.crude.crudeAvg,
    )[0] ||
    zeroCrude.sort((a, b) => b.all3.avg - a.all3.avg || b.crude.crudeDays - a.crude.crudeDays)[0] ||
    results[0];

  log('\nBEST', best.id);
  log(JSON.stringify({ crude: best.crude, all3: best.all3 }, null, 2));

  const out = {
    LIVE_FROM,
    TO,
    index: indexLive,
    best: { id: best.id, tp: best.tp, crude: best.crude, all3: best.all3 },
    zeroCrude: zeroCrude.slice(0, 25).map((r) => ({
      id: r.id,
      tp: r.tp,
      crude: {
        days: r.crude.crudeDays,
        green: r.crude.crudeGreen,
        red: r.crude.crudeRed,
        avg: r.crude.crudeAvg,
        net: r.crude.crudeNet,
        dayRows: r.crude.dayRows.filter((d) => d.crude),
      },
      all3: {
        days: r.all3.days,
        green: r.all3.green,
        red: r.all3.red,
        avg: r.all3.avg,
        net: r.all3.net,
      },
    })),
    zeroAll3: zeroAll3.slice(0, 25).map((r) => ({
      id: r.id,
      tp: r.tp,
      all3: {
        days: r.all3.days,
        green: r.all3.green,
        red: r.all3.red,
        avg: r.all3.avg,
        net: r.all3.net,
        dayRows: r.all3.dayRows,
      },
      crude: {
        days: r.crude.crudeDays,
        green: r.crude.crudeGreen,
        red: r.crude.crudeRed,
        avg: r.crude.crudeAvg,
        net: r.crude.crudeNet,
        dayRows: r.crude.dayRows.filter((d) => d.crude),
      },
    })),
    top: results.slice(0, 40).map((r) => ({
      id: r.id,
      cRed: r.crude.crudeRed,
      cDays: r.crude.crudeDays,
      cAvg: r.crude.crudeAvg,
      a3Red: r.all3.red,
      a3: `${r.all3.green}/${r.all3.days}`,
      a3Avg: r.all3.avg,
    })),
  };
  fs.writeFileSync('/tmp/crude-treasure.json', JSON.stringify(out, null, 2));
  log('wrote /tmp/crude-treasure.json');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
