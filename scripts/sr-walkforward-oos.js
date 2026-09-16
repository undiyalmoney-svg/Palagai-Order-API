'use strict';
/**
 * Walk-forward OOS hunt for Trade Bot DNA.
 *
 * Freeze knobs on TRAIN months only, then score later months never used
 * to pick. Option ₹ = Trade Bot month UI (mapTrade BS weekly ATM).
 * NSE overlay is only valid ≤14d — this window is years, so BS throughout.
 *
 *   node scripts/sr-walkforward-oos.js /tmp/sr-wf-candles-full.json /opt/cursor/artifacts
 */
const fs = require('fs');
const path = require('path');
const { runSrBreakout } = require('../live/sr-breakout');
const { mapTrade, BOOKS } = require('../live/sr-desk');
const {
  exitOptsFor, LOT_UNITS, DAY_LOSS_STOP_RS, MAX_TRADES_PER_DAY, STRATEGY_VERSION,
} = require('../live/sr-strategy-config');
const { SPEC } = require('../live/sr-live');

const CACHE = process.argv[2] || '/tmp/sr-wf-candles-full.json';
const OUTDIR = process.argv[3] || '/opt/cursor/artifacts';
const TICK = 0.05;
const TRAIN_TO = '2025-12-31';
const OOS_FROM = '2026-01-01';
const OOS_TO = '2026-09-16';
const ALT_TRAIN_TO = '2024-12-31';
const ALT_OOS_FROM = '2025-01-01';
const SEP16 = '2026-09-16';

// Actual 16 Sep Kite PALAGAI fills (gross index-option, before extra tax).
const LIVE_SEP16 = {
  bank: { option: 'CE', in: '10:50', why: 'STOP', qty: 30, entry: 776.75, exit: 735, gross: Math.round((735 - 776.75) * 30) },
  nifty: { option: 'PE', in: '11:20', why: 'GIVEUP', qty: 65, entry: 144.15, exit: 138.75, gross: Math.round((138.75 - 144.15) * 65) },
};

function pf(p, l) { return l > 0 ? Math.round((p / l) * 100) / 100 : (p > 0 ? 99 : 0); }
function ymd(s) { return String(s || '').slice(0, 10); }
function monthId(iso) { return String(iso).slice(0, 7); }
function hmToMin(hm) {
  const [h, m] = String(hm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function monthList(from, to) {
  const out = [];
  let [y, mo] = from.slice(0, 7).split('-').map(Number);
  const [ey, emo] = to.slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && mo <= emo)) {
    const id = `${y}-${String(mo).padStart(2, '0')}`;
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    out.push({ id, from: `${id}-01`, to: `${id}-${String(last).padStart(2, '0')}` });
    mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
  }
  return out;
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
  if (patch.sessionAlignOffNifty && key === 'nifty') merged.sessionAlign = false;
  if (patch.sessionAlignOffBank && key === 'banknifty') merged.sessionAlign = false;
  if (patch.sessionAlignBank && key === 'banknifty') merged.sessionAlign = true;
  delete merged.cutRs;
  delete merged.structureOff;
  delete merged.giveOff;
  return merged;
}

function runBook(key, candles, patch) {
  const book = BOOKS[key];
  const perPoint = book.unitsPerLot;
  const merged = optsFor(key, patch);
  const maxTrades = patch.maxTradesPerDay != null ? patch.maxTradesPerDay : MAX_TRADES_PER_DAY;
  const { trades } = runSrBreakout(candles || [], {
    entryPts: book.entryPts, trendBars: 20, gapLo: book.gapLo, gapHi: book.gapHi,
    targetByScore: book.targetByScore, maxTradesPerDay: maxTrades,
    dayLossStop: DAY_LOSS_STOP_RS / perPoint, dayProfitTarget: 0,
    reportFromDate: '2021-01-01',
    ...book.session, ...merged,
    haltAfterStop: !!patch.haltAfterStop,
  });
  const mapped = [];
  for (const t of trades || []) {
    const row = mapTrade(t, book, 1, perPoint, null);
    mapped.push({
      date: t.date,
      month: monthId(t.date),
      book: book.id,
      key,
      option: t.option,
      score: t.confidence,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      why: t.exitReason,
      pts: t.points,
      rs: Math.round(Number(row.netOptionPnlRs) || 0),
      units: perPoint,
    });
  }
  return mapped;
}

