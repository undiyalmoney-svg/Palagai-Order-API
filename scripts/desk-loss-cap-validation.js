/**
 * Desk loss-cap validation — replays the EXACT live-green DNA (strategy-core.cjs)
 * on real NIFTY / BANK index 5m data (Yahoo fallback, since Kite is IP-blocked
 * locally) and measures the impact of:
 *   a) per-option loss cap (exit any leg at -₹250 / -₹300 / -₹400 per lot)
 *   b) fewer trades (max 2/day)
 * against the current baseline.
 *
 * NOTE (honesty): option premiums are ESTIMATED by the engine (ATM delta ×
 * index move, no real option candles available offline). So absolute ₹ amounts
 * are approximations; the RELATIVE improvement of a loss-cap / fewer-trades
 * is what matters. Validate intraday with real fills before trusting either.
 *
 * Run: node scripts/desk-loss-cap-validation.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  NIFTY_50_INSTRUMENT,
  BANK_NIFTY_INSTRUMENT,
  createTrapStrategy,
  replayPaperOnIndex,
} = require('../live/strategy-core.cjs');
const { LIVE_GREEN_DNA, liveGreenTrapExtras, liveGreenBankTrapExtras } = require('../live/dna-live-green');
const { indexDayRiskOverrides } = require('../live/daily-desk-defaults');

const CACHE = '/tmp/stock-data';
const IST = 5 * 3600 + 30 * 60;
const LOOKBACK_DAYS = 12;
const CAPS = [0, 250, 300, 400]; // ₹ per 1-lot max loss; 0 = baseline

/** Per-index-point option P&L (₹ / lot): ATM delta × ₹/point. */
const BOOK = {
  [NIFTY_50_INSTRUMENT.id]: { delta: 0.41, rsPerPt: 65, kind: 'nifty' },
  [BANK_NIFTY_INSTRUMENT.id]: { delta: 0.3, rsPerPt: 30, kind: 'banknifty' },
};
const PER_PT = {
  [NIFTY_50_INSTRUMENT.id]: 0.41 * 65,
  [BANK_NIFTY_INSTRUMENT.id]: 0.3 * 30,
};

