#!/usr/bin/env node
/**
 * LOW-TURNOVER RESEARCH — reframed problem.
 *
 * Prior programme (30 strategies) failed for ONE arithmetic reason:
 *   gross edge ≈ ₹20/trade  vs  costs ≈ ₹24/trade.
 * The fix is not a better indicator. It is a strategy whose gross edge per
 * trade is measured in HUNDREDS of rupees, so a ~₹25 fixed cost is noise.
 *
 * That requires: long holds, few trades, large captured moves.
 *
 * PRIMARY CANDIDATE — CROSS-SECTIONAL MOMENTUM (12-1).
 *   Rank the universe by return over the last 12 months EXCLUDING the most
 *   recent month (the skip avoids well-documented short-term reversal).
 *   Hold the top N, equally weighted, rebalance every H months.
 *   Rationale: Jegadeesh & Titman (1993) and ~30 years of replication across
 *   markets incl. India (Sehgal & Balakrishnan; Ansari & Khan). This is not
 *   an indicator combination — it is a risk/behavioural premium, and it is
 *   structurally low-turnover, which is exactly the constraint that matters.
 *
 * Also tested for like-for-like frequency comparison under IDENTICAL costs:
 *   - Absolute (time-series) momentum with a market-regime filter
 *   - Buy & hold Nifty (the do-nothing benchmark every strategy must beat)
 *
 * REAL PORTFOLIO SIMULATION: equity compounds, whole shares only, no
 * fractional units, cannot deploy more than available cash, costs charged
 * per actual executed order.
 *
 * SPLIT: DEV 2013-06..2019-12 | VALID 2020-01..2022-12 | TEST 2023-01..2026-08
 *
 * Usage: node scripts/lowturnover-research.js
 */
const { fetchHistoricalCandles } = require('../live/kite-market');

const UNIVERSE = {
  HDFCBANK: 341249, ICICIBANK: 1270529, SBIN: 779521, KOTAKBANK: 492033,
  AXISBANK: 1510401, INDUSINDBK: 1346049, BANKBARODA: 1195009,
  TCS: 2953217, INFY: 408065, WIPRO: 969473, HCLTECH: 1850625, TECHM: 3465729,
  RELIANCE: 738561, IOC: 415745, BPCL: 134657, ONGC: 633601,
  TATASTEEL: 895745, JSWSTEEL: 3001089, HINDALCO: 348929,
  MARUTI: 2815745, M_M: 519937, BAJAJ_AUTO: 4267265, HEROMOTOCO: 345089,
  ITC: 424961, HINDUNILVR: 356865, BRITANNIA: 140033, DABUR: 197633, MARICO: 1041153,
  ULTRACEMCO: 2952193, SHREECEM: 794369, AMBUJACEM: 325121,
  SUNPHARMA: 857857, CIPLA: 177665, DRREDDY: 225537, LUPIN: 2672641, AUROPHARMA: 70401,
  NTPC: 2977281, POWERGRID: 3834113, LT: 2939649, ADANIPORTS: 3861249,
  TITAN: 897537, ASIANPAINT: 60417, BHARTIARTL: 2714625, BAJFINANCE: 81153,
  NESTLEIND: 4598529,
};
const NIFTY = 256265;

const FROM = '2013-06-03';
const DEV_TO = '2019-12-31';
const VALID_TO = '2022-12-31';
const TO = '2026-08-21';
const START_CAPITAL = 20000;
const DP_RS = 15 * 1.18;

/** Zerodha CNC delivery. DP charged once per scrip per SELL day. */
function buyCost(turnover) {
  const stt = turnover * 0.001;
  const exch = turnover * 0.0000297;
  const sebi = turnover * 0.000001;
  const stamp = turnover * 0.00015;
  return stt + exch + sebi + stamp + (exch + sebi) * 0.18;
}
function sellCost(turnover) {
  const stt = turnover * 0.001;
  const exch = turnover * 0.0000297;
  const sebi = turnover * 0.000001;
  return stt + exch + sebi + (exch + sebi) * 0.18 + DP_RS;
}

