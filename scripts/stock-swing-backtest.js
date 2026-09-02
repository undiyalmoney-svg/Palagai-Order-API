#!/usr/bin/env node
/**
 * Bank-stock SWING kingdom — "few entries, each one should pay off big."
 *
 * Different animal from stock-ensemble-backtest.js (which was intraday
 * scalping and failed). This version:
 *   - 60-minute candles, not 5-minute (Kite allows 400 days/request here vs
 *     100 for 5-min, so real 5yr history is cheap to fetch).
 *   - NO forced same-day exit. Positions can run for days — real overnight/
 *     weekend gap risk exists and is not modeled (backtest cannot see a gap
 *     that happens outside trading hours; flag this honestly in output).
 *   - Much stricter entry: needs vote threshold AND a longer-term (EMA50 on
 *     hourly, ~8 trading days) trend alignment, not just the vote alone.
 *   - NO fixed R-multiple exit. Wide initial stop, then trail behind
 *     confirmed swing pivots once price has moved 1R in favour — lets a real
 *     trend pay out instead of capping it, at the cost of giving back some
 *     open profit before the trail catches it.
 *   - Cash-only sizing (delivery/CNC, not MIS) — no leverage assumed.
 *   - Delivery charges (brokerage-free but STT/stamp/DP differ from intraday
 *     — see live/equity-charges.js).
 *   - Max holding cap (default 15 trading days) as a backtest backstop, not
 *     a real broker limit — without it a dead position could sit open for
 *     the whole 5-year window and never resolve.
 *
 * Usage: node scripts/stock-swing-backtest.js <fromDate> <toDate> [capitalRs]
 * Env:   KITE_API_KEY, KITE_ACCESS_TOKEN, VOTE_THRESHOLD (default 5)
 */
const { fetchHistoricalCandles } = require('../live/kite-market');
const { estimateDeliveryRoundTripCharges } = require('../live/equity-charges');

/** Full Bank Nifty constituent set (12) — widened from the original 4 to test
 * whether the lack of edge is about these specific stocks or the method. */
const STOCKS = {
  HDFCBANK: { token: 341249, label: 'HDFC Bank' },
  ICICIBANK: { token: 1270529, label: 'ICICI Bank' },
  SBIN: { token: 779521, label: 'SBI' },
  KOTAKBANK: { token: 492033, label: 'Kotak Mahindra' },
  AXISBANK: { token: 1510401, label: 'Axis Bank' },
  INDUSINDBK: { token: 1346049, label: 'IndusInd Bank' },
  BANKBARODA: { token: 1195009, label: 'Bank of Baroda' },
  FEDERALBNK: { token: 261889, label: 'Federal Bank' },
  AUBANK: { token: 5436929, label: 'AU Small Finance Bank' },
  IDFCFIRSTB: { token: 2863105, label: 'IDFC First Bank' },
  PNB: { token: 2730497, label: 'Punjab National Bank' },
  BANDHANBNK: { token: 579329, label: 'Bandhan Bank' },
};

const MAX_KITE_DAYS_PER_REQUEST = 390;
const VOTE_THRESHOLD = Number(process.env.VOTE_THRESHOLD) || 5;
const ATR_STOP_MULT = 2.0;
const TRAIL_ARM_R = 1.0; // once +1R favourable, start trailing behind swings
const MAX_HOLD_BARS = 90; // ~15 trading days on hourly (6/day) — backtest backstop only
const COOLDOWN_BARS = 6; // ~1 trading day between entries on the same stock

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
    const rows = await fetchHistoricalCandles(authorization, token, cursor, end, '60minute');
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

function createState() {
  return {
    ema50: null,
    avgGain: null,
    avgLoss: null,
    prevClose: null,
    atr14: null,
    ema200: null,
    volBuf: [],
    closeBuf: [],
    rangeBuf: [],
    pivotHighs: [], // 7-bar fractal — a stronger, more-tested level than a 5-bar swing
    pivotLows: [],
  };
}
function pushCapped(buf, v, cap) {
  buf.push(v);
  if (buf.length > cap) buf.shift();
}
function avg(b) {
  return b.length ? b.reduce((a, x) => a + x, 0) / b.length : null;
}

