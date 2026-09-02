#!/usr/bin/env node
/**
 * The ACTUAL Trap V2 engine (createTrapStrategyV2 — the one thing proven to
 * work on Nifty, unmodified) driven on individual bank-stock price data
 * instead of the Nifty index, on 5-min candles (see CORRECTED note below —
 * this was originally asked/attempted on 1-hour candles, but Trap V2's
 * intraday warmup makes hourly bars unworkable).
 *
 * Everything else built for stocks this session (kingdom ensemble, swing
 * trailing, Donchian trend) was a NEW mechanism. This is not — it reuses
 * runSrTrapConfirm/srTrapExitLogic exactly as shipped, with no option-premium
 * layer (cash equity: P&L is just price-diff x shares, so the engine's
 * option-marks-unknown fallback path is used — pure index/structural
 * SL/target/EOD, same as the "DISABLE_TRAIL" isolation test run on Nifty).
 *
 * Calibration: Trap V2's pierce/risk-band are tuned in NIFTY INDEX POINTS
 * (~24,000). A fixed 20-point pierce is meaningless on a Rs35 PNB share and
 * far too tight on a Rs1,500 ICICI share, so pierce/minRisk/maxRisk are
 * rescaled to the SAME PERCENTAGE of price Nifty uses, recomputed every bar
 * from that bar's close. entryWindows (the Nifty-specific time filter) is
 * cleared — importing a Nifty-derived finding onto a different instrument
 * untested would be exactly the mistake this session has been correcting.
 *
 * CORRECTED (this pass): was run on 60-minute candles, where Trap V2's
 * intraday swing lookback (swingLb=5, counted in bars WITHIN the day) burned
 * the first 5 of only ~7 bars a day - 71% of all bars returned "Warming
 * swing lookback" and the engine produced ZERO trades in 5.6 years. Trap V2
 * is a 5-minute engine; on 5-min bars that same warmup costs 25 minutes.
 *
 * Usage: node scripts/stock-trap-backtest.js <fromDate> <toDate> [capitalRs]
 * Env:   KITE_API_KEY, KITE_ACCESS_TOKEN
 */
const { createTrapStrategyV2 } = require('../live/strategy-core.cjs');
const { fetchHistoricalCandles } = require('../live/kite-market');
const { estimateEquityRoundTripCharges } = require('../live/equity-charges');

const ALL_STOCKS = {
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
  // Cross-sector diversification set — not banks, picked for liquidity + sector spread.
  RELIANCE: { token: 738561, label: 'Reliance Industries' },
  INFY: { token: 408065, label: 'Infosys' },
  TCS: { token: 2953217, label: 'TCS' },
  ITC: { token: 424961, label: 'ITC' },
  LT: { token: 2939649, label: 'Larsen & Toubro' },
  BAJFINANCE: { token: 81153, label: 'Bajaj Finance' },
  TITAN: { token: 897537, label: 'Titan Company' },
  ASIANPAINT: { token: 60417, label: 'Asian Paints' },
  MARUTI: { token: 2815745, label: 'Maruti Suzuki' },
  BHARTIARTL: { token: 2714625, label: 'Bharti Airtel' },
  SUNPHARMA: { token: 857857, label: 'Sun Pharma' },
  ULTRACEMCO: { token: 2952193, label: 'UltraTech Cement' },
};
// SYMBOLS=SBIN,KOTAKBANK to restrict the universe without duplicating the script.
const SYMBOLS_FILTER = (process.env.SYMBOLS || '').split(',').map((s) => s.trim()).filter(Boolean);
const STOCKS = SYMBOLS_FILTER.length
  ? Object.fromEntries(Object.entries(ALL_STOCKS).filter(([sym]) => SYMBOLS_FILTER.includes(sym)))
  : ALL_STOCKS;

// Kite caps 5-minute history at 100 days/request (60-minute allows 400).
const MAX_KITE_DAYS_PER_REQUEST = 90;
const CANDLE_INTERVAL = '5minute';
// Same % of price as Nifty's pierce20/minRisk4/maxRisk28 at ~24,000.
const PIERCE_PCT = 20 / 24000;
const MIN_RISK_PCT = 4 / 24000;
const MAX_RISK_PCT = 28 / 24000;

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
    const rows = await fetchHistoricalCandles(authorization, token, cursor, end, CANDLE_INTERVAL);
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

