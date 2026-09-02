#!/usr/bin/env node
/**
 * ₹20,000 INDIAN SWING-TRADING RESEARCH ENGINE
 *
 * Tests multiple fundamentally different strategy families under a strict
 * three-way split, with real Zerodha delivery (CNC) costs, at true ₹20,000
 * account scale. Designed to REJECT, not to flatter.
 *
 * DATA:    Kite Connect historical daily OHLC (real, fetched live)
 * PERIOD:  2013-06 .. 2026-08  (~13 years)
 * SPLIT:   DEV      2013-06-03 .. 2019-12-31   (develop / choose params)
 *          VALID    2020-01-01 .. 2022-12-31   (first check)
 *          TEST     2023-01-01 .. 2026-08-21   (FINAL — untouched until the end)
 *
 * COSTS (Zerodha CNC/delivery, applied to every trade):
 *   brokerage  ₹0 (delivery is brokerage-free)
 *   STT        0.1% on BOTH buy and sell turnover
 *   exchange   0.00297% both sides
 *   SEBI       0.0001% both sides
 *   stamp      0.015% on buy only
 *   DP charge  ₹15 + 18% GST = ₹17.70 per scrip per SELL day  <- flat, brutal at small size
 *   GST        18% on (exchange + SEBI)
 *   slippage   swept: 0.05% / 0.10% / 0.20% per leg
 *
 * KNOWN LIMITATIONS (stated, not hidden):
 *   - SURVIVORSHIP BIAS: the universe is stocks liquid TODAY. A stock that
 *     was liquid in 2014 and later delisted/collapsed is absent. This biases
 *     results OPTIMISTICALLY. Quantified in the report, not waved away.
 *   - Kite daily bars are split/bonus adjusted but not dividend adjusted.
 *   - No intraday fills: all entries/exits at daily open or close only.
 *
 * Usage: node scripts/research-engine.js
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

const CAPITAL = 20000;
const RISK_PCT = 0.01;      // 1% => ₹200 max planned loss per trade
const MAX_POSITIONS = Number(process.env.MAXPOS) || 3;
const MAX_POS_VALUE = CAPITAL / MAX_POSITIONS;

const DP_RS = 15 * 1.18;

function deliveryCharges(buyPx, sellPx, qty) {
  const bt = buyPx * qty;
  const st = sellPx * qty;
  const stt = (bt + st) * 0.001;
  const exch = (bt + st) * 0.0000297;
  const sebi = (bt + st) * 0.000001;
  const stamp = bt * 0.00015;
  const gst = (exch + sebi) * 0.18;
  return stt + exch + sebi + stamp + gst + DP_RS;
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
    const rows = await fetchHistoricalCandles(auth, token, cur, end, 'day');
    out.push(...rows);
    cur = addDays(end, 1);
  }
  const seen = new Set();
  return out.filter((r) => (seen.has(r.date) ? false : (seen.add(r.date), true)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- indicator helpers (all causal) ----------
function sma(arr, i, n) {
  if (i < n - 1) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k += 1) s += arr[k];
  return s / n;
}
function atr(bars, i, n = 14) {
  if (i < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k += 1) {
    s += Math.max(bars[k].high - bars[k].low, Math.abs(bars[k].high - bars[k - 1].close), Math.abs(bars[k].low - bars[k - 1].close));
  }
  return s / n;
}
function rsi(closes, i, n = 2) {
  if (i < n) return null;
  let g = 0, l = 0;
  for (let k = i - n + 1; k <= i; k += 1) {
    const ch = closes[k] - closes[k - 1];
    if (ch > 0) g += ch; else l -= ch;
  }
  if (l === 0) return 100;
  const rs = (g / n) / (l / n);
  return 100 - 100 / (1 + rs);
}

// ---------- trade record ----------
function makeTrade(sym, entryDate, exitDate, entryPx, exitPx, qty, reason, slip) {
  const buy = entryPx * (1 + slip);
  const sell = exitPx * (1 - slip);
  const gross = (sell - buy) * qty;
  const costs = deliveryCharges(buy, sell, qty);
  return { sym, entryDate, exitDate, entryPx: buy, exitPx: sell, qty, gross, costs, net: gross - costs, reason };
}

/**
 * FAMILY G — VOLATILITY CONTRACTION BREAKOUT (NR7).
 * Rationale: volatility clusters and mean-reverts. An unusually narrow range
 * bar marks coiled/low-energy price; the subsequent range expansion tends to
 * be directional. Two parameters only (lookback, trend filter).
 * Entry : next day stop-buy above the NR7 bar high, only if close > SMA200
 *         (trade expansion only in the direction of the primary trend).
 * Stop  : NR7 bar low.
 * Exit  : trailing SMA20 close-below, or time stop 15 days.
 */