function allTrades(candles, patch) {
  return runBook('nifty', candles.nifty, patch)
    .concat(runBook('banknifty', candles.banknifty, patch));
}

function tickHaircutRs(t, ticks) {
  return Math.round(2 * ticks * TICK * t.units);
}

function buck(ts, haircutTicks) {
  let p = 0, l = 0, n = 0;
  const byBook = { nifty: 0, bank: 0 };
  const reasons = {};
  let closeN = 0, closeRs = 0;
  const byDay = new Map();
  for (const t of ts) {
    let o = Number(t.rs) || 0;
    if (haircutTicks) o -= tickHaircutRs(t, haircutTicks);
    n += o;
    if (o > 0) p += o;
    else if (o < 0) l += Math.abs(o);
    byBook[t.book] = (byBook[t.book] || 0) + o;
    reasons[t.why] = reasons[t.why] || { n: 0, rs: 0 };
    reasons[t.why].n += 1;
    reasons[t.why].rs += o;
    if (t.why === 'CLOSE') { closeN += 1; closeRs += o; }
    byDay.set(t.date, (byDay.get(t.date) || 0) + o);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let eq = 0, peak = 0, maxDd = 0, worstDay = 0, worstDayIso = null;
  for (const [iso, v] of days) {
    eq += v;
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDd) maxDd = dd;
    if (v < worstDay) { worstDay = v; worstDayIso = iso; }
  }
  return {
    n: ts.length,
    net: Math.round(n),
    profit: Math.round(p),
    loss: Math.round(l),
    pf: pf(p, l),
    nifty: Math.round(byBook.nifty || 0),
    bank: Math.round(byBook.bank || 0),
    closeN,
    closeRs: Math.round(closeRs),
    maxDd: Math.round(maxDd),
    worstDay: Math.round(worstDay),
    worstDayIso,
    losers: ts.filter((t) => (haircutTicks ? t.rs - tickHaircutRs(t, haircutTicks) : t.rs) < 0).length,
  };
}

function monthStats(trades, months, from, to, haircutTicks) {
  const inWin = trades.filter((t) => t.date >= from && t.date <= to);
  const byM = {};
  for (const m of months) {
    const ts = inWin.filter((t) => t.date >= m.from && t.date <= m.to);
    byM[m.id] = buck(ts, haircutTicks);
  }
  const nets = months.map((m) => byM[m.id].net);
  const green = nets.filter((x) => x > 0).length;
  const redMonths = months.filter((m) => byM[m.id].net < 0).map((m) => ({ id: m.id, net: byM[m.id].net }));
  const bleed = months.filter((m) => byM[m.id].closeN >= 8 && byM[m.id].closeRs <= -5000).map((m) => m.id);
  const tot = buck(inWin, haircutTicks);
  const worstMonth = months.slice().sort((a, b) => byM[a.id].net - byM[b.id].net)[0];
  return {
    ...tot,
    monthNets: Object.fromEntries(months.map((m) => [m.id, byM[m.id].net])),
    monthClose: Object.fromEntries(months.map((m) => [m.id, { n: byM[m.id].closeN, rs: byM[m.id].closeRs }])),
    greenMonths: green,
    monthCount: months.length,
    monthWinRate: months.length ? Math.round((green / months.length) * 1000) / 10 : 0,
    redMonths,
    closeBleedMonths: bleed,
    worstMonth: worstMonth ? { id: worstMonth.id, net: byM[worstMonth.id].net } : null,
  };
}

