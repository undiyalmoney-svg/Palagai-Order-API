#!/usr/bin/env node
/**
 * FINAL VALIDATION — "-10% single-day drop -> 2-day bounce"
 *
 * FROZEN. No optimisation of threshold, horizon, universe, sizing, filters or
 * stops. The primary spec is fixed before running:
 *   SIGNAL : close <= -10% vs previous close (computable at that close)
 *   ENTRY  : NEXT session's OPEN  (NOT the signal close — this is stricter
 *            than the original discovery, which measured from signal close and
 *            therefore captured any overnight bounce for free)
 *   EXIT   : close of (entry day + 2 sessions)
 *   Diagnostic horizons 1/3/5/10/20 reported but NOT selectable.
 *
 * DESIGNED TO FALSIFY. Every section below is an attack:
 *   - corporate-action screen (a "-10% day" may be a split, not a crash)
 *   - tail-dependence (strip top 1/5/10/20% winners)
 *   - regime split (crisis vs calm)
 *   - stock and sector concentration + leave-one-out
 *   - placebo thresholds (-5%, -7%) and random matched days
 *   - bootstrap CI, not just a t-stat
 *   - realistic per-component costs at each position size
 *
 * HONESTY FLAGS BAKED IN:
 *   - TEST window is NOT BLIND (examined during discovery). Reported as such.
 *   - Universe is survivorship-limited: delisted names (DHFL, Jet, IL&FS,
 *     RCom) cannot be fetched from a live broker API. 12 "fallen angels" that
 *     survived are included, which helps but does not fix it.
 *   - Selected after ~417 prior hypotheses -> winner's curse applies.
 *
 * Usage: node scripts/final-validation.js
 */
const { fetchHistoricalCandles } = require('../live/kite-market');

const SECTOR = {
  HDFCBANK: 'Financials', ICICIBANK: 'Financials', SBIN: 'Financials', KOTAKBANK: 'Financials',
  AXISBANK: 'Financials', INDUSINDBK: 'Financials', BANKBARODA: 'Financials', PNB: 'Financials',
  IDFCFIRSTB: 'Financials', RBLBANK: 'Financials', BANDHANBNK: 'Financials', YESBANK: 'Financials',
  BAJFINANCE: 'Financials',
  TCS: 'IT', INFY: 'IT', WIPRO: 'IT', HCLTECH: 'IT', TECHM: 'IT',
  RELIANCE: 'Energy', IOC: 'Energy', BPCL: 'Energy', ONGC: 'Energy', RPOWER: 'Energy',
  NTPC: 'Utilities', POWERGRID: 'Utilities', SUZLON: 'Utilities',
  TATASTEEL: 'Metals', JSWSTEEL: 'Metals', HINDALCO: 'Metals', VEDL: 'Metals',
  MARUTI: 'Auto', M_M: 'Auto', BAJAJ_AUTO: 'Auto', HEROMOTOCO: 'Auto',
  ITC: 'FMCG', HINDUNILVR: 'FMCG', BRITANNIA: 'FMCG', DABUR: 'FMCG', MARICO: 'FMCG', NESTLEIND: 'FMCG',
  ULTRACEMCO: 'Cement', SHREECEM: 'Cement', AMBUJACEM: 'Cement',
  SUNPHARMA: 'Pharma', CIPLA: 'Pharma', DRREDDY: 'Pharma', LUPIN: 'Pharma', AUROPHARMA: 'Pharma',
  LT: 'Industrials', ADANIPORTS: 'Industrials', GMRAIRPORT: 'Industrials',
  TITAN: 'Consumer', ASIANPAINT: 'Consumer', ZEEL: 'Media',
  BHARTIARTL: 'Telecom', IDEA: 'Telecom', INDUSTOWER: 'Telecom',
};
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
  YESBANK: 3050241, IDEA: 3677697, ZEEL: 975873, SUZLON: 3076609,
  RPOWER: 3906305, PNB: 2730497, IDFCFIRSTB: 2863105, VEDL: 784129,
  RBLBANK: 4708097, INDUSTOWER: 7458561, BANDHANBNK: 579329, GMRAIRPORT: 3463169,
};
const NIFTY = 256265;
const FROM = '2013-06-03';
const DEV_TO = '2019-12-31';
const VALID_TO = '2022-12-31';
const TO = '2026-08-21';
const THRESHOLD = -10;   // FROZEN
const PRIMARY_HOLD = 2;  // FROZEN
const DIAG = [1, 2, 3, 5, 10, 20];
const DP_RS = 15 * 1.18;