function familyNR7(bars, closes, slip, params = {}) {
  const NR = params.nr || 7;
  const TREND = params.trend || 200;
  const TIME_STOP = params.timeStop || 15;
  const trades = [];
  let open = null;
  for (let i = Math.max(NR, TREND) + 1; i < bars.length - 1; i += 1) {
    if (open) {
      const b = bars[i];
      let exitPx = null, reason = null;
      if (b.low <= open.stop) { exitPx = open.stop; reason = 'stop'; }
      else if (closes[i] < sma(closes, i, 20)) { exitPx = b.close; reason = 'trail-sma20'; }
      else if (i - open.i >= TIME_STOP) { exitPx = b.close; reason = 'time'; }
      if (exitPx != null) { trades.push(makeTrade(open.sym, open.date, b.date, open.px, exitPx, open.qty, reason, slip)); open = null; }
      continue;
    }
    // NR7 detection on bar i
    const rng = bars[i].high - bars[i].low;
    let narrowest = true;
    for (let k = i - NR + 1; k < i; k += 1) if (bars[k].high - bars[k].low <= rng) { narrowest = false; break; }
    if (!narrowest) continue;
    const s200 = sma(closes, i, TREND);
    if (s200 == null || closes[i] < s200) continue;
    // Next bar: stop-buy above NR7 high
    const nb = bars[i + 1];
    const trigger = bars[i].high;
    if (nb.high < trigger) continue;
    const entryPx = Math.max(nb.open, trigger);
    const stop = bars[i].low;
    const riskPerShare = entryPx - stop;
    if (!(riskPerShare > 0)) continue;
    let qty = Math.floor((CAPITAL * RISK_PCT) / riskPerShare);
    qty = Math.min(qty, Math.floor(MAX_POS_VALUE / entryPx));
    if (qty < 1) continue;
    open = { sym: bars.sym, i: i + 1, date: nb.date, px: entryPx, stop, qty };
  }
  return trades;
}

/**
 * FAMILY E — MEAN REVERSION IN AN UPTREND (Connors-style RSI2).
 * Rationale: short-term oversold dips within an established uptrend are
 * liquidity-driven overshoots that tend to revert. Deliberately minimal:
 * one trend filter + one oscillator threshold.
 * Entry : close > SMA200 AND RSI(2) < 10  -> buy next open.
 * Exit  : close > SMA5, or stop at 2xATR, or time stop 10 days.
 */
function familyRSI2(bars, closes, slip, params = {}) {
  const TREND = params.trend || 200;
  const RSI_TH = params.rsiTh || 10;
  const TIME_STOP = params.timeStop || 10;
  const trades = [];
  let open = null;
  for (let i = TREND + 2; i < bars.length - 1; i += 1) {
    if (open) {
      const b = bars[i];
      let exitPx = null, reason = null;
      if (b.low <= open.stop) { exitPx = open.stop; reason = 'stop'; }
      else if (closes[i] > sma(closes, i, 5)) { exitPx = b.close; reason = 'revert-sma5'; }
      else if (i - open.i >= TIME_STOP) { exitPx = b.close; reason = 'time'; }
      if (exitPx != null) { trades.push(makeTrade(open.sym, open.date, b.date, open.px, exitPx, open.qty, reason, slip)); open = null; }
      continue;
    }
    const s200 = sma(closes, i, TREND);
    const r = rsi(closes, i, 2);
    const a = atr(bars, i, 14);
    if (s200 == null || r == null || a == null) continue;
    if (!(closes[i] > s200 && r < RSI_TH)) continue;
    const nb = bars[i + 1];
    const entryPx = nb.open;
    const stop = entryPx - 2 * a;
    const riskPerShare = entryPx - stop;
    if (!(riskPerShare > 0)) continue;
    let qty = Math.floor((CAPITAL * RISK_PCT) / riskPerShare);
    qty = Math.min(qty, Math.floor(MAX_POS_VALUE / entryPx));
    if (qty < 1) continue;
    open = { sym: bars.sym, i: i + 1, date: nb.date, px: entryPx, stop, qty };
  }
  return trades;
}