// The engine (runSrTrapConfirm/srTrapExitLogic) reads ctx.previous5m via
// seriesAt(ctx) = [...ctx.previous5m, ctx.candle5m] — never ctx.series5m.
// It only needs: today's bars (for the intraday swing/PDHL check) and enough
// history for EMA(<=50) to converge (negligible seed bias past ~5x period).
// A fixed rolling window comfortably covers both (~5-6 trading days) without
// slicing the FULL history on every bar — full slicing is what made the
// 5-min/3.4yr run effectively O(n^2) and non-terminating within 10 minutes.
const CONTEXT_WINDOW_BARS = 400;

function buildContext(candles, index, instrumentId) {
  const candle5m = candles[index];
  const windowStart = Math.max(0, index - CONTEXT_WINDOW_BARS);
  return {
    candle60m: { ...candle5m },
    candle30m: { ...candle5m },
    candle15m: { ...candle5m },
    candle5m,
    previous60m: [],
    previous30m: [],
    previous15m: [],
    previous5m: candles.slice(windowStart, index),
    candleIndex5m: index,
    replayStepIndex: index,
    replayFrom: candles[windowStart]?.date ?? candle5m.date,
    replayTo: candle5m.date,
    instrumentId,
  };
}

/**
 * strategy-core.cjs gates on /bank/i.test(instrumentId) in FOUR places and
 * applies Math.max(extras.minRisk, 8) / Math.max(extras.maxRisk, 50) when it
 * matches. "HDFCBANK"/"ICICIBANK"/"KOTAKBANK" all match that regex, so every
 * bank stock was silently treated as the Bank Nifty INDEX and had its
 * price-rescaled risk band (0.12-0.85 on a Rs730 share) clamped back to
 * 8-50 absolute points - rejecting every signal. Feed the engine an id that
 * cannot match, so the rescaled band we computed is the one actually used.
 */
function engineInstrumentId(symbol) {
  return `STK_${symbol.replace(/BANK/gi, '')}`;
}

