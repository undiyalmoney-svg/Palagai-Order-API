#!/usr/bin/env node
/**
 * CAPITAL SENSITIVITY — frozen strategies, capital is the ONLY variable.
 *
 * Rules, parameters, entries, exits, holding period, ranking and sizing
 * methodology are taken UNCHANGED from lowturnover-research.js. Nothing is
 * re-optimised. The single question: at what account size, if any, does the
 * already-frozen strategy become economically viable?
 *
 * PRIMARY   XS-Mom 6-1, top3, 3-month hold   <- best on DEV *and* VALID, i.e.
 *           the config a disciplined process would actually have frozen
 *           BEFORE seeing the final window.
 * SECONDARY XS-Mom 12-1, top5, 3-month hold
 *
 * Costs modelled per component (not a blended %): STT, exchange txn, SEBI
 * turnover fee, GST, stamp duty, DP charge. Brokerage ₹0 (Zerodha CNC).
 * Swept at 1.0x / 1.5x / 2.0x plus a slippage sweep.
 *
 * Effects decomposed rather than conflated:
 *   A FIXED COST      — DP ₹17.70/sell, size-independent
 *   B PERCENTAGE COST — STT/stamp/exchange, scale-invariant by construction
 *   C POSITION SIZING — whole-share granularity & unaffordable names
 *   D LIQUIDITY       — participation vs traded value
 *   E RISK OF RUIN    — drawdown in rupees vs account survivability
 *
 * Usage: node scripts/capital-sensitivity.js
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
const VALID_TO = '2022-12-31';
const TO = '2026-08-21';
const DP_RS = 15 * 1.18;

function buyCost(t, mult) {
  const stt = t * 0.001, exch = t * 0.0000297, sebi = t * 0.000001, stamp = t * 0.00015;
  return (stt + exch + sebi + stamp + (exch + sebi) * 0.18) * mult;
}
function sellCost(t, mult) {
  const stt = t * 0.001, exch = t * 0.0000297, sebi = t * 0.000001;
  return (stt + exch + sebi + (exch + sebi) * 0.18) * mult + DP_RS * mult;
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
function sma(arr, i, n) {
  if (i < n - 1) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k += 1) { if (arr[k] == null) return null; s += arr[k]; }
  return s / n;
}

function run(dates, px, symbols, cfg, capital) {
  const { topN, holdMonths, lookback, skip, slip, costMult, tradeFrom } = cfg;
  const monthStarts = [];
  for (let i = 1; i < dates.length; i += 1) if (dates[i].slice(0, 7) !== dates[i - 1].slice(0, 7)) monthStarts.push(i);
  // Trading begins at tradeFrom with EXACTLY `capital` in cash. Without this,
  // equity compounds from 2013 and a "₹20,000" run is really holding ~₹237,000
  // by the out-of-sample window — which silently hides the whole-share
  // affordability constraint the small account actually faces.
  const startMonth = tradeFrom ? monthStarts.findIndex((i) => dates[i] >= tradeFrom) : 0;

  let cash = capital;
  let holdings = {};
  const trades = [];
  const eqCurve = [];
  let blockedByPrice = 0;   // effect C: name in target but unaffordable
  let targetSlots = 0;
  let deployedSum = 0, deployedN = 0;
  let maxNotional = 0;

  const valueAt = (i) => {
    let v = cash;
    for (const [s, q] of Object.entries(holdings)) if (px[s][i] != null) v += px[s][i] * q;
    return v;
  };

  for (let m = Math.max(0, startMonth); m < monthStarts.length; m += 1) {
    const i = monthStarts[m];
    const nextI = m + 1 < monthStarts.length ? monthStarts[m + 1] : dates.length;
    if ((m - Math.max(0, startMonth)) % holdMonths !== 0) {
      for (let d = i; d < nextI; d += 1) {
        const v = valueAt(d); eqCurve.push({ date: dates[d], eq: v });
        deployedSum += (v - cash) / v; deployedN += 1;
      }
      continue;
    }
    const rankAt = i - 1, lookIdx = rankAt - lookback, skipIdx = rankAt - skip;
    if (lookIdx < 0) { for (let d = i; d < nextI; d += 1) eqCurve.push({ date: dates[d], eq: valueAt(d) }); continue; }

    const scored = [];
    for (const s of symbols) {
      const a = px[s][lookIdx], b = px[s][skipIdx];
      if (a == null || b == null || !(a > 0)) continue;
      scored.push({ s, mom: b / a - 1 });
    }
    scored.sort((x, y) => y.mom - x.mom);
    const target = scored.slice(0, topN).filter((x) => x.mom > 0).map((x) => x.s);

    for (const s of Object.keys(holdings)) {
      if (target.includes(s)) continue;
      const q = holdings[s], p = px[s][i];
      if (p == null) continue;
      const fill = p * (1 - slip), turnover = fill * q, c = sellCost(turnover, costMult);
      cash += turnover - c;
      trades.push({ date: dates[i], sym: s, side: 'SELL', qty: q, turnover, cost: c });
      delete holdings[s];
    }
    const held = Object.keys(holdings);
    const toBuy = target.filter((s) => !held.includes(s));
    if (toBuy.length) {
      const perSlot = valueAt(i) / Math.max(1, target.length);
      for (const s of toBuy) {
        targetSlots += 1;
        const p = px[s][i];
        if (p == null) continue;
        const fill = p * (1 + slip);
        let qty = Math.floor(Math.min(perSlot, cash * 0.98) / fill);
        if (qty < 1) { blockedByPrice += 1; continue; }   // effect C, counted
        let turnover = fill * qty, c = buyCost(turnover, costMult);
        while (turnover + c > cash && qty > 0) { qty -= 1; turnover = fill * qty; c = buyCost(turnover, costMult); }
        if (qty < 1) { blockedByPrice += 1; continue; }
        cash -= turnover + c;
        holdings[s] = qty;
        maxNotional = Math.max(maxNotional, turnover);
        trades.push({ date: dates[i], sym: s, side: 'BUY', qty, turnover, cost: c });
      }
    }
    for (let d = i; d < nextI; d += 1) {
      const v = valueAt(d); eqCurve.push({ date: dates[d], eq: v });
      deployedSum += (v - cash) / v; deployedN += 1;
    }
  }
  return { trades, eqCurve, blockedByPrice, targetSlots, maxNotional,
    utilisation: deployedN ? (deployedSum / deployedN) * 100 : 0 };
}

function analyse(res, capital, from, to) {
  const seg = res.eqCurve.filter((e) => e.date >= from && e.date <= to);
  if (seg.length < 30) return null;
  const startEq = seg[0].eq, endEq = seg[seg.length - 1].eq;
  const yrs = (new Date(seg[seg.length - 1].date) - new Date(seg[0].date)) / (365.25 * 86400000);
  let peak = -Infinity, ddPct = 0, ddRs = 0;
  for (const e of seg) { peak = Math.max(peak, e.eq); const d = e.eq - peak; if (d / peak < ddPct) { ddPct = d / peak; ddRs = d; } }
  const tr = res.trades.filter((t) => t.date >= from && t.date <= to);
  const costs = tr.reduce((a, t) => a + t.cost, 0);
  const net = endEq - startEq;
  const gross = net + costs;
  const byMonth = {};
  for (const e of seg) byMonth[e.date.slice(0, 7)] = e.eq;
  const ms = Object.keys(byMonth).sort();
  const mr = [];
  for (let i = 1; i < ms.length; i += 1) mr.push(byMonth[ms[i]] / byMonth[ms[i - 1]] - 1);
  let streak = 0, worstStreak = 0;
  for (const r of mr) { if (r <= 0) { streak += 1; worstStreak = Math.max(worstStreak, streak); } else streak = 0; }
  return {
    startEq, endEq, gross, costs, net,
    grossPct: (gross / startEq) * 100, netPct: (net / startEq) * 100,
    costOverGross: gross > 0 ? (costs / gross) * 100 : Infinity,
    cagr: (Math.pow(endEq / startEq, 1 / yrs) - 1) * 100,
    ddPct: ddPct * 100, ddRs,
    nTrades: tr.length, tradesPerMonth: tr.length / Math.max(1, ms.length),
    expectancy: tr.length ? net / tr.length : 0,
    posMonths: mr.length ? (100 * mr.filter((r) => r > 0).length) / mr.length : 0,
    worstMonth: mr.length ? Math.min(...mr) * 100 : 0,
    bestMonth: mr.length ? Math.max(...mr) * 100 : 0,
    worstStreak, monthlyReturns: mr,
    utilisation: res.utilisation,
    blocked: res.blockedByPrice, slots: res.targetSlots,
    maxNotional: res.maxNotional,
  };
}

function monteCarlo(monthlyReturns, capital, paths = 5000) {
  if (monthlyReturns.length < 12) return null;
  const finals = [], dds = [];
  for (let p = 0; p < paths; p += 1) {
    let eq = capital, peak = capital, mdd = 0;
    for (let i = 0; i < monthlyReturns.length; i += 1) {
      eq *= 1 + monthlyReturns[Math.floor(Math.random() * monthlyReturns.length)];
      peak = Math.max(peak, eq);
      mdd = Math.min(mdd, (eq - peak) / peak);
    }
    finals.push(eq); dds.push(mdd * 100);
  }
  finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.floor(arr.length * p)];
  return {
    median: q(finals, 0.5), p10: q(finals, 0.10), p5: q(finals, 0.05),
    ddMedian: q(dds, 0.5), ddP5: q(dds, 0.05),
    probBelowStart: (100 * finals.filter((f) => f < capital).length) / finals.length,
    probDD30: (100 * dds.filter((d) => d <= -30).length) / dds.length,
  };
}

async function main() {
  const auth = `token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}`;
  const raw = {};
  for (const [s, t] of Object.entries(UNIVERSE)) {
    try { process.stderr.write(`${s} `); const r = await fetchAll(auth, t); if (r.length > 1500) raw[s] = r; } catch (e) {}
  }
  const nifty = await fetchAll(auth, NIFTY);
  const symbols = Object.keys(raw);
  const dates = nifty.map((r) => r.date.slice(0, 10));
  const px = {};
  for (const s of symbols) {
    const m = new Map(raw[s].map((r) => [r.date.slice(0, 10), r.close]));
    let last = null;
    px[s] = dates.map((d) => { if (m.has(d)) { last = m.get(d); return last; } return last; });
  }
  console.error(`\n${symbols.length} symbols, ${dates.length} sessions.\n`);

  const PRIMARY = { name: 'XS-Mom 6-1, top3, 3mo (frozen)', topN: 3, holdMonths: 3, lookback: 126, skip: 21 };
  const SECONDARY = { name: 'XS-Mom 12-1, top5, 3mo (frozen)', topN: 5, holdMonths: 3, lookback: 252, skip: 21 };
  const CAPITALS = [20000, 25000, 50000, 75000, 100000, 200000, 300000, 500000, 1000000];
  const TEST_FROM = addDays(VALID_TO, 1);

  // Nifty benchmark on the out-of-sample window
  const nSeg = dates.map((d, i) => ({ d, c: nifty[i].close })).filter((x) => x.d >= TEST_FROM);
  const nYrs = (new Date(nSeg[nSeg.length - 1].d) - new Date(nSeg[0].d)) / (365.25 * 86400000);
  const nCagr = (Math.pow(nSeg[nSeg.length - 1].c / nSeg[0].c, 1 / nYrs) - 1) * 100;
  let np = -Infinity, ndd = 0;
  for (const s of nSeg) { np = Math.max(np, s.c); ndd = Math.min(ndd, (s.c - np) / np); }
  const nDD = ndd * 100;

  for (const cfg of [PRIMARY, SECONDARY]) {
    console.log(`\n${'='.repeat(140)}`);
    console.log(`${cfg.name}   ·   OUT-OF-SAMPLE WINDOW ${TEST_FROM} → ${TO}   ·   slippage 0.10%/leg, costs 1.0x`);
    console.log(`BENCHMARK Nifty 50: CAGR ${nCagr.toFixed(1)}%, MaxDD ${nDD.toFixed(1)}%, Return/DD ${(nCagr / Math.abs(nDD)).toFixed(2)}`);
    console.log('='.repeat(140));
    console.log('Capital     NetRet%   Net₹      Costs₹  Cost/Gross%  MaxDD%    MaxDD₹   Expect₹  Trades  PosMo%   CAGR%  Ret/DD  Util%  Blocked  vs Nifty');
    console.log('-'.repeat(140));
    for (const cap of CAPITALS) {
      const res = run(dates, px, symbols, { ...cfg, slip: 0.001, costMult: 1, tradeFrom: TEST_FROM }, cap);
      const a = analyse(res, cap, TEST_FROM, TO);
      if (!a) { console.log(String(cap).padStart(9), '  (insufficient)'); continue; }
      const retDD = a.cagr / Math.abs(a.ddPct || 1);
      const verdict = a.cagr > nCagr && retDD > (nCagr / Math.abs(nDD)) ? 'BEATS' : a.cagr > nCagr ? 'ret only' : 'LOSES';
      console.log(
        `₹${(cap / 1000).toFixed(0)}k`.padStart(9),
        a.netPct.toFixed(1).padStart(8),
        `₹${a.net.toFixed(0)}`.padStart(10),
        `₹${a.costs.toFixed(0)}`.padStart(9),
        a.costOverGross.toFixed(1).padStart(11),
        a.ddPct.toFixed(1).padStart(8),
        `₹${Math.abs(a.ddRs).toFixed(0)}`.padStart(10),
        `₹${a.expectancy.toFixed(0)}`.padStart(8),
        String(a.nTrades).padStart(6),
        a.posMonths.toFixed(0).padStart(6),
        a.cagr.toFixed(1).padStart(8),
        retDD.toFixed(2).padStart(7),
        a.utilisation.toFixed(0).padStart(6),
        `${a.blocked}/${a.slots}`.padStart(8),
        verdict.padStart(9),
      );
    }
  }

  // ---- cost-multiplier fragility on the primary, at three capital levels ----
  console.log(`\n${'='.repeat(100)}`);
  console.log('COST FRAGILITY — primary strategy, out-of-sample window (CAGR %)');
  console.log('='.repeat(100));
  console.log('Capital      1.0x costs   1.5x costs   2.0x costs   |  slip 0.10%  slip 0.20%  slip 0.30%');
  console.log('-'.repeat(100));
  for (const cap of [20000, 100000, 500000, 1000000]) {
    const row = [];
    for (const mult of [1, 1.5, 2]) {
      const a = analyse(run(dates, px, symbols, { ...PRIMARY, slip: 0.001, costMult: mult, tradeFrom: TEST_FROM }, cap), cap, TEST_FROM, TO);
      row.push(a ? a.cagr.toFixed(1) : 'n/a');
    }
    const srow = [];
    for (const sl of [0.001, 0.002, 0.003]) {
      const a = analyse(run(dates, px, symbols, { ...PRIMARY, slip: sl, costMult: 1, tradeFrom: TEST_FROM }, cap), cap, TEST_FROM, TO);
      srow.push(a ? a.cagr.toFixed(1) : 'n/a');
    }
    console.log(`₹${(cap / 1000).toFixed(0)}k`.padStart(9), row.map((r) => `${r}%`.padStart(12)).join(''), '  |', srow.map((r) => `${r}%`.padStart(11)).join(''));
  }

  // ---- Monte Carlo ----
  console.log(`\n${'='.repeat(112)}`);
  console.log('MONTE CARLO — 5,000 randomised trade-order paths, out-of-sample monthly returns (NOT a guarantee)');
  console.log('='.repeat(112));
  console.log('Capital      Median₹      P10₹        P5₹     MedianDD%   P5 DD%   P(end<start)  P(DD>30%)');
  console.log('-'.repeat(112));
  for (const cap of [20000, 100000, 500000, 1000000]) {
    const a = analyse(run(dates, px, symbols, { ...PRIMARY, slip: 0.001, costMult: 1, tradeFrom: TEST_FROM }, cap), cap, TEST_FROM, TO);
    if (!a) continue;
    const mc = monteCarlo(a.monthlyReturns, cap);
    if (!mc) continue;
    console.log(
      `₹${(cap / 1000).toFixed(0)}k`.padStart(9),
      `₹${mc.median.toFixed(0)}`.padStart(12), `₹${mc.p10.toFixed(0)}`.padStart(11), `₹${mc.p5.toFixed(0)}`.padStart(11),
      mc.ddMedian.toFixed(1).padStart(10), mc.ddP5.toFixed(1).padStart(9),
      `${mc.probBelowStart.toFixed(1)}%`.padStart(13), `${mc.probDD30.toFixed(1)}%`.padStart(11),
    );
  }
}

main().catch((e) => { console.error('ERR:', e.message, e.stack); process.exit(1); });