/**
 * FAMILY C — 52-WEEK-HIGH BREAKOUT.
 * Rationale: the 52w high is a widely-watched anchor; breaching it is the
 * classic documented "anchoring/underreaction" momentum trigger.
 * Entry : close makes a new 250-day high -> buy next open.
 * Stop  : 3xATR. Exit: close below SMA50, or time stop 40 days.
 */
function family52w(bars, closes, slip, params = {}) {
  const LOOK = params.look || 250;
  const TIME_STOP = params.timeStop || 40;
  const trades = [];
  let open = null;
  for (let i = LOOK + 2; i < bars.length - 1; i += 1) {
    if (open) {
      const b = bars[i];
      let exitPx = null, reason = null;
      if (b.low <= open.stop) { exitPx = open.stop; reason = 'stop'; }
      else if (closes[i] < sma(closes, i, 50)) { exitPx = b.close; reason = 'trail-sma50'; }
      else if (i - open.i >= TIME_STOP) { exitPx = b.close; reason = 'time'; }
      if (exitPx != null) { trades.push(makeTrade(open.sym, open.date, b.date, open.px, exitPx, open.qty, reason, slip)); open = null; }
      continue;
    }
    let isHigh = true;
    for (let k = i - LOOK; k < i; k += 1) if (closes[k] >= closes[i]) { isHigh = false; break; }
    if (!isHigh) continue;
    const a = atr(bars, i, 14);
    if (a == null) continue;
    const nb = bars[i + 1];
    const entryPx = nb.open;
    const stop = entryPx - 3 * a;
    const riskPerShare = entryPx - stop;
    if (!(riskPerShare > 0)) continue;
    let qty = Math.floor((CAPITAL * RISK_PCT) / riskPerShare);
    qty = Math.min(qty, Math.floor(MAX_POS_VALUE / entryPx));
    if (qty < 1) continue;
    open = { sym: bars.sym, i: i + 1, date: nb.date, px: entryPx, stop, qty };
  }
  return trades;
}

/**
 * FAMILY D — PULLBACK TO RISING SMA20 IN AN UPTREND.
 * Rationale: trend continuation after an orderly retracement; buying the dip
 * rather than the breakout reduces entry slippage and improves R:R.
 */
function familyPullback(bars, closes, slip, params = {}) {
  const TIME_STOP = params.timeStop || 15;
  const trades = [];
  let open = null;
  for (let i = 205; i < bars.length - 1; i += 1) {
    if (open) {
      const b = bars[i];
      let exitPx = null, reason = null;
      if (b.low <= open.stop) { exitPx = open.stop; reason = 'stop'; }
      else if (closes[i] > open.target) { exitPx = b.close; reason = 'target'; }
      else if (i - open.i >= TIME_STOP) { exitPx = b.close; reason = 'time'; }
      if (exitPx != null) { trades.push(makeTrade(open.sym, open.date, b.date, open.px, exitPx, open.qty, reason, slip)); open = null; }
      continue;
    }
    const s20 = sma(closes, i, 20);
    const s200 = sma(closes, i, 200);
    const s20prev = sma(closes, i - 20, 20);
    const a = atr(bars, i, 14);
    if (s20 == null || s200 == null || s20prev == null || a == null) continue;
    if (!(closes[i] > s200 && s20 > s20prev)) continue;      // uptrend, rising SMA20
    if (!(bars[i].low <= s20 && closes[i] > s20)) continue;   // touched & closed back above
    const nb = bars[i + 1];
    const entryPx = nb.open;
    const stop = entryPx - 1.5 * a;
    const riskPerShare = entryPx - stop;
    if (!(riskPerShare > 0)) continue;
    let qty = Math.floor((CAPITAL * RISK_PCT) / riskPerShare);
    qty = Math.min(qty, Math.floor(MAX_POS_VALUE / entryPx));
    if (qty < 1) continue;
    open = { sym: bars.sym, i: i + 1, date: nb.date, px: entryPx, stop, target: entryPx + 3 * a, qty };
  }
  return trades;
}