async function backtestStock(symbol, meta, fromDate, toDate, allocatedCapital, authorization) {
  const warmFrom = addDaysIso(fromDate, -40);
  const candles = await fetchChunked(authorization, meta.token, warmFrom, toDate);
  if (candles.length < 60) return { symbol, trades: [] };

  let startIndex = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].date.slice(0, 10) >= fromDate) {
      startIndex = Math.max(i, 15);
      break;
    }
  }

  const strategy = createTrapStrategyV2();
  strategy.initialize({ extras: { entryWindows: '' } }); // clear the Nifty-specific time filter

  const dayStopRs = allocatedCapital * 0.03;
  const dayLockRs = allocatedCapital * 0.05;

  const trades = [];
  let open = null;
  let dayKey = null;
  let dayNet = 0;
  let dayTradeCount = 0;
  let dayStopped = false;

  for (let i = startIndex; i < candles.length; i += 1) {
    const c = candles[i];
    const day = c.date.slice(0, 10);
    if (day < fromDate || day > toDate) continue;
    if (day !== dayKey) {
      dayKey = day;
      dayNet = 0;
      dayTradeCount = 0;
      dayStopped = false;
      strategy.onTradeClosed?.(0, day); // let the engine's own day-state roll over too
    }

    const ctx = buildContext(candles, i, engineInstrumentId(symbol));
    const closes = candles.slice(Math.max(0, i - CONTEXT_WINDOW_BARS + 1), i + 1).map((x) => x.close);
    const price = c.close;

    // Rescale pierce/risk band to THIS stock's current price level, same %
    // Nifty uses. Recomputed every bar so it tracks price drift over 5 years.
    const dynamicExtras = {
      entryWindows: '',
      piercePts: Math.max(0.05, price * PIERCE_PCT),
      bankPiercePts: Math.max(0.05, price * PIERCE_PCT),
      minRiskPts: Math.max(0.02, price * MIN_RISK_PCT),
      maxRiskPts: Math.max(0.1, price * MAX_RISK_PCT),
      // armPeakTrailFloor divides profitLockArmRs by a hardcoded rupee-per-INDEX-POINT
      // constant (₹65) to get an arming threshold in "points" — meaningless for cash
      // equity, where a "point" here is ₹1 of raw share price. That mismatch armed the
      // early-exit floor after ~₹9 of favorable price move regardless of share price,
      // which is why trades on expensive stocks (Maruti, UltraTech) scalped out in
      // minutes. Disabled here so exits only come from the real structural stop, the
      // 3.5R target, or EOD — fewer, larger trades instead of thousands of tiny ones.
      profitLockArmRs: 0,
    };

    if (open) {
      const managedOpen = {
        direction: open.direction,
        entry: open.entry,
        stop: open.stop,
        target: open.target,
        entryTime: open.entryTime,
        trail: open.trail ?? null,
        peakMfePts: Math.max(
          open.peakMfePts ?? 0,
          open.direction === 'BUY' ? c.high - open.entry : open.entry - c.low,
        ),
        initialRiskPts: open.initialRiskPts,
        lotsMultiplier: 1,
        // No option marks — engine falls back to pure index/structural exit.
        optionPeakMfeRs: null,
        optionEntryPremium: null,
        optionBarLow: null,
        optionLotUnits: null,
      };
      strategy.updateSettings({ extras: dynamicExtras });
      const exit = strategy.exitLogic(c, managedOpen, closes, ctx);
      if (managedOpen.stop !== open.stop) open.stop = managedOpen.stop;
      open.peakMfePts = managedOpen.peakMfePts;

      const t = c.date.slice(11, 16);
      const forceEod = t >= '15:15';
      const exitPrice = exit ? exit.exitPrice : forceEod ? c.close : null;
      const reason = exit ? exit.reason : forceEod ? 'EOD square-off' : null;

      if (exitPrice != null) {
        const gross =
          open.direction === 'BUY' ? (exitPrice - open.entry) * open.shares : (open.entry - exitPrice) * open.shares;
        const charges = estimateEquityRoundTripCharges({
          entryPrice: open.direction === 'BUY' ? open.entry : exitPrice,
          exitPrice: open.direction === 'BUY' ? exitPrice : open.entry,
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
        strategy.onTradeClosed?.(open.direction === 'BUY' ? exitPrice - open.entry : open.entry - exitPrice, day);
        dayNet += net;
        dayTradeCount += 1;
        open = null;
        if (dayNet <= -dayStopRs || dayNet >= dayLockRs) dayStopped = true;
      }
      continue;
    }

    if (dayStopped) continue;
    if (dayTradeCount >= 3) continue;

    strategy.updateSettings({ extras: dynamicExtras });
    const signal = strategy.generateSignal(ctx);
    if (signal.action !== 'BUY' && signal.action !== 'SELL') continue;

    const shares = Math.max(1, Math.floor(allocatedCapital / signal.entryPrice));
    open = {
      direction: signal.action,
      entry: signal.entryPrice,
      stop: signal.stopLoss,
      target: signal.target,
      entryTime: c.date,
      shares,
      initialRiskPts: Math.abs(signal.entryPrice - signal.stopLoss),
      peakMfePts: 0,
      trail: null,
    };
  }

  return { symbol, trades };
}

async function main() {
  const [, , fromDate, toDate, capitalArg] = process.argv;
  const apiKey = process.env.KITE_API_KEY;
  const accessToken = process.env.KITE_ACCESS_TOKEN;
  if (!fromDate || !toDate) {
    console.error('Usage: node scripts/stock-trap-backtest.js <fromDate> <toDate> [capitalRs]');
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

  console.error(`Trap V2 (real engine) on stocks: ${symbols.join(', ')} · Rs${totalCapital} total · ${CANDLE_INTERVAL} candles`);

  const results = [];
  for (const sym of symbols) {
    console.error(`Fetching ${STOCKS[sym].label} (${CANDLE_INTERVAL})...`);
    const r = await backtestStock(sym, STOCKS[sym], fromDate, toDate, allocatedPerStock, authorization);
    console.error(`  ${sym}: ${r.trades.length} trades`);
    results.push(r);
  }

  const allTrades = results.flatMap((r) => r.trades);
  console.log(JSON.stringify({ fromDate, toDate, totalCapital, trades: allTrades }, null, 2));
}

main().catch((err) => {
  console.error('TRAP_STOCK_BACKTEST_ERROR:', err.message, err.stack);
  process.exit(1);
});
