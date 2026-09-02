#!/usr/bin/env node
/**
 * REVERSAL SUBGROUP ANALYSIS — when is short-term reversal strongest?
 *
 * The anomaly definition is UNCHANGED: candidates are the bottom quintile of
 * trailing 20-day return, measured at the previous close, entered next open.
 * Nothing about that is re-optimised. We only PARTITION those same candidates
 * by characteristics known at selection time, and ask where the effect lives.
 *
 * UNIVERSE: 57 names = 45 currently-liquid large caps PLUS 12 "fallen angels"
 * (Yes Bank, Vodafone Idea, Zee, Suzlon, Reliance Power, RBL, Indus Towers,
 * Bandhan, PNB, IDFC First, Vedanta, GMR). The clean 45-name universe is known
 * to be survivorship-biased — it inflated the loser leg's edge by roughly 2/3 —
 * so ALL results here use the stressed universe as the honest baseline.
 * LIMITATION: truly delisted names (DHFL, Jet, IL&FS, RCom) cannot be fetched
 * from a live broker API at all, so even this remains optimistic.
 *
 * DECLARED HYPOTHESES (economically motivated, not a grid search):
 *   H1 long-term trend   — above vs below SMA200. Separates liquidity
 *                          overshoot (temporary) from structural repricing
 *                          (permanent). The falling-knife filter.
 *   H2 decline magnitude — deepest decile vs rest of the quintile.
 *   H3 volume            — elevated vs normal volume during the decline.
 *                          High volume suggests information, not liquidity.
 *   H4 stock volatility  — high vs low ATR%. Reversal profits classically
 *                          concentrate in volatile (costly) names.
 *   H5 market regime     — Nifty above vs below its SMA200.
 *   H6 decline shape     — many consecutive down days vs few.
 *   H7 gap               — gap-down entry vs no gap.
 *   H8 drawdown depth    — >30% below 52-week high vs nearer the high.
 * 8 hypotheses x 2 sides x 7 horizons = 112 tests. Bonferroni applied.
 *
 * Usage: node scripts/reversal-subgroups.js
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
  // fallen angels — included so "buy the loser" faces real falling knives
  YESBANK: 3050241, IDEA: 3677697, ZEEL: 975873, SUZLON: 3076609,
  RPOWER: 3906305, PNB: 2730497, IDFCFIRSTB: 2863105, VEDL: 784129,
  RBLBANK: 4708097, INDUSTOWER: 7458561, BANDHANBNK: 579329, GMRAIRPORT: 3463169,
};
const NIFTY = 256265;
const FROM = '2013-06-03';
const DEV_TO = '2019-12-31';
const VALID_TO = '2022-12-31';
const TO = '2026-08-21';
const LOOKBACK = 20;
const HORIZONS = [1, 2, 3, 5, 10, 20, 30];

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
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sdev = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const tstat = (a) => (a.length > 2 && sdev(a) > 0 ? mean(a) / (sdev(a) / Math.sqrt(a.length)) : 0);
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * p)] ?? 0; };
function pFromT(t) {
  const z = Math.abs(t);
  const b = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
  const c = 0.39894228 * Math.exp(-z * z / 2), tt = 1 / (1 + 0.2316419 * z);
  return 2 * c * tt * (b[0] + tt * (b[1] + tt * (b[2] + tt * (b[3] + tt * b[4]))));
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
  const C = {}, H = {}, L = {}, V = {};
  for (const s of symbols) {
    const m = new Map(raw[s].map((r) => [r.date.slice(0, 10), r]));
    let last = null;
    C[s] = []; H[s] = []; L[s] = []; V[s] = [];
    for (const d of dates) {
      if (m.has(d)) last = m.get(d);
      C[s].push(last ? last.close : null); H[s].push(last ? last.high : null);
      L[s].push(last ? last.low : null); V[s].push(last && m.has(d) ? last.volume : 0);
    }
  }
  console.error(`\n${symbols.length} symbols (incl. fallen angels), ${T} sessions.\n`);

  // features
  const F = {};
  for (const s of symbols) {
    const c = C[s];
    const f = { sma200: [], atrPct: [], volRatio: [], dnStreak: [], hi252: [], gap: [] };
    let dn = 0;
    for (let i = 0; i < T; i += 1) {
      let sm = null;
      if (i >= 199) { let x = 0, ok = true; for (let k = i - 199; k <= i; k += 1) { if (c[k] == null) { ok = false; break; } x += c[k]; } sm = ok ? x / 200 : null; }
      f.sma200.push(sm);
      let atr = null;
      if (i >= 14) { let x = 0, ok = true; for (let k = i - 13; k <= i; k += 1) { if (H[s][k] == null || c[k - 1] == null) { ok = false; break; } x += Math.max(H[s][k] - L[s][k], Math.abs(H[s][k] - c[k - 1]), Math.abs(L[s][k] - c[k - 1])); } atr = ok ? x / 14 : null; }
      f.atrPct.push(atr != null && c[i] > 0 ? atr / c[i] : null);
      let va = null;
      if (i >= 20) { let x = 0; for (let k = i - 19; k <= i; k += 1) x += V[s][k]; va = x / 20; }
      f.volRatio.push(va > 0 ? V[s][i] / va : null);
      const r1 = i > 0 && c[i - 1] > 0 && c[i] != null ? c[i] / c[i - 1] - 1 : null;
      if (r1 != null) { if (r1 < 0) dn += 1; else dn = 0; }
      f.dnStreak.push(dn);
      let hh = null;
      if (i >= 252) { let x = -Infinity, ok = true; for (let k = i - 251; k <= i; k += 1) { if (c[k] == null) { ok = false; break; } x = Math.max(x, c[k]); } hh = ok ? x : null; }
      f.hi252.push(hh);
      f.gap.push(r1 != null ? r1 < -0.02 : null);
    }
    F[s] = f;
  }

  const winOf = (d) => (d <= DEV_TO ? 'DEV' : d <= VALID_TO ? 'VALID' : 'TEST');
  const fwd = (s, i, h) => {
    if (i + h >= T) return null;
    const a = C[s][i], b = C[s][i + h];
    if (a == null || b == null || !(a > 0)) return null;
    return (b / a - 1) - (nClose[i + h] / nClose[i] - 1);
  };
  // Nifty SMA200 for market regime
  const nSma = [];
  for (let i = 0; i < T; i += 1) { if (i < 199) { nSma.push(null); continue; } let x = 0; for (let k = i - 199; k <= i; k += 1) x += nClose[k]; nSma.push(x / 200); }

  const HYP = {
    'H1 above SMA200':   (s, i) => (F[s].sma200[i] != null && C[s][i] != null) ? C[s][i] > F[s].sma200[i] : null,
    'H2 deepest decline':(s, i, rank, n) => rank < n * 0.25,
    'H3 high volume':    (s, i) => F[s].volRatio[i] != null ? F[s].volRatio[i] > 1.5 : null,
    'H4 high volatility':(s, i) => F[s].atrPct[i] != null ? F[s].atrPct[i] > 0.025 : null,
    'H5 Nifty uptrend':  (s, i) => nSma[i] != null ? nClose[i] > nSma[i] : null,
    'H6 3+ down days':   (s, i) => F[s].dnStreak[i] >= 3,
    'H7 gap down >2%':   (s, i) => F[s].gap[i],
    'H8 >30% below 52wH':(s, i) => (F[s].hi252[i] != null && C[s][i] != null) ? C[s][i] < F[s].hi252[i] * 0.70 : null,
  };
  const hypNames = Object.keys(HYP);
  const nHyp = hypNames.length * 2 * HORIZONS.length;
  const bonf = 0.05 / nHyp;

  // accumulate daily cross-sectional means per subgroup
  const acc = {};
  const key = (h, side, hor) => `${h}|${side}|${hor}`;
  for (const hn of hypNames) for (const side of ['YES', 'NO']) for (const hor of HORIZONS)
    acc[key(hn, side, hor)] = { DEV: [], VALID: [], TEST: [] };
  const allCand = { DEV: {}, VALID: {}, TEST: {} };
  for (const w of ['DEV', 'VALID', 'TEST']) for (const hor of HORIZONS) allCand[w][hor] = [];

  for (let i = LOOKBACK + 1; i < T; i += 1) {
    const w = winOf(dates[i]);
    const scored = [];
    for (const s of symbols) {
      const a = C[s][i - LOOKBACK], b = C[s][i];
      if (a == null || b == null || !(a > 0)) continue;
      scored.push({ s, r: b / a - 1 });
    }
    if (scored.length < 25) continue;
    scored.sort((x, y) => x.r - y.r);           // ascending: worst first
    const k = Math.max(5, Math.floor(scored.length / 5));
    const cands = scored.slice(0, k);            // bottom quintile = reversal candidates
    for (const hor of HORIZONS) {
      const all = [];
      for (const c of cands) { const e = fwd(c.s, i, hor); if (e != null) all.push(e); }
      if (all.length) allCand[w][hor].push(mean(all));
    }
    for (const hn of hypNames) {
      for (const hor of HORIZONS) {
        const yes = [], no = [];
        cands.forEach((c, rank) => {
          let v = null;
          try { v = HYP[hn](c.s, i, rank, cands.length); } catch (e) { v = null; }
          if (v == null) return;
          const e = fwd(c.s, i, hor);
          if (e == null) return;
          (v ? yes : no).push(e);
        });
        if (yes.length) acc[key(hn, 'YES', hor)][w].push(mean(yes));
        if (no.length) acc[key(hn, 'NO', hor)][w].push(mean(no));
      }
    }
  }

  console.log('='.repeat(132));
  console.log('REVERSAL SUBGROUPS — bottom-quintile 20d losers, partitioned. Market-adjusted forward excess %, date-clustered.');
  console.log(`Universe ${symbols.length} (incl. 12 fallen angels) · HYPOTHESES: ${nHyp} · Bonferroni p<${bonf.toExponential(2)}`);
  console.log('='.repeat(132));
  console.log('\nBASELINE — all reversal candidates, no partition:');
  console.log('Hor      DEV%      t      VALID%      t       TEST%      t');
  console.log('-'.repeat(132));
  for (const hor of HORIZONS) {
    const d = allCand.DEV[hor], v = allCand.VALID[hor], t = allCand.TEST[hor];
    console.log(String(hor).padStart(3),
      (mean(d) * 100).toFixed(3).padStart(9), tstat(d).toFixed(2).padStart(7),
      (mean(v) * 100).toFixed(3).padStart(11), tstat(v).toFixed(2).padStart(7),
      (mean(t) * 100).toFixed(3).padStart(11), tstat(t).toFixed(2).padStart(7));
  }

  console.log('\n\nSUBGROUP RESULTS ON DEVELOPMENT DATA (discovery happens here only)');
  console.log('-'.repeat(132));
  console.log('Hypothesis            Hor      YES%     t(YES)       NO%      t(NO)     YES-NO%   t(diff)   nDays   Bonf(YES)');
  console.log('-'.repeat(132));
  const rows = [];
  for (const hn of hypNames) {
    for (const hor of HORIZONS) {
      const y = acc[key(hn, 'YES', hor)].DEV, n = acc[key(hn, 'NO', hor)].DEV;
      if (y.length < 100 || n.length < 100) continue;
      const L2 = Math.min(y.length, n.length);
      const diff = []; for (let i = 0; i < L2; i += 1) diff.push(y[i] - n[i]);
      const ty = tstat(y), td = tstat(diff);
      rows.push({ hn, hor, my: mean(y) * 100, ty, mn: mean(n) * 100, tn: tstat(n), md: mean(diff) * 100, td, days: y.length, py: pFromT(ty) });
    }
  }
  rows.sort((a, b) => b.my - a.my);
  for (const r of rows.slice(0, 22)) {
    console.log(r.hn.padEnd(21), String(r.hor).padStart(3),
      r.my.toFixed(3).padStart(9), r.ty.toFixed(2).padStart(10),
      r.mn.toFixed(3).padStart(10), r.tn.toFixed(2).padStart(10),
      r.md.toFixed(3).padStart(11), r.td.toFixed(2).padStart(9),
      String(r.days).padStart(7), (r.py < bonf ? '   PASS' : '   fail').padStart(11));
  }

  // FREEZE: strongest YES subgroup on DEV that passes Bonferroni, then OOS
  const frozen = rows.filter((r) => r.py < bonf && r.my > 0).sort((a, b) => b.my - a.my).slice(0, 8);
  console.log(`\n\nFROZEN ON DEV (${frozen.length} subgroups, Bonferroni-passing, positive) → measured untouched OOS`);
  console.log('-'.repeat(132));
  console.log('Hypothesis            Hor     DEV%      VALID%     t(V)      TEST%      t(T)    sign held?   OOS mean%');
  console.log('-'.repeat(132));
  for (const r of frozen) {
    const v = acc[key(r.hn, 'YES', r.hor)].VALID, t = acc[key(r.hn, 'YES', r.hor)].TEST;
    if (v.length < 30 || t.length < 30) continue;
    const mv = mean(v) * 100, mt = mean(t) * 100;
    const held = mv > 0 && mt > 0;
    console.log(r.hn.padEnd(21), String(r.hor).padStart(3),
      r.my.toFixed(3).padStart(9), mv.toFixed(3).padStart(11), tstat(v).toFixed(2).padStart(8),
      mt.toFixed(3).padStart(11), tstat(t).toFixed(2).padStart(8),
      (held ? '     YES' : '      no').padStart(12), ((mv + mt) / 2).toFixed(3).padStart(12));
  }

  console.log('\n\nDISTRIBUTION + COST TEST for frozen subgroups (DEV daily means, %)');
  console.log('-'.repeat(132));
  console.log('Hypothesis            Hor     mean   median      p5      p25      p75      p95   win%   |  net of 0.55% cost');
  console.log('-'.repeat(132));
  for (const r of frozen) {
    const a = acc[key(r.hn, 'YES', r.hor)].DEV.map((x) => x * 100);
    const v = acc[key(r.hn, 'YES', r.hor)].VALID, t = acc[key(r.hn, 'YES', r.hor)].TEST;
    const oos = ((mean(v) + mean(t)) / 2) * 100;
    console.log(r.hn.padEnd(21), String(r.hor).padStart(3),
      mean(a).toFixed(3).padStart(8), pctl(a, 0.5).toFixed(3).padStart(8),
      pctl(a, 0.05).toFixed(3).padStart(8), pctl(a, 0.25).toFixed(3).padStart(8),
      pctl(a, 0.75).toFixed(3).padStart(8), pctl(a, 0.95).toFixed(3).padStart(8),
      ((100 * a.filter((x) => x > 0).length) / a.length).toFixed(0).padStart(6),
      '  |', `${(oos - 0.55).toFixed(3)}%`.padStart(10), (oos - 0.55 > 0 ? ' TRADEABLE' : ' consumed'));
  }
}

main().catch((e) => { console.error('ERR:', e.message, e.stack); process.exit(1); });