function updateIndicators(state, candles, i) {
  const c = candles[i];
  const prev = candles[i - 1];
  const k = 2 / 51;
  state.ema50 = state.ema50 == null ? c.close : c.close * k + state.ema50 * (1 - k);
  const k200 = 2 / 201; // ~33 trading days on hourly — a real "bigger trend" filter
  state.ema200 = state.ema200 == null ? c.close : c.close * k200 + state.ema200 * (1 - k200);

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

  const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  state.atr14 = state.atr14 == null ? tr : (state.atr14 * 13 + tr) / 14;

  pushCapped(state.volBuf, Number(c.volume) || 0, 20);
  pushCapped(state.closeBuf, c.close, 15);
  pushCapped(state.rangeBuf, c.high - c.low, 20);

  // 7-bar fractal, confirmed causally at i-3 (3 bars each side) — a level that
  // held against 6 neighbouring bars, not just 4, so it's been "tested" more.
  if (i >= 6) {
    const bars = candles.slice(i - 6, i + 1);
    const mid = bars[3];
    if (bars.every((b) => mid.high >= b.high)) pushCapped(state.pivotHighs, mid.high, 2);
    if (bars.every((b) => mid.low <= b.low)) pushCapped(state.pivotLows, mid.low, 2);
  }
}

function rsiFrom(state) {
  if (state.avgGain == null || state.avgLoss == null) return null;
  if (state.avgLoss === 0) return 100;
  return 100 - 100 / (1 + state.avgGain / state.avgLoss);
}

function kingdomVote(state, candle) {
  const sTrend = candle.close > state.ema50 ? 1 : candle.close < state.ema50 ? -1 : 0;
  const momRef = state.closeBuf.length >= 15 ? state.closeBuf[0] : null;
  const sMomentum = momRef == null ? 0 : candle.close > momRef ? 1 : candle.close < momRef ? -1 : 0;
  const rsi = rsiFrom(state);
  const sRsi = rsi == null ? 0 : rsi > 55 ? 1 : rsi < 45 ? -1 : 0;
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
  const queen = sTrend !== 0 && sTrend === sMomentum ? sTrend * 2 : 0;
  const score = sTrend + sMomentum + sRsi + sVolume + sStructure + queen;
  const bigTrend = state.ema200 == null ? 0 : candle.close > state.ema200 ? 1 : candle.close < state.ema200 ? -1 : 0;
  return {
    direction: score >= VOTE_THRESHOLD ? 'bull' : score <= -VOTE_THRESHOLD ? 'bear' : null,
    score,
    volumeConfirmed: sVolume !== 0,
    bigTrend,
  };
}

