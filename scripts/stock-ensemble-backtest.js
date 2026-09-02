#!/usr/bin/env node
/**
 * Bank-stock ensemble ("kingdom") backtest — cash equity, real 5-min Kite
 * candles, real Zerodha intraday equity charges. No options, no expiry, no
 * Black-Scholes modeling: P&L is just (exit - entry) x shares, which is why
 * this is a materially more trustworthy backtest than the Nifty/Bank Nifty
 * options work (paper should track live far more closely here).
 *
 * Design ("kingdom"):
 *   Soldiers  - 5 independent, genuinely different technical checks, each
 *               voting bullish(+1)/bearish(-1)/neutral(0). Deliberately NOT
 *               1000s of near-duplicate indicators - that's overfitting
 *               dressed up as sophistication, not real signal.
 *   Knight    - shock-bar detector (irregular/outsized range), weight 1.5x
 *               in the vote, direction = the shock bar's own close vs open.
 *   Magician  - volatility-regime veto. If the market is dead-quiet (ATR far
 *               below its own average), veto the bar outright - no vote can
 *               override a "nothing is moving" read.
 *   Queen     - trend+momentum ALIGNMENT check, weight 2x. Only fires when
 *               two independent soldiers agree; that agreement itself is the
 *               "strongest single confirmer."
 *   Manager   - tallies all weighted votes; requires a real net majority
 *               (not 1-2 votes) before calling a direction "confirmed."
 *   Eagle     - once bullish is confirmed, triggers on a breakout above the
 *               recent N-bar high (long entry).
 *   Snake     - once bearish is confirmed, triggers on a breakdown below the
 *               recent N-bar low (short entry - Zerodha MIS intraday short
 *               selling on liquid large-caps).
 *   King      - not a signal. Capital protection: ATR-based stop, R-multiple
 *               target, max trades/day per stock, combined day-loss stop.
 *
 * Usage: node scripts/stock-ensemble-backtest.js <fromDate> <toDate> [capitalRs]
 * Env:   KITE_API_KEY, KITE_ACCESS_TOKEN
 *        VOTE_THRESHOLD (default 4)  MODE=soldiers-only (disables knight/queen/magician)
 */
const { fetchHistorical5m } = require('../live/kite-market');
const { estimateEquityRoundTripCharges } = require('../live/equity-charges');

const STOCKS = {
  HDFCBANK: { token: 341249, label: 'HDFC Bank' },
  ICICIBANK: { token: 1270529, label: 'ICICI Bank' },
  SBIN: { token: 779521, label: 'SBI' },
  KOTAKBANK: { token: 492033, label: 'Kotak Mahindra' },
};

const MAX_KITE_DAYS_PER_REQUEST = 95;
const VOTE_THRESHOLD = Number(process.env.VOTE_THRESHOLD) || 4;
const SOLDIERS_ONLY = (process.env.MODE || '').toLowerCase() === 'soldiers-only';
const BREAKOUT_LOOKBACK = 10;
const ATR_STOP_MULT = 1.5;
const TARGET_R = 2.5;
const MAX_TRADES_PER_STOCK_PER_DAY = 2;
const COOLDOWN_MIN = 15;
const DAY_STOP_RS_PER_STOCK = 400; // king: stop that one stock's book for the day
const ENTRY_START = '09:30';
const ENTRY_END = '14:45';
const EOD_EXIT = '15:15';

