#!/usr/bin/env node
/**
 * LARGE-MOVE RESEARCH — entry node of the decision flowchart.
 *
 * WHY THIS AND NOT ANOTHER SMALL-EDGE HUNT:
 * Every prior finding died on the same arithmetic — gross edge ~0.1-0.7% vs
 * ~0.55% round-trip cost at ₹20,000. The only structural escape is a
 * condition whose expected forward move is SEVERAL percent, so a fixed ~0.55%
 * toll is a minor tax rather than the whole edge. Large single-day and
 * multi-day dislocations are the natural candidate: they are rare (low
 * turnover, which suits the account) and they are followed by large moves in
 * SOME direction. The question is whether that direction is predictable.
 *
 * UNIVERSE: 57 names incl. 12 fallen angels (Yes Bank, Vodafone Idea, Zee,
 * Suzlon, RPower, RBL, Indus Towers, Bandhan, PNB, IDFC First, Vedanta, GMR).
 * Large-drop research is the single most survivorship-sensitive design there
 * is — a -15% day is exactly what a collapsing company prints — so the
 * stressed universe is used throughout, never the clean one.
 * LIMITATION: fully delisted names (DHFL, Jet, IL&FS, RCom) are unfetchable
 * from a live broker API, so even this is optimistic.
 *
 * NO PARAMETER OPTIMISATION: thresholds are round numbers fixed in advance
 * (5/7/10/15%), not searched. Discovery on DEV; VALID/TEST read afterwards.
 *
 * Usage: node scripts/largemove-study.js
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
  YESBANK: 3050241, IDEA: 3677697, ZEEL: 975873, SUZLON: 3076609,
  RPOWER: 3906305, PNB: 2730497, IDFCFIRSTB: 2863105, VEDL: 784129,
  RBLBANK: 4708097, INDUSTOWER: 7458561, BANDHANBNK: 579329, GMRAIRPORT: 3463169,
};
const NIFTY = 256265;
const FROM = '2013-06-03';
const DEV_TO = '2019-12-31';
const VALID_TO = '2022-12-31';
const TO = '2026-08-21';
const HORIZONS = [1, 2, 3, 5, 10, 20, 30];
const COST = 0.55; // % round trip at ₹20,000 (STT+DP+stamp+exch) incl. modest slippage

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
const sdev = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a) => (a.length > 2 && sdev(a) > 0 ? mean(a) / (sdev(a) / Math.sqrt(a.length)) : 0);
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * p)] ?? 0; };

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
  const C = {};
  for (const s of symbols) {
    const m = new Map(raw[s].map((r) => [r.date.slice(0, 10), r.close]));
    let last = null;
    C[s] = dates.map((d) => { if (m.has(d)) last = m.get(d); return last; });
  }
  console.error(`\n${symbols.length} symbols (incl. fallen angels), ${T} sessions.\n`);

  const winOf = (d) => (d <= DEV_TO ? 'DEV' : d <= VALID_TO ? 'VALID' : 'TEST');
  const fwd = (s, i, h) => {
    if (i + h >= T) return null;
    const a = C[s][i], b = C[s][i + h];
    if (a == null || b == null || !(a > 0)) return null;
    return ((b / a - 1) - (nClose[i + h] / nClose[i] - 1)) * 100;
  };

  // Conditions: fixed round thresholds, declared in advance, no search.
  const CONDS = {
    '1d drop <= -5%':   (s, i) => { const r = ret(s, i, 1); return r != null && r <= -5; },
    '1d drop <= -7%':   (s, i) => { const r = ret(s, i, 1); return r != null && r <= -7; },
    '1d drop <= -10%':  (s, i) => { const r = ret(s, i, 1); return r != null && r <= -10; },
    '1d drop <= -15%':  (s, i) => { const r = ret(s, i, 1); return r != null && r <= -15; },
    '1d gain >= +5%':   (s, i) => { const r = ret(s, i, 1); return r != null && r >= 5; },
    '1d gain >= +7%':   (s, i) => { const r = ret(s, i, 1); return r != null && r >= 7; },
    '1d gain >= +10%':  (s, i) => { const r = ret(s, i, 1); return r != null && r >= 10; },
    '5d drop <= -15%':  (s, i) => { const r = ret(s, i, 5); return r != null && r <= -15; },
    '5d drop <= -20%':  (s, i) => { const r = ret(s, i, 5); return r != null && r <= -20; },
    '5d gain >= +15%':  (s, i) => { const r = ret(s, i, 5); return r != null && r >= 15; },
    '5d gain >= +20%':  (s, i) => { const r = ret(s, i, 5); return r != null && r >= 20; },
  };
  function ret(s, i, n) {
    if (i < n) return null;
    const a = C[s][i - n], b = C[s][i];
    return (a != null && b != null && a > 0) ? (b / a - 1) * 100 : null;
  }

  // event-level accumulation (each occurrence is one observation)
  const ev = {};
  for (const cn of Object.keys(CONDS)) { ev[cn] = { DEV: {}, VALID: {}, TEST: {} }; for (const w of ['DEV', 'VALID', 'TEST']) for (const h of HORIZONS) ev[cn][w][h] = []; }
  const base = { DEV: {}, VALID: {}, TEST: {} };
  for (const w of ['DEV', 'VALID', 'TEST']) for (const h of HORIZONS) base[w][h] = [];

  for (let i = 6; i < T; i += 1) {
    const w = winOf(dates[i]);
    for (const s of symbols) {
      for (const h of HORIZONS) { const e = fwd(s, i, h); if (e != null) base[w][h].push(e); }
      for (const [cn, fn] of Object.entries(CONDS)) {
        let hit = false;
        try { hit = fn(s, i); } catch (e) { hit = false; }
        if (!hit) continue;
        for (const h of HORIZONS) { const e = fwd(s, i, h); if (e != null) ev[cn][w][h].push(e); }
      }
    }
  }

  console.log('='.repeat(134));
  console.log('LARGE-MOVE EVENT STUDY — market-adjusted forward excess return (%), event-level');
  console.log(`Universe ${symbols.length} incl. fallen angels · ${dates[0]}..${dates[T - 1]} · cost hurdle ${COST}% round trip`);
  console.log('='.repeat(134));
  console.log('\nBASELINE (all stock-days, control group):');
  let bl = '   ';
  for (const h of HORIZONS) bl += `${h}d ${mean(base.DEV[h]).toFixed(3)}%  `;
  console.log('  DEV  ' + bl);

  for (const cn of Object.keys(CONDS)) {
    const nD = ev[cn].DEV[HORIZONS[0]].length;
    if (nD < 30) { console.log(`\n${cn}: only ${nD} DEV events — INSUFFICIENT EVIDENCE, skipped.`); continue; }
    console.log(`\n${'-'.repeat(134)}`);
    console.log(`${cn}   (DEV events: ${nD}, VALID: ${ev[cn].VALID[HORIZONS[0]].length}, TEST: ${ev[cn].TEST[HORIZONS[0]].length})`);
    console.log('Hor |    DEV%      t   |   VALID%      t   |    TEST%      t   | sign | OOSmean |  net of cost');
    for (const h of HORIZONS) {
      const d = ev[cn].DEV[h], v = ev[cn].VALID[h], t = ev[cn].TEST[h];
      if (d.length < 30 || v.length < 15 || t.length < 15) continue;
      const md = mean(d) - mean(base.DEV[h]);
      const mv = mean(v) - mean(base.VALID[h]);
      const mt = mean(t) - mean(base.TEST[h]);
      const held = Math.sign(md) === Math.sign(mv) && Math.sign(md) === Math.sign(mt);
      const oos = (mv + mt) / 2;
      const net = Math.abs(oos) - COST;
      console.log(
        String(h).padStart(3), '|', md.toFixed(3).padStart(8), tstat(d).toFixed(2).padStart(6), '  |',
        mv.toFixed(3).padStart(8), tstat(v).toFixed(2).padStart(6), '  |',
        mt.toFixed(3).padStart(8), tstat(t).toFixed(2).padStart(6), '  |',
        (held ? ' YES' : '  no').padStart(4), '|', oos.toFixed(3).padStart(7), '|',
        `${net.toFixed(3)}%`.padStart(9), net > 0 && held ? ' CLEARS COST' : '',
      );
    }
    // distribution at the horizon with the largest |DEV| effect
    let bestH = HORIZONS[0], bestAbs = -1;
    for (const h of HORIZONS) { const d = ev[cn].DEV[h]; if (d.length < 30) continue; const m = Math.abs(mean(d) - mean(base.DEV[h])); if (m > bestAbs) { bestAbs = m; bestH = h; } }
    const dd = ev[cn].DEV[bestH];
    console.log(`  dist @${bestH}d: median ${pctl(dd, 0.5).toFixed(2)}  p5 ${pctl(dd, 0.05).toFixed(2)}  p25 ${pctl(dd, 0.25).toFixed(2)}  p75 ${pctl(dd, 0.75).toFixed(2)}  p95 ${pctl(dd, 0.95).toFixed(2)}  win% ${((100 * dd.filter((x) => x > 0).length) / dd.length).toFixed(0)}  worst ${Math.min(...dd).toFixed(1)}`);
  }
}

main().catch((e) => { console.error('ERR:', e.message, e.stack); process.exit(1); });