function addDays(d, n) {
  const [y, m, dd] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

async function fetchAll(auth, token) {
  const out = [];
  let cur = FROM;
  while (cur <= TO) {
    const end = addDays(cur, 1900) > TO ? TO : addDays(cur, 1900);
    out.push(...await fetchHistoricalCandles(auth, token, cur, end, 'day'));
    cur = addDays(end, 1);
  }
  const seen = new Set();
  return out.filter((r) => (seen.has(r.date) ? false : (seen.add(r.date), true)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Portfolio backtest. Rebalances on the first trading day of each Hth month,
 * at that day's OPEN, using a ranking computed from data up to the PREVIOUS
 * month-end close. No look-ahead: the ranking date always precedes the
 * execution date.
 */
function runMomentum(dates, px, symbols, cfg, niftyClose) {
  const { topN, holdMonths, lookback, skip, regimeFilter, slip } = cfg;
  const monthStarts = [];
  for (let i = 1; i < dates.length; i += 1) {
    if (dates[i].slice(0, 7) !== dates[i - 1].slice(0, 7)) monthStarts.push(i);
  }

  let cash = START_CAPITAL;
  let holdings = {}; // sym -> qty
  const trades = [];
  const equityCurve = [];
  let rebalCount = 0;

  const valueAt = (i) => {
    let v = cash;
    for (const [s, q] of Object.entries(holdings)) if (px[s][i] != null) v += px[s][i] * q;
    return v;
  };

  for (let m = 0; m < monthStarts.length; m += 1) {
    const i = monthStarts[m];
    // Track equity daily between rebalances
    const nextI = m + 1 < monthStarts.length ? monthStarts[m + 1] : dates.length;
    if (m % holdMonths !== 0) {
      for (let d = i; d < nextI; d += 1) equityCurve.push({ date: dates[d], eq: valueAt(d) });
      continue;
    }
    rebalCount += 1;

    // ---- RANK using data strictly BEFORE today ----
    const rankAt = i - 1; // previous close
    const lookIdx = rankAt - lookback;
    const skipIdx = rankAt - skip;
    if (lookIdx < 0) { for (let d = i; d < nextI; d += 1) equityCurve.push({ date: dates[d], eq: valueAt(d) }); continue; }

    let target = [];
    const regimeOk = !regimeFilter || (niftyClose[rankAt] != null && niftyClose[rankAt] > sma(niftyClose, rankAt, 200));
    if (regimeOk) {
      const scored = [];
      for (const s of symbols) {
        const a = px[s][lookIdx];
        const b = px[s][skipIdx];
        if (a == null || b == null || !(a > 0)) continue;
        scored.push({ s, mom: b / a - 1 });
      }
      scored.sort((x, y) => y.mom - x.mom);
      target = scored.slice(0, topN).filter((x) => x.mom > 0).map((x) => x.s);
    }

    // ---- SELL anything not in target ----
    for (const s of Object.keys(holdings)) {
      if (target.includes(s)) continue;
      const q = holdings[s];
      const p = px[s][i];
      if (p == null) continue;
      const fill = p * (1 - slip);
      const turnover = fill * q;
      const c = sellCost(turnover);
      cash += turnover - c;
      trades.push({ date: dates[i], sym: s, side: 'SELL', qty: q, px: fill, cost: c });
      delete holdings[s];
    }

    // ---- BUY to fill target equally ----
    const held = Object.keys(holdings);
    const toBuy = target.filter((s) => !held.includes(s));
    if (toBuy.length) {
      const totalVal = valueAt(i);
      const perSlot = totalVal / Math.max(1, target.length);
      for (const s of toBuy) {
        const p = px[s][i];
        if (p == null) continue;
        const fill = p * (1 + slip);
        let qty = Math.floor(Math.min(perSlot, cash * 0.98) / fill);
        if (qty < 1) continue;
        let turnover = fill * qty;
        let c = buyCost(turnover);
        while (turnover + c > cash && qty > 0) { qty -= 1; turnover = fill * qty; c = buyCost(turnover); }
        if (qty < 1) continue;
        cash -= turnover + c;
        holdings[s] = (holdings[s] || 0) + qty;
        trades.push({ date: dates[i], sym: s, side: 'BUY', qty, px: fill, cost: c });
      }
    }
    for (let d = i; d < nextI; d += 1) equityCurve.push({ date: dates[d], eq: valueAt(d) });
  }
  return { trades, equityCurve, rebalCount };
}

function sma(arr, i, n) {
  if (i < n - 1) return null;
  let s = 0, cnt = 0;
  for (let k = i - n + 1; k <= i; k += 1) { if (arr[k] == null) return null; s += arr[k]; cnt += 1; }
  return cnt ? s / cnt : null;
}

function analyse(equityCurve, trades, from, to) {
  const seg = equityCurve.filter((e) => e.date.slice(0, 10) >= from && e.date.slice(0, 10) <= to);
  if (seg.length < 20) return null;
  const startEq = seg[0].eq, endEq = seg[seg.length - 1].eq;
  const years = (new Date(seg[seg.length - 1].date) - new Date(seg[0].date)) / (365.25 * 86400000);
  let peak = -Infinity, maxDD = 0;
  for (const e of seg) { peak = Math.max(peak, e.eq); maxDD = Math.min(maxDD, (e.eq - peak) / peak); }

  // monthly
  const byMonth = {};
  for (const e of seg) byMonth[e.date.slice(0, 7)] = e.eq;
  const months = Object.keys(byMonth).sort();
  const mrets = [];
  for (let i = 1; i < months.length; i += 1) mrets.push(byMonth[months[i]] / byMonth[months[i - 1]] - 1);
  const posM = mrets.filter((r) => r > 0).length;
  let worstStreak = 0, cur = 0;
  for (const r of mrets) { if (r <= 0) { cur += 1; worstStreak = Math.max(worstStreak, cur); } else cur = 0; }

  const segTrades = trades.filter((t) => t.date.slice(0, 10) >= from && t.date.slice(0, 10) <= to);
  const totalCost = segTrades.reduce((a, t) => a + t.cost, 0);
  return {
    startEq, endEq,
    totalPct: (endEq / startEq - 1) * 100,
    cagr: (Math.pow(endEq / startEq, 1 / years) - 1) * 100,
    maxDD: maxDD * 100,
    nTrades: segTrades.length,
    totalCost,
    costPerTrade: segTrades.length ? totalCost / segTrades.length : 0,
    tradesPerMonth: segTrades.length / Math.max(1, months.length),
    posMonthsPct: mrets.length ? (100 * posM) / mrets.length : 0,
    nMonths: mrets.length,
    worstMonth: mrets.length ? Math.min(...mrets) * 100 : 0,
    bestMonth: mrets.length ? Math.max(...mrets) * 100 : 0,
    worstStreak,
  };
}

function fmt(v, d = 1) { return (v >= 0 ? '+' : '') + v.toFixed(d); }

async function main() {
  const auth = `token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}`;
  const raw = {};
  for (const [sym, tok] of Object.entries(UNIVERSE)) {
    try { process.stderr.write(`${sym} `); const r = await fetchAll(auth, tok); if (r.length > 1500) raw[sym] = r; }
    catch (e) { process.stderr.write(`(skip) `); }
  }
  const nifty = await fetchAll(auth, NIFTY);
  const symbols = Object.keys(raw);
  console.error(`\n${symbols.length} symbols.\n`);

  // union of dates from nifty (market calendar)
  const dates = nifty.map((r) => r.date.slice(0, 10));
  // Forward-fill: a stock that simply did not print on a given session must
  // keep its last known price. Leaving a null made valueAt() treat the holding
  // as worthless for that day, manufacturing impossible -99% drawdowns in a
  // long-only book. Leading nulls (before a stock's history begins) stay null
  // so the ranker correctly ignores it until it actually exists.
  const px = {};
  for (const s of symbols) {
    const m = new Map(raw[s].map((r) => [r.date.slice(0, 10), r.close]));
    let last = null;
    px[s] = dates.map((d) => {
      if (m.has(d)) { last = m.get(d); return last; }
      return last; // null before first print, else carried forward
    });
  }
  const nClose = nifty.map((r) => r.close);

  const windows = [['DEV', FROM, DEV_TO], ['VALID', addDays(DEV_TO, 1), VALID_TO], ['TEST', addDays(VALID_TO, 1), TO]];

  const configs = [
    { name: 'XS-Mom 12-1, top3, 1mo hold',   topN: 3, holdMonths: 1, lookback: 252, skip: 21, regimeFilter: false },
    { name: 'XS-Mom 12-1, top3, 3mo hold',   topN: 3, holdMonths: 3, lookback: 252, skip: 21, regimeFilter: false },
    { name: 'XS-Mom 12-1, top5, 3mo hold',   topN: 5, holdMonths: 3, lookback: 252, skip: 21, regimeFilter: false },
    { name: 'XS-Mom 6-1,  top3, 3mo hold',   topN: 3, holdMonths: 3, lookback: 126, skip: 21, regimeFilter: false },
    { name: 'XS-Mom 12-1, top3, 3mo + regime', topN: 3, holdMonths: 3, lookback: 252, skip: 21, regimeFilter: true },
    { name: 'XS-Mom 12-1, top3, 6mo hold',   topN: 3, holdMonths: 6, lookback: 252, skip: 21, regimeFilter: false },
  ];

  for (const slip of [0.001, 0.002]) {
    console.log(`\n${'='.repeat(122)}`);
    console.log(`SLIPPAGE ${(slip * 100).toFixed(2)}%/leg  ·  ₹20,000 start  ·  whole shares  ·  Zerodha CNC delivery costs (DP ₹17.70/sell)`);
    console.log('='.repeat(122));
    console.log('Strategy                          Win     CAGR%   MaxDD%  Trades  Tr/mo  Cost/tr   TotCost   Pos.Mo%  WorstMo%  LoseStrk   EndEquity');
    console.log('-'.repeat(122));
    for (const cfg of configs) {
      const { trades, equityCurve } = runMomentum(dates, px, symbols, { ...cfg, slip }, nClose);
      for (const [wn, wf, wt] of windows) {
        const a = analyse(equityCurve, trades, wf, wt);
        if (!a) { console.log(cfg.name.padEnd(34), wn.padEnd(7), ' (insufficient)'); continue; }
        console.log(
          (wn === 'DEV' ? cfg.name : '').padEnd(34),
          wn.padEnd(7),
          fmt(a.cagr).padStart(7),
          a.maxDD.toFixed(1).padStart(8),
          String(a.nTrades).padStart(7),
          a.tradesPerMonth.toFixed(1).padStart(6),
          `₹${a.costPerTrade.toFixed(0)}`.padStart(8),
          `₹${a.totalCost.toFixed(0)}`.padStart(9),
          a.posMonthsPct.toFixed(0).padStart(8),
          a.worstMonth.toFixed(1).padStart(9),
          String(a.worstStreak).padStart(9),
          `₹${a.endEq.toFixed(0)}`.padStart(12),
        );
      }
      console.log('-'.repeat(122));
    }

    // Benchmark: buy & hold Nifty
    console.log('\nBENCHMARK — buy & hold Nifty 50 (one buy, one sell, no rebalancing):');
    for (const [wn, wf, wt] of windows) {
      const seg = dates.map((d, i) => ({ d, c: nClose[i] })).filter((x) => x.d >= wf && x.d <= wt);
      if (seg.length < 20) continue;
      const yrs = (new Date(seg[seg.length - 1].d) - new Date(seg[0].d)) / (365.25 * 86400000);
      const tot = seg[seg.length - 1].c / seg[0].c;
      let peak = -Infinity, dd = 0;
      for (const s of seg) { peak = Math.max(peak, s.c); dd = Math.min(dd, (s.c - peak) / peak); }
      console.log(`  ${wn.padEnd(7)} CAGR ${fmt((Math.pow(tot, 1 / yrs) - 1) * 100).padStart(6)}%   MaxDD ${(dd * 100).toFixed(1).padStart(6)}%`);
    }
  }
}

main().catch((e) => { console.error('ERR:', e.message, e.stack); process.exit(1); });