async function backtestStock(authorization, symbol, meta, fromDate, toDate, allocatedCapital) {
  const warmFrom = addDaysIso(fromDate, -90);
  const candles = await fetchChunked(authorization, meta.token, warmFrom, toDate);
  if (candles.length < 100) return { symbol, trades: [] };

  let startIndex = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].date.slice(0, 10) >= fromDate) {
      startIndex = Math.max(i, 60);
      break;
    }
  }

  const state = createState();
  for (let i = 1; i < startIndex; i += 1) updateIndicators(state, candles, i);

  const trades = [];
  let open = null; // {direction, entry, stop, initialRisk, shares, entryTime, entryIdx, armed}
  let lastEntryIdx = -Infinity;

  for (let i = startIndex; i < candles.length; i += 1) {
    updateIndicators(state, candles, i);
    const c = candles[i];
    const day = c.date.slice(0, 10);
    if (day > toDate) break;

    if (open) {
      let exitPrice = null;
      let reason = null;
      if (open.direction === 'long') {
        if (c.low <= open.stop) {
          exitPrice = open.stop;
          reason = 'Stop loss hit';
        } else {
          const favR = (c.high - open.entry) / open.initialRisk;
          if (favR >= TRAIL_ARM_R) {
            const lastLow = state.pivotLows[state.pivotLows.length - 1];
            if (lastLow != null && lastLow > open.stop) {
              open.stop = lastLow; // ratchet stop up to the latest confirmed swing low
            }
          }
        }
      } else {
        if (c.high >= open.stop) {
          exitPrice = open.stop;
          reason = 'Stop loss hit';
        } else {
          const favR = (open.entry - c.low) / open.initialRisk;
          if (favR >= TRAIL_ARM_R) {
            const lastHigh = state.pivotHighs[state.pivotHighs.length - 1];
            if (lastHigh != null && lastHigh < open.stop) {
              open.stop = lastHigh;
            }
          }
        }
      }
      if (!exitPrice && i - open.entryIdx >= MAX_HOLD_BARS) {
        exitPrice = c.close;
        reason = 'Max hold reached';
      }
      if (exitPrice) {
        const gross =
          open.direction === 'long'
            ? (exitPrice - open.entry) * open.shares
            : (open.entry - exitPrice) * open.shares;
        const charges = estimateDeliveryRoundTripCharges({
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
          holdBars: i - open.entryIdx,
          grossRs: Math.round(gross * 100) / 100,
          chargesRs: charges.totalRs,
          netRs: net,
          reason,
        });
        lastEntryIdx = i;
        open = null;
      }
      continue;
    }

    if (i - lastEntryIdx < COOLDOWN_BARS) continue;
    if (state.pivotHighs.length < 2 || state.pivotLows.length < 2) continue;

    const vote = kingdomVote(state, c);
    if (!vote.direction) continue;
    if (!vote.volumeConfirmed) continue; // real conviction required, not just a soft vote
    if (vote.direction === 'bull' && vote.bigTrend < 0) continue; // don't fight the ~33-day trend
    if (vote.direction === 'bear' && vote.bigTrend > 0) continue;

    const support = state.pivotLows[state.pivotLows.length - 1];
    const resistance = state.pivotHighs[state.pivotHighs.length - 1];
    const tolerance = Math.max(0.1, (state.atr14 || 0) * 0.5);

    if (
      vote.direction === 'bull' &&
      support != null &&
      c.low <= support + tolerance &&
      c.close > c.open &&
      c.close > support
    ) {
      const stop = support - (state.atr14 || 1) * (ATR_STOP_MULT - 1);
      const initialRisk = Math.max(0.5, c.close - stop);
      const shares = Math.max(1, Math.floor(allocatedCapital / c.close));
      open = { direction: 'long', entry: c.close, stop, initialRisk, shares, entryTime: c.date, entryIdx: i };
    } else if (
      vote.direction === 'bear' &&
      resistance != null &&
      c.high >= resistance - tolerance &&
      c.close < c.open &&
      c.close < resistance
    ) {
      const stop = resistance + (state.atr14 || 1) * (ATR_STOP_MULT - 1);
      const initialRisk = Math.max(0.5, stop - c.close);
      const shares = Math.max(1, Math.floor(allocatedCapital / c.close));
      open = { direction: 'short', entry: c.close, stop, initialRisk, shares, entryTime: c.date, entryIdx: i };
    }
  }

  return { symbol, trades };
}

async function main() {
  const [, , fromDate, toDate, capitalArg] = process.argv;
  const apiKey = process.env.KITE_API_KEY;
  const accessToken = process.env.KITE_ACCESS_TOKEN;
  if (!fromDate || !toDate) {
    console.error('Usage: node scripts/stock-swing-backtest.js <fromDate> <toDate> [capitalRs]');
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
    `SWING kingdom: ${symbols.join(', ')} · Rs${totalCapital} total · vote threshold ${VOTE_THRESHOLD} · ` +
      `hourly candles · trailing exit, no fixed target · NO overnight-gap risk modeled`,
  );

  const results = [];
  for (const sym of symbols) {
    console.error(`Fetching ${STOCKS[sym].label} (60min)...`);
    const r = await backtestStock(authorization, sym, STOCKS[sym], fromDate, toDate, allocatedPerStock);
    console.error(`  ${sym}: ${r.trades.length} trades`);
    results.push(r);
  }

  const allTrades = results.flatMap((r) => r.trades);
  console.log(JSON.stringify({ fromDate, toDate, totalCapital, trades: allTrades }, null, 2));
}

main().catch((err) => {
  console.error('SWING_BACKTEST_ERROR:', err.message, err.stack);
  process.exit(1);
});
