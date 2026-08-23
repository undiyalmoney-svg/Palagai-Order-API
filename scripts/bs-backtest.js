#!/usr/bin/env node
/**
 * Multi-year Nifty Trap V2 backtest priced with Black-Scholes instead of
 * either (a) real option premiums (unavailable beyond the current/recent
 * weeks — see live/instrument-archive.js) or (b) the flat "index points ×
 * ₹/point" proxy used throughout reports/ historically.
 *
 * Drives the SAME strategy interface (createTrapStrategyV2) real live
 * trading uses, over REAL multi-year 5-min Nifty 50 index candles from
 * Kite. Only the option premium is modeled — everything else (signal
 * detection, entry/exit rules, peak-trail, day risk caps) is the real,
 * unmodified engine.
 *
 * Standalone and read-only: does not touch paper-desk-engine.ts or any
 * file the live desk / real orders depend on.
 *
 * Usage: node scripts/bs-backtest.js <fromDate> <toDate> [lots]
 * Env:   KITE_API_KEY, KITE_ACCESS_TOKEN
 */
const { createTrapStrategyV2 } = require('../live/strategy-core.cjs');
const { fetchHistorical5m } = require('../live/kite-market');
const { blackScholesPrice, realizedVolAnnualized } = require('../live/bs-option-pricer');
const { estimateRoundTripCharges } = require('../live/charge-entry-gate');
const { DAY_PROFIT_LOCK_RS, STRICT_DAY_STOP_RS } = require('../live/daily-desk-defaults');

const COOLDOWN_MIN = 12;

/**
 * Per-instrument contract spec. Lot sizes mirror daily-desk-defaults.js
 * (*_RS_PER_POINT), which is what the desk's money math already assumes.
 *
 * Expiry conventions are approximations of NSE history:
 *  - Nifty weekly moved Thu -> Tue around Sep 2025.
 *  - Bank Nifty weeklies were discontinued ~Nov 2024; monthly (last Tue) after.
 * Time-to-expiry drives theta in the BS model, so these matter; they are
 * modelled to the right week but not to holiday-shifted exact dates.
 */
const INSTRUMENTS = {
  nifty: {
    id: 'nifty-50',
    label: 'Nifty 50',
    token: 256265,
    lotSize: 65,
    strikeStep: 50,
    expiry: 'weekly',
  },
  bank: {
    id: 'bank-nifty',
    label: 'Bank Nifty',
    token: 260105,
    lotSize: 30,
    strikeStep: 100,
    expiry: 'bank',
  },
};
const RISK_FREE_RATE = 0.065;
/** Matches live-path.js's fillFrictionPremium — BS has no bid-ask spread of
 * its own, so without this every fill is an unrealistically perfect midpoint. */
const FILL_FRICTION_RS = 0.5;
/** Approximate — NSE moved Nifty weekly expiry Thu→Tue "in Sep 2025" (exact date not in source comments). */
const EXPIRY_DOW_SWITCH_DATE = '2025-09-01';
const MAX_KITE_DAYS_PER_REQUEST = 95; // Kite caps at 100; stay under with margin

function addDaysIso(dateIso, delta) {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function daysBetweenIso(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / (24 * 60 * 60 * 1000),
  );
}