function sep16View(trades) {
  const ts = trades.filter((t) => t.date === SEP16);
  return { ...buck(ts), trades: ts.map((t) => ({ book: t.book, option: t.option, in: t.entryTime, out: t.exitTime, why: t.why, rs: t.rs })) };
}

function liveAdjSep16(paperDay) {
  const liveGross = LIVE_SEP16.bank.gross + LIVE_SEP16.nifty.gross; // -1603
  const paperMatched = (paperDay.trades || []).filter((t) =>
    (t.book === 'bank' && t.option === 'CE' && t.in === '10:50')
    || (t.book === 'nifty' && t.option === 'PE' && t.in === '11:20'));
  const paperMatchedNet = paperMatched.reduce((s, t) => s + t.rs, 0);
  const unmatched = (paperDay.trades || []).filter((t) => !paperMatched.includes(t));
  const unmatchedNet = unmatched.reduce((s, t) => s + t.rs, 0);
  // Live actually filled the two matched legs. Unmatched paper legs are
  // what Live would take now that per-book cap matches Paper (35efe30).
  return {
    liveFilledGross: liveGross,
    paperMatchedNet: Math.round(paperMatchedNet),
    paperUnmatchedNet: Math.round(unmatchedNet),
    asLivedThatMorning: liveGross + 0, // only the two fills; 12:35 was blocked
    asPaperEqLiveNow: liveGross + unmatchedNet, // 12:35 + 11:50 still in DNA
    fillDeltaVsPaperMatched: liveGross - paperMatchedNet,
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
  out.push({ id: 'halt_max1', patch: { haltAfterStop: true, maxTradesPerDay: 1 } });
  out.push({ id: 'score2', patch: both({ minScore: 2 }) });
  out.push({ id: 'score2_n', patch: { nifty: { minScore: 2 } } });
  out.push({ id: 'score2_b', patch: { banknifty: { minScore: 2 } } });
  out.push({ id: 'n_align', patch: { sessionAlignNifty: true } });
  out.push({ id: 'b_align_off', patch: { sessionAlignOffBank: true } });
  out.push({ id: 'give_off', patch: both({ giveOff: true }) });
  out.push({ id: 'give_off_n', patch: { nifty: { giveOff: true } } });
  out.push({ id: 'give_off_b', patch: { banknifty: { giveOff: true } } });
  out.push({ id: 'give_3_12', patch: both({ giveUpBar: 3, giveUpMinPts: 12 }) });
  out.push({ id: 'give_5_12', patch: both({ giveUpBar: 5, giveUpMinPts: 12 }) });
  out.push({ id: 'give_4_8', patch: both({ giveUpBar: 4, giveUpMinPts: 8 }) });
  out.push({ id: 'give_4_16', patch: both({ giveUpBar: 4, giveUpMinPts: 16 }) });
  out.push({ id: 'give_n3', patch: { nifty: { giveUpBar: 3, giveUpMinPts: 12 } } });
  out.push({ id: 'give_n5', patch: { nifty: { giveUpBar: 5, giveUpMinPts: 12 } } });
  for (const t of [0, 4, 6, 8, 10, 12]) {
    out.push({ id: `time_both_${t}`, patch: both({ timeStopBars: t }) });
    out.push({ id: `time_n${t}`, patch: { nifty: { timeStopBars: t } } });
    out.push({ id: `time_b${t}`, patch: { banknifty: { timeStopBars: t } } });
  }
  for (const cut of [1500, 2000, 2500, 3500, 5000]) {
    out.push({ id: `bank_cut_${cut}`, patch: { banknifty: { cutRs: cut } } });
  }
  for (const cut of [2000, 3500, 5000, 7500]) {
    out.push({ id: `nifty_cut_${cut}`, patch: { nifty: { cutRs: cut } } });
  }
  out.push({ id: 'box_off', patch: both({ structureOff: true }) });
  out.push({ id: 'box_off_n', patch: { nifty: { structureOff: true } } });
  out.push({ id: 'box_off_b', patch: { banknifty: { structureOff: true } } });
  out.push({ id: 'box_30_60', patch: { nifty: { minStructurePts: 30 }, banknifty: { minStructurePts: 60 } } });
  out.push({ id: 'box_50_100', patch: { nifty: { minStructurePts: 50 }, banknifty: { minStructurePts: 100 } } });
  out.push({ id: 'box_n0', patch: { nifty: { minStructurePts: 0, structureExit: true } } });
  // combos from prior hunts + TRAIN-sensible pairs
  out.push({ id: 'b8_halt', patch: { haltAfterStop: true, banknifty: { timeStopBars: 8 } } });
  out.push({ id: 'b10', patch: { banknifty: { timeStopBars: 10 } } });
  out.push({ id: 'b8_score2n', patch: { nifty: { minScore: 2 } } });
  out.push({ id: 'b8_n_align', patch: { sessionAlignNifty: true } });
  out.push({ id: 'halt_score2', patch: { haltAfterStop: true, nifty: { minScore: 2 }, banknifty: { minScore: 2 } } });
  out.push({ id: 'halt_give_n', patch: { haltAfterStop: true, nifty: { giveOff: true } } });
  out.push({ id: 'max1_halt', patch: { maxTradesPerDay: 1, haltAfterStop: true } });
  out.push({ id: 'max1_score2', patch: { maxTradesPerDay: 1, nifty: { minScore: 2 }, banknifty: { minScore: 2 } } });
  out.push({ id: 'b6_halt', patch: { haltAfterStop: true, banknifty: { timeStopBars: 6 } } });
  out.push({ id: 'b4_halt', patch: { haltAfterStop: true, banknifty: { timeStopBars: 4 } } });
  out.push({ id: 'n8_b8', patch: both({ timeStopBars: 8 }) });
  out.push({ id: 'n6_b10_halt', patch: { haltAfterStop: true, banknifty: { timeStopBars: 10 } } });
  out.push({ id: 'n6_b8_give_n_off', patch: { nifty: { giveOff: true } } });
  out.push({ id: 'n6_b8_box_off_b', patch: { banknifty: { structureOff: true } } });
  out.push({ id: 'b8_cut2000', patch: { banknifty: { cutRs: 2000, timeStopBars: 8 } } });
  out.push({ id: 'b8_cut1500', patch: { banknifty: { cutRs: 1500, timeStopBars: 8 } } });
  out.push({ id: 'b8_cut3500', patch: { banknifty: { cutRs: 3500, timeStopBars: 8 } } });
  out.push({ id: 'b8_max1', patch: { maxTradesPerDay: 1 } });
  out.push({ id: 'conservative', patch: {
    haltAfterStop: true, maxTradesPerDay: 2,
    nifty: { minScore: 2, timeStopBars: 6 },
    banknifty: { timeStopBars: 8, minScore: 2 },
  } });
  out.push({ id: 'safe_halt_max1_b8', patch: { haltAfterStop: true, maxTradesPerDay: 1, banknifty: { timeStopBars: 8 } } });
  out.push({ id: 'n_align_halt_b8', patch: { sessionAlignNifty: true, haltAfterStop: true } });
  out.push({ id: 'give_n_off_halt_b8', patch: { haltAfterStop: true, nifty: { giveOff: true } } });
  out.push({ id: 'box_off_b_halt', patch: { haltAfterStop: true, banknifty: { structureOff: true } } });
  out.push({ id: 'b8_give_b_off', patch: { banknifty: { giveOff: true, timeStopBars: 8 } } });
  // de-dupe by id
  const seen = new Set();
  return out.filter((v) => { if (seen.has(v.id)) return false; seen.add(v.id); return true; });
}

function hasCloseBleed(stats) {
  return (stats.closeBleedMonths || []).length > 0;
}

function rankTrain(a, b) {
  // Prefer more green TRAIN months, then net, PF, shallower DD, less loss.
  return (b.train.monthWinRate - a.train.monthWinRate)
    || (b.train.greenMonths - a.train.greenMonths)
    || (b.train.net - a.train.net)
    || (b.train.pf - a.train.pf)
    || (a.train.maxDd - b.train.maxDd)
    || (a.train.loss - b.train.loss);
}

function slimRow(r) {
  return {
    id: r.id,
    trainWR: r.train.monthWinRate, trainGreen: `${r.train.greenMonths}/${r.train.monthCount}`,
    trainNet: r.train.net, trainPf: r.train.pf, trainDd: r.train.maxDd,
    trainWorst: r.train.worstMonth, trainBleed: r.train.closeBleedMonths,
    trainRed: r.train.redMonths.slice(0, 8),
    oosWR: r.oos.monthWinRate, oosGreen: `${r.oos.greenMonths}/${r.oos.monthCount}`,
    oosNet: r.oos.net, oosPf: r.oos.pf, oosDd: r.oos.maxDd,
    oosWorst: r.oos.worstMonth, oosBleed: r.oos.closeBleedMonths,
    oosRed: r.oos.redMonths, oosMonths: r.oos.monthNets,
    oosTick05: r.oosTick05 && r.oosTick05.net, oosTick1: r.oosTick1 && r.oosTick1.net,
    sep16: r.sep16 && r.sep16.net, n: r.oos.n + r.train.n,
  };
}

function main() {
  const candles = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const paperEqLive = JSON.stringify(exitOptsFor('nifty')) === JSON.stringify(SPEC.nifty.opts)
    && JSON.stringify(exitOptsFor('banknifty')) === JSON.stringify(SPEC.banknifty.opts);
  const allMonths = monthList('2021-01-01', OOS_TO);
  const trainMonths = allMonths.filter((m) => m.to <= TRAIN_TO);
  const oosMonths = allMonths.filter((m) => m.from >= OOS_FROM);
  const altTrainMonths = allMonths.filter((m) => m.to <= ALT_TRAIN_TO);
  const altOosMonths = allMonths.filter((m) => m.from >= ALT_OOS_FROM);
  const variants = buildVariants();
  const rows = [];
  for (const v of variants) {
    process.stderr.write(`variant ${v.id}\n`);
    const trades = allTrades(candles, v.patch);
    const train = monthStats(trades, trainMonths, '2021-01-01', TRAIN_TO);
    const oos = monthStats(trades, oosMonths, OOS_FROM, OOS_TO);
    const oosTick05 = monthStats(trades, oosMonths, OOS_FROM, OOS_TO, 0.5);
    const oosTick1 = monthStats(trades, oosMonths, OOS_FROM, OOS_TO, 1);
    const altTrain = monthStats(trades, altTrainMonths, '2021-01-01', ALT_TRAIN_TO);
    const altOos = monthStats(trades, altOosMonths, ALT_OOS_FROM, OOS_TO);
    const sep16 = sep16View(trades);
    rows.push({
      id: v.id, patch: v.patch, train, oos, oosTick05, oosTick1, altTrain, altOos, sep16,
      liveSep16: liveAdjSep16(sep16),
    });
  }

  const v16 = rows.find((r) => r.id === 'v15_6');
  const v17 = rows.find((r) => r.id === 'v15_7');
  const noBleedTrain = rows.filter((r) => !hasCloseBleed(r.train) && r.train.net > 0);
  const pool = (noBleedTrain.length ? noBleedTrain : rows.filter((r) => r.train.net > 0)).slice();
  pool.sort(rankTrain);
  const frozen = pool[0];

  const oosRank = rows.slice().sort((a, b) =>
    (b.oos.monthWinRate - a.oos.monthWinRate)
    || (b.oos.net - a.oos.net)
    || (a.oos.maxDd - b.oos.maxDd));

  const beats17 = frozen && v17
    && frozen.oos.net > v17.oos.net
    && frozen.oos.monthWinRate >= v17.oos.monthWinRate
    && !hasCloseBleed(frozen.oos);

  // Rolling: for each 2026 month, freeze on all prior months using same ranker.
  const rolling = [];
  for (const m of oosMonths) {
    const prior = allMonths.filter((x) => x.to < m.from);
    const scored = rows.map((r) => ({
      id: r.id,
      train: monthStats(
        // rebuild from stored month nets? we only have train/oos splits.
        // Use concatenated monthNets from train+oos by reconstructing a fake stats
        // from r.train / r.alt — insufficient for intra-2026.
        // Instead compare using monthNets on allMonths via r.train.monthNets + r.oos.monthNets
        [{ date: '2021-01-01', rs: 0, why: 'TIME', book: 'nifty', units: 65 }],
        prior, '2021-01-01', prior.length ? prior[prior.length - 1].to : '2021-01-01',
      ),
      oosNet: (r.oos.monthNets || {})[m.id],
      raw: r,
    }));
    // proper prior stats from stored nets
    const ranked = rows.map((r) => {
      const nets = { ...r.train.monthNets, ...r.oos.monthNets };
      const priorNets = prior.map((x) => nets[x.id] || 0);
      const green = priorNets.filter((x) => x > 0).length;
      const net = priorNets.reduce((s, x) => s + x, 0);
      return {
        id: r.id,
        wr: prior.length ? green / prior.length : 0,
        green,
        net,
        oosM: nets[m.id] || 0,
      };
    }).sort((a, b) => (b.wr - a.wr) || (b.net - a.net));
    rolling.push({ month: m.id, pick: ranked[0].id, pickOos: ranked[0].oosM, top3: ranked.slice(0, 3) });
  }

  fs.mkdirSync(OUTDIR, { recursive: true });
  const summary = {
    strategyVersionNow: STRATEGY_VERSION,
    paperEqualsLive: paperEqLive,
    rupeeSeries: 'bs_atm_weekly_month_ui',
    nseOverlay: 'not used — window >14d (2021-01-01..2026-09-16); NSE 5m overlay only valid ≤14d',
    candles: {
      nifty: candles.niftyMeta || { n: (candles.nifty || []).length, first: candles.nifty && candles.nifty[0] && candles.nifty[0].date, last: candles.nifty && candles.nifty[candles.nifty.length - 1] && candles.nifty[candles.nifty.length - 1].date },
      banknifty: candles.bankniftyMeta || { n: (candles.banknifty || []).length },
      source: candles.source || 'kite-5m-index',
      lastBar: candles.nifty && candles.nifty.length && candles.nifty[candles.nifty.length - 1].date,
    },
    lotUnits: LOT_UNITS,
    trainWindow: { from: '2021-01-01', to: TRAIN_TO, months: trainMonths.length },
    oosWindow: { from: OOS_FROM, to: OOS_TO, months: oosMonths.length, note: '16 Sep last bar is partial session' },
    altWindow: { trainTo: ALT_TRAIN_TO, oosFrom: ALT_OOS_FROM, oosMonths: altOosMonths.length },
    nVariants: variants.length,
    v15_6: slimRow(v16),
    v15_7: slimRow(v17),
    frozenFromTrain: frozen && { ...slimRow(frozen), patch: frozen.patch, liveSep16: frozen.liveSep16, altOos: { wr: frozen.altOos.monthWinRate, net: frozen.altOos.net, red: frozen.altOos.redMonths, bleed: frozen.altOos.closeBleedMonths } },
    beats15_7Oos: !!beats17,
    bestOosPeek: slimRow(oosRank[0]),
    oosLeaderboard: oosRank.slice(0, 12).map(slimRow),
    trainLeaderboard: pool.slice(0, 12).map(slimRow),
    rolling2026: rolling,
    liveSep16Fills: LIVE_SEP16,
    claim90: {
      possible: false,
      reason: 'filled after run',
    },
  };

  const frozenOosWR = frozen ? frozen.oos.monthWinRate : 0;
  const frozenOosN = frozen ? frozen.oos.monthCount : 0;
  summary.claim90 = {
    possible: frozenOosWR >= 90 && frozenOosN >= 8 && !!beats17,
    frozenOosWR,
    frozenOosMonths: frozenOosN,
    why: frozenOosWR >= 90 && frozenOosN >= 8
      ? (beats17 ? 'OOS month-win-rate ≥90% on ≥8 months and beats 15.7 OOS without CLOSE bleed'
        : 'OOS month-win-rate looks high but ship rule vs 15.7 OOS failed or CLOSE bleed returned')
      : `Cannot claim 90% Live profit: OOS month-win-rate is ${frozenOosWR}% on ${frozenOosN} months (need ≥90% on ≥8). 16 Sep is in the OOS window. Sample is one 2026 regime, not a guarantee tomorrow.`,
  };

  const md = [];
  md.push('# Walk-forward OOS — Trade Bot DNA');
  md.push('');
  md.push(`Kite 5m index ${summary.candles.nifty.first || '2021-01-01'} → ${summary.candles.lastBar}. Option ₹ = **BS weekly ATM (month UI)**. NSE overlay **not** used (span ≫ 14d). Lots 65 / 30 (current Live). Paper===Live: ${paperEqLive}.`);
  md.push('');
  md.push(`**TRAIN** 2021-01-01 … 2025-12-31 (${trainMonths.length} months). **OOS** 2026-01-01 … 2026-09-16 (${oosMonths.length} months, 16 Sep partial). Knobs frozen on TRAIN only.`);
  md.push('');
  md.push('## 15.6 vs 15.7 vs TRAIN-frozen');
  md.push('');
  md.push('| DNA | Train WR | Train net | Train PF | Train DD | OOS WR | OOS net | OOS PF | OOS DD | OOS red | OOS CLOSE bleed | 16 Sep paper | OOS −0.5 tick | OOS −1 tick |');
  md.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---:|---:|');
  for (const r of [v16, v17, frozen]) {
    if (!r) continue;
    md.push(`| ${r.id} | ${r.train.monthWinRate}% (${r.train.greenMonths}/${r.train.monthCount}) | ${r.train.net} | ${r.train.pf} | ${r.train.maxDd} | **${r.oos.monthWinRate}%** (${r.oos.greenMonths}/${r.oos.monthCount}) | ${r.oos.net} | ${r.oos.pf} | ${r.oos.maxDd} | ${r.oos.redMonths.map((x) => x.id + ' ' + x.net).join(', ') || '—'} | ${r.oos.closeBleedMonths.join(', ') || '—'} | ${r.sep16.net} | ${r.oosTick05.net} | ${r.oosTick1.net} |`);
  }
  md.push('');
  md.push('## OOS 2026 month nets (TRAIN-frozen vs 15.6 / 15.7)');
  md.push('');
  const mids = oosMonths.map((m) => m.id);
  md.push('| DNA | ' + mids.join(' | ') + ' |');
  md.push('|---|' + mids.map(() => '---:').join('|') + '|');
  for (const r of [v16, v17, frozen]) {
    if (!r) continue;
    md.push(`| ${r.id} | ` + mids.map((id) => r.oos.monthNets[id]).join(' | ') + ' |');
  }
  md.push('');
  md.push('## TRAIN freeze pick');
  md.push('');
  md.push(frozen ? `Frozen **${frozen.id}** patch \`${JSON.stringify(frozen.patch)}\`.` : 'no freeze');
  md.push('');
  md.push(`Beats 15.7 OOS net+WR without CLOSE bleed: **${!!beats17}**.`);
  md.push('');
  md.push('## 90% claim');
  md.push('');
  md.push(summary.claim90.why);
  md.push('');
  md.push('## Rolling 2026 (pick on all prior months, score that month)');
  md.push('');
  md.push('| Month | Train-frozen pick | That month ₹ |');
  md.push('|---|---|---:|');
  for (const x of rolling) md.push(`| ${x.month} | ${x.pick} | ${x.pickOos} |`);
  md.push('');
  md.push('## 16 Sep Live fills vs paper');
  md.push('');
  md.push(`Live: Bank CE STOP (776.75→735)×30 = ₹${LIVE_SEP16.bank.gross}; Nifty PE (144.15→138.75)×65 = ₹${LIVE_SEP16.nifty.gross}; **gross ₹${LIVE_SEP16.bank.gross + LIVE_SEP16.nifty.gross}**.`);
  if (frozen) {
    md.push(`Frozen paper 16 Sep ₹${frozen.sep16.net}. Live-vs-matched-paper delta ₹${frozen.liveSep16.fillDeltaVsPaperMatched}. As-lived-that-morning ₹${frozen.liveSep16.asLivedThatMorning}. Paper===Live now (includes later book legs) ₹${Math.round(frozen.liveSep16.asPaperEqLiveNow)}.`);
  }
  md.push('');
  md.push('## Top TRAIN (no CLOSE bleed)');
  md.push('');
  md.push('| id | Train WR | Train net | OOS WR | OOS net | OOS red |');
  md.push('|---|---:|---:|---:|---:|---|');
  for (const r of pool.slice(0, 15)) {
    md.push(`| ${r.id} | ${r.train.monthWinRate}% | ${r.train.net} | ${r.oos.monthWinRate}% | ${r.oos.net} | ${r.oos.redMonths.map((x) => x.id).join(',') || '—'} |`);
  }
  md.push('');
  md.push('## Top OOS (peek — not used to freeze)');
  md.push('');
  md.push('| id | OOS WR | OOS net | Train WR | Train net | OOS red |');
  md.push('|---|---:|---:|---:|---:|---|');
  for (const r of oosRank.slice(0, 12)) {
    md.push(`| ${r.id} | ${r.oos.monthWinRate}% | ${r.oos.net} | ${r.train.monthWinRate}% | ${r.train.net} | ${r.oos.redMonths.map((x) => x.id).join(',') || '—'} |`);
  }
  md.push('');
  md.push(`Alt freeze TRAIN through 2024: frozen DNA alt-OOS WR ${frozen ? frozen.altOos.monthWinRate : '?'}% net ₹${frozen ? frozen.altOos.net : '?'} red ${frozen && frozen.altOos.redMonths.map((x) => x.id).join(',')}.`);

  const mdPath = path.join(OUTDIR, 'sr_walkforward_oos.md');
  const jsonPath = path.join(OUTDIR, 'sr_walkforward_oos.json');
  fs.writeFileSync(mdPath, md.join('\n'));
  const jsonOut = {
    ...summary,
    frozenFull: frozen && {
      id: frozen.id, patch: frozen.patch,
      train: frozen.train, oos: frozen.oos, oosTick05: frozen.oosTick05, oosTick1: frozen.oosTick1,
      altOos: frozen.altOos, sep16: frozen.sep16, liveSep16: frozen.liveSep16,
    },
    v15_6_full: v16 && { train: v16.train, oos: v16.oos, sep16: v16.sep16, oosTick05: v16.oosTick05, oosTick1: v16.oosTick1 },
    v15_7_full: v17 && { train: v17.train, oos: v17.oos, sep16: v17.sep16, oosTick05: v17.oosTick05, oosTick1: v17.oosTick1 },
  };
  fs.writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2));
  console.log(JSON.stringify({
    paperEqualsLive: paperEqLive,
    frozen: frozen && frozen.id,
    beats15_7Oos: !!beats17,
    claim90: summary.claim90,
    v15_7_oos: slimRow(v17),
    frozenSlim: frozen && slimRow(frozen),
    bestOosPeek: slimRow(oosRank[0]),
    mdPath, jsonPath,
  }, null, 2));
}

main();