/** Per-component Zerodha CNC delivery cost for one round trip. */
function costRs(buyPx, sellPx, qty) {
  const bt = buyPx * qty, st = sellPx * qty;
  const stt = (bt + st) * 0.001;
  const exch = (bt + st) * 0.0000297;
  const sebi = (bt + st) * 0.000001;
  const stamp = bt * 0.00015;
  const gst = (exch + sebi) * 0.18;
  return { stt, exch, sebi, stamp, gst, dp: DP_RS, total: stt + exch + sebi + stamp + gst + DP_RS };
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
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const med = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const sdev = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a) => (a.length > 2 && sdev(a) > 0 ? mean(a) / (sdev(a) / Math.sqrt(a.length)) : 0);
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.min(s.length - 1, Math.floor(s.length * p)))] ?? 0; };
function skew(a) { const m = mean(a), s = sdev(a); return s > 0 ? mean(a.map((x) => ((x - m) / s) ** 3)) : 0; }
function bootstrapCI(a, iters = 10000) {
  const ms = [];
  for (let i = 0; i < iters; i += 1) {
    let s = 0;
    for (let k = 0; k < a.length; k += 1) s += a[Math.floor(Math.random() * a.length)];
    ms.push(s / a.length);
  }
  ms.sort((x, y) => x - y);
  return [ms[Math.floor(iters * 0.025)], ms[Math.floor(iters * 0.975)]];
}

