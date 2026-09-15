'use strict';
/**
 * Day-by-day loser autopsy for DNA 15.5 on the Trade Bot month-UI option ₹
 * (mapTrade BS weekly, same as >14d month view). Replays Jun 1 → Sep 15 2026.
 *
 *   node scripts/sr-loser-autopsy.js /tmp/sr-month-candles.json /opt/cursor/artifacts
 */
const fs = require('fs');
const path = require('path');
const { runSrBreakout } = require('../live/sr-breakout');
const { mapTrade, BOOKS } = require('../live/sr-desk');
const {
  exitOptsFor, LOT_UNITS, DAY_LOSS_STOP_RS, MAX_TRADES_PER_DAY, STRATEGY_VERSION,
} = require('../live/sr-strategy-config');
const { SPEC } = require('../live/sr-live');

const CACHE = process.argv[2] || '/tmp/sr-month-candles.json';
const OUTDIR = process.argv[3] || '/opt/cursor/artifacts';
const FROM = '2026-06-01';
const TO = '2026-09-15';
const WARM = '2026-05-18';
const BASELINE_NET = 98568;
const MONTHS = [
  { id: '2026-06', from: '2026-06-01', to: '2026-06-30' },
  { id: '2026-07', from: '2026-07-01', to: '2026-07-31' },
  { id: '2026-08', from: '2026-08-01', to: '2026-08-31' },
  { id: '2026-09', from: '2026-09-01', to: '2026-09-15' },
];
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pf(p, l) { return l > 0 ? Math.round((p / l) * 100) / 100 : (p > 0 ? 99 : 0); }
function hmToMin(hm) {
  const [h, m] = String(hm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function ymd(d) { return String(d || '').slice(0, 10); }
function hhmm(d) { return String(d).slice(11, 16); }
function weekday(iso) {
  const dt = new Date(`${iso}T12:00:00+05:30`);
  return dt.getDay();
}
function isExpiryTue(iso) { return weekday(iso) === 2; }

function dayStats(candles) {
  const by = new Map();
  for (const c of candles || []) {
    const day = ymd(c.date);
    if (!day) continue;
    let s = by.get(day);
    if (!s) {
      s = { open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), firstHm: hhmm(c.date), lastHm: hhmm(c.date) };
      by.set(day, s);
    } else {
      s.high = Math.max(s.high, Number(c.high));
      s.low = Math.min(s.low, Number(c.low));
      s.close = Number(c.close);
      s.lastHm = hhmm(c.date);
    }
  }
  return by;
}

function excursion(candles, t) {
  const day = t.date;
  const dir = t.option === 'PE' ? -1 : 1;
  const entry = Number(t.entryPrice);
  const inM = hmToMin(t.entryTime);
  const outM = hmToMin(t.exitTime);
  let mae = 0;
  let mfe = 0;
  let bars = 0;
  for (const c of candles || []) {
    if (ymd(c.date) !== day) continue;
    const hm = hhmm(c.date);
    const m = hmToMin(hm);
    if (m < inM || m > outM) continue;
    bars += 1;
    const fav = dir * ((dir > 0 ? Number(c.high) : Number(c.low)) - entry);
    const adv = dir * ((dir > 0 ? Number(c.low) : Number(c.high)) - entry);
    if (fav > mfe) mfe = fav;
    if (adv < mae) mae = adv;
  }
  return { maePts: Math.round(mae * 100) / 100, mfePts: Math.round(mfe * 100) / 100, holdBars: bars };
}

function optsFor(key, patch) {
  const p = patch[key] || {};
  const base = exitOptsFor(key, 1);
  const merged = { ...base, ...p };
  const units = LOT_UNITS[key] || 0;
  if (p.cutRs != null) {
    if (p.cutRs > 0 && units > 0) merged.stopPts = p.cutRs / units;
    else delete merged.stopPts;
  }
  if (p.structureOff) { merged.structureExit = false; merged.minStructurePts = 0; }
  delete merged.cutRs;
  delete merged.structureOff;
  return merged;
}

function runBook(key, candles, from, to, patch) {
  const book = BOOKS[key];
  const perPoint = book.unitsPerLot;
  const merged = optsFor(key, patch);
  const maxTrades = patch.maxTradesPerDay != null ? patch.maxTradesPerDay : MAX_TRADES_PER_DAY;
  const entryEndHm = patch.entryEndHm || book.session.entryEndHm;
  const { trades } = runSrBreakout(candles || [], {
    entryPts: book.entryPts, trendBars: 20, gapLo: book.gapLo, gapHi: book.gapHi,
    targetByScore: book.targetByScore, maxTradesPerDay: maxTrades,
    dayLossStop: DAY_LOSS_STOP_RS / perPoint, dayProfitTarget: 0, reportFromDate: from,
    ...book.session, ...merged, entryEndHm,
    skipWeekdays: patch.skipWeekdays || merged.skipWeekdays,
    sessionAlign: !!(patch.sessionAlign && (!patch.sessionAlignBooks || patch.sessionAlignBooks.includes(key))),
  });
  const stats = dayStats(candles);
  const mapped = [];
  const seq = new Map();
  for (const t of trades || []) {
    if (t.date < from || t.date > to) continue;
    const row = mapTrade(t, book, 1, perPoint, null);
    const k = `${t.date}|${book.id}`;
    const n = (seq.get(k) || 0) + 1;
    seq.set(k, n);
    const ds = stats.get(t.date) || {};
    const dayPts = (Number(ds.close) || 0) - (Number(ds.open) || 0);
    const dayDown = dayPts < 0;
    const dayUp = dayPts > 0;
    const vsOpen = Number(t.entryPrice) - Number(ds.open || t.entryPrice);
    const exc = excursion(candles, t);
    const wd = weekday(t.date);
    const net = Number(row.netOptionPnlRs) || 0;
    mapped.push({
      date: t.date,
      book: book.id,
      key,
      side: t.side,
      option: t.option,
      entryClock: row.entryClock || t.entryTime,
      exitClock: row.exitClock || t.exitTime,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      why: t.exitReason,
      optionIn: row.optionEntryPremium,
      optionOut: row.optionExitPremium,
      optionRs: Math.round(net),
      indexPts: t.points,
      score: t.confidence,
      structureBox: t.structure ? t.structure.height : null,
      wall: t.structure ? t.structure.wall : t.level,
      measuredMove: t.structure ? t.structure.measuredMove : null,
      giveUp: t.exitReason === 'GIVEUP',
      time: t.exitReason === 'TIME',
      stop: t.exitReason === 'STOP',
      structure: t.exitReason === 'STRUCTURE',
      close: t.exitReason === 'CLOSE',
      daySeq: n,
      weekday: WEEK[wd],
      weekdayN: wd,
      expiryTue: isExpiryTue(t.date),
      after13: hmToMin(t.entryTime) >= 13 * 60,
      dayOpen: ds.open || null,
      dayClose: ds.close || null,
      dayPts: Math.round(dayPts * 100) / 100,
      dayDown,
      ceOnDownDay: t.option === 'CE' && dayDown,
      peOnUpDay: t.option === 'PE' && dayUp,
      wrongVsClose: (t.option === 'CE' && dayDown) || (t.option === 'PE' && dayUp),
      belowOpen: vsOpen < 0,
      wrongVsOpen: (t.option === 'CE' && vsOpen < 0) || (t.option === 'PE' && vsOpen > 0),
      maePts: exc.maePts,
      mfePts: exc.mfePts,
      holdBars: exc.holdBars,
      greenMaeThenStop: t.exitReason === 'STOP' && exc.mfePts > 0 && net < 0,
      tinyBox: t.structure && ((book.id === 'nifty' && t.structure.height < 40)
        || (book.id === 'bank' && t.structure.height < 80)),
    });
  }
  return mapped;
}

function allTrades(candles, patch) {
  let tr = [];
  for (const key of ['nifty', 'banknifty']) {
    tr = tr.concat(runBook(key, candles[key], FROM, TO, patch));
  }
  tr.sort((a, b) => a.date.localeCompare(b.date)
    || a.entryTime.localeCompare(b.entryTime)
    || a.book.localeCompare(b.book));
  return tr;
}

function scoreTrades(ts) {
  let p = 0, l = 0, n = 0;
  const byBook = { nifty: 0, bank: 0 };
  const byMonth = { '2026-06': 0, '2026-07': 0, '2026-08': 0, '2026-09': 0 };
  const reasons = {};
  let losers = 0;
  let closeN = 0;
  for (const t of ts) {
    const o = Number(t.optionRs) || 0;
    n += o;
    if (o > 0) p += o;
    else if (o < 0) { l += Math.abs(o); losers += 1; }
    byBook[t.book] = (byBook[t.book] || 0) + o;
    const mo = t.date.slice(0, 7);
    if (byMonth[mo] != null) byMonth[mo] += o;
    reasons[t.why] = reasons[t.why] || { n: 0, rs: 0, lossN: 0, lossRs: 0 };
    reasons[t.why].n += 1;
    reasons[t.why].rs += o;
    if (o < 0) { reasons[t.why].lossN += 1; reasons[t.why].lossRs += o; }
    if (t.why === 'CLOSE') closeN += 1;
  }
  return {
    net: Math.round(n),
    profit: Math.round(p),
    loss: Math.round(l),
    pf: pf(p, l),
    n: ts.length,
    losers,
    nifty: Math.round(byBook.nifty || 0),
    bank: Math.round(byBook.bank || 0),
    jun: Math.round(byMonth['2026-06']),
    jul: Math.round(byMonth['2026-07']),
    aug: Math.round(byMonth['2026-08']),
    sep: Math.round(byMonth['2026-09']),
    closeN,
    reasons: Object.fromEntries(Object.entries(reasons).map(([k, v]) => [k, {
      n: v.n, rs: Math.round(v.rs), lossN: v.lossN, lossRs: Math.round(v.lossRs),
    }])),
  };
}

function cluster(losers, all) {
  function part(name, pred) {
    const hit = losers.filter(pred);
    const miss = losers.filter((t) => !pred(t));
    const allHit = all.filter(pred);
    const hitRs = hit.reduce((s, t) => s + t.optionRs, 0);
    const allHitRs = allHit.reduce((s, t) => s + t.optionRs, 0);
    const allHitWin = allHit.filter((t) => t.optionRs > 0).reduce((s, t) => s + t.optionRs, 0);
    return {
      name,
      loserN: hit.length,
      loserRs: Math.round(hitRs),
      loserShare: losers.length ? Math.round(100 * hit.length / losers.length) : 0,
      allN: allHit.length,
      allRs: Math.round(allHitRs),
      winRsInBucket: Math.round(allHitWin),
      restLoserN: miss.length,
      restLoserRs: Math.round(miss.reduce((s, t) => s + t.optionRs, 0)),
    };
  }
  return [
    part('2nd trade of the book-day', (t) => t.daySeq === 2),
    part('Bank CE on down day (look-ahead close)', (t) => t.book === 'bank' && t.ceOnDownDay),
    part('Bank PE on up day (look-ahead close)', (t) => t.book === 'bank' && t.peOnUpDay),
    part('Bank wrong option vs day close', (t) => t.book === 'bank' && t.wrongVsClose),
    part('Nifty wrong option vs day close', (t) => t.book === 'nifty' && t.wrongVsClose),
    part('Bank CE/PE vs day-open at entry (causal)', (t) => t.book === 'bank' && t.wrongVsOpen),
    part('Nifty CE/PE vs day-open at entry (causal)', (t) => t.book === 'nifty' && t.wrongVsOpen),
    part('GIVEUP exit', (t) => t.why === 'GIVEUP'),
    part('TIME exit', (t) => t.why === 'TIME'),
    part('STOP exit', (t) => t.why === 'STOP'),
    part('STRUCTURE exit', (t) => t.why === 'STRUCTURE'),
    part('CLOSE leftover', (t) => t.why === 'CLOSE'),
    part('STOP after green MFE', (t) => t.greenMaeThenStop),
    part('STOP with MFE ≥ +12 index pts', (t) => t.why === 'STOP' && t.mfePts >= 12),
    part('Monday', (t) => t.weekday === 'Mon'),
    part('Tuesday expiry', (t) => t.expiryTue),
    part('score 1 only', (t) => t.score === 1),
    part('score ≥ 2', (t) => t.score >= 2),
    part('entry after 13:00', (t) => t.after13),
    part('tiny structure box', (t) => !!t.tinyBox),
    part('Bank book', (t) => t.book === 'bank'),
    part('Nifty book', (t) => t.book === 'nifty'),
    part('CE', (t) => t.option === 'CE'),
    part('PE', (t) => t.option === 'PE'),
  ];
}

function dayTable(trades) {
  const by = new Map();
  for (const t of trades) {
    let d = by.get(t.date);
    if (!d) {
      d = { date: t.date, weekday: t.weekday, expiryTue: t.expiryTue, net: 0, loss: 0, profit: 0, n: 0, losers: 0, books: {}, reasons: {}, trades: [] };
      by.set(t.date, d);
    }
    d.net += t.optionRs;
    d.n += 1;
    if (t.optionRs < 0) { d.loss += t.optionRs; d.losers += 1; }
    else d.profit += t.optionRs;
    d.books[t.book] = (d.books[t.book] || 0) + t.optionRs;
    d.reasons[t.why] = (d.reasons[t.why] || 0) + 1;
    d.trades.push({
      book: t.book, option: t.option, in: t.entryTime, out: t.exitTime, why: t.why,
      rs: t.optionRs, pts: t.indexPts, score: t.score, seq: t.daySeq, box: t.structureBox,
    });
  }
  return [...by.values()].map((d) => ({
    ...d,
    net: Math.round(d.net),
    loss: Math.round(d.loss),
    profit: Math.round(d.profit),
    nifty: Math.round(d.books.nifty || 0),
    bank: Math.round(d.books.bank || 0),
  })).sort((a, b) => a.net - b.net);
}

function variants() {
  const both = (o) => ({ nifty: { ...o }, banknifty: { ...o } });
  return [
    { id: 'baseline_15_5', patch: {} },
    { id: 'max1', patch: { maxTradesPerDay: 1 } },
    { id: 'score2', patch: { nifty: { minScore: 2 }, banknifty: { minScore: 2 } } },
    { id: 'entry_before_13', patch: { entryEndHm: '12:55' } },
    { id: 'give_3_12', patch: both({ giveUpBar: 3, giveUpMinPts: 12 }) },
    { id: 'give_2_8', patch: both({ giveUpBar: 2, giveUpMinPts: 8 }) },
    { id: 'give_4_8', patch: both({ giveUpBar: 4, giveUpMinPts: 8 }) },
    { id: 'give_4_16', patch: both({ giveUpBar: 4, giveUpMinPts: 16 }) },
    { id: 'give_5_12', patch: both({ giveUpBar: 5, giveUpMinPts: 12 }) },
    { id: 'give_off', patch: both({ giveUpBar: 0, giveUpMinPts: 0 }) },
    { id: 'time_4', patch: both({ timeStopBars: 4 }) },
    { id: 'time_5', patch: both({ timeStopBars: 5 }) },
    { id: 'time_8', patch: both({ timeStopBars: 8 }) },
    { id: 'nlock_8_5', patch: { nifty: { lockArmPts: 8, lockAtPts: 5 } } },
    { id: 'nlock_20_10', patch: { nifty: { lockArmPts: 20, lockAtPts: 10 } } },
    { id: 'block_20_10', patch: { banknifty: { lockArmPts: 20, lockAtPts: 10 } } },
    { id: 'block_50_25', patch: { banknifty: { lockArmPts: 50, lockAtPts: 25 } } },
    { id: 'both_lock_mfe', patch: { nifty: { lockArmPts: 12, lockAtPts: 4 }, banknifty: { lockArmPts: 30, lockAtPts: 10 } } },
    { id: 'box_50_100', patch: { nifty: { minStructurePts: 50 }, banknifty: { minStructurePts: 100 } } },
    { id: 'box_30_60', patch: { nifty: { minStructurePts: 30 }, banknifty: { minStructurePts: 60 } } },
    { id: 'box_off', patch: { nifty: { structureOff: true }, banknifty: { structureOff: true } } },
    { id: 'bank_cut_1500', patch: { banknifty: { cutRs: 1500 } } },
    { id: 'bank_cut_2000', patch: { banknifty: { cutRs: 2000 } } },
    { id: 'nifty_cut_3500', patch: { nifty: { cutRs: 3500 } } },
    { id: 'failStop_on', patch: both({ failStop: true }) },
    { id: 'session_align_both', patch: { sessionAlign: true } },
    { id: 'session_align_bank', patch: { sessionAlign: true, sessionAlignBooks: ['banknifty'] } },
    { id: 'skip_monday', patch: { skipWeekdays: [1] } },
    { id: 'skip_expiry_tue', patch: { skipWeekdays: [2] } },
    { id: 'max2_give_3_8', patch: both({ giveUpBar: 3, giveUpMinPts: 8 }) },
    { id: 'max1_give_4_12', patch: { maxTradesPerDay: 1 } },
    { id: 'bank_give_off', patch: { banknifty: { giveUpBar: 0, giveUpMinPts: 0 } } },
    { id: 'nifty_give_off', patch: { nifty: { giveUpBar: 0, giveUpMinPts: 0 } } },
  ];
}

function mdWorst(days) {
  const rows = ['| date | wd | net ₹ | loss ₹ | n | losers | nifty | bank | why |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|'];
  for (const d of days.slice(0, 15)) {
    const why = Object.entries(d.reasons).map(([k, v]) => `${k}×${v}`).join(', ');
    rows.push(`| ${d.date} | ${d.weekday}${d.expiryTue ? ' exp' : ''} | ${d.net} | ${d.loss} | ${d.n} | ${d.losers} | ${d.nifty} | ${d.bank} | ${why} |`);
  }
  return rows.join('\n');
}

function main() {
  const candles = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  if (!candles.nifty || !candles.banknifty) throw new Error('bad cache');
  const paperEqLive = JSON.stringify(exitOptsFor('nifty')) === JSON.stringify(SPEC.nifty.opts)
    && JSON.stringify(exitOptsFor('banknifty')) === JSON.stringify(SPEC.banknifty.opts);

  const baselineTrades = allTrades(candles, {});
  const baseScore = scoreTrades(baselineTrades);
  const losers = baselineTrades.filter((t) => t.optionRs < 0)
    .sort((a, b) => a.optionRs - b.optionRs);
  const days = dayTable(baselineTrades);
  const clusters = cluster(losers, baselineTrades);

  const tried = [];
  for (const v of variants()) {
    process.stderr.write(`variant ${v.id}\n`);
    const ts = allTrades(candles, v.patch);
    const s = scoreTrades(ts);
    tried.push({
      id: v.id,
      patch: v.patch,
      ...s,
      dNet: s.net - baseScore.net,
      dLoss: s.loss - baseScore.loss,
      dAug: s.aug - baseScore.aug,
      dLosers: s.losers - baseScore.losers,
      dPf: Math.round((s.pf - baseScore.pf) * 100) / 100,
      beatsNet: s.net > baseScore.net,
      augOk: s.aug >= 0,
      cutsLossMoreThanWin: (baseScore.loss - s.loss) > (baseScore.profit - s.profit)
        && s.net >= baseScore.net,
    });
  }
  tried.sort((a, b) => (b.net - a.net) || (a.loss - b.loss));

  const shipable = tried.filter((t) => t.id !== 'baseline_15_5'
    && t.net > baseScore.net
    && t.aug >= 0
    && t.loss <= baseScore.loss);
  const best = shipable[0] || null;

  fs.mkdirSync(OUTDIR, { recursive: true });
  const payload = {
    strategyVersion: STRATEGY_VERSION,
    window: { from: FROM, to: TO, warm: WARM },
    rupeeMode: 'bs_atm_weekly_like_month_ui',
    paperEqualsLive: paperEqLive,
    baselineExpectedNet: BASELINE_NET,
    baseline: baseScore,
    baselineMatch: baseScore.net === BASELINE_NET,
    loserCount: losers.length,
    clusters,
    worstDays: days.slice(0, 15),
    redDays: days.filter((d) => d.net < 0).length,
    greenDays: days.filter((d) => d.net > 0).length,
    tried,
    shipable: shipable.map((t) => t.id),
    best,
    losers,
    allTrades: baselineTrades,
  };
  const jsonPath = path.join(OUTDIR, 'sr_loser_autopsy_15_5.json');
  const slim = { ...payload, allTrades: undefined };
  slim.losers = losers;
  fs.writeFileSync(jsonPath, JSON.stringify(slim, null, 2));
  fs.writeFileSync(path.join(OUTDIR, 'sr_loser_trades_15_5.json'), JSON.stringify(losers, null, 2));
  fs.writeFileSync(path.join(OUTDIR, 'sr_all_trades_15_5.json'), JSON.stringify(baselineTrades, null, 2));

  const md = [
    '# S/R 15.5 loser autopsy — Jun 1 to Sep 15 2026',
    '',
    `DNA \`${STRATEGY_VERSION}\`. Option ₹ = Trade Bot month UI (BS weekly ATM). Paper===Live: ${paperEqLive}.`,
    '',
    `Baseline: net ₹${baseScore.net} (expect ₹${BASELINE_NET}), PF ${baseScore.pf}, losers ${baseScore.losers}/${baseScore.n}, loss ₹${baseScore.loss}. Jun ₹${baseScore.jun} Jul ₹${baseScore.jul} Aug ₹${baseScore.aug} Sep ₹${baseScore.sep}. CLOSE leftover n=${baseScore.closeN}.`,
    '',
    '## Worst 15 days',
    '',
    mdWorst(days),
    '',
    '## Why losers arrive',
    '',
    '| cluster | loser n | loser ₹ | share | all n in bucket | bucket net ₹ | wins in bucket ₹ |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...clusters.map((c) => `| ${c.name} | ${c.loserN} | ${c.loserRs} | ${c.loserShare}% | ${c.allN} | ${c.allRs} | ${c.winRsInBucket} |`),
    '',
    '## Filters tried (engine re-run, same window)',
    '',
    '| id | net | Δnet | Aug | loss | losers | PF | vs 15.5 |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
    ...tried.map((t) => `| ${t.id} | ${t.net} | ${t.dNet} | ${t.aug} | ${t.loss} | ${t.losers} | ${t.pf} | ${t.beatsNet && t.augOk ? 'better net' : (t.net > baseScore.net ? 'net up, check Aug' : 'rejected')} |`),
    '',
    best
      ? `Best shipable: **${best.id}** net ₹${best.net} (Δ₹${best.dNet}) Aug ₹${best.aug} loss ₹${best.loss}.`
      : 'No filter beats 15.5 net without wrecking August or raising losses. Do not bump DNA.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUTDIR, 'sr_loser_autopsy_15_5.md'), md);
  console.log(JSON.stringify({
    jsonPath,
    paperEqualsLive: paperEqLive,
    baseline: baseScore,
    baselineMatch: baseScore.net === BASELINE_NET,
    loserCount: losers.length,
    best: best && { id: best.id, net: best.net, dNet: best.dNet, aug: best.aug, loss: best.loss },
    topTried: tried.slice(0, 8).map((t) => ({ id: t.id, net: t.net, dNet: t.dNet, aug: t.aug, loss: t.loss, pf: t.pf })),
  }, null, 2));
}

main();
