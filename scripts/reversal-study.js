#!/usr/bin/env node
/**
 * SHORT-TERM (1-MONTH) REVERSAL — focused study of the effect the scanner found.
 *
 * The scan flagged, with sign stability across DEV/VALID/TEST:
 *   - stocks at new 20d/50d/52w highs UNDERPERFORM subsequently
 *   - the top-quintile 20-day-momentum minus bottom-quintile spread is NEGATIVE
 * Both are the same underlying phenomenon: short-horizon REVERSAL. This is a
 * documented anomaly (Jegadeesh 1990; Lehmann 1990), usually attributed to
 * liquidity provision — short-term winners are bid up by impatient buyers and
 * revert as liquidity providers are compensated.
 *
 * TWO BUGS in the scanner's presentation are corrected here:
 *   1. The L/S series is ALREADY market-neutral (top minus bottom). The
 *      scanner then subtracted the market baseline a second time, overstating
 *      the spread. Here L/S is reported raw.
 *   2. The cost test subtracted 0.50% from a negative spread, which is
 *      meaningless. Direction is handled explicitly: a tradeable edge is
 *      |edge| for the leg actually traded.
 *
 * CRITICAL PRACTICAL CONSTRAINT: Indian retail cannot short cash equity
 * overnight. So the short leg is NOT investable here. Everything hinges on
 * whether the LONG-ONLY loser leg beats the market by more than costs.
 *
 * Usage: node scripts/reversal-study.js
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
const LOOKBACKS = [5, 10, 20, 60];
const HORIZONS = [5, 10, 20, 30];

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
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
function tstat(a) { return a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length)) : 0; }

async function main() {
  const auth = `token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}`;
  const raw = {};
  for (const [s, t] of Object.entries(UNIVERSE)) {
    try { process.stderr.write(`${s} `); const r = await fetchAll(auth, t); if (r.length > 1500) raw[s] = r; } catch (e) {}
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
  console.error(`\n${symbols.length} symbols, ${T} sessions.\n`);

  const winOf = (d) => (d <= DEV_TO ? 'DEV' : d <= VALID_TO ? 'VALID' : 'TEST');
  const WINS = ['DEV', 'VALID', 'TEST'];
  const fwdExcess = (s, i, h) => {
    if (i + h >= T) return null;
    const a = C[s][i], b = C[s][i + h];
    if (a == null || b == null || !(a > 0)) return null;
    return (b / a - 1) - (nClose[i + h] / nClose[i] - 1);
  };

  console.log('='.repeat(120));
  console.log('REVERSAL SURFACE — market-adjusted forward excess return by formation lookback and holding horizon');
  console.log('Quintile portfolios, date-clustered means. LOSERS = bottom quintile by past return.');
  console.log('='.repeat(120));

  for (const LB of LOOKBACKS) {
    console.log(`\n--- Formation: past ${LB}-day return ---`);
    console.log('Hor   Win      LOSER excess%   t      WINNER excess%   t      L-minus-W%   t      LoserWin%  Days');
    console.log('-'.repeat(120));
    for (const h of HORIZONS) {
      for (const w of WINS) {
        const loser = [], winner = [], ls = [];
        for (let i = LB; i < T; i += 1) {
          if (winOf(dates[i]) !== w) continue;
          const scored = [];
          for (const s of symbols) {
            const a = C[s][i - LB], b = C[s][i];
            if (a == null || b == null || !(a > 0)) continue;
            scored.push({ s, r: b / a - 1 });
          }
          if (scored.length < 20) continue;
          scored.sort((x, y) => y.r - x.r);
          const k = Math.max(3, Math.floor(scored.length / 5));
          const top = scored.slice(0, k).map((x) => x.s);
          const bot = scored.slice(-k).map((x) => x.s);
          const tv = [], bv = [];
          for (const s of top) { const e = fwdExcess(s, i, h); if (e != null) tv.push(e); }
          for (const s of bot) { const e = fwdExcess(s, i, h); if (e != null) bv.push(e); }
          if (!tv.length || !bv.length) continue;
          loser.push(mean(bv)); winner.push(mean(tv)); ls.push(mean(bv) - mean(tv));
        }
        if (loser.length < 50) continue;
        console.log(
          String(h).padStart(3), w.padEnd(7),
          (mean(loser) * 100).toFixed(3).padStart(13), tstat(loser).toFixed(2).padStart(7),
          (mean(winner) * 100).toFixed(3).padStart(16), tstat(winner).toFixed(2).padStart(7),
          (mean(ls) * 100).toFixed(3).padStart(13), tstat(ls).toFixed(2).padStart(7),
          ((100 * loser.filter((x) => x > 0).length) / loser.length).toFixed(0).padStart(10),
          String(loser.length).padStart(6),
        );
      }
      console.log('');
    }
  }

  console.log('='.repeat(120));
  console.log('COST REALITY CHECK (long-only loser leg — the only investable side for Indian retail)');
  console.log('Round-trip CNC cost on a ₹6,667 position ≈ 0.50%; on ₹20,000 ≈ 0.31%; plus slippage ~0.10–0.20%.');
  console.log('The LOSER excess return must exceed that to be tradeable.');
  console.log('='.repeat(120));
}

main().catch((e) => { console.error('ERR:', e.message, e.stack); process.exit(1); });