async function main() {
  const auth = `token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}`;
  const raw = {};
  for (const [s, t] of Object.entries(UNIVERSE)) {
    try { process.stderr.write(`${s} `); const r = await fetchAll(auth, t); if (r.length > 1200) raw[s] = r; } catch (e) {}
  }
  const nifty = await fetchAll(auth, NIFTY);
  const symbols = Object.keys(raw);
  const dates = nifty.map((r) => r.date.slice(0, 10));
  const nClose = nifty.map((r) => r.close);
  const T = dates.length;
  const idxOf = new Map(dates.map((d, i) => [d, i]));

  // aligned OHLC (forward-filled close; open/high/low only on real trading days)
  const O = {}, C = {}, HI = {}, LO = {}, real = {};
  for (const s of symbols) {
    const m = new Map(raw[s].map((r) => [r.date.slice(0, 10), r]));
    let last = null;
    O[s] = []; C[s] = []; HI[s] = []; LO[s] = []; real[s] = [];
    for (const d of dates) {
      const has = m.has(d);
      if (has) last = m.get(d);
      real[s].push(has);
      O[s].push(has ? last.open : null);
      C[s].push(last ? last.close : null);
      HI[s].push(has ? last.high : null);
      LO[s].push(has ? last.low : null);
    }
  }
  console.error(`\n${symbols.length} symbols, ${T} sessions.\n`);

  // ---------- EVENT DETECTION + CORPORATE ACTION SCREEN ----------
  const events = [];
  let caFlagged = 0;
  for (const s of symbols) {
    for (let i = 1; i < T - PRIMARY_HOLD - 1; i += 1) {
      if (!real[s][i] || !real[s][i - 1]) continue;
      const prev = C[s][i - 1], cl = C[s][i];
      if (prev == null || cl == null || !(prev > 0)) continue;
      const drop = (cl / prev - 1) * 100;
      if (drop > THRESHOLD) continue;
      // Corporate-action screen: a genuine crash still trades within a plausible
      // intraday range. A split/bonus prints a price near an exact ratio of the
      // prior close AND the whole day's range sits below it.
      const ratio = cl / prev;
      const nearSplit = [0.5, 1 / 3, 0.25, 0.2, 0.1, 2 / 3, 0.75].some((r) => Math.abs(ratio - r) < 0.02);
      const rangeBelow = HI[s][i] != null && HI[s][i] < prev * 0.95;
      if (nearSplit && rangeBelow) { caFlagged += 1; continue; }
      // entry next session open
      let j = i + 1;
      while (j < T && !real[s][j]) j += 1;
      if (j >= T || O[s][j] == null) continue;
      const entry = O[s][j];
      const fwd = {};
      for (const h of DIAG) {
        let k = j, steps = 0;
        while (k < T - 1 && steps < h) { k += 1; if (real[s][k]) steps += 1; }
        fwd[h] = (steps === h && C[s][k] != null) ? (C[s][k] / entry - 1) * 100 : null;
      }
      // MAE over the primary hold
      let mae = 0;
      { let k = j, steps = 0;
        while (k < T && steps < PRIMARY_HOLD) { if (real[s][k] && LO[s][k] != null) mae = Math.min(mae, (LO[s][k] / entry - 1) * 100); k += 1; if (k < T && real[s][k]) steps += 1; } }
      const w = dates[i] <= DEV_TO ? 'DEV' : dates[i] <= VALID_TO ? 'VALID' : 'TEST';
      events.push({ sym: s, sector: SECTOR[s] || 'Other', date: dates[i], entryDate: dates[j], win: w,
        drop, entry, fwd, mae, i, j, year: dates[i].slice(0, 4) });
    }
  }
  const P = events.map((e) => e.fwd[PRIMARY_HOLD]).filter((x) => x != null);
  console.log('='.repeat(120));
  console.log('FINAL VALIDATION — "-10% single-day drop -> buy next open -> exit +2 sessions" (FROZEN)');
  console.log('='.repeat(120));
  console.log(`Universe ${symbols.length} (incl. 12 fallen angels; DELISTED NAMES ABSENT — survivorship-limited)`);
  console.log(`Period ${dates[0]}..${dates[T - 1]}  ·  events ${events.length}  ·  corporate-action screened out ${caFlagged}`);
  console.log(`Unique stocks firing: ${new Set(events.map((e) => e.sym)).size}  ·  events/yr ${(events.length / 13.2).toFixed(1)}`);

  // ---------- PRIMARY RESULT ----------
  console.log('\n--- 1. PRIMARY (2-session hold, gross, entry at next open) ---');
  const ci = bootstrapCI(P);
  console.log(`  n=${P.length}  mean ${mean(P).toFixed(3)}%  median ${med(P).toFixed(3)}%  t=${tstat(P).toFixed(2)}`);
  console.log(`  bootstrap 95% CI [${ci[0].toFixed(3)}%, ${ci[1].toFixed(3)}%]   skew ${skew(P).toFixed(2)}`);
  const wins = P.filter((x) => x > 0);
  console.log(`  win rate ${(100 * wins.length / P.length).toFixed(1)}%  avgWin ${mean(wins).toFixed(2)}%  avgLoss ${mean(P.filter((x) => x <= 0)).toFixed(2)}%`);
  console.log(`  p5 ${pctl(P, 0.05).toFixed(2)}  p25 ${pctl(P, 0.25).toFixed(2)}  p75 ${pctl(P, 0.75).toFixed(2)}  p95 ${pctl(P, 0.95).toFixed(2)}  worst ${Math.min(...P).toFixed(2)}  best ${Math.max(...P).toFixed(2)}`);
  const cvar = mean([...P].sort((a, b) => a - b).slice(0, Math.floor(P.length * 0.05)));
  console.log(`  CVaR(5%) ${cvar.toFixed(2)}%   mean MAE ${mean(events.map((e) => e.mae)).toFixed(2)}%   worst MAE ${Math.min(...events.map((e) => e.mae)).toFixed(2)}%`);

  console.log('\n--- 2. DIAGNOSTIC HORIZONS (not selectable) ---');
  for (const h of DIAG) {
    const a = events.map((e) => e.fwd[h]).filter((x) => x != null);
    console.log(`  ${String(h).padStart(2)}d  n=${String(a.length).padStart(4)}  mean ${mean(a).toFixed(3).padStart(7)}%  median ${med(a).toFixed(3).padStart(7)}%  t=${tstat(a).toFixed(2).padStart(6)}  win% ${(100 * a.filter((x) => x > 0).length / a.length).toFixed(0)}`);
  }

  console.log('\n--- 3. BY WINDOW (TEST IS NOT BLIND — examined during discovery) ---');
  for (const w of ['DEV', 'VALID', 'TEST']) {
    const a = events.filter((e) => e.win === w).map((e) => e.fwd[PRIMARY_HOLD]).filter((x) => x != null);
    if (a.length < 5) continue;
    const c = bootstrapCI(a, 4000);
    console.log(`  ${w.padEnd(6)} n=${String(a.length).padStart(4)}  mean ${mean(a).toFixed(3).padStart(7)}%  median ${med(a).toFixed(3).padStart(7)}%  t=${tstat(a).toFixed(2).padStart(6)}  CI[${c[0].toFixed(2)}, ${c[1].toFixed(2)}]  win% ${(100 * a.filter((x) => x > 0).length / a.length).toFixed(0)}`);
  }

  console.log('\n--- 4. TAIL DEPENDENCE (strip largest winners) ---');
  const sorted = [...P].sort((a, b) => b - a);
  for (const frac of [0.01, 0.05, 0.10, 0.20]) {
    const cut = Math.max(1, Math.floor(P.length * frac));
    const rest = sorted.slice(cut);
    console.log(`  drop top ${(frac * 100).toFixed(0).padStart(2)}% (${cut} trades): mean ${mean(rest).toFixed(3)}%  median ${med(rest).toFixed(3)}%  t=${tstat(rest).toFixed(2)}`);
  }
  const top5share = sorted.slice(0, Math.floor(P.length * 0.05)).reduce((a, b) => a + b, 0) / P.reduce((a, b) => a + b, 0);
  console.log(`  top 5% of events contribute ${(top5share * 100).toFixed(0)}% of total gross P&L`);

  console.log('\n--- 5. REGIME / CLUSTERING ---');
  const byYear = {};
  for (const e of events) { (byYear[e.year] ||= []).push(e.fwd[PRIMARY_HOLD]); }
  for (const y of Object.keys(byYear).sort()) {
    const a = byYear[y].filter((x) => x != null);
    if (!a.length) continue;
    console.log(`  ${y}  n=${String(a.length).padStart(4)}  mean ${mean(a).toFixed(3).padStart(7)}%  median ${med(a).toFixed(3).padStart(7)}%  win% ${(100 * a.filter((x) => x > 0).length / a.length).toFixed(0)}`);
  }
  // Nifty regime at signal time
  const nSma = [];
  for (let i = 0; i < T; i += 1) { if (i < 199) { nSma.push(null); continue; } let x = 0; for (let k = i - 199; k <= i; k += 1) x += nClose[k]; nSma.push(x / 200); }
  for (const [lbl, fn] of [['Nifty>SMA200', (e) => nSma[e.i] != null && nClose[e.i] > nSma[e.i]], ['Nifty<SMA200', (e) => nSma[e.i] != null && nClose[e.i] < nSma[e.i]]]) {
    const a = events.filter(fn).map((e) => e.fwd[PRIMARY_HOLD]).filter((x) => x != null);
    if (a.length < 5) continue;
    console.log(`  ${lbl.padEnd(14)} n=${String(a.length).padStart(4)}  mean ${mean(a).toFixed(3)}%  median ${med(a).toFixed(3)}%  win% ${(100 * a.filter((x) => x > 0).length / a.length).toFixed(0)}`);
  }

  console.log('\n--- 6. STOCK CONCENTRATION (leave-one-out) ---');
  const byStock = {};
  for (const e of events) { const v = e.fwd[PRIMARY_HOLD]; if (v != null) (byStock[e.sym] ||= []).push(v); }
  const contrib = Object.entries(byStock).map(([s, a]) => ({ s, n: a.length, sum: a.reduce((x, y) => x + y, 0), mean: mean(a) }))
    .sort((a, b) => b.sum - a.sum);
  const total = P.reduce((a, b) => a + b, 0);
  console.log(`  unique stocks ${contrib.length}; total gross ${total.toFixed(1)}%`);
  for (const c of contrib.slice(0, 5)) console.log(`    top: ${c.s.padEnd(12)} n=${String(c.n).padStart(3)}  sum ${c.sum.toFixed(1)}%  (${(100 * c.sum / total).toFixed(0)}% of total)  mean ${c.mean.toFixed(2)}%`);
  console.log(`  top1 ${(100 * contrib[0].sum / total).toFixed(0)}%  top5 ${(100 * contrib.slice(0, 5).reduce((a, c) => a + c.sum, 0) / total).toFixed(0)}%  top10 ${(100 * contrib.slice(0, 10).reduce((a, c) => a + c.sum, 0) / total).toFixed(0)}%`);
  let worstLOO = { s: null, m: Infinity };
  for (const c of contrib) {
    const rest = P.length - c.n;
    const m = (total - c.sum) / rest;
    if (m < worstLOO.m) worstLOO = { s: c.s, m };
  }
  console.log(`  worst leave-one-out: removing ${worstLOO.s} -> mean ${worstLOO.m.toFixed(3)}%`);

  console.log('\n--- 7. SECTOR CONCENTRATION ---');
  const bySec = {};
  for (const e of events) { const v = e.fwd[PRIMARY_HOLD]; if (v != null) (bySec[e.sector] ||= []).push(v); }
  for (const [s, a] of Object.entries(bySec).sort((x, y) => y[1].length - x[1].length)) {
    console.log(`  ${s.padEnd(13)} n=${String(a.length).padStart(4)}  mean ${mean(a).toFixed(3).padStart(7)}%  share of gross ${(100 * a.reduce((x, y) => x + y, 0) / total).toFixed(0)}%`);
  }

  console.log('\n--- 8. PLACEBO (same pipeline, weaker thresholds; NOT alternatives to trade) ---');
  for (const th of [-5, -7]) {
    const pl = [];
    for (const s of symbols) {
      for (let i = 1; i < T - PRIMARY_HOLD - 1; i += 1) {
        if (!real[s][i] || !real[s][i - 1]) continue;
        const prev = C[s][i - 1], cl = C[s][i];
        if (prev == null || cl == null || !(prev > 0)) continue;
        const d = (cl / prev - 1) * 100;
        if (d > th || d <= th - 2) continue; // band, so bands are disjoint
        let j = i + 1; while (j < T && !real[s][j]) j += 1;
        if (j >= T || O[s][j] == null) continue;
        let k = j, steps = 0;
        while (k < T - 1 && steps < PRIMARY_HOLD) { k += 1; if (real[s][k]) steps += 1; }
        if (steps === PRIMARY_HOLD && C[s][k] != null) pl.push((C[s][k] / O[s][j] - 1) * 100);
      }
    }
    console.log(`  band ${th}% to ${th - 2}%: n=${pl.length}  mean ${mean(pl).toFixed(3)}%  median ${med(pl).toFixed(3)}%  t=${tstat(pl).toFixed(2)}`);
  }
  // random matched days
  const rnd = [];
  for (let z = 0; z < 3000; z += 1) {
    const s = symbols[Math.floor(Math.random() * symbols.length)];
    const i = 200 + Math.floor(Math.random() * (T - 210));
    if (!real[s][i] || O[s][i + 1] == null) continue;
    let j = i + 1, k = j, steps = 0;
    while (k < T - 1 && steps < PRIMARY_HOLD) { k += 1; if (real[s][k]) steps += 1; }
    if (steps === PRIMARY_HOLD && C[s][k] != null) rnd.push((C[s][k] / O[s][j] - 1) * 100);
  }
  console.log(`  random stock-days:  n=${rnd.length}  mean ${mean(rnd).toFixed(3)}%  median ${med(rnd).toFixed(3)}%  t=${tstat(rnd).toFixed(2)}`);

  console.log('\n--- 9. COSTS (per component, by position size) + NET ---');
  for (const pos of [6667, 10000, 20000, 66667, 200000]) {
    const px = 500, qty = Math.floor(pos / px);
    const c = costRs(px, px * 1.01, qty);
    const pctCost = (c.total / pos) * 100;
    console.log(`  ₹${String(pos).padStart(7)}: STT ₹${c.stt.toFixed(1)} exch ₹${c.exch.toFixed(2)} sebi ₹${c.sebi.toFixed(3)} stamp ₹${c.stamp.toFixed(2)} GST ₹${c.gst.toFixed(2)} DP ₹${c.dp.toFixed(2)} = ₹${c.total.toFixed(1)} (${pctCost.toFixed(3)}%)  net edge ${(mean(P) - pctCost).toFixed(3)}%`);
  }
  console.log('  friction sensitivity on gross mean:');
  for (const f of [0.25, 0.50, 0.75, 1.00]) console.log(`    ${f.toFixed(2)}% round trip -> net ${(mean(P) - f).toFixed(3)}%  ${mean(P) - f > 0 ? '' : '(negative)'}`);

  console.log('\n--- 10. SIMULTANEOUS SIGNALS (₹20,000 concentration) ---');
  const perDay = {};
  for (const e of events) perDay[e.date] = (perDay[e.date] || 0) + 1;
  const counts = Object.values(perDay);
  console.log(`  signal days ${counts.length}  ·  mean ${mean(counts).toFixed(2)}  ·  max ${Math.max(...counts)} on one day`);
  const dist = {};
  for (const c of counts) { const b = c >= 10 ? '10+' : String(c); dist[b] = (dist[b] || 0) + 1; }
  console.log('  days by simultaneous-signal count: ' + Object.entries(dist).sort().map(([k, v]) => `${k}:${v}`).join('  '));
}

main().catch((e) => { console.error('ERR:', e.message, e.stack); process.exit(1); });