function dayOfWeekUTC(dateIso) {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function nextWeeklyIso(dateIso, targetDow) {
  const dow = dayOfWeekUTC(dateIso);
  let add = (targetDow - dow + 7) % 7;
  if (add === 0) add = 7; // never same-day expiry — always roll
  return addDaysIso(dateIso, add);
}

/** Last `dow` of the month containing dateIso; rolls to next month if passed. */
function lastDowOfMonthIso(dateIso, dow) {
  const [y, m] = dateIso.split('-').map(Number);
  const pick = (yy, mm) => {
    const last = new Date(Date.UTC(yy, mm, 0)); // last day of month mm (1-based)
    const back = (last.getUTCDay() - dow + 7) % 7;
    last.setUTCDate(last.getUTCDate() - back);
    return last.toISOString().slice(0, 10);
  };
  let iso = pick(y, m);
  if (iso <= dateIso) {
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    iso = pick(ny, nm);
  }
  return iso;
}

/** Bank Nifty: weekly Wed until ~Nov 2024, monthly last-Tue after. */
const BANK_WEEKLY_END_DATE = '2024-11-20';

function nextExpiryIso(dateIso, kind = 'weekly') {
  if (kind === 'bank') {
    return dateIso >= BANK_WEEKLY_END_DATE
      ? lastDowOfMonthIso(dateIso, 2)
      : nextWeeklyIso(dateIso, 3); // Wed
  }
  return nextWeeklyIso(dateIso, dateIso >= EXPIRY_DOW_SWITCH_DATE ? 2 : 4);
}

function yearsBetween(dateTimeIso, expiryDateIso) {
  const d = String(dateTimeIso).slice(0, 10);
  const days = daysBetweenIso(d, expiryDateIso);
  // Intraday fraction: assume entry mid-session, ~0.4 of a trading day left today.
  const fracToday = expiryDateIso === d ? 0.15 : 0.4;
  return Math.max(0, (days + fracToday) / 365);
}

async function fetchHistorical5mChunked(authorization, token, fromDate, toDate) {
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

function buildContext(candles, index, instrumentId) {
  const candle5m = candles[index];
  const causal = candles.slice(0, index + 1);
  return {
    candle60m: { ...candle5m },
    candle30m: { ...candle5m },
    candle15m: { ...candle5m },
    candle5m,
    previous60m: [],
    previous30m: [],
    previous15m: [],
    previous5m: candles.slice(0, index),
    candleIndex5m: index,
    replayStepIndex: index,
    replayFrom: candles[0]?.date ?? candle5m.date,
    replayTo: candle5m.date,
    instrumentId,
    series5m: causal,
  };
}

function roundStrike(spot, step) {
  return Math.round(spot / step) * step;
}

/** CE value rises with spot, PE falls — map candle high/low to option high/low accordingly. */
function optionHighLow(type, candle, strike, tYears, vol, r) {
  const spotForHigh = type === 'CE' ? candle.high : candle.low;
  const spotForLow = type === 'CE' ? candle.low : candle.high;
  return {
    high: blackScholesPrice(spotForHigh, strike, tYears, vol, r, type),
    low: blackScholesPrice(spotForLow, strike, tYears, vol, r, type),
  };
}

async function main() {
  const [, , fromDate, toDate, lotsArg, instArg] = process.argv;
  const instKey = (instArg || process.env.BS_INSTRUMENT || 'nifty').toLowerCase();
  const INST = INSTRUMENTS[instKey];
  if (!INST) {
    console.error(`Unknown instrument "${instKey}". Options: ${Object.keys(INSTRUMENTS).join(', ')}`);
    process.exit(1);
  }
  const apiKey = process.env.KITE_API_KEY;
  const accessToken = process.env.KITE_ACCESS_TOKEN;
  if (!fromDate || !toDate) {
    console.error('Usage: node scripts/bs-backtest.js <fromDate> <toDate> [lots] [nifty|bank]');
    process.exit(1);
  }
  if (!apiKey || !accessToken) {
    console.error('Set KITE_API_KEY and KITE_ACCESS_TOKEN env vars');
    process.exit(1);
  }
  const lots = Math.max(1, Math.floor(Number(lotsArg)) || 1);
  const authorization = `token ${apiKey}:${accessToken}`;

  const VOL_WARMUP_DAYS = 40; // trading-day-ish calendar buffer for realized-vol lookback
  const warmFrom = addDaysIso(fromDate, -VOL_WARMUP_DAYS);

  console.error(`Fetching ${INST.label} 5-min candles ${warmFrom} -> ${toDate} (chunked)...`);
  const candles = await fetchHistorical5mChunked(
    authorization,
    INST.token,
    warmFrom,
    toDate,
  );
  console.error(`Fetched ${candles.length} candles.`);
  if (candles.length < 100) {
    console.error('Not enough candle history returned — aborting.');
    process.exit(1);
  }

  // Daily closes (causal) for the realized-vol estimator.
  const dailyCloseByDate = new Map();
  for (const c of candles) {
    dailyCloseByDate.set(c.date.slice(0, 10), c.close);
  }
  const dailyDates = [...dailyCloseByDate.keys()].sort();
  const dailyCloses = dailyDates.map((d) => dailyCloseByDate.get(d));
  const dailyIndexOfDate = new Map(dailyDates.map((d, i) => [d, i]));

  const strategy = createTrapStrategyV2();
  // DISABLE_TRAIL=1 arms the peak-trail at an unreachable level so trades
  // only close via structural stop/target/EOD — isolates the signal's
  // "clean" edge from the friction-sensitive ₹100/₹50/₹50 micro-trail.
  if (process.env.DISABLE_TRAIL) {
    strategy.initialize({ extras: { profitLockArmRs: 1e9, profitLockLockRs: 1e9, profitLockGivebackRs: 0 } });
    console.error('Peak-trail DISABLED — structural SL/target/EOD exits only.');
  } else if (process.env.TRAIL_ARM_RS) {
    const arm = Number(process.env.TRAIL_ARM_RS);
    const lock = Math.round(arm / 2);
    const giveback = Math.round(arm / 2);
    strategy.initialize({
      extras: { profitLockArmRs: arm, profitLockLockRs: lock, profitLockGivebackRs: giveback },
    });
    console.error(`Peak-trail set to arm₹${arm}/lock₹${lock}/giveback₹${giveback}.`);
  } else if (process.env.TARGET_R) {
    // Lower R:R -> higher win rate -> fewer red days, smaller wins. This is the
    // only structural lever on red-day COUNT that does not depend on the
    // spread-fragile micro-trail.
    const rr = Number(process.env.TARGET_R);
    strategy.initialize({
      targetRMultiple: rr,
      extras: { profitLockArmRs: 1e9, profitLockLockRs: 1e9, profitLockGivebackRs: 0 },
    });
    console.error(`Target ${rr}R, peak-trail OFF.`);
  } else {
    strategy.initialize();
  }

  let startIndex = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].date.slice(0, 10) >= fromDate) {
      startIndex = Math.max(i, 40);
      break;
    }
  }

  const trades = [];
  let open = null; // { direction, entry, stop, target, entryTime, strike, expiry, optionType, optionEntryPremium, optionPeakMfeRs, optionBarLow, optionLotUnits, lotsMultiplier, initialRiskPts }
  let dayKey = null;
  let dayNet = 0;
  let dayTradeCount = 0;
  let dayStopped = false;
  let lastExitAt = null;

  function volAt(dateIso) {
    const di = dailyIndexOfDate.get(dateIso);
    if (di == null) return 0.13;
    return realizedVolAnnualized(dailyCloses, di, 20);
  }

  for (let i = startIndex; i < candles.length; i += 1) {
    const candle = candles[i];
    const day = candle.date.slice(0, 10);
    if (day < fromDate || day > toDate) continue;
    if (day !== dayKey) {
      dayKey = day;
      dayNet = 0;
      dayTradeCount = 0;
      dayStopped = false;
    }

    const ctx = buildContext(candles, i, INST.id);
    const closes = candles.slice(0, i + 1).map((c) => c.close);
    const vol = volAt(day);

    if (open) {
      const tYears = yearsBetween(candle.date, open.expiry);
      const hl = optionHighLow(open.optionType, candle, open.strike, tYears, vol, RISK_FREE_RATE);
      const peakRs = Math.max(
        0,
        Math.round((hl.high - open.optionEntryPremium) * open.optionLotUnits * 100) / 100,
      );
      open.optionPeakMfeRs = Math.max(open.optionPeakMfeRs, peakRs);
      open.optionBarLow = hl.low;

      const managedOpen = {
        direction: open.direction,
        entry: open.entry,
        stop: open.stop,
        target: open.target,
        entryTime: open.entryTime,
        peakMfePts:
          open.direction === 'BUY' ? candle.high - open.entry : open.entry - candle.low,
        initialRiskPts: open.initialRiskPts,
        optionPeakMfeRs: open.optionPeakMfeRs,
        optionEntryPremium: open.optionEntryPremium,
        optionBarLow: open.optionBarLow,
        optionLotUnits: open.optionLotUnits,
        lotsMultiplier: lots,
      };
      const exit = strategy.exitLogic(candle, managedOpen, closes, ctx);
      if (managedOpen.stop !== open.stop) open.stop = managedOpen.stop;

      if (exit) {
        const exitTYears = yearsBetween(candle.date, open.expiry);
        const rawExitPremium =
          exit.optionExitPremium != null
            ? exit.optionExitPremium
            : blackScholesPrice(
                exit.exitPrice,
                open.strike,
                exitTYears,
                vol,
                RISK_FREE_RATE,
                open.optionType,
              );
        // Sell-side friction: real fills happen at bid, not theoretical mid.
        const optionExitPremium = Math.max(0.05, rawExitPremium - FILL_FRICTION_RS);
        const grossRs =
          Math.round(
            (optionExitPremium - open.optionEntryPremium) * open.optionLotUnits * 100,
          ) / 100;
        const charges = estimateRoundTripCharges({
          entryPrice: open.optionEntryPremium,
          exitPrice: optionExitPremium,
          quantity: open.optionLotUnits,
        });
        const netRs = Math.round((grossRs - (charges.totalRs || 0)) * 100) / 100;
        const indexPoints =
          open.direction === 'BUY' ? exit.exitPrice - open.entry : open.entry - exit.exitPrice;

        trades.push({
          entryTime: open.entryTime,
          exitTime: candle.date,
          direction: open.direction,
          strike: open.strike,
          optionType: open.optionType,
          expiry: open.expiry,
          indexEntry: open.entry,
          indexExit: exit.exitPrice,
          indexPoints: Math.round(indexPoints * 100) / 100,
          optionEntryPremium: open.optionEntryPremium,
          optionExitPremium,
          grossRs,
          chargesRs: Math.round((charges.totalRs || 0) * 100) / 100,
          netRs,
          exitReason: exit.reason,
        });

        strategy.onTradeClosed?.(indexPoints, day);
        dayNet += netRs;
        dayTradeCount += 1;
        lastExitAt = candle.date;
        open = null;
        if (dayNet <= -STRICT_DAY_STOP_RS * lots || dayNet >= DAY_PROFIT_LOCK_RS * lots) {
          dayStopped = true;
        }
      }
      continue;
    }

    if (dayStopped) continue;
    if (dayTradeCount >= 3) continue; // matches TRAP_V2 maxTradesPerDay
    if (lastExitAt) {
      const minsSince = (new Date(candle.date) - new Date(lastExitAt)) / 60000;
      if (minsSince < COOLDOWN_MIN) continue;
    }

    const signal = strategy.generateSignal(ctx);
    if (signal.action !== 'BUY' && signal.action !== 'SELL') continue;

    const strike = roundStrike(signal.entryPrice, INST.strikeStep);
    const expiry = nextExpiryIso(day, INST.expiry);
    const optionType = signal.action === 'BUY' ? 'CE' : 'PE';
    const tYears = yearsBetween(candle.date, expiry);
    const rawEntryPremium = blackScholesPrice(
      signal.entryPrice,
      strike,
      tYears,
      vol,
      RISK_FREE_RATE,
      optionType,
    );
    // Buy-side friction: real fills happen at ask, not theoretical mid.
    const optionEntryPremium = rawEntryPremium + FILL_FRICTION_RS;

    open = {
      direction: signal.action,
      entry: signal.entryPrice,
      stop: signal.stopLoss,
      target: signal.target,
      entryTime: candle.date,
      strike,
      expiry,
      optionType,
      optionEntryPremium,
      optionPeakMfeRs: 0,
      optionBarLow: optionEntryPremium,
      optionLotUnits: INST.lotSize * lots,
      initialRiskPts: Math.abs(signal.entryPrice - signal.stopLoss),
    };
  }

  // Summary
  const wins = trades.filter((t) => t.netRs > 0).length;
  const losses = trades.filter((t) => t.netRs < 0).length;
  const netRs = Math.round(trades.reduce((a, t) => a + t.netRs, 0) * 100) / 100;
  const grossWin = trades.filter((t) => t.netRs > 0).reduce((a, t) => a + t.netRs, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.netRs < 0).reduce((a, t) => a + t.netRs, 0));
  const profitFactor = grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null;

  const byDate = new Map();
  for (const t of trades) {
    const d = t.entryTime.slice(0, 10);
    byDate.set(d, (byDate.get(d) || 0) + t.netRs);
  }
  const dayNets = [...byDate.values()];
  const greenDays = dayNets.filter((n) => n > 0).length;
  const redDays = dayNets.filter((n) => n < 0).length;

  let peak = 0;
  let running = 0;
  let maxDrawdown = 0;
  for (const d of [...byDate.keys()].sort()) {
    running += byDate.get(d);
    peak = Math.max(peak, running);
    maxDrawdown = Math.min(maxDrawdown, running - peak);
  }

  const summary = {
    instrument: INST.label,
    instrumentId: INST.id,
    lotSize: INST.lotSize,
    fromDate,
    toDate,
    lots,
    method:
      'Black-Scholes modeled premiums over REAL Kite 5-min Nifty index candles ' +
      '(realized-vol-based IV, real time-to-expiry decay). Not real fills/spreads — ' +
      'a materially better proxy than flat points×₹/point, still not a live-fill guarantee.',
    trades: trades.length,
    wins,
    losses,
    winRatePct: trades.length ? Math.round((wins / trades.length) * 1000) / 10 : null,
    netRs,
    profitFactor,
    tradingDays: dayNets.length,
    greenDays,
    redDays,
    redDayPct: dayNets.length ? Math.round((redDays / dayNets.length) * 1000) / 10 : null,
    avgPerDayRs: dayNets.length ? Math.round((netRs / dayNets.length) * 100) / 100 : null,
    maxDrawdownRs: Math.round(maxDrawdown * 100) / 100,
  };

  console.log(JSON.stringify({ summary, trades }, null, 2));
}

main().catch((err) => {
  console.error('BS_BACKTEST_ERROR:', err.message);
  process.exit(1);
});