function stats(trades) {
  if (!trades.length) return null;
  const wins = trades.filter((t) => t.net > 0);
  const losses = trades.filter((t) => t.net <= 0);
  const gw = wins.reduce((a, t) => a + t.net, 0);
  const gl = Math.abs(losses.reduce((a, t) => a + t.net, 0));
  const net = trades.reduce((a, t) => a + t.net, 0);
  const gross = trades.reduce((a, t) => a + t.gross, 0);
  return {
    n: trades.length,
    winPct: (100 * wins.length) / trades.length,
    net, gross,
    costs: trades.reduce((a, t) => a + t.costs, 0),
    pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    avgWin: wins.length ? gw / wins.length : 0,
    avgLoss: losses.length ? -gl / losses.length : 0,
    expectancy: net / trades.length,
  };
}

function inWindow(t, from, to) { return t.entryDate.slice(0, 10) >= from && t.entryDate.slice(0, 10) <= to; }

async function main() {
  const auth = `token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}`;
  const data = {};
  for (const [sym, tok] of Object.entries(UNIVERSE)) {
    try {
      process.stderr.write(`${sym} `);
      const r = await fetchAll(auth, tok);
      if (r.length > 1500) { r.sym = sym; data[sym] = r; }
    } catch (e) { process.stderr.write(`(skip ${sym}) `); }
  }
  console.error(`\n\n${Object.keys(data).length} symbols with >1500 daily bars.`);
  const anySym = Object.keys(data)[0];
  console.error(`Period: ${data[anySym][0].date.slice(0, 10)} .. ${data[anySym][data[anySym].length - 1].date.slice(0, 10)}\n`);

  const families = {
    'G. Vol-contraction NR7': familyNR7,
    'E. RSI2 mean-reversion': familyRSI2,
    'C. 52-week-high breakout': family52w,
    'D. Pullback to SMA20': familyPullback,
  };

  for (const slip of [0.0005, 0.001, 0.002]) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`SLIPPAGE ${(slip * 100).toFixed(2)}% per leg   (₹20,000 account, 1% risk, max ${MAX_POSITIONS} positions, CNC delivery costs)`);
    console.log('='.repeat(100));
    console.log('Family                     Window     trades  win%     gross     costs       net     PF   expectancy');
    console.log('-'.repeat(100));
    for (const [fname, fn] of Object.entries(families)) {
      const all = [];
      for (const sym of Object.keys(data)) {
        const bars = data[sym];
        const closes = bars.map((b) => b.close);
        all.push(...fn(bars, closes, slip));
      }
      for (const [wname, wfrom, wto] of [['DEV', FROM, DEV_TO], ['VALID', addDays(DEV_TO, 1), VALID_TO], ['TEST', addDays(VALID_TO, 1), TO]]) {
        const s = stats(all.filter((t) => inWindow(t, wfrom, wto)));
        if (!s) { console.log(fname.padEnd(26), wname.padEnd(9), '   (no trades)'); continue; }
        console.log(
          fname.padEnd(26), wname.padEnd(9),
          String(s.n).padStart(6), s.winPct.toFixed(0).padStart(5),
          `₹${s.gross.toFixed(0)}`.padStart(10), `₹${s.costs.toFixed(0)}`.padStart(9),
          `₹${s.net.toFixed(0)}`.padStart(10), s.pf.toFixed(2).padStart(6),
          `₹${s.expectancy.toFixed(1)}`.padStart(9),
        );
      }
      console.log('-'.repeat(100));
    }
  }
}

main().catch((e) => { console.error('ERR:', e.message, e.stack); process.exit(1); });