function addDaysIso(dateIso, delta) {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

async function fetchChunked(authorization, token, fromDate, toDate) {
  const out = [];
  let cursor = fromDate;
  while (cursor <= toDate) {
    const chunkEnd = addDaysIso(cursor, MAX_KITE_DAYS_PER_REQUEST - 1);
    const end = chunkEnd > toDate ? toDate : chunkEnd;
    const rows = await fetchHistorical5m(authorization, token, cursor, end);
    out.push(...rows);
    cursor = addDaysIso(end, 1);
  }
  const seen = new Set();
  const deduped = [];
  for (const r of out) {
    if (seen.has(r.date)) continue;
    seen.add(r.date);
    deduped.push(r);
  }
  deduped.sort((a, b) => a.date.localeCompare(b.date));
  return deduped;
}

/** Incremental (causal, O(1)/bar) indicator state — no O(n^2) re-slicing. */
function createIndicatorState() {
  return {
    i: 0,
    ema20: null,
    avgGain: null,
    avgLoss: null,
    prevClose: null,
    atr14: null,
    atrBuf: [], // last 20 ATR values for atrSma20
    volBuf: [], // last 20 volumes for volSma20
    closeBuf: [], // last 11 closes for momentum(10)
    highBuf: [], // last BREAKOUT_LOOKBACK highs (excl current)
    lowBuf: [], // last BREAKOUT_LOOKBACK lows (excl current)
    rangeBuf: [], // last 20 (high-low) for shock-bar average
    pivotHighs: [], // last 2 confirmed swing highs (3-bar fractal)
    pivotLows: [],
  };
}

function pushCapped(buf, v, cap) {
  buf.push(v);
  if (buf.length > cap) buf.shift();
}
function avg(buf) {
  return buf.length ? buf.reduce((a, b) => a + b, 0) / buf.length : null;
}

/** Update state with bar i (candles[i]); candles[i-1] must exist for TR/pivots. */
function updateIndicators(state, candles, i) {
  const c = candles[i];
  const prev = candles[i - 1];

  // EMA20
  const k = 2 / 21;
  state.ema20 = state.ema20 == null ? c.close : c.close * k + state.ema20 * (1 - k);

  // RSI14 (Wilder)
  if (state.prevClose != null) {
    const chg = c.close - state.prevClose;
    const gain = Math.max(0, chg);
    const loss = Math.max(0, -chg);
    if (state.avgGain == null) {
      state.avgGain = gain;
      state.avgLoss = loss;
    } else {
      state.avgGain = (state.avgGain * 13 + gain) / 14;
      state.avgLoss = (state.avgLoss * 13 + loss) / 14;
    }
  }
  state.prevClose = c.close;

  // ATR14 (Wilder) from true range
  const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  state.atr14 = state.atr14 == null ? tr : (state.atr14 * 13 + tr) / 14;
  pushCapped(state.atrBuf, state.atr14, 20);

  pushCapped(state.volBuf, Number(c.volume) || 0, 20);
  pushCapped(state.closeBuf, c.close, 11);
  pushCapped(state.rangeBuf, c.high - c.low, 20);

  // 3-bar fractal pivots, confirmed one bar late (causal) at index i-1
  if (i >= 2) {
    const a = candles[i - 2],
      b = candles[i - 1],
      cc = candles[i];
    if (b.high > a.high && b.high > cc.high) pushCapped(state.pivotHighs, b.high, 2);
    if (b.low < a.low && b.low < cc.low) pushCapped(state.pivotLows, b.low, 2);
  }

  // Breakout reference: push the bar that just became "previous" (prev, not c) so
  // highBuf/lowBuf hold [i-BREAKOUT_LOOKBACK .. i-1] when bar i is evaluated — the
  // current bar's own high/low must never be in its own breakout reference.
  pushCapped(state.highBuf, prev.high, BREAKOUT_LOOKBACK);
  pushCapped(state.lowBuf, prev.low, BREAKOUT_LOOKBACK);
}

function rsiFrom(state) {
  if (state.avgGain == null || state.avgLoss == null) return null;
  if (state.avgLoss === 0) return 100;
  const rs = state.avgGain / state.avgLoss;
  return 100 - 100 / (1 + rs);
}

/** The kingdom vote. Returns {direction:'bull'|'bear'|null, score, vetoed}. */
function kingdomVote(state, candle) {
  const atrSma20 = avg(state.atrBuf);
  if (atrSma20 != null && state.atr14 != null && state.atr14 < atrSma20 * 0.55) {
    return { direction: null, score: 0, vetoed: true, reason: 'Magician veto — dead quiet' };
  }

  // --- Soldiers ---
  const sTrend = candle.close > state.ema20 ? 1 : candle.close < state.ema20 ? -1 : 0;
  const momRef = state.closeBuf.length >= 11 ? state.closeBuf[0] : null;
  const sMomentum = momRef == null ? 0 : candle.close > momRef ? 1 : candle.close < momRef ? -1 : 0;
  const rsi = rsiFrom(state);
  const sRsi = rsi == null ? 0 : rsi > 52 ? 1 : rsi < 48 ? -1 : 0;
  const volAvg = avg(state.volBuf);
  const sVolume =
    volAvg != null && Number(candle.volume) > volAvg * 1.2
      ? candle.close > candle.open
        ? 1
        : candle.close < candle.open
          ? -1
          : 0
      : 0;
  const lastHigh = state.pivotHighs[state.pivotHighs.length - 1];
  const prevHigh = state.pivotHighs[state.pivotHighs.length - 2];
  const lastLow = state.pivotLows[state.pivotLows.length - 1];
  const prevLow = state.pivotLows[state.pivotLows.length - 2];
  let sStructure = 0;
  if (lastHigh != null && prevHigh != null && lastLow != null && prevLow != null) {
    if (lastHigh > prevHigh && lastLow > prevLow) sStructure = 1;
    else if (lastHigh < prevHigh && lastLow < prevLow) sStructure = -1;
  }

  if (SOLDIERS_ONLY) {
    const score = sTrend + sMomentum + sRsi + sVolume + sStructure;
    return {
      direction: score >= VOTE_THRESHOLD ? 'bull' : score <= -VOTE_THRESHOLD ? 'bear' : null,
      score,
      vetoed: false,
    };
  }

  // --- Knight: shock bar (irregular/outsized range), weight 1.5 ---
  const rangeAvg = avg(state.rangeBuf);
  const barRange = candle.high - candle.low;
  const knight =
    rangeAvg != null && barRange > rangeAvg * 2
      ? (candle.close > candle.open ? 1 : candle.close < candle.open ? -1 : 0) * 1.5
      : 0;

  // --- Queen: trend + momentum alignment, weight 2 ---
  const queen = sTrend !== 0 && sTrend === sMomentum ? sTrend * 2 : 0;

  const score = sTrend + sMomentum + sRsi + sVolume + sStructure + knight + queen;
  return {
    direction: score >= VOTE_THRESHOLD ? 'bull' : score <= -VOTE_THRESHOLD ? 'bear' : null,
    score,
    vetoed: false,
  };
}

function timeOf(dateIso) {
  return dateIso.slice(11, 16);
}

async function backtestStock(authorization, symbol, meta, fromDate, toDate, allocatedCapital) {
  const warmFrom = addDaysIso(fromDate, -40);
  const candles = await fetchChunked(authorization, meta.token, warmFrom, toDate);
  if (candles.length < 100) return { symbol, trades: [], note: 'insufficient data' };

  let startIndex = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].date.slice(0, 10) >= fromDate) {
      startIndex = Math.max(i, 30);
      break;
    }
  }

  const state = createIndicatorState();
  for (let i = 1; i < startIndex; i += 1) updateIndicators(state, candles, i);

  const trades = [];
  let open = null; // {direction, entry, stop, target, entryTime, shares}
  let dayKey = null;
  let dayNet = 0;
  let dayTradeCount = 0;
  let dayStopped = false;
  let lastExitAt = null;

  for (let i = startIndex; i < candles.length; i += 1) {
    updateIndicators(state, candles, i);
    const c = candles[i];
    const day = c.date.slice(0, 10);
    if (day < fromDate || day > toDate) continue;
    if (day !== dayKey) {
      dayKey = day;
      dayNet = 0;
      dayTradeCount = 0;
      dayStopped = false;
    }
    const t = timeOf(c.date);

    if (open) {
      let exitPrice = null;
      let reason = null;
      if (open.direction === 'long') {
        if (c.low <= open.stop) {
          exitPrice = open.stop;
          reason = 'Stop loss hit';
        } else if (c.high >= open.target) {
          exitPrice = open.target;
          reason = 'Target hit';
        }
      } else {
        if (c.high >= open.stop) {
          exitPrice = open.stop;
          reason = 'Stop loss hit';
        } else if (c.low <= open.target) {
          exitPrice = open.target;
          reason = 'Target hit';
        }
      }
      if (!exitPrice && t >= EOD_EXIT) {
        exitPrice = c.close;
        reason = 'EOD square-off';
      }
      if (exitPrice) {
        const gross =
          open.direction === 'long'
            ? (exitPrice - open.entry) * open.shares
            : (open.entry - exitPrice) * open.shares;
        const charges = estimateEquityRoundTripCharges({
          entryPrice: open.direction === 'long' ? open.entry : exitPrice,
          exitPrice: open.direction === 'long' ? exitPrice : open.entry,
          quantity: open.shares,
        });
        const net = Math.round((gross - charges.totalRs) * 100) / 100;
        trades.push({
          symbol,
          direction: open.direction,
          entryTime: open.entryTime,
          exitTime: c.date,
          entryPrice: open.entry,
          exitPrice,
          shares: open.shares,
          grossRs: Math.round(gross * 100) / 100,
          chargesRs: charges.totalRs,
          netRs: net,
          reason,
        });
        dayNet += net;
        dayTradeCount += 1;
        lastExitAt = c.date;
        open = null;
        if (dayNet <= -DAY_STOP_RS_PER_STOCK) dayStopped = true;
      }
      continue;
    }

    if (dayStopped) continue;
    if (dayTradeCount >= MAX_TRADES_PER_STOCK_PER_DAY) continue;
    if (t < ENTRY_START || t > ENTRY_END) continue;
    if (lastExitAt) {
      const mins = (new Date(c.date) - new Date(lastExitAt)) / 60000;
      if (mins < COOLDOWN_MIN) continue;
    }
    const vote = kingdomVote(state, c);
    if (vote.vetoed || !vote.direction) continue;

    // Eagle/Snake as ORIGINALLY described: eagle buys off SUPPORT, snake sells
    // off RESISTANCE — a sweep-and-bounce at a real pivot level, not a
    // breakout chase. Same family as the Nifty strategy that actually works:
    // price dips through the level (a "sweep") then closes back on the right
    // side of it (the bounce/rejection confirms the level held).
    const support = state.pivotLows[state.pivotLows.length - 1];
    const resistance = state.pivotHighs[state.pivotHighs.length - 1];
    const tolerance = Math.max(0.05, (state.atr14 || 0) * 0.5);

    if (
      vote.direction === 'bull' &&
      support != null &&
      c.low <= support + tolerance &&
      c.close > c.open &&
      c.close > support
    ) {
      const stop = Math.min(c.low, support) - tolerance * 0.5;
      const stopDist = Math.max(0.5, c.close - stop);
      const shares = Math.max(1, Math.floor(allocatedCapital / c.close));
      open = {
        direction: 'long',
        entry: c.close,
        stop,
        target: c.close + stopDist * TARGET_R,
        entryTime: c.date,
        shares,
      };
    } else if (
      vote.direction === 'bear' &&
      resistance != null &&
      c.high >= resistance - tolerance &&
      c.close < c.open &&
      c.close < resistance
    ) {
      const stop = Math.max(c.high, resistance) + tolerance * 0.5;
      const stopDist = Math.max(0.5, stop - c.close);
      const shares = Math.max(1, Math.floor(allocatedCapital / c.close));
      open = {
        direction: 'short',
        entry: c.close,
        stop,
        target: c.close - stopDist * TARGET_R,
        entryTime: c.date,
        shares,
      };
    }
  }

  return { symbol, trades };
}