const pad = (n) => String(n).padStart(2, '0');
function isoIST(ts) {
  const d = new Date((ts + IST) * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00+05:30`;
}
function addDaysIso(d, n) {
  const [y, m, dd] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function yahooCandles(sym) {
  const raw = JSON.parse(fs.readFileSync(path.join(CACHE, `${sym}.json`), 'utf8'));
  const r = raw.chart.result[0];
  const q = r.indicators.quote[0];
  const out = [];
  for (let i = 0; i < r.timestamp.length; i += 1) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
    out.push({ date: isoIST(r.timestamp[i]), open: o, high: h, low: l, close: c, volume: q.volume[i] || 0 });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function trapOverrides(book, instrumentId) {
  const risk = indexDayRiskOverrides({
    instrumentId, enableNifty: true, enableBank: true, dayProfitLock: false, strictDayStop: false,
  }) || {};
  const extras = book === 'bank' ? liveGreenBankTrapExtras() : liveGreenTrapExtras();
  const maxTrades = book === 'bank'
    ? LIVE_GREEN_DNA.trap.bankMaxTradesPerDay || LIVE_GREEN_DNA.trap.maxTradesPerDay
    : LIVE_GREEN_DNA.trap.maxTradesPerDay;
  return { ...risk, maxTradesPerDay: maxTrades, targetRMultiple: LIVE_GREEN_DNA.trap.targetRMultiple, extras };
}

function replayDay(book, allBars, day) {
  const instrumentId = book === 'bank' ? BANK_NIFTY_INSTRUMENT.id : NIFTY_50_INSTRUMENT.id;
  const warmFrom = addDaysIso(day, -LOOKBACK_DAYS);
  const candles = allBars.filter((b) => b.date.slice(0, 10) >= warmFrom && b.date.slice(0, 10) <= day);
  const strategy = createTrapStrategy();
  strategy.initialize(trapOverrides(book, instrumentId));
  const result = replayPaperOnIndex({
    instrumentId,
    instrumentName: book === 'bank' ? 'Bank Nifty' : 'Nifty 50',
    kind: book === 'bank' ? 'banknifty' : 'nifty',
    candles,
    fromDate: day,
    toDate: day,
    instruments: [],
    forceCloseOpen: true,
    lotsMultiplier: 1,
    enableKutty: false,
    kuttyAlone: false,
    livePath: null, // allow estimated option P&L (no real option candles offline)
    optionCandlesByToken: new Map(),
    neededOptionTokens: new Set(),
    strategy,
  });
  return (result.trades || []).filter((t) => t.netOptionPnlRs != null);
}

/** Apply a per-option max-loss cap (₹) to a trade using its max adverse excursion. */
function capTrade(t, cap) {
  if (!(cap > 0)) return { ...t, net: t.netOptionPnlRs };
  const perPt = PER_PT[t.instrumentId];
  const capPts = cap / perPt;
  if (t.maeIndexPts != null && t.maeIndexPts >= capPts) {
    // the cap would have stopped this leg at ~−cap (plus its round-trip charges)
    return { ...t, capped: true, net: -cap - (t.chargesRs ?? 45) };
  }
  return { ...t, net: t.netOptionPnlRs };
}

function deskByDay(trades, cap, maxPerDay) {
  const byDay = {};
  for (const t of trades) {
    const d = String(t.entryTime || '').slice(0, 10);
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(t);
  }
  const days = [];
  let total = 0;
  let count = 0;
  for (const [d, list] of Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]))) {
    const capped = list.map((t) => capTrade(t, cap)).sort((a, b) =>
      String(a.entryTime).localeCompare(String(b.entryTime)));
    const took = maxPerDay > 0 ? capped.slice(0, maxPerDay) : capped;
    const net = took.reduce((s, t) => s + t.net, 0);
    total += net;
    count += took.length;
    days.push({ day: d, trades: took.length, net: Math.round(net) });
  }
  const active = days.filter((d) => d.trades > 0);
  return {
    trades: count,
    days: active,
    total: Math.round(total),
    avgDay: active.length ? Math.round(total / active.length) : 0,
    green: active.filter((d) => d.net > 0).length,
    red: active.filter((d) => d.net < 0).length,
  };
}

function line(r) {
  return `  trades=${String(r.trades).padStart(3)}  total=₹${String(r.total).padStart(6)}  avg/day=₹${String(r.avgDay).padStart(5)}  G/R=${r.green}G/${r.red}R  days=${r.days.length}`;
}

async function main() {
  const nifty = yahooCandles('^NSEI');
  const bank = yahooCandles('^NSEBANK');
  const days = [...new Set([...nifty, ...bank].map((b) => b.date.slice(0, 10)))].sort();
  console.log(`\n=== Desk loss-cap validation — live-green DNA · ${days.length} trading days (${days[0]} → ${days[days.length - 1]}) ===`);
  console.log(`  data: ^NSEI ${nifty.length} bars · ^NSEBANK ${bank.length} bars`);

  const all = [];
  for (const day of days) {
    for (const book of ['nifty', 'bank']) {
      try {
        const trades = replayDay(book, book === 'nifty' ? nifty : bank, day);
        for (const t of trades) all.push({ ...t, _book: book });
      } catch (e) {
        console.error(`  replay failed ${book} ${day}: ${e.message}`);
      }
    }
  }
  const wins = all.filter((t) => t.netOptionPnlRs > 0).length;
  const losses = all.filter((t) => t.netOptionPnlRs < 0).length;
  console.log(`\n  replay produced ${all.length} trades (${wins}W / ${losses}L)`);

  console.log(`\n  -- VARIANTS (option ₹ are engine estimates; compare RELATIVE) --`);
  for (const cap of CAPS) {
    console.log(`  [${cap === 0 ? 'BASELINE' : 'CAP ₹' + cap}]${line(deskByDay(all, cap, 0))}`);
  }
  const r0 = deskByDay(all, 0, 2);
  const r3 = deskByDay(all, 300, 2);
  console.log(`  [MAX 2/day]         ${line(r0)}`);
  console.log(`  [CAP ₹300+MAX 2/d]  ${line(r3)}`);

  const detail = deskByDay(all, 300, 2);
  console.log(`\n  CAP ₹300 + max 2/day by day:`);
  detail.days.forEach((d) => console.log(`    ${d.day}  ${d.trades}t  ₹${d.net}`));

  const byDay = {};
  for (const t of all) { const d = String(t.entryTime || '').slice(0, 10); (byDay[d] ||= []).push(t); }
  for (const [d, list] of Object.entries(byDay)) {
    if (list.length >= 2) {
      console.log(`\n  sample day ${d} — baseline raw trades:`);
      list.sort((a, b) => a.entryTime.localeCompare(b.entryTime)).forEach((t) =>
        console.log(`    ${t._book.padEnd(5)} ${String(t.entryTime).slice(11, 16)}→${String(t.exitTime).slice(11, 16)} ${String(t.exitReason).padEnd(10)} idxPts=${String(Math.round(t.indexPoints)).padStart(5)} mae=${String(Math.round(t.maeIndexPts || 0)).padStart(4)} net=₹${Math.round(t.netOptionPnlRs)} chg=₹${Math.round(t.chargesRs || 0)}`));
      break;
    }
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });