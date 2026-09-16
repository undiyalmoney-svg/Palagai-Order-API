'use strict';
/**
 * DNA 15.6 profit hunt: Jun–Sep 15 complete + 16 Sep (partial session)
 * option ₹ = Trade Bot month UI (mapTrade BS weekly ATM).
 *
 *   node scripts/sr-profit-grid-15-6.js /tmp/sr-month-candles.json /opt/cursor/artifacts
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
const TO_FULL = '2026-09-15';
const TO_NOW = '2026-09-16';
const SEP16 = '2026-09-16';
const MONTHS = [
  { id: '2026-06', from: '2026-06-01', to: '2026-06-30' },
  { id: '2026-07', from: '2026-07-01', to: '2026-07-31' },
  { id: '2026-08', from: '2026-08-01', to: '2026-08-31' },
  { id: '2026-09', from: '2026-09-01', to: '2026-09-15' },
];

function pf(p, l) { return l > 0 ? Math.round((p / l) * 100) / 100 : (p > 0 ? 99 : 0); }
function hmToMin(hm) {
  const [h, m] = String(hm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
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
  if (p.giveOff) { merged.giveUpBar = 0; merged.giveUpMinPts = 0; }
  if (patch.sessionAlignNifty && key === 'nifty') merged.sessionAlign = true;
  if (patch.sessionAlignOff && key === 'nifty') merged.sessionAlign = false;
  if (patch.sessionAlignOff && key === 'banknifty') merged.sessionAlign = false;
  delete merged.cutRs;
  delete merged.structureOff;
  delete merged.giveOff;
  return merged;
}

function runBook(key, candles, from, to, patch) {
  const book = BOOKS[key];
  const perPoint = book.unitsPerLot;
  const merged = optsFor(key, patch);
  const maxTrades = patch.maxTradesPerDay != null ? patch.maxTradesPerDay : MAX_TRADES_PER_DAY;
  const { trades } = runSrBreakout(candles || [], {
    entryPts: book.entryPts, trendBars: 20, gapLo: book.gapLo, gapHi: book.gapHi,
    targetByScore: book.targetByScore, maxTradesPerDay: maxTrades,
    dayLossStop: DAY_LOSS_STOP_RS / perPoint, dayProfitTarget: 0, reportFromDate: from,
    ...book.session, ...merged,
    haltAfterStop: !!patch.haltAfterStop,
  });
  const mapped = [];
  for (const t of trades || []) {
    if (t.date < from || t.date > to) continue;
    const row = mapTrade(t, book, 1, perPoint, null);
    mapped.push({
      date: t.date,
      book: book.id,
      key,
      option: t.option,
      score: t.confidence,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      holdMin: hmToMin(t.exitTime) - hmToMin(t.entryTime),
      why: t.exitReason,
      pts: t.points,
      rs: Math.round(Number(row.netOptionPnlRs) || 0),
    });
  }
  return mapped;
}

function allTrades(candles, from, to, patch) {
  return runBook('nifty', candles.nifty, from, to, patch)
    .concat(runBook('banknifty', candles.banknifty, from, to, patch));
}

function buck(ts) {
  let p = 0, l = 0, n = 0;
  const byBook = { nifty: 0, bank: 0 };
  const reasons = {};
  let closeN = 0, closeRs = 0;
  for (const t of ts) {
    const o = Number(t.rs) || 0;
    n += o;
    if (o > 0) p += o;
    else if (o < 0) l += Math.abs(o);
    byBook[t.book] = (byBook[t.book] || 0) + o;
    reasons[t.why] = reasons[t.why] || { n: 0, rs: 0 };
    reasons[t.why].n += 1;
    reasons[t.why].rs += o;
    if (t.why === 'CLOSE') { closeN += 1; closeRs += o; }
  }
  return {
    n: ts.length,
    net: Math.round(n),
    profit: Math.round(p),
    loss: Math.round(l),
    pf: pf(p, l),
    nifty: Math.round(byBook.nifty || 0),
    bank: Math.round(byBook.bank || 0),
    reasons: Object.fromEntries(Object.entries(reasons).map(([k, v]) => [k, { n: v.n, rs: Math.round(v.rs) }])),
    closeN,
    closeRs: Math.round(closeRs),
    losers: ts.filter((t) => t.rs < 0).length,
  };
}

function score(candles, patch) {
  const months = {};
  let all = [];
  for (const m of MONTHS) {
    const tr = allTrades(candles, m.from, m.to, patch);
    months[m.id] = buck(tr);
    all = all.concat(tr);
  }
  const tot = buck(all);
  const sep16 = allTrades(candles, SEP16, SEP16, patch);
  return {
    jun: months['2026-06'].net,
    jul: months['2026-07'].net,
    aug: months['2026-08'].net,
    sep: months['2026-09'].net,
    ...tot,
    augClose: months['2026-08'].reasons.CLOSE || { n: 0, rs: 0 },
    sep16: {
      ...buck(sep16),
      trades: sep16,
      pe1150: sep16.find((t) => t.book === 'nifty' && t.option === 'PE' && t.entryTime === '11:50') || null,
      bankStop: sep16.find((t) => t.book === 'bank' && t.why === 'STOP') || null,
      niftyGive: sep16.find((t) => t.book === 'nifty' && t.why === 'GIVEUP') || null,
    },
  };
}

function buildVariants() {
  const both = (o) => ({ nifty: { ...o }, banknifty: { ...o } });
  const out = [
    { id: 'v15_6', patch: { banknifty: { timeStopBars: 6 } } },
    { id: 'v15_7', patch: {} },
  ];
  out.push({ id: 'max1', patch: { maxTradesPerDay: 1 } });
  out.push({ id: 'halt_stop', patch: { haltAfterStop: true } });
  out.push({ id: 'halt_stop_max1', patch: { haltAfterStop: true, maxTradesPerDay: 1 } });
  out.push({ id: 'score2', patch: both({ minScore: 2 }) });
  out.push({ id: 'score2_n', patch: { nifty: { minScore: 2 } } });
  out.push({ id: 'score2_b', patch: { banknifty: { minScore: 2 } } });
  out.push({ id: 'n_session_align', patch: { sessionAlignNifty: true } });
  out.push({ id: 'give_off', patch: both({ giveOff: true }) });
  out.push({ id: 'give_off_n', patch: { nifty: { giveOff: true } } });
  out.push({ id: 'give_off_b', patch: { banknifty: { giveOff: true } } });
  for (const t of [0, 8, 12]) {
    out.push({ id: `time_${t}`, patch: both({ timeStopBars: t }) });
    out.push({ id: `time_n${t}_b6`, patch: { nifty: { timeStopBars: t } } });
    out.push({ id: `time_n6_b${t}`, patch: { banknifty: { timeStopBars: t } } });
  }
  for (const cut of [1500, 2000, 3000, 3500]) {
    out.push({ id: `bank_cut_${cut}`, patch: { banknifty: { cutRs: cut } } });
    out.push({ id: `bank_cut_${cut}_halt`, patch: { haltAfterStop: true, banknifty: { cutRs: cut } } });
    out.push({ id: `bank_cut_${cut}_t8`, patch: { banknifty: { cutRs: cut, timeStopBars: 8 } } });
  }
  out.push({ id: 'box_off', patch: both({ structureOff: true }) });
  out.push({ id: 'box_off_n', patch: { nifty: { structureOff: true } } });
  out.push({ id: 'box_off_b', patch: { banknifty: { structureOff: true } } });
  out.push({ id: 'box_50_100', patch: { nifty: { minStructurePts: 50 }, banknifty: { minStructurePts: 100 } } });
  out.push({ id: 'box_30_60', patch: { nifty: { minStructurePts: 30 }, banknifty: { minStructurePts: 60 } } });
  // combos aimed at 16 Sep without sit-out-only
  out.push({ id: 'give_off_n_halt', patch: { haltAfterStop: true, nifty: { giveOff: true } } });
  out.push({ id: 'n_align_halt', patch: { sessionAlignNifty: true, haltAfterStop: true } });
  out.push({ id: 'n_align_score2n', patch: { sessionAlignNifty: true, nifty: { minScore: 2 } } });
  out.push({ id: 'give_off_n_bank2000', patch: { nifty: { giveOff: true }, banknifty: { cutRs: 2000 } } });
  out.push({ id: 'give_off_n_bank1500', patch: { nifty: { giveOff: true }, banknifty: { cutRs: 1500 } } });
  out.push({ id: 'max1_give_off_n', patch: { maxTradesPerDay: 1, nifty: { giveOff: true } } });
  out.push({ id: 'time8_give_off', patch: { nifty: { timeStopBars: 8, giveOff: true }, banknifty: { timeStopBars: 8 } } });
  out.push({ id: 'time8_halt', patch: { haltAfterStop: true, nifty: { timeStopBars: 8 }, banknifty: { timeStopBars: 8 } } });
  return out;
}

function shipable(row, base) {
  if (row.id === 'v15_6' || row.id === 'v15_7') return false;
  if (row.aug < 0) return false;
  if (row.augClose && row.augClose.n > 0) return false;
  if (row.net <= base.net) return false;
  // sit-out-only: fewer trades AND lower profit (missed winners)
  if (row.n < base.n * 0.75 && row.profit < base.profit) return false;
  return true;
}

function main() {
  const candles = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const paperEqLive = JSON.stringify(exitOptsFor('nifty')) === JSON.stringify(SPEC.nifty.opts)
    && JSON.stringify(exitOptsFor('banknifty')) === JSON.stringify(SPEC.banknifty.opts);
  const variants = buildVariants();
  const rows = [];
  for (const v of variants) {
    process.stderr.write(`variant ${v.id}\n`);
    const s = score(candles, v.patch);
    rows.push({ id: v.id, patch: v.patch, ...s });
  }
  const base = rows.find((r) => r.id === 'v15_6');
  const ranked = [...rows].sort((a, b) => (b.net - a.net) || (a.loss - b.loss) || (b.pf - a.pf));
  const legal = ranked.filter((r) => shipable(r, base));
  const best = legal[0] || null;

  fs.mkdirSync(OUTDIR, { recursive: true });
  const slim = rows.map((r) => ({
    id: r.id,
    jun: r.jun, jul: r.jul, aug: r.aug, sep: r.sep,
    net: r.net, dNet: r.net - base.net,
    pf: r.pf, loss: r.loss, dLoss: r.loss - base.loss,
    n: r.n, profit: r.profit, nifty: r.nifty, bank: r.bank,
    augClose: r.augClose,
    sep16net: r.sep16.net,
    sep16n: r.sep16.n,
    pe1150: r.sep16.pe1150,
    bankStop: r.sep16.bankStop,
    niftyGive: r.sep16.niftyGive,
    sep16trades: r.sep16.trades,
    reasons: r.reasons,
  }));
  const jsonPath = path.join(OUTDIR, 'sr_profit_grid_15_6.json');
  fs.writeFileSync(jsonPath, JSON.stringify({
    strategyVersion: STRATEGY_VERSION,
    window: { from: FROM, to: TO_FULL, extraDay: TO_NOW },
    rupeeMode: 'bs_atm_weekly_like_month_ui',
    paperEqualsLive: paperEqLive,
    baseline: slim.find((r) => r.id === 'v15_6'),
    best: best && slim.find((r) => r.id === best.id),
    shipable: legal.map((r) => r.id),
    ranked: slim.sort((a, b) => (b.net - a.net) || (a.loss - b.loss)),
  }, null, 2));

  function mdRow(r) {
    return `| ${r.id} | ${r.jun} | ${r.jul} | ${r.aug} | ${r.sep} | ${r.net} | ${r.net - base.net} | ${r.pf} | ${r.loss} | ${r.n} | ${r.sep16net} | ${r.pe1150 ? r.pe1150.rs : '—'} | ${r.bankStop ? r.bankStop.rs : '—'} | ${r.niftyGive ? r.niftyGive.rs : '—'} |`;
  }
  const md = [
    '# S/R 15.6 profit grid — Jun 1–Sep 15 2026 + 16 Sep (bars to 13:25 IST)',
    '',
    `DNA \`${STRATEGY_VERSION}\`. Option ₹ = Trade Bot month UI (BS weekly ATM). Paper===Live: ${paperEqLive}.`,
    '',
    `Baseline 15.6 complete window: net ₹${base.net}, PF ${base.pf}, loss ₹${base.loss}, n=${base.n}. Jun ₹${base.jun} Jul ₹${base.jul} Aug ₹${base.aug} Sep1–15 ₹${base.sep}. Aug CLOSE n=${base.augClose.n} ₹${base.augClose.rs}.`,
    '',
    '16 Sep live was Bank CE STOP and Nifty PE GIVEUP. Paper 15.6 also prints a later Nifty 11:50 PE TIME that is a **loser** on this ₹, and a Bank 12:35 CE TIME winner.',
    '',
    '| id | Jun | Jul | Aug | Sep1–15 | net | Δnet | PF | loss | n | 16Sep net | 11:50 PE | Bank STOP | Nifty GIVEUP |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...slim.sort((a, b) => (b.net - a.net) || (a.loss - b.loss)).map(mdRow),
    '',
    best
      ? `Best shipable vs 15.6: **${best.id}** net ₹${best.net} (Δ₹${best.net - base.net}) Aug ₹${best.aug} loss ₹${best.loss}.`
      : 'No variant beats 15.6 Jun–Sep15 net without a red August, CLOSE bleed, or sit-out that misses winners. Do not bump DNA.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUTDIR, 'sr_profit_grid_15_6.md'), md);
  console.log(JSON.stringify({
    jsonPath,
    paperEqualsLive: paperEqLive,
    baselineNet: base.net,
    best: best && { id: best.id, net: best.net, dNet: best.net - base.net, aug: best.aug, sep16: best.sep16.net },
    shipable: legal.map((r) => r.id),
    top5: ranked.slice(0, 5).map((r) => ({ id: r.id, net: r.net, dNet: r.net - base.net, aug: r.aug, sep16: r.sep16.net })),
  }, null, 2));
}

main();