async function main() {
  const [, , fromDate, toDate, capitalArg] = process.argv;
  const apiKey = process.env.KITE_API_KEY;
  const accessToken = process.env.KITE_ACCESS_TOKEN;
  if (!fromDate || !toDate) {
    console.error('Usage: node scripts/stock-ensemble-backtest.js <fromDate> <toDate> [capitalRs]');
    process.exit(1);
  }
  if (!apiKey || !accessToken) {
    console.error('Set KITE_API_KEY and KITE_ACCESS_TOKEN');
    process.exit(1);
  }
  const totalCapital = Math.max(10000, Number(capitalArg) || 40000);
  const symbols = Object.keys(STOCKS);
  const allocatedPerStock = totalCapital / symbols.length;
  const authorization = `token ${apiKey}:${accessToken}`;

  console.error(
    `Kingdom backtest: ${symbols.join(', ')} · Rs${totalCapital} total (Rs${Math.round(allocatedPerStock)}/stock) · ` +
      `${SOLDIERS_ONLY ? 'SOLDIERS-ONLY' : 'FULL KINGDOM'} · vote threshold ${VOTE_THRESHOLD}`,
  );

  const results = [];
  for (const sym of symbols) {
    console.error(`Fetching ${STOCKS[sym].label}...`);
    const r = await backtestStock(authorization, sym, STOCKS[sym], fromDate, toDate, allocatedPerStock);
    console.error(`  ${sym}: ${r.trades.length} trades`);
    results.push(r);
  }

  const allTrades = results.flatMap((r) => r.trades);
  console.log(JSON.stringify({ fromDate, toDate, totalCapital, mode: SOLDIERS_ONLY ? 'soldiers-only' : 'full', trades: allTrades }, null, 2));
}

main().catch((err) => {
  console.error('STOCK_BACKTEST_ERROR:', err.message, err.stack);
  process.exit(1);
});
