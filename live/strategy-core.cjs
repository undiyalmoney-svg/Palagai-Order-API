"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// scripts/server-live/bundle-entry.ts
var bundle_entry_exports = {};
__export(bundle_entry_exports, {
  BANK_NIFTY_INSTRUMENT: () => BANK_NIFTY_INSTRUMENT,
  CRUDE_OIL_MINI_INSTRUMENT: () => CRUDE_OIL_MINI_INSTRUMENT,
  NIFTY_50_INSTRUMENT: () => NIFTY_50_INSTRUMENT,
  applySlConfirmCutoff: () => applySlConfirmCutoff,
  armPeakTrailFloor: () => armPeakTrailFloor,
  computeProtectiveSlTrigger: () => computeProtectiveSlTrigger,
  createGenieStrategy: () => createGenieStrategy,
  createTrapStrategy: () => createTrapStrategy,
  effectiveProtectiveStop: () => effectiveProtectiveStop,
  evaluateOptionPeakTrail: () => evaluateOptionPeakTrail,
  optionPeakTrailSettingsFromExtras: () => optionPeakTrailSettingsFromExtras,
  replayPaperOnCrude: () => replayPaperOnCrude,
  replayPaperOnIndex: () => replayPaperOnIndex,
  resolveAtmCrudeMiniOption: () => resolveAtmCrudeMiniOption,
  resolveAtmWeeklyOption: () => resolveAtmWeeklyOption,
  resolveCrudeOilMiniFuturesToken: () => resolveCrudeOilMiniFuturesToken,
  resolveCrudeProfileDayLossPts: () => resolveCrudeProfileDayLossPts,
  resolveCrudeStrategyProfile: () => resolveCrudeStrategyProfile
});
module.exports = __toCommonJS(bundle_entry_exports);

// src/app/core/constants/instruments.const.ts
var NIFTY_50_INSTRUMENT = {
  id: "nifty-50",
  instrumentToken: 256265,
  tradingSymbol: "NIFTY 50",
  name: "NIFTY 50",
  exchange: "NSE"
};
var BANK_NIFTY_INSTRUMENT = {
  id: "bank-nifty",
  instrumentToken: 260105,
  tradingSymbol: "NIFTY BANK",
  name: "Bank Nifty",
  exchange: "NSE"
};
var CRUDE_OIL_MINI_INSTRUMENT = {
  id: "crude-oil-mini",
  instrumentToken: 0,
  tradingSymbol: "CRUDEOILM",
  name: "Crude Oil Mini",
  exchange: "MCX"
};
var TESTER_TAB_IDS = [NIFTY_50_INSTRUMENT.id, BANK_NIFTY_INSTRUMENT.id];

// src/app/core/config/session.config.ts
var NSE_SESSION = {
  marketOpen: "09:15",
  marketClose: "15:30",
  sessionCloseCandle: "15:15",
  lastEntryTime: "14:15",
  firstHourReadyTime: "10:15",
  firstHourEnd: "10:15",
  timezone: "Asia/Kolkata",
  sessionCloseLabel: "Market close (15:15 candle)"
};
var MCX_CRUDE_SESSION = {
  marketOpen: "09:00",
  marketClose: "23:15",
  sessionCloseCandle: "23:15",
  lastEntryTime: "22:15",
  firstHourReadyTime: "10:00",
  firstHourEnd: "10:00",
  timezone: "Asia/Kolkata",
  sessionCloseLabel: "Market close (23:15 candle)"
};
function resolveSessionConfig(params) {
  const { instrumentId, exchange, instrumentToken } = params ?? {};
  if (instrumentId === "crude-oil" || instrumentId === "crude-oil-mini" || exchange === "MCX" || instrumentToken === 520702) {
    return MCX_CRUDE_SESSION;
  }
  return NSE_SESSION;
}

// src/app/core/utils/trade-date.util.ts
function extractTradeDate(timestamp) {
  if (timestamp.includes("T")) {
    return timestamp.split("T")[0];
  }
  return timestamp.slice(0, 10);
}

// src/app/core/strategy-engine/utils/market-session.util.ts
var SESSION_CLOSE_CANDLE = NSE_SESSION.sessionCloseCandle;
function hasExplicitOffset(dateTime) {
  return /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(dateTime.trim());
}
function parseMarketTimestamp(dateTime) {
  const normalized = dateTime.includes("T") ? dateTime : dateTime.replace(" ", "T");
  if (!hasExplicitOffset(normalized)) {
    return (/* @__PURE__ */ new Date(`${normalized}+05:30`)).getTime();
  }
  return new Date(normalized).getTime();
}
function extractHhMm(dateTime, timezone = NSE_SESSION.timezone) {
  if (!hasExplicitOffset(dateTime)) {
    const normalized = dateTime.includes("T") ? dateTime.replace("T", " ") : dateTime;
    const part = (normalized.split(/\s+/)[1] ?? "").slice(0, 5);
    if (/^\d{2}:\d{2}$/.test(part)) {
      return part;
    }
  }
  const ts = parseMarketTimestamp(dateTime);
  if (Number.isNaN(ts)) {
    const normalized = dateTime.includes("T") ? dateTime.replace("T", " ") : dateTime;
    return (normalized.split(" ")[1] ?? "").slice(0, 5);
  }
  return new Date(ts).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone
  });
}
function resolveSessionFromContext(ctx) {
  if (ctx?.session) {
    return ctx.session;
  }
  return resolveSessionConfig({ instrumentId: ctx?.instrumentId });
}

// src/app/core/strategy-engine/utils/signal-debug.util.ts
function buildSignalDebug(params) {
  return {
    marketRegime: params.marketRegime,
    strategyStatus: params.strategyStatus,
    currentStep: params.currentStep,
    blockingRule: params.blockingRule,
    expectedValue: params.expectedValue ?? "\u2014",
    actualValue: params.actualValue ?? "\u2014",
    nextConditionRequired: params.nextConditionRequired ?? "\u2014",
    steps: params.steps ?? [],
    entryQuality: params.entryQuality
  };
}

// src/app/core/strategy-engine/strategies/pdhl-opening-range/pdhl-opening-range.evaluator.ts
function createPdhlOrState() {
  return {
    tradingDate: null,
    dayNetPts: 0,
    tradesToday: 0,
    lossesToday: 0,
    winsToday: 0,
    dayStoppedReason: null
  };
}
var PDHL_RUPEES_PER_POINT = 65;
var PDHL_BANK_RUPEES_PER_POINT = 30;
var PDHL_NIFTY_PARAMS = {
  maxStopPts: 30,
  minStopPts: 3,
  targetRMultiple: 1,
  dailyProfitLockPts: 0,
  dailyMaxLossPts: 60,
  earliestEntry: "09:20",
  lastEntry: "15:10",
  weekdayRules: {
    2: { earliestEntry: "11:30", maxTrades: 3 },
    // Tue
    3: { earliestEntry: "11:00", maxOrWidth: 90 },
    // Wed — OR filter turns Wed green
    5: { earliestEntry: "11:30", maxTrades: 3 }
    // Fri
  },
  dna: "opening_range|swing|breakout|cap30|r_1|whole_day|ema_exit|L0|S60|TueFri_1130_x3|Wed_OR90"
};
var PDHL_BANK_PARAMS = {
  maxStopPts: 45,
  minStopPts: 3,
  targetRMultiple: 1,
  dailyProfitLockPts: 0,
  dailyMaxLossPts: 60,
  earliestEntry: "09:20",
  lastEntry: "15:10",
  weekdayRules: {
    2: { earliestEntry: "11:30", maxTrades: 2 },
    // Tue
    3: { earliestEntry: "11:30", maxTrades: 2 },
    // Wed
    5: { earliestEntry: "11:30", maxTrades: 2 }
    // Fri
  },
  dna: "opening_range|swing|breakout|cap45|r_1|whole_day|ema_exit|L0|S60|TueWedFri_1130_x2"
};
var DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function pdhlWeekdayNumber(tradingDate) {
  return (/* @__PURE__ */ new Date(`${tradingDate}T12:00:00`)).getDay();
}
function pdhlWeekdayRule(tradingDate, p) {
  const rule = p.weekdayRules?.[pdhlWeekdayNumber(tradingDate)];
  return rule ?? null;
}
function effectivePdhlEarliestEntry(tradingDate, p) {
  const raised = pdhlWeekdayRule(tradingDate, p)?.earliestEntry;
  if (!raised) {
    return p.earliestEntry;
  }
  return raised > p.earliestEntry ? raised : p.earliestEntry;
}
function effectivePdhlMaxTradesToday(tradingDate, p) {
  const cap = pdhlWeekdayRule(tradingDate, p)?.maxTrades ?? 0;
  if (cap <= 0) {
    return null;
  }
  return cap;
}
function effectivePdhlMaxOrWidth(tradingDate, p) {
  const w = pdhlWeekdayRule(tradingDate, p)?.maxOrWidth ?? 0;
  if (w <= 0) {
    return null;
  }
  return w;
}
function pdhlWeekdayLabel(tradingDate) {
  return DOW_SHORT[pdhlWeekdayNumber(tradingDate)] ?? "Day";
}
var PDHL_MAX_STOP_LOSS_PTS = PDHL_NIFTY_PARAMS.maxStopPts;
var PDHL_MIN_STOP_LOSS_PTS = PDHL_NIFTY_PARAMS.minStopPts;
var PDHL_TARGET_R_MULTIPLE = PDHL_NIFTY_PARAMS.targetRMultiple;
var PDHL_DAILY_PROFIT_LOCK_PTS = PDHL_NIFTY_PARAMS.dailyProfitLockPts;
var PDHL_DAILY_MAX_LOSS_PTS = PDHL_NIFTY_PARAMS.dailyMaxLossPts;
var PDHL_LAST_ENTRY_TIME = PDHL_NIFTY_PARAMS.lastEntry;
var PDHL_SWING_LOOKBACK = 3;
var PDHL_EMA_EXIT_PERIOD = 20;
function resolvePdhlOrParams(instrumentId) {
  const id = (instrumentId ?? "").toLowerCase();
  if (id === "bank-nifty" || id.includes("banknifty") || id.includes("bank-nifty")) {
    return PDHL_BANK_PARAMS;
  }
  return PDHL_NIFTY_PARAMS;
}
function isBankPdhlInstrument(instrumentId) {
  const id = (instrumentId ?? "").toLowerCase();
  return id === "bank-nifty" || id.includes("banknifty") || id.includes("bank-nifty");
}
function rupeesPerPointForInstrument(instrumentId) {
  const id = (instrumentId ?? "").toLowerCase();
  if (id === "natgas-mini" || id.includes("natgas") || id.includes("naturalgas")) {
    return 50;
  }
  if (id === "crude-oil-mini" || id === "crude-oil" || id.includes("crude")) {
    return 10;
  }
  return isBankPdhlInstrument(instrumentId) ? PDHL_BANK_RUPEES_PER_POINT : PDHL_RUPEES_PER_POINT;
}
function mergePdhlOrParams(instrumentId, overrides) {
  const base = resolvePdhlOrParams(instrumentId);
  if (!overrides) {
    return base;
  }
  return { ...base, ...overrides };
}
function recordPdhlTradeClosed(state, points, params = PDHL_NIFTY_PARAMS) {
  state.dayNetPts += points;
  state.tradesToday += 1;
  if (points < 0) {
    state.lossesToday += 1;
  } else if (points > 0) {
    state.winsToday += 1;
  }
  if (params.dailyProfitLockPts > 0 && state.dayNetPts >= params.dailyProfitLockPts) {
    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;
  } else if (params.dailyMaxLossPts > 0 && state.dayNetPts <= -params.dailyMaxLossPts) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
  }
}
function openingRange(dayBars, marketOpen, firstHourEnd) {
  const bars = dayBars.filter((c) => {
    const t = extractHhMm(c.date);
    return t >= marketOpen && t < firstHourEnd;
  });
  if (!bars.length) {
    return null;
  }
  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  return { high, low, mid: (high + low) / 2, range: high - low };
}
function swingAtIndex(series, index, lookback = PDHL_SWING_LOOKBACK) {
  if (index < 0 || index >= series.length || series.length < lookback * 2 + 1) {
    return null;
  }
  let lastH = NaN;
  let lastL = NaN;
  const maxPivot = Math.min(index, series.length - 1 - lookback);
  for (let i = lookback; i <= maxPivot; i += 1) {
    const bar = series[i];
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j += 1) {
      if (bar.high <= series[i - j].high || bar.high <= series[i + j].high) {
        isHigh = false;
      }
      if (bar.low >= series[i - j].low || bar.low >= series[i + j].low) {
        isLow = false;
      }
    }
    if (isHigh) {
      lastH = bar.high;
    }
    if (isLow) {
      lastL = bar.low;
    }
  }
  if (!Number.isFinite(lastH) || !Number.isFinite(lastL)) {
    return null;
  }
  return { high: lastH, low: lastL };
}
function emaLast(closes, period = PDHL_EMA_EXIT_PERIOD) {
  if (closes.length < period) {
    return null;
  }
  let sum = 0;
  for (let i = 0; i < period; i += 1) {
    sum += closes[i];
  }
  let prev = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i += 1) {
    prev = closes[i] * k + prev * (1 - k);
  }
  return prev;
}
function runPdhlOpeningRange(ctx, state, paramsOverride) {
  const p = mergePdhlOrParams(ctx.instrumentId, paramsOverride);
  const session = resolveSessionFromContext(ctx);
  const current = ctx.candle5m;
  const tradingDate = extractTradeDate(current.date);
  const time = extractHhMm(current.date, session.timezone);
  const all5m = [...ctx.previous5m, current];
  const series5m = ctx.series5m?.length ? ctx.series5m : all5m;
  const seriesIndex = ctx.series5m?.length ? ctx.candleIndex5m : all5m.length - 1;
  const dayBars = all5m.filter((c) => extractTradeDate(c.date) === tradingDate);
  if (state.tradingDate !== tradingDate) {
    state.tradingDate = tradingDate;
    state.dayNetPts = 0;
    state.tradesToday = 0;
    state.lossesToday = 0;
    state.winsToday = 0;
    state.dayStoppedReason = null;
  }
  const earliest = effectivePdhlEarliestEntry(tradingDate, p);
  const maxTradesToday = effectivePdhlMaxTradesToday(tradingDate, p);
  const maxOrWidth = effectivePdhlMaxOrWidth(tradingDate, p);
  const dayRule = pdhlWeekdayRule(tradingDate, p);
  const dayLabel = pdhlWeekdayLabel(tradingDate);
  const base = {
    tradingDate,
    time,
    strategy: "OR Swing Breakout",
    dna: p.dna,
    instrumentId: ctx.instrumentId ?? null,
    rupeesPerPoint: rupeesPerPointForInstrument(ctx.instrumentId),
    dayNetPts: state.dayNetPts,
    dayNetRs: state.dayNetPts * rupeesPerPointForInstrument(ctx.instrumentId),
    tradesToday: state.tradesToday,
    lossesToday: state.lossesToday,
    dailyProfitLock: p.dailyProfitLockPts,
    dailyMaxLoss: p.dailyMaxLossPts,
    maxStopPts: p.maxStopPts,
    earliestEntry: earliest,
    baseEarliestEntry: p.earliestEntry,
    weekdayRule: dayRule,
    weekdayLabel: dayLabel,
    maxOrWidth
  };
  if (time < session.marketOpen) {
    return waiting(current, "Before market open", base);
  }
  if (time < session.firstHourReadyTime) {
    return waiting(
      current,
      `Waiting for opening range (${session.marketOpen}\u2013${session.firstHourEnd})`,
      base
    );
  }
  if (state.dayStoppedReason) {
    return noTrade(current, state.dayStoppedReason, base);
  }
  if (p.dailyProfitLockPts > 0 && state.dayNetPts >= p.dailyProfitLockPts) {
    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;
    return noTrade(current, state.dayStoppedReason, base);
  }
  if (p.dailyMaxLossPts > 0 && state.dayNetPts <= -p.dailyMaxLossPts) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
    return noTrade(current, state.dayStoppedReason, base);
  }
  if (maxTradesToday != null && state.tradesToday >= maxTradesToday) {
    return noTrade(
      current,
      `${dayLabel} trade cap reached (${state.tradesToday}/${maxTradesToday})`,
      base
    );
  }
  if (time < earliest || time > p.lastEntry) {
    const delayHint = dayRule?.earliestEntry && earliest !== p.earliestEntry ? ` \xB7 ${dayLabel} delay until ${earliest}` : "";
    return waiting(
      current,
      `Outside entry window (${earliest}\u2013${p.lastEntry})${delayHint}`,
      base
    );
  }
  const or = openingRange(dayBars, session.marketOpen, session.firstHourEnd);
  if (!or) {
    return waiting(current, "Opening range unavailable", base);
  }
  if (maxOrWidth != null && or.range >= maxOrWidth) {
    return noTrade(
      current,
      `${dayLabel}: OR width ${or.range.toFixed(1)} \u2265 ${maxOrWidth} \u2014 no trade`,
      { ...base, orHigh: or.high, orLow: or.low, orWidth: or.range }
    );
  }
  const bias = current.close >= or.mid ? "BUY" : "SELL";
  const swing = swingAtIndex(series5m, seriesIndex, PDHL_SWING_LOOKBACK);
  if (!swing) {
    return waiting(current, "Swing high/low not ready", {
      ...base,
      bias,
      orHigh: or.high,
      orLow: or.low
    });
  }
  let action = null;
  if (bias === "BUY" && current.close > swing.high) {
    action = "BUY";
  } else if (bias === "SELL" && current.close < swing.low) {
    action = "SELL";
  }
  if (!action) {
    return waiting(current, "Waiting for OR bias + swing breakout", {
      ...base,
      bias,
      orHigh: or.high,
      orLow: or.low,
      swingHigh: swing.high,
      swingLow: swing.low
    });
  }
  const entry = current.close;
  let stopLoss = action === "BUY" ? current.low : current.high;
  let risk = Math.abs(entry - stopLoss);
  if (risk < p.minStopPts) {
    return waiting(current, `Risk ${risk.toFixed(1)} < min ${p.minStopPts}`, {
      ...base,
      bias,
      swingHigh: swing.high,
      swingLow: swing.low
    });
  }
  if (risk > p.maxStopPts) {
    stopLoss = action === "BUY" ? entry - p.maxStopPts : entry + p.maxStopPts;
    risk = p.maxStopPts;
  }
  if (p.dailyMaxLossPts > 0 && state.dayNetPts - risk < -p.dailyMaxLossPts) {
    return noTrade(
      current,
      `Next SL would breach day max loss (day ${state.dayNetPts.toFixed(1)}, risk ${risk.toFixed(1)})`,
      base
    );
  }
  const targetPts = risk * p.targetRMultiple;
  const target = action === "BUY" ? entry + targetPts : entry - targetPts;
  const rr = p.targetRMultiple;
  const targetRs = targetPts * PDHL_RUPEES_PER_POINT;
  const debug = buildSignalDebug({
    marketRegime: String(ctx.marketRegime ?? "N/A"),
    strategyStatus: "PASS",
    currentStep: "Entry",
    blockingRule: "None",
    expectedValue: action,
    actualValue: action,
    nextConditionRequired: "Trade execution",
    steps: [
      { name: "Day Budget", status: "PASS", actualValue: `${state.dayNetPts.toFixed(1)} pts` },
      { name: "OR Bias", status: "PASS", actualValue: bias },
      { name: "Swing Breakout", status: "PASS", actualValue: `${swing.low.toFixed(1)}\u2013${swing.high.toFixed(1)}` },
      { name: "Target", status: "PASS", actualValue: `${targetPts.toFixed(1)} pts (${rr}R)` }
    ]
  });
  return {
    action,
    entryPrice: entry,
    stopLoss,
    target,
    riskRewardRatio: rr,
    reason: `${action} #${state.tradesToday + 1} \u2014 swing breakout, ${rr}R | day ${state.dayNetPts.toFixed(1)}`,
    analysis: {
      ...base,
      bias,
      pattern: "swing_breakout",
      orHigh: or.high,
      orLow: or.low,
      swingHigh: swing.high,
      swingLow: swing.low,
      riskPts: risk,
      targetPts,
      targetRs,
      riskRs: risk * PDHL_RUPEES_PER_POINT,
      finalDecision: action,
      debug
    }
  };
}
function waiting(candle, reason, analysis) {
  return {
    action: "WAITING",
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { ...analysis, finalDecision: "WAITING", currentStep: reason }
  };
}
function noTrade(candle, reason, analysis) {
  return {
    action: "NO_TRADE",
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { ...analysis, finalDecision: "NO_TRADE" }
  };
}

// src/app/core/utils/option-chain.util.ts
var NIFTY_WEEKLY_DOW = 2;
function strikeStep(kind) {
  return kind === "banknifty" ? 100 : 50;
}
function roundAtmStrike(spot, kind) {
  const step = strikeStep(kind);
  return Math.round(spot / step) * step;
}
function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function istCalendarDay(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
function parseExpiry(expiry) {
  if (!expiry) {
    return null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  }
  const d = new Date(expiry.includes("T") ? expiry : `${expiry}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}
function asOfCalendarDay(asOf) {
  return istCalendarDay(asOf);
}
function optionName(kind) {
  return kind === "banknifty" ? "BANKNIFTY" : "NIFTY";
}
function isIndexOption(item, kind) {
  if (item.exchange !== "NFO") {
    return false;
  }
  if (item.instrumentType !== "CE" && item.instrumentType !== "PE") {
    return false;
  }
  const sym = item.tradingSymbol.toUpperCase();
  const nm = (item.name || "").toUpperCase();
  if (kind === "banknifty") {
    return sym.startsWith("BANKNIFTY") || nm === "BANKNIFTY";
  }
  if (sym.startsWith("BANKNIFTY") || nm === "BANKNIFTY") {
    return false;
  }
  if (sym.startsWith("FINNIFTY") || nm === "FINNIFTY") {
    return false;
  }
  if (sym.startsWith("MIDCPNIFTY") || nm === "MIDCPNIFTY") {
    return false;
  }
  if (sym.startsWith("NIFTYNXT")) {
    return false;
  }
  return sym.startsWith("NIFTY") || nm === "NIFTY";
}
function lastTuesdayOfMonth(year, month) {
  const last = new Date(year, month + 1, 0);
  last.setHours(0, 0, 0, 0);
  const back = (last.getDay() - NIFTY_WEEKLY_DOW + 7) % 7;
  last.setDate(last.getDate() - back);
  return last;
}
function nextMonthlyExpiryDate(asOf, rollSameDay) {
  const day = asOfCalendarDay(asOf);
  let year = day.getFullYear();
  let month = day.getMonth();
  for (let i = 0; i < 4; i += 1) {
    const candidate = lastTuesdayOfMonth(year, month);
    if (candidate.getTime() > day.getTime()) {
      return candidate;
    }
    if (candidate.getTime() === day.getTime() && !rollSameDay) {
      return candidate;
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return lastTuesdayOfMonth(year, month);
}
function nextWeeklyExpiryDate(asOf, rollSameDay, kind = "nifty") {
  if (kind === "banknifty") {
    return nextMonthlyExpiryDate(asOf, rollSameDay);
  }
  const day = asOfCalendarDay(asOf);
  const dow = day.getDay();
  let add = (NIFTY_WEEKLY_DOW - dow + 7) % 7;
  if (add === 0 && rollSameDay) {
    add = 7;
  }
  const exp = new Date(day);
  exp.setDate(exp.getDate() + add);
  return exp;
}
function isCurrentWeeklyExpiryDay(asOfDay, instruments, kind) {
  const day = asOfCalendarDay(asOfDay);
  const chain = instruments ?? [];
  const expiresToday = chain.some((item) => {
    if (!isIndexOption(item, kind)) {
      return false;
    }
    if (item.instrumentType !== "CE" && item.instrumentType !== "PE") {
      return false;
    }
    const exp = parseExpiry(item.expiry);
    return exp != null && exp.getTime() === day.getTime();
  });
  if (expiresToday) {
    return true;
  }
  if (kind === "banknifty") {
    return nextMonthlyExpiryDate(day, false).getTime() === day.getTime();
  }
  return day.getDay() === NIFTY_WEEKLY_DOW;
}
function shouldRollWeeklyExpiry(params) {
  const asOfDay = asOfCalendarDay(params.asOf);
  return isCurrentWeeklyExpiryDay(asOfDay, params.instruments, params.kind);
}
function formatExpiryIso(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function formatExpiryLabel(d) {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata"
  });
}
function defaultLot(kind) {
  return kind === "banknifty" ? 30 : 65;
}
function buildSyntheticAtmOption(params) {
  const asOf = new Date(
    params.asOfDateTime.includes("T") ? params.asOfDateTime : params.asOfDateTime.replace(" ", "T")
  );
  const asOfSafe = Number.isNaN(asOf.getTime()) ? /* @__PURE__ */ new Date() : asOf;
  const asOfDay = asOfCalendarDay(asOfSafe);
  const rollSameDay = shouldRollWeeklyExpiry({
    asOf: asOfSafe,
    instruments: params.instruments ?? [],
    kind: params.kind
  });
  const exp = nextWeeklyExpiryDate(asOfDay, rollSameDay, params.kind);
  const name = optionName(params.kind);
  const optType = params.direction === "BUY" ? "CE" : "PE";
  const strike = roundAtmStrike(params.spot, params.kind);
  const expiryIso = formatExpiryIso(exp);
  return {
    instrumentToken: 0,
    exchangeToken: 0,
    tradingSymbol: `${name} ATM ${strike} ${optType}`,
    name,
    exchange: "NFO",
    segment: "NFO-OPT",
    instrumentType: optType,
    expiry: expiryIso,
    strike,
    tickSize: 0.05,
    lotSize: defaultLot(params.kind),
    lastPrice: 0
  };
}
function maxFrontExpiryDays(kind) {
  return kind === "banknifty" ? 45 : 10;
}
function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1e3));
}
function resolveAtmWeeklyOption(params) {
  const { instruments, kind, direction, spot } = params;
  const asOf = new Date(
    params.asOfDateTime.includes("T") ? params.asOfDateTime : params.asOfDateTime.replace(" ", "T")
  );
  if (Number.isNaN(asOf.getTime())) {
    return {
      instrument: buildSyntheticAtmOption(params),
      source: "synthetic"
    };
  }
  const asOfDay = asOfCalendarDay(asOf);
  const rollSameDay = shouldRollWeeklyExpiry({
    asOf,
    instruments,
    kind
  });
  const optType = direction === "BUY" ? "CE" : "PE";
  const strike = roundAtmStrike(spot, kind);
  const step = strikeStep(kind);
  const expected = nextWeeklyExpiryDate(asOfDay, rollSameDay, kind);
  const maxDays = maxFrontExpiryDays(kind);
  const pool = instruments.filter(
    (item) => isIndexOption(item, kind) && item.instrumentType === optType
  );
  const withExpiry = pool.map((item) => ({ item, exp: parseExpiry(item.expiry) })).filter((row) => row.exp != null).filter((row) => {
    if (row.exp.getTime() <= asOfDay.getTime()) {
      return false;
    }
    const toExp = daysBetween(asOfDay, row.exp);
    return toExp > 0 && toExp <= maxDays;
  });
  const onExpected = withExpiry.filter(
    (row) => Math.abs(daysBetween(expected, row.exp)) <= 3
  );
  const candidatePool = onExpected.length > 0 ? onExpected : withExpiry;
  const exact = candidatePool.filter((row) => Math.abs(row.item.strike - strike) <= 0.01).sort((a, b) => a.exp.getTime() - b.exp.getTime());
  if (exact[0]) {
    return { instrument: exact[0].item, source: "chain" };
  }
  const near = candidatePool.filter((row) => Math.abs(row.item.strike - strike) <= step).sort((a, b) => {
    const ea = a.exp.getTime() - b.exp.getTime();
    if (ea !== 0) {
      return ea;
    }
    return Math.abs(a.item.strike - strike) - Math.abs(b.item.strike - strike);
  });
  if (near[0]) {
    return { instrument: near[0].item, source: "chain" };
  }
  const synthetic = buildSyntheticAtmOption({ ...params, instruments });
  synthetic.tradingSymbol = `${optionName(kind)} ATM ${strike} ${optType} \xB7 week ${formatExpiryLabel(expected)}`;
  return { instrument: synthetic, source: "synthetic" };
}

// src/app/core/paper-desk/trade-charges.util.ts
function roundPaise(n) {
  return Math.round(n * 100) / 100;
}
function estimateRoundTripCharges(input) {
  const qty = Math.max(0, Math.floor(input.quantity) || 0);
  const entry = Math.max(0, input.entryPrice);
  const exit = Math.max(0, input.exitPrice);
  if (qty < 1 || entry <= 0 && exit <= 0) {
    return zeroCharges();
  }
  const buyTurnover = entry * qty;
  const sellTurnover = exit * qty;
  const brokerageBuy = Math.min(20, buyTurnover * 3e-4);
  const brokerageSell = Math.min(20, sellTurnover * 3e-4);
  const brokerageRs = roundPaise(brokerageBuy + brokerageSell);
  let exchangeRs = 0;
  let sttRs = 0;
  let stampRs = 0;
  if (input.segment === "nse_equity") {
    exchangeRs = roundPaise((buyTurnover + sellTurnover) * 297e-7);
    sttRs = roundPaise(sellTurnover * 25e-5);
    stampRs = roundPaise(buyTurnover * 15e-5);
  } else {
    exchangeRs = roundPaise((buyTurnover + sellTurnover) * 35e-5);
    sttRs = roundPaise(sellTurnover * 1e-3);
    stampRs = roundPaise(buyTurnover * 3e-5);
  }
  const sebiRs = roundPaise((buyTurnover + sellTurnover) * 1e-6);
  const gstBase = brokerageRs + exchangeRs + sebiRs;
  const gstRs = roundPaise(gstBase * 0.18);
  const totalRs = roundPaise(brokerageRs + exchangeRs + gstRs + sebiRs + stampRs + sttRs);
  return { brokerageRs, exchangeRs, gstRs, sebiRs, stampRs, sttRs, totalRs };
}
function applyChargesToOptionTrade(params) {
  const breakdown = estimateRoundTripCharges({
    segment: params.segment ?? "nfo_option",
    entryPrice: params.entryPremium,
    exitPrice: params.exitPremium,
    quantity: params.quantity
  });
  return {
    chargesRs: breakdown.totalRs,
    netPnlRs: roundPaise(params.grossPnlRs - breakdown.totalRs),
    breakdown
  };
}
function zeroCharges() {
  return {
    brokerageRs: 0,
    exchangeRs: 0,
    gstRs: 0,
    sebiRs: 0,
    stampRs: 0,
    sttRs: 0,
    totalRs: 0
  };
}

// src/app/core/paper-desk/option-delta.util.ts
var ATM_OPTION_DELTA = {
  nifty: 0.41,
  bank: 0.3,
  crude: 0.55,
  natgas: 0.55
};
var BOOK_LOT_SIZE = {
  nifty: 65,
  bank: 30,
  crude: 10,
  natgas: 250
};
function bookForInstrumentId(instrumentId) {
  const id = (instrumentId ?? "").toLowerCase();
  if (id.includes("bank")) {
    return "bank";
  }
  if (id.includes("natgas") || id.includes("naturalgas")) {
    return "natgas";
  }
  if (id.includes("crude")) {
    return "crude";
  }
  return "nifty";
}
function atmDeltaForInstrumentId(instrumentId) {
  return ATM_OPTION_DELTA[bookForInstrumentId(instrumentId)];
}
function estimatedPremiumMove(tradePoints, instrumentId) {
  return tradePoints * atmDeltaForInstrumentId(instrumentId);
}

// stub:angular-core-stub
function Injectable(_opts) {
  return function(target) {
    return target;
  };
}

// src/app/core/strategy-manager/config/managed-strategy-ids.ts
var MANAGED_STRATEGY_IDS = {
  CHAMPION_PDHL: "pdhl-opening-range",
  VOL_EXPAND_DONCH15: "vol-expand-donch15-ema50-eod",
  SWING5_PREV_DAY: "swing5-prev-day-eod",
  DONCHIAN_20: "donchian-20-eod",
  DONCHIAN_55_TURTLE: "donchian-55-turtle",
  /** Daily-consistency search: max green-day share (not default — fat tails). */
  INSIDE_BREAK: "inside-break-eod",
  /** Donch-20 retest + OR-mid + Swing-5 structure trail — selectable. */
  DONCH_RETEST_OR_MID_2R: "donch-retest-or-mid-2r",
  /** S/R retest twin: Swing-5 retest + EMA50 + 2R. */
  SWING_RETEST_EMA50_2R: "swing-retest-ema50-2r",
  /**
   * Pine Smart Pullback PRO port — EMA50 pullback · 1.5R.
   * Selectable (not default). Research: scripts/smart-pullback-pro-daily-research.py
   */
  SMART_PULLBACK_PRO: "smart-pullback-pro",
  /**
   * Align Combo · GENIE — Nifty+Bank together when aligned, one alone, skip chop.
   * Selectable (was prior default). OOS ~₹507/day.
   */
  ALIGN_COMBO_GENIE: "align-combo-genie",
  /**
   * S/R Trap + Confirm — liquidity sweep at swing S/R + next-bar confirm · 3.5R.
   * **Default Nifty/Bank** Paper+Live (doc 33 RCA).
   */
  SR_TRAP_CONFIRM: "sr-trap-confirm",
  /** Stocks Desk champion — gap-up fade ₹500 book. */
  GAP_FADE_500: "gap-fade-500"
};
var DEFAULT_CHANNEL_ASSIGNMENTS = {
  nifty: {
    paper: MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM,
    live: MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM,
    shadow: null
  },
  bank: {
    paper: MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM,
    live: MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM,
    shadow: null
  },
  stocks: {
    paper: MANAGED_STRATEGY_IDS.GAP_FADE_500,
    live: MANAGED_STRATEGY_IDS.GAP_FADE_500,
    shadow: null
  }
};

// src/app/core/strategy-manager/models/strategy-settings.model.ts
function defaultStrategySettings(partial) {
  const base = {
    entryTimeStart: "10:15",
    entryTimeEnd: "15:10",
    exitTime: "15:15",
    orEnd: "10:15",
    stopLossPts: 30,
    bankStopLossPts: 45,
    minStopPts: 3,
    emaLength: 50,
    donchianLength: 20,
    swingLookback: 5,
    volExpandAtrMult: 1.2,
    maxTradesPerDay: 0,
    positionSizeLots: 1,
    riskPercent: 1,
    instrumentType: "index",
    dayStopPts: 60,
    dayProfitLockPts: 0,
    /** Option-₹ day risk (preferred for live/paper parity; 0 = use index pts). */
    dayStopRs: 0,
    dayProfitLockRs: 0,
    targetRMultiple: 0,
    profitProtectEnabled: false,
    profitProtectArmR: 1,
    profitProtectLockR: 0,
    regimeFilterEnabled: false,
    regimeMinOrDriveFrac: 0.3,
    regimeMaxGapAtr: 6,
    extras: {}
  };
  if (!partial) {
    return base;
  }
  const { extras: partialExtras, ...rest } = partial;
  return {
    ...base,
    ...rest,
    extras: { ...base.extras, ...partialExtras ?? {} }
  };
}

// src/app/core/strategy-manager/indicators/desk-indicators.ts
function seriesAt(ctx) {
  return [...ctx.previous5m, ctx.candle5m];
}
function toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function emaLast2(closes, period) {
  if (closes.length < period) {
    return null;
  }
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i += 1) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}
function atrAt(candles, period = 14) {
  if (candles.length < period + 1) {
    return null;
  }
  const trs = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  if (trs.length < period) {
    return null;
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}
function donchian(candles, lookback, excludeLast = true) {
  const end = excludeLast ? candles.length - 1 : candles.length;
  const start = end - lookback;
  if (start < 0 || end <= start) {
    return null;
  }
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = start; i < end; i += 1) {
    hi = Math.max(hi, candles[i].high);
    lo = Math.min(lo, candles[i].low);
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
    return null;
  }
  return { high: hi, low: lo };
}
function researchSwingAt(candles, lookback) {
  const n = candles.length;
  if (n < lookback * 2 + 1 || lookback < 1) {
    return { high: null, low: null };
  }
  const lastSh = new Array(n).fill(Number.NaN);
  const lastSl = new Array(n).fill(Number.NaN);
  let curH = Number.NaN;
  let curL = Number.NaN;
  for (let i = lookback; i < n - lookback; i += 1) {
    const h = candles[i].high;
    const l = candles[i].low;
    let isH = true;
    let isL = true;
    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (j === i) {
        continue;
      }
      if (candles[j].high >= h) {
        isH = false;
      }
      if (candles[j].low <= l) {
        isL = false;
      }
      if (!isH && !isL) {
        break;
      }
    }
    const conf = i + lookback;
    if (isH) {
      curH = h;
    }
    if (isL) {
      curL = l;
    }
    if (conf < n) {
      lastSh[conf] = curH;
      lastSl[conf] = curL;
    }
  }
  for (let i = 1; i < n; i += 1) {
    if (Number.isNaN(lastSh[i]) && !Number.isNaN(lastSh[i - 1])) {
      lastSh[i] = lastSh[i - 1];
    }
    if (Number.isNaN(lastSl[i]) && !Number.isNaN(lastSl[i - 1])) {
      lastSl[i] = lastSl[i - 1];
    }
  }
  const hi = lastSh[n - 1];
  const lo = lastSl[n - 1];
  return {
    high: Number.isNaN(hi) ? null : hi,
    low: Number.isNaN(lo) ? null : lo
  };
}
function openingRange2(dayBars, marketOpen, orEnd) {
  const openM = toMin(marketOpen);
  const endM = toMin(orEnd);
  let hi = -Infinity;
  let lo = Infinity;
  let firstOpen = null;
  let lastClose = null;
  for (const b of dayBars) {
    const m = toMin(extractHhMm(b.date));
    if (m < openM) {
      continue;
    }
    if (m >= endM) {
      break;
    }
    hi = Math.max(hi, b.high);
    lo = Math.min(lo, b.low);
    if (firstOpen == null) {
      firstOpen = b.open;
    }
    lastClose = b.close;
  }
  if (firstOpen == null || lastClose == null || !(hi > lo)) {
    return null;
  }
  return { high: hi, low: lo, mid: (hi + lo) / 2, firstOpen, lastClose };
}
function barsOnDay(series, day) {
  return series.filter((c) => extractTradeDate(c.date) === day);
}
function previousDayBars(series, day) {
  const days = [...new Set(series.map((c) => extractTradeDate(c.date)))].sort();
  const idx = days.indexOf(day);
  if (idx <= 0) {
    return [];
  }
  return barsOnDay(series, days[idx - 1]);
}

// src/app/core/strategy-manager/engines/index-rule.engine.ts
function createRuleDayState() {
  return {
    tradingDate: null,
    dayNetPts: 0,
    dayNetOptionRs: 0,
    tradesToday: 0,
    dayStopped: false,
    insideHigh: null,
    insideLow: null,
    brokeRes: false,
    brokeSup: false,
    brokeLevelRes: null,
    brokeLevelSup: null
  };
}
function indexRuleInitialRisk(open, settings) {
  if (settings.targetRMultiple > 0) {
    const fromTarget = Math.abs(open.target - open.entry) / settings.targetRMultiple;
    if (fromTarget > 0) {
      return fromTarget;
    }
  }
  return Math.abs(open.entry - open.stop);
}
function applyIndexRuleProfitProtect(candle, open, settings) {
  if (!settings.profitProtectEnabled || settings.profitProtectArmR <= 0) {
    return;
  }
  const risk = indexRuleInitialRisk(open, settings);
  if (!(risk > 0)) {
    return;
  }
  const armPts = settings.profitProtectArmR * risk;
  const lockPts = settings.profitProtectLockR * risk;
  if (open.direction === "BUY") {
    const mfe = candle.high - open.entry;
    if (mfe >= armPts) {
      const lockStop = open.entry + lockPts;
      if (lockStop > open.stop) {
        open.stop = lockStop;
      }
    }
  } else {
    const mfe = open.entry - candle.low;
    if (mfe >= armPts) {
      const lockStop = open.entry - lockPts;
      if (lockStop < open.stop) {
        open.stop = lockStop;
      }
    }
  }
}
function armPeakTrailFloor(candle, open, settings, instrumentId) {
  const x = settings.extras ?? {};
  const armRs = typeof x["profitLockArmRs"] === "number" ? x["profitLockArmRs"] : 600;
  const lockRs = typeof x["profitLockLockRs"] === "number" ? x["profitLockLockRs"] : 300;
  const givebackRs = typeof x["profitLockGivebackRs"] === "number" ? x["profitLockGivebackRs"] : 300;
  if (!(armRs > 0)) {
    return false;
  }
  const rs = /bank/i.test(instrumentId) ? 30 : 65;
  const armPts = armRs / rs;
  const barMfe = open.direction === "BUY" ? candle.high - open.entry : open.entry - candle.low;
  const peak = Math.max(open.peakMfePts ?? 0, Math.max(0, barMfe));
  open.peakMfePts = peak;
  if (peak < armPts) {
    return false;
  }
  if (typeof open.optionPeakMfeRs === "number") {
    return false;
  }
  const peakRs = peak * rs;
  const floorRs = Math.max(lockRs, peakRs - Math.max(0, givebackRs));
  const floorPts = floorRs / rs;
  if (open.direction === "BUY") {
    const lockStop = open.entry + floorPts;
    if (lockStop > open.stop) {
      open.stop = lockStop;
    }
  } else {
    const lockStop = open.entry - floorPts;
    if (lockStop < open.stop) {
      open.stop = lockStop;
    }
  }
  return true;
}
function applySlConfirmCutoff(candle, open, settings, instrumentId = "") {
  const x = settings.extras ?? {};
  if (x["slConfirmCutoffEnabled"] === false) {
    return null;
  }
  const fracR = typeof x["slConfirmCutoffFracR"] === "number" ? x["slConfirmCutoffFracR"] : 0.55;
  const maxMfeR = typeof x["slConfirmCutoffMaxMfeR"] === "number" ? x["slConfirmCutoffMaxMfeR"] : 0.75;
  const softRs = typeof x["slConfirmSoftRs"] === "number" ? x["slConfirmSoftRs"] : 700;
  if (!(fracR > 0) || !(maxMfeR >= 0)) {
    return null;
  }
  const risk = open.initialRiskPts != null && open.initialRiskPts > 0 ? open.initialRiskPts : Math.abs(open.entry - open.stop);
  if (!(risk > 0)) {
    return null;
  }
  const mfe = open.direction === "BUY" ? Math.max(0, candle.high - open.entry) : Math.max(0, open.entry - candle.low);
  const peak = Math.max(open.peakMfePts ?? 0, mfe);
  open.peakMfePts = peak;
  if (peak >= maxMfeR * risk) {
    return null;
  }
  const mae = open.direction === "BUY" ? Math.max(0, open.entry - candle.low) : Math.max(0, candle.high - open.entry);
  const rs = /bank/i.test(instrumentId) ? 30 : 65;
  const hitFrac = mae >= fracR * risk;
  const hitSoft = softRs > 0 && mae * rs >= softRs;
  if (!(hitFrac || hitSoft)) {
    return null;
  }
  const against = open.direction === "BUY" ? candle.close < open.entry : candle.close > open.entry;
  const adverseBody = open.direction === "BUY" ? candle.close < candle.open : candle.close > candle.open;
  if (!(against && adverseBody)) {
    return null;
  }
  return {
    exitPrice: candle.close,
    reason: hitSoft && !hitFrac ? "SL cutoff \u2014 soft \u20B9 adverse" : "SL cutoff \u2014 confirmed adverse"
  };
}
function indexRuleExitLogic(candle, open, closes, settings, spec, series) {
  const time = extractHhMm(candle.date);
  if (spec.exit === "swing_trail") {
    const lb = Math.max(1, Math.floor(settings.swingLookback) || 3);
    if (open.direction === "BUY") {
      if (candle.low <= open.stop) {
        return { exitPrice: open.stop, reason: `Swing-${lb} trail / stop` };
      }
    } else if (candle.high >= open.stop) {
      return { exitPrice: open.stop, reason: `Swing-${lb} trail / stop` };
    }
    const bars = series ?? [];
    if (bars.length >= lb * 2 + 1) {
      const sw = researchSwingAt(bars, lb);
      if (open.direction === "BUY" && sw.low != null) {
        open.trail = open.trail == null || !Number.isFinite(open.trail) ? sw.low : Math.max(open.trail, sw.low);
        if (candle.low <= open.trail) {
          return { exitPrice: open.trail, reason: `Swing-${lb} trail / stop` };
        }
      } else if (open.direction === "SELL" && sw.high != null) {
        open.trail = open.trail == null || !Number.isFinite(open.trail) ? sw.high : Math.min(open.trail, sw.high);
        if (candle.high >= open.trail) {
          return { exitPrice: open.trail, reason: `Swing-${lb} trail / stop` };
        }
      }
    }
    if (time >= settings.exitTime) {
      return { exitPrice: candle.close, reason: "EOD / session exit" };
    }
    return null;
  }
  applyIndexRuleProfitProtect(candle, open, settings);
  if (open.direction === "BUY") {
    if (candle.low <= open.stop) {
      return {
        exitPrice: open.stop,
        reason: "Stop loss hit"
      };
    }
    if (settings.targetRMultiple > 0 && candle.high >= open.target) {
      return { exitPrice: open.target, reason: "Target hit" };
    }
  } else {
    if (candle.high >= open.stop) {
      return {
        exitPrice: open.stop,
        reason: "Stop loss hit"
      };
    }
    if (settings.targetRMultiple > 0 && candle.low <= open.target) {
      return { exitPrice: open.target, reason: "Target hit" };
    }
  }
  if (spec.exit === "ema") {
    const ema = emaLast2(closes, settings.emaLength);
    if (ema != null) {
      if (open.direction === "BUY" && candle.close < ema) {
        return { exitPrice: candle.close, reason: `EMA-${settings.emaLength} exit` };
      }
      if (open.direction === "SELL" && candle.close > ema) {
        return { exitPrice: candle.close, reason: `EMA-${settings.emaLength} exit` };
      }
    }
  }
  if (time >= settings.exitTime) {
    return { exitPrice: candle.close, reason: "EOD / session exit" };
  }
  return null;
}
function mergeSettings(base, partial) {
  if (!partial) {
    return { ...base, extras: { ...base.extras } };
  }
  return defaultStrategySettings({ ...base, ...partial, extras: { ...base.extras, ...partial.extras } });
}
function recordRuleTradeClosed(state, points, dayStopPts, dayProfitLockPts = 0, money = null) {
  state.dayNetPts += points;
  state.tradesToday += 1;
  // Live/paper parity: lock/stop on option ₹ when configured (avoids Bank
  // "day lock" on index points while option money is still red).
  if (money && (money.dayStopRs > 0 || money.dayProfitLockRs > 0)) {
    const netRs = Number(money.netRs);
    state.dayNetOptionRs = (state.dayNetOptionRs || 0) + (Number.isFinite(netRs) ? netRs : 0);
    if (money.dayStopRs > 0 && state.dayNetOptionRs <= -money.dayStopRs) {
      state.dayStopped = true;
    }
    if (money.dayProfitLockRs > 0 && state.dayNetOptionRs >= money.dayProfitLockRs) {
      state.dayStopped = true;
    }
    return;
  }
  if (dayStopPts > 0 && state.dayNetPts <= -dayStopPts) {
    state.dayStopped = true;
  }
  if (dayProfitLockPts > 0 && state.dayNetPts >= dayProfitLockPts) {
    state.dayStopped = true;
  }
}

// src/app/core/strategy-manager/modules/champion-pdhl.managed-strategy.ts
var ChampionPdhlManagedStrategy = class {
  id = MANAGED_STRATEGY_IDS.CHAMPION_PDHL;
  name = "Champion";
  version = "1.0.0";
  description = "Production champion: OR mid bias + swing breakout \xB7 SL caps \xB7 1R \xB7 EMA-20 \xB7 day \u221260. DNA unchanged.";
  supports = ["nifty", "bank"];
  defaultSettings = defaultStrategySettings({
    entryTimeStart: "09:20",
    entryTimeEnd: "15:10",
    exitTime: "15:15",
    orEnd: "10:15",
    stopLossPts: 30,
    minStopPts: 8,
    emaLength: 20,
    donchianLength: 0,
    swingLookback: 3,
    maxTradesPerDay: 0,
    instrumentType: "options",
    dayStopPts: 60,
    targetRMultiple: 1
  });
  settings = { ...this.defaultSettings, extras: {} };
  state = createPdhlOrState();
  /** Desk risk overrides (strict day stop / profit lock) — additive only. */
  pdhlOverrides = null;
  lastInstrumentId = null;
  initialize(settings) {
    this.settings = mergeSettings(this.defaultSettings, settings);
    this.reset();
  }
  /** Called by desk when Trade Desk checkboxes change — does not alter DNA tables. */
  setPdhlDeskOverrides(overrides) {
    this.pdhlOverrides = overrides;
  }
  reset() {
    this.state = createPdhlOrState();
  }
  analyze(ctx) {
    const signal = this.generateSignal(ctx);
    return { lastReason: signal.reason, ...signal.analysis };
  }
  generateSignal(ctx) {
    this.lastInstrumentId = ctx.instrumentId ?? null;
    const params = mergePdhlOrParams(ctx.instrumentId, this.pdhlOverrides);
    const result = runPdhlOpeningRange(ctx, this.state, params);
    return {
      action: result.action,
      entryPrice: result.entryPrice,
      stopLoss: result.stopLoss,
      target: result.target,
      riskRewardRatio: result.riskRewardRatio,
      reason: result.reason,
      analysis: result.analysis
    };
  }
  calculateStopLoss(ctx, entryPrice, direction) {
    const signal = this.generateSignal(ctx);
    if (signal.action === "BUY" || signal.action === "SELL") {
      return signal.stopLoss;
    }
    return direction === "BUY" ? entryPrice - this.settings.stopLossPts : entryPrice + this.settings.stopLossPts;
  }
  calculateTarget(ctx, entryPrice, stopLoss, direction) {
    const signal = this.generateSignal(ctx);
    if (signal.action === "BUY" || signal.action === "SELL") {
      return { target: signal.target, riskRewardRatio: signal.riskRewardRatio };
    }
    const risk = Math.abs(entryPrice - stopLoss);
    return {
      target: direction === "BUY" ? entryPrice + risk : entryPrice - risk,
      riskRewardRatio: 1
    };
  }
  exitLogic(candle, open, closes) {
    const time = extractHhMm(candle.date);
    if (open.direction === "BUY") {
      if (candle.low <= open.stop) {
        return { exitPrice: open.stop, reason: "Stop loss hit" };
      }
      if (candle.high >= open.target) {
        return { exitPrice: open.target, reason: "Target hit" };
      }
    } else {
      if (candle.high >= open.stop) {
        return { exitPrice: open.stop, reason: "Stop loss hit" };
      }
      if (candle.low <= open.target) {
        return { exitPrice: open.target, reason: "Target hit" };
      }
    }
    const ema20 = emaLast(closes, PDHL_EMA_EXIT_PERIOD);
    if (ema20 != null) {
      if (open.direction === "BUY" && candle.close < ema20) {
        return { exitPrice: candle.close, reason: "EMA-20 exit" };
      }
      if (open.direction === "SELL" && candle.close > ema20) {
        return { exitPrice: candle.close, reason: "EMA-20 exit" };
      }
    }
    if (time >= "15:15") {
      return { exitPrice: candle.close, reason: "Session close" };
    }
    return null;
  }
  onTradeClosed(points) {
    const params = mergePdhlOrParams(this.lastInstrumentId, this.pdhlOverrides);
    recordPdhlTradeClosed(this.state, points, params);
  }
  getSettings() {
    return { ...this.settings, extras: { ...this.settings.extras } };
  }
  updateSettings(partial) {
    this.settings = mergeSettings(this.settings, partial);
  }
};
ChampionPdhlManagedStrategy = __decorateClass([
  Injectable({ providedIn: "root" })
], ChampionPdhlManagedStrategy);

// src/app/core/strategy-manager/engines/kutty-scalp.engine.ts
var KUTTY_ID = "kutty";
var KUTTY_NAME = "Kutty";
var KUTTY_TARGET_RS = 600;
var KUTTY_STOP_RS = 200;
var KUTTY_CAPITAL_RS = 6e4;
var KUTTY_TRAP_RESERVE_RS = 3e4;
var KUTTY_MARGIN_PER_TRADE_RS = 8e3;
var KUTTY_MAX_TRADES_PER_DAY = 0;
var KUTTY_ENTRY_START = "10:00";
var KUTTY_ENTRY_END = "14:30";
var SWING_LB = 5;
var PIERCE = 3;
function createKuttyDayState() {
  return { tradingDate: null, tradesToday: 0, pending: null };
}
function rsPerPoint(kind) {
  return kind === "banknifty" ? PDHL_BANK_RUPEES_PER_POINT : PDHL_RUPEES_PER_POINT;
}
function kuttyTargetPts(kind) {
  return KUTTY_TARGET_RS / rsPerPoint(kind);
}
function kuttyStopPts(kind) {
  return KUTTY_STOP_RS / rsPerPoint(kind);
}
function canOpenKutty(params) {
  const capital = params.capitalRs ?? KUTTY_CAPITAL_RS;
  const reserve = params.kuttyAlone || params.trapOpenAnywhere ? 0 : params.trapReserveRs ?? KUTTY_TRAP_RESERVE_RS;
  const need = params.kuttyMarginRs ?? KUTTY_MARGIN_PER_TRADE_RS;
  return capital - params.usedMarginRs - reserve >= need;
}
function wait(candle, reason) {
  return {
    action: "WAITING",
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { strategy: KUTTY_ID }
  };
}
function stratIsReady(signal) {
  if (signal.action === "BUY" || signal.action === "SELL") {
    return true;
  }
  if (signal.action === "SKIPPED" || signal.action === "NO_TRADE") {
    return false;
  }
  const a = signal.analysis ?? {};
  if (a["kuttyStandDown"] === true || a["primaryReady"] === true || a["setupArmed"] === true) {
    return true;
  }
  const armed = a["armed"];
  if (armed != null && armed !== false && armed !== 0 && armed !== "") {
    return true;
  }
  return stratReadyReason(signal.reason);
}
function stratPathFree(signal) {
  return !stratIsReady(signal);
}
function stratReadyReason(reason) {
  const r = reason.toLowerCase();
  if (r.startsWith("kutty")) {
    return false;
  }
  return r.includes("wait confirm") || r.includes("trap buy armed") || r.includes("trap sell armed") || /\barmed\b/.test(r) || r.includes("pending entry") || r.includes("awaiting confirm") || r.includes("setup ready");
}
function clearKuttyPending(state) {
  state.pending = null;
}
var KUTTY_YIELD_STRAT_REASON = "Kutty yield \u2014 Strat priority";
function swingHL(dayBars, i) {
  const start = Math.max(0, i - SWING_LB);
  const window = dayBars.slice(start, i);
  if (!window.length) {
    return { sh: dayBars[i].high, sl: dayBars[i].low };
  }
  return {
    sh: Math.max(...window.map((b) => b.high)),
    sl: Math.min(...window.map((b) => b.low))
  };
}
function runKuttyScalp(ctx, state, kind) {
  const candle = ctx.candle5m;
  const day = extractTradeDate(candle.date);
  const time = extractHhMm(candle.date);
  if (state.tradingDate !== day) {
    state.tradingDate = day;
    state.tradesToday = 0;
    state.pending = null;
  }
  if (KUTTY_MAX_TRADES_PER_DAY > 0 && state.tradesToday >= KUTTY_MAX_TRADES_PER_DAY) {
    return wait(candle, "Kutty max trades");
  }
  const tp = kuttyTargetPts(kind);
  const sl = kuttyStopPts(kind);
  const series = seriesAt(ctx);
  const dayBars = barsOnDay(series, day);
  const i = dayBars.findIndex((b) => b.date === candle.date);
  if (state.pending) {
    const p = state.pending;
    state.pending = null;
    if (time < KUTTY_ENTRY_START || time > KUTTY_ENTRY_END) {
      return wait(candle, "Kutty confirm outside window");
    }
    const fill = candle.open;
    const bull = p.dir === 1 && candle.close > candle.open && candle.close > p.signalClose;
    const bear = p.dir === -1 && candle.close < candle.open && candle.close < p.signalClose;
    if (!(bull || bear)) {
      return wait(candle, "Kutty confirm failed");
    }
    return {
      action: p.dir === 1 ? "BUY" : "SELL",
      entryPrice: fill,
      stopLoss: p.dir === 1 ? fill - sl : fill + sl,
      target: p.dir === 1 ? fill + tp : fill - tp,
      riskRewardRatio: tp / sl,
      reason: `Kutty trap confirm ${p.dir === 1 ? "BUY" : "SELL"} \xB7 \u20B9${KUTTY_TARGET_RS}/\u20B9${KUTTY_STOP_RS}`,
      analysis: { strategy: KUTTY_ID, setup: "kutty_trap_confirm" }
    };
  }
  if (time < KUTTY_ENTRY_START || time > KUTTY_ENTRY_END) {
    return wait(candle, "Kutty outside window");
  }
  if (i < SWING_LB || series.length < 55) {
    return wait(candle, "Kutty warming");
  }
  const closes = series.map((c) => c.close);
  const ema = emaLast2(closes, 50);
  if (ema == null) {
    return wait(candle, "Kutty EMA");
  }
  const { sh, sl: swingLow } = swingHL(dayBars, i);
  const cc = candle.close;
  const oo = candle.open;
  const hh = candle.high;
  const ll = candle.low;
  const trapBuy = ll < swingLow - PIERCE && cc > swingLow && cc > oo;
  const trapSell = hh > sh + PIERCE && cc < sh && cc < oo;
  const rng = Math.max(hh - ll, 1e-9);
  const bounceBuy = ll <= swingLow + PIERCE && ll >= swingLow - PIERCE * 2 && cc > oo && cc >= swingLow && (hh - cc) / rng < 0.35;
  const bounceSell = hh >= sh - PIERCE && hh <= sh + PIERCE * 2 && cc < oo && cc <= sh && (cc - ll) / rng < 0.35;
  let dir = 0;
  if ((trapBuy || bounceBuy) && cc > ema) {
    dir = 1;
  } else if ((trapSell || bounceSell) && cc < ema) {
    dir = -1;
  }
  if (!dir) {
    return wait(candle, "Kutty no trap");
  }
  state.pending = { dir, signalClose: cc };
  return wait(candle, dir === 1 ? "Kutty BUY armed" : "Kutty SELL armed");
}
function kuttyExitLogic(candle, open) {
  const time = extractHhMm(candle.date);
  if (open.direction === "BUY") {
    if (candle.low <= open.stop) {
      return { exitPrice: open.stop, reason: "Kutty stop" };
    }
    if (candle.high >= open.target) {
      return { exitPrice: open.target, reason: "Kutty target" };
    }
  } else {
    if (candle.high >= open.stop) {
      return { exitPrice: open.stop, reason: "Kutty stop" };
    }
    if (candle.low <= open.target) {
      return { exitPrice: open.target, reason: "Kutty target" };
    }
  }
  if (time >= "15:15") {
    return { exitPrice: candle.close, reason: "Kutty EOD" };
  }
  return null;
}
function recordKuttyClosed(state) {
  state.tradesToday += 1;
  state.pending = null;
}

// src/app/core/paper-desk/paper-desk-engine.ts
function effectiveProtectiveStop(open) {
  const trail = open.trail;
  if (trail == null || !Number.isFinite(trail)) {
    return open.stop;
  }
  return open.direction === "BUY" ? Math.max(open.stop, trail) : Math.min(open.stop, trail);
}
function stubCandle(from) {
  return { ...from };
}
function buildContext(candles, index, instrumentId) {
  const candle5m = candles[index];
  const causal = candles.slice(0, index + 1);
  return {
    candle60m: stubCandle(candle5m),
    candle30m: stubCandle(candle5m),
    candle15m: stubCandle(candle5m),
    candle5m,
    previous60m: [],
    previous30m: [],
    previous15m: [],
    previous5m: candles.slice(0, index),
    candleIndex5m: index,
    replayStepIndex: index,
    replayFrom: candles[0]?.date ?? candle5m.date,
    replayTo: candle5m.date,
    session: NSE_SESSION,
    instrumentId,
    series5m: causal
  };
}
function toOptionContract(opt, source = "chain") {
  return {
    tradingSymbol: opt.tradingSymbol,
    instrumentToken: opt.instrumentToken,
    strike: opt.strike,
    expiry: opt.expiry,
    optionType: opt.instrumentType === "PE" ? "PE" : "CE",
    lotSize: opt.lotSize > 0 ? opt.lotSize : 1,
    source
  };
}
function normalizeMinute(ts) {
  return ts.replace("T", " ").slice(0, 16);
}
function lookupPremium(optionCandles, when, edge = "close") {
  if (!optionCandles?.length) {
    return null;
  }
  const target = normalizeMinute(when);
  const targetDay = target.slice(0, 10);
  let best = null;
  for (const c of optionCandles) {
    const norm = normalizeMinute(c.date);
    if (norm.slice(0, 10) !== targetDay) {
      continue;
    }
    if (norm <= target) {
      best = c;
    }
  }
  if (!best) {
    return null;
  }
  return edge === "open" ? best.open : best.close;
}
function lookupOptionBarLow(optionCandles, when) {
  if (!optionCandles?.length) {
    return null;
  }
  const target = normalizeMinute(when);
  const targetDay = target.slice(0, 10);
  let best = null;
  for (const c of optionCandles) {
    const norm = normalizeMinute(c.date);
    if (norm.slice(0, 10) !== targetDay) {
      continue;
    }
    if (norm <= target) {
      best = c;
    }
  }
  return best ? best.low : null;
}
function computeOptionPeakMfeRs(params) {
  const entry = params.entryPremium;
  if (!(entry != null && entry > 0) || !params.optionCandles?.length) {
    return null;
  }
  const lot = Math.max(1, Math.floor(params.lotSize) || 1);
  const lots = Math.max(1, Math.floor(params.lotsMultiplier ?? 1) || 1);
  const from = normalizeMinute(params.entryTime);
  const to = normalizeMinute(params.asOfTime);
  let peakPrem = 0;
  for (const c of params.optionCandles) {
    const t = normalizeMinute(c.date);
    if (t < from || t > to) {
      continue;
    }
    peakPrem = Math.max(peakPrem, c.high - entry);
  }
  if (!(peakPrem > 0)) {
    return 0;
  }
  return Math.round(peakPrem * lot * lots * 100) / 100;
}
function entryPremiumEdge(entryPrice, candle) {
  const dOpen = Math.abs(entryPrice - candle.open);
  const dClose = Math.abs(entryPrice - candle.close);
  return dOpen <= dClose ? "open" : "close";
}
function isLevelExitReason(reason) {
  const r = reason.toLowerCase();
  return /\bstop\b/.test(r) || /\btarget\b/.test(r) || /\bsl\b/.test(r) || r.includes("stop loss") || r.includes("trail / stop");
}
function applyEstimatedOptionPnl(params) {
  const lots = Math.max(1, Math.floor(params.lots) || 1);
  const premiumMove = estimatedPremiumMove(params.indexPoints, params.instrumentId);
  const lotSize = params.lotSize > 0 ? params.lotSize : BOOK_LOT_SIZE[bookForInstrumentId(params.instrumentId)];
  const entry = params.entryPremium ?? Math.max(10, Math.abs(premiumMove) + 20);
  const exit = entry + premiumMove;
  const pnl = premiumMove * lotSize * lots;
  return { entry, exit, pnl };
}
function computeOptionPnl(params) {
  const lots = Math.max(1, Math.floor(params.lots) || 1);
  const lotSize = params.lotSize > 0 ? params.lotSize : 1;
  return (params.exitPremium - params.entryPremium) * lotSize * lots;
}
var tradeSeq = 0;
function closePaperTrade(params) {
  const { open } = params;
  const livePath = params.livePath || null;
  const lots = Math.max(1, Math.floor(params.lotsMultiplier ?? 1) || 1);
  const indexPoints = open.direction === "BUY" ? params.exitPrice - open.entry : open.entry - params.exitPrice;
  let optionExitPremium = null;
  let optionPnlRs = null;
  let premiumEstimated = open.premiumEstimated;
  let optionEntryPremium = open.optionEntryPremium;
  if (open.option) {
    const restingOpt = params.optionExitPremium != null && params.optionExitPremium > 0 ? params.optionExitPremium : null;
    // Live path: never invent delta PnL on level exits — only real option marks.
    const allowEstimate = !(livePath && livePath.noEstimatedExitPnl);
    const useEstimate = allowEstimate && restingOpt == null && (open.option.source === "synthetic" || open.option.instrumentToken <= 0 || open.premiumEstimated || isLevelExitReason(params.exitReason));
    if (restingOpt != null) {
      optionExitPremium = restingOpt;
      premiumEstimated = false;
    } else if (!useEstimate) {
      optionExitPremium = lookupPremium(
        params.optionCandlesByToken.get(open.option.instrumentToken),
        params.exitTime,
        "close"
      );
    }
    if (!useEstimate && optionEntryPremium != null && optionExitPremium != null) {
      const friction = livePath ? Number(livePath.fillFrictionPremium) || 0 : 0;
      // Resting bank/stand already names the option ₹. Do not haircut it again.
      if (friction > 0 && restingOpt == null) {
        optionEntryPremium = Math.max(0.05, Number(optionEntryPremium) + friction);
        optionExitPremium = Math.max(0.05, Number(optionExitPremium) - friction);
      }
      optionPnlRs = computeOptionPnl({
        entryPremium: optionEntryPremium,
        exitPremium: optionExitPremium,
        lotSize: open.option.lotSize,
        lots
      });
      premiumEstimated = false;
    } else if (allowEstimate) {
      const est = applyEstimatedOptionPnl({
        indexPoints,
        entryPremium: optionEntryPremium,
        lotSize: open.option.lotSize,
        lots,
        instrumentId: params.instrumentId
      });
      optionEntryPremium = est.entry;
      optionExitPremium = est.exit;
      optionPnlRs = est.pnl;
      premiumEstimated = true;
    } else {
      // Live path: missing exit mark → no fictional ₹ (trade marked estimated, PnL null).
      premiumEstimated = true;
      optionPnlRs = null;
    }
  }
  tradeSeq += 1;
  const qty = open.option != null ? Math.max(1, open.option.lotSize || 1) * lots : 0;
  let chargesRs = null;
  let netOptionPnlRs = null;
  if (optionPnlRs != null && optionEntryPremium != null && optionExitPremium != null && qty > 0) {
    const charged = applyChargesToOptionTrade({
      entryPremium: optionEntryPremium,
      exitPremium: optionExitPremium,
      quantity: qty,
      segment: open.option?.exchange === "MCX" ? "mcx_option" : "nfo_option",
      grossPnlRs: optionPnlRs
    });
    chargesRs = charged.chargesRs;
    netOptionPnlRs = charged.netPnlRs;
  }
  const moneyOutcome = optionPnlRs == null ? void 0 : optionPnlRs > 0 ? "WIN" : optionPnlRs < 0 ? "LOSS" : "FLAT";
  const timeline = [
    ...open.timeline ?? [],
    {
      at: params.exitTime,
      event: "EXIT",
      detail: `${params.exitReason} @ ${params.exitPrice.toFixed(2)}`
    }
  ];
  return {
    id: `pt-${tradeSeq}-${params.exitTime}`,
    instrumentId: params.instrumentId,
    instrumentName: params.instrumentName,
    direction: open.direction,
    indexEntry: open.entry,
    indexStop: open.stop,
    indexTarget: open.target,
    indexExit: params.exitPrice,
    indexPoints,
    entryTime: open.entryTime,
    exitTime: params.exitTime,
    exitReason: params.exitReason,
    option: open.option,
    optionEntryPremium,
    optionExitPremium,
    optionPnlRs,
    premiumEstimated,
    optionEntryEdge: open.optionEntryEdge,
    outcome: indexPoints > 0 ? "WIN" : indexPoints < 0 ? "LOSS" : "FLAT",
    strategyId: params.strategyId,
    strategyName: params.strategyName,
    mfeIndexPts: open.mfeIndexPts ?? 0,
    maeIndexPts: open.maeIndexPts ?? 0,
    chargesRs,
    netOptionPnlRs,
    moneyOutcome,
    timeline,
    entryReason: open.entryReason
  };
}
function replayPaperOnIndex(params) {
  const {
    instrumentId,
    instrumentName,
    kind,
    candles,
    fromDate,
    toDate,
    instruments,
    optionCandlesByToken,
    neededOptionTokens
  } = params;
  const forceCloseOpen = params.forceCloseOpen !== false;
  const lotsMultiplier = Math.max(1, Math.floor(params.lotsMultiplier ?? 1) || 1);
  const kuttyAlone = !!params.kuttyAlone;
  const enableKutty = kuttyAlone || params.enableKutty !== false;
  const kuttyMargin = params.kuttyMargin ?? { usedRs: 0, trapOpenLegs: 0 };
  const kuttyState = createKuttyDayState();
  const liveHook = params.liveHook;
  const livePath = params.livePath || null;
  const afterBar = liveHook?.afterBarTime ?? null;
  const hookActive = (barTime) => !!liveHook && (!afterBar || barTime > afterBar);
  const strategy = params.strategy ?? (() => {
    const fallback = new ChampionPdhlManagedStrategy();
    fallback.initialize();
    return fallback;
  })();
  strategy.reset();
  const trades = [];
  const dayNetByDate = {};
  let open = null;
  let lastSignal = "Waiting";
  let chosenOption = null;
  let chosenBias = null;
  let indexSpot = null;
  let chosenAsOf = null;
  for (let i = 40; i < candles.length; i += 1) {
    const candle = candles[i];
    const day = extractTradeDate(candle.date);
    if (day < fromDate || day > toDate) {
      continue;
    }
    const closes = candles.slice(0, i + 1).map((c) => c.close);
    const ctx = buildContext(candles, i, instrumentId);
    let deferredPrimary = null;
    if (open) {
      const fav = open.direction === "BUY" ? candle.high - open.entry : open.entry - candle.low;
      const adv = open.direction === "BUY" ? open.entry - candle.low : candle.high - open.entry;
      open.mfeIndexPts = Math.max(open.mfeIndexPts ?? 0, Math.max(0, fav));
      open.maeIndexPts = Math.max(open.maeIndexPts ?? 0, Math.max(0, adv));
      const isKutty = open.source === "kutty";
      let exit = null;
      if (!kuttyAlone && isKutty) {
        const stratSig = strategy.generateSignal(ctx);
        if (stratIsReady(stratSig)) {
          clearKuttyPending(kuttyState);
        }
        if (stratSig.action === "BUY" || stratSig.action === "SELL") {
          exit = { exitPrice: stratSig.entryPrice, reason: KUTTY_YIELD_STRAT_REASON };
          deferredPrimary = stratSig;
        }
      }
      if (!exit) {
        if (isKutty) {
          exit = kuttyExitLogic(candle, open);
        } else {
          const optBars = open.option ? optionCandlesByToken.get(open.option.instrumentToken) : void 0;
          const optMfe = computeOptionPeakMfeRs({
            entryPremium: open.optionEntryPremium,
            entryTime: open.entryTime,
            asOfTime: candle.date,
            optionCandles: optBars,
            lotSize: open.option?.lotSize ?? 0,
            lotsMultiplier
          });
          if (optMfe != null) {
            open.optionPeakMfeRs = Math.max(open.optionPeakMfeRs ?? 0, optMfe);
          }
          const optBarLow = lookupOptionBarLow(optBars, candle.date);
          const lotUnits = open.option && open.option.lotSize > 0 ? open.option.lotSize * Math.max(1, Math.floor(lotsMultiplier) || 1) : null;
          const managedOpen = {
            direction: open.direction,
            entry: open.entry,
            stop: open.stop,
            target: open.target,
            entryTime: open.entryTime,
            trail: open.trail ?? null,
            peakMfePts: open.mfeIndexPts ?? 0,
            initialRiskPts: open.initialRiskPts ?? Math.abs(open.entry - open.stop),
            optionPeakMfeRs: open.optionPeakMfeRs ?? optMfe,
            optionEntryPremium: open.optionEntryPremium,
            optionBarLow: optBarLow,
            optionLotUnits: lotUnits,
            lotsMultiplier
          };
          exit = strategy.exitLogic(candle, managedOpen, closes, ctx);
          if (managedOpen.stop !== open.stop) {
            open.timeline = [
              ...open.timeline ?? [],
              {
                at: candle.date,
                event: "STOP_MOVED",
                detail: `SL ${open.stop.toFixed(2)} \u2192 ${managedOpen.stop.toFixed(2)}`
              }
            ];
            open.stop = managedOpen.stop;
          }
          if (managedOpen.peakMfePts != null) {
            open.mfeIndexPts = Math.max(open.mfeIndexPts ?? 0, managedOpen.peakMfePts);
          }
          if (managedOpen.trail !== open.trail) {
            open.trail = managedOpen.trail ?? null;
          }
        }
      }
      if (exit) {
        const closed = closePaperTrade({
          instrumentId,
          instrumentName,
          open,
          exitPrice: exit.exitPrice,
          exitTime: candle.date,
          exitReason: exit.reason,
          optionCandlesByToken,
          lotsMultiplier,
          strategyId: isKutty ? KUTTY_ID : strategy.id,
          strategyName: isKutty ? KUTTY_NAME : strategy.name,
          optionExitPremium: exit.optionExitPremium ?? null,
          livePath
        });
        trades.push(closed);
        if (hookActive(candle.date)) {
          liveHook?.onClose?.(closed.entryTime, closed.exitReason);
        }
        if (isKutty) {
          recordKuttyClosed(kuttyState);
          kuttyMargin.usedRs = Math.max(0, kuttyMargin.usedRs - KUTTY_MARGIN_PER_TRADE_RS);
        } else {
          const moneyRs = closed.netOptionPnlRs ?? closed.optionPnlRs;
          strategy.onTradeClosed?.(closed.indexPoints, day, moneyRs);
          kuttyMargin.trapOpenLegs = Math.max(0, kuttyMargin.trapOpenLegs - 1);
        }
        if (livePath?.deskGate) livePath.deskGate.release();
        dayNetByDate[day] = (dayNetByDate[day] ?? 0) + closed.indexPoints;
        open = null;
        lastSignal = `Closed: ${exit.reason}`;
      } else if (enableKutty && !kuttyAlone && !isKutty) {
        lastSignal = `Strat in trade \u2014 Kutty waits for free slot`;
      }
      if (open || !deferredPrimary) {
        continue;
      }
    }
    const signal = kuttyAlone ? {
      action: "WAITING",
      entryPrice: candle.close,
      stopLoss: candle.close,
      target: candle.close,
      riskRewardRatio: 0,
      reason: "Kutty alone \u2014 Strat off",
      analysis: { kuttyAlone: true }
    } : deferredPrimary ?? strategy.generateSignal(ctx);
    lastSignal = signal.reason;
    let entryAction = signal.action;
    let entryPrice = signal.entryPrice;
    let entryStop = signal.stopLoss;
    let entryTarget = signal.target;
    let entryReason = signal.reason;
    let entrySource = "primary";
    let entryStrategyId = strategy.id;
    let entryStrategyName = strategy.name;
    if (entryAction !== "BUY" && entryAction !== "SELL") {
      if (!kuttyAlone && !stratPathFree(signal)) {
        clearKuttyPending(kuttyState);
        lastSignal = `Kutty wait \u2014 Strat ready \xB7 ${signal.reason}`;
        continue;
      }
      if (enableKutty && canOpenKutty({
        usedMarginRs: kuttyMargin.usedRs,
        trapOpenAnywhere: kuttyMargin.trapOpenLegs > 0,
        kuttyAlone
      })) {
        const kSig = runKuttyScalp(ctx, kuttyState, kind);
        if (kSig.action === "BUY" || kSig.action === "SELL") {
          entryAction = kSig.action;
          entryPrice = kSig.entryPrice;
          entryStop = kSig.stopLoss;
          entryTarget = kSig.target;
          entryReason = kSig.reason;
          entrySource = "kutty";
          entryStrategyId = KUTTY_ID;
          entryStrategyName = KUTTY_NAME;
          lastSignal = kSig.reason;
        } else {
          lastSignal = kSig.reason;
          continue;
        }
      } else {
        continue;
      }
    } else {
      clearKuttyPending(kuttyState);
    }
    const resolved = resolveAtmWeeklyOption({
      instruments,
      kind,
      direction: entryAction,
      spot: entryPrice,
      asOfDateTime: candle.date
    });
    const option = toOptionContract(resolved.instrument, resolved.source);
    if (resolved.source === "chain" && resolved.instrument.instrumentToken > 0) {
      neededOptionTokens.add(resolved.instrument.instrumentToken);
    }
    const fillEdge = entryPremiumEdge(entryPrice, candle);
    let optionEntryPremium = null;
    let premiumEstimated = resolved.source === "synthetic";
    if (resolved.source === "chain") {
      optionEntryPremium = lookupPremium(
        optionCandlesByToken.get(resolved.instrument.instrumentToken),
        candle.date,
        fillEdge
      );
      if (optionEntryPremium == null) {
        premiumEstimated = true;
      }
    }
    // Paper ≡ Live: skip entries the broker would never take.
    if (livePath && livePath.rejectEstimatedPremium !== false && premiumEstimated) {
      lastSignal = `Live-path skip \u2014 estimated/synthetic premium`;
      continue;
    }
    if (livePath && optionEntryPremium != null) {
      const { evaluateChargeEntryGate } = require("./charge-entry-gate");
      const { LIVE_GREEN_DNA } = require("./dna-live-green");
      const lots = Math.max(1, Math.floor(lotsMultiplier ?? 1) || 1);
      const qty = Math.max(1, Number(option.lotSize) || 1) * lots;
      const gate = evaluateChargeEntryGate({
        instrumentId,
        entryPremium: optionEntryPremium,
        quantity: qty,
        indexEntry: entryPrice,
        indexStop: entryStop,
        indexTarget: entryTarget,
        targetRMultiple: strategy?.getSettings?.()?.targetRMultiple,
        ops: { ...LIVE_GREEN_DNA.liveOps, ...livePath },
      });
      if (gate.skip) {
        lastSignal = gate.reason;
        continue;
      }
    }
    if (livePath?.deskGate && !livePath.deskGate.tryOpen()) {
      lastSignal = `Live-path skip \u2014 maxOpenLegs ${livePath.deskGate.maxOpenLegs}`;
      continue;
    }
    open = {
      direction: entryAction,
      entry: entryPrice,
      stop: entryStop,
      target: entryTarget,
      entryTime: candle.date,
      trail: null,
      option,
      optionEntryPremium,
      premiumEstimated,
      optionEntryEdge: fillEdge,
      mfeIndexPts: 0,
      maeIndexPts: 0,
      initialRiskPts: Math.abs(entryPrice - entryStop),
      entryReason,
      source: entrySource,
      timeline: [
        {
          at: candle.date,
          event: "ENTRY",
          detail: `${entryAction} @ ${entryPrice.toFixed(2)} \xB7 SL ${entryStop.toFixed(2)} \xB7 T ${entryTarget.toFixed(2)} \xB7 ${entryReason}`
        }
      ]
    };
    if (hookActive(candle.date)) {
      liveHook?.onOpen?.({
        direction: entryAction,
        entryTime: candle.date,
        indexEntry: entryPrice,
        indexStop: entryStop,
        option,
        optionEntryPremium
      });
    }
    if (entrySource === "kutty") {
      kuttyMargin.usedRs += KUTTY_MARGIN_PER_TRADE_RS;
    } else {
      kuttyMargin.trapOpenLegs += 1;
    }
    chosenOption = option;
    chosenBias = entryAction;
    indexSpot = entryPrice;
    chosenAsOf = candle.date;
    lastSignal = `${entryAction} @ ${entryPrice.toFixed(1)} \xB7 ${entryStrategyName}`;
  }
  if (forceCloseOpen && open) {
    let lastIdx = -1;
    for (let i = candles.length - 1; i >= 0; i -= 1) {
      const day = extractTradeDate(candles[i].date);
      if (day >= fromDate && day <= toDate) {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx >= 0) {
      const candle = candles[lastIdx];
      const day = extractTradeDate(candle.date);
      const isKutty = open.source === "kutty";
      const closed = closePaperTrade({
        instrumentId,
        instrumentName,
        open,
        exitPrice: candle.close,
        exitTime: candle.date,
        exitReason: "End of range",
        optionCandlesByToken,
        lotsMultiplier,
        strategyId: isKutty ? KUTTY_ID : strategy.id,
        strategyName: isKutty ? KUTTY_NAME : strategy.name,
        livePath
      });
      trades.push(closed);
      if (hookActive(candle.date)) {
        liveHook?.onClose?.(closed.entryTime, closed.exitReason);
      }
      if (isKutty) {
        recordKuttyClosed(kuttyState);
        kuttyMargin.usedRs = Math.max(0, kuttyMargin.usedRs - KUTTY_MARGIN_PER_TRADE_RS);
      } else {
        const moneyRs = closed.netOptionPnlRs ?? closed.optionPnlRs;
        strategy.onTradeClosed?.(closed.indexPoints, day, moneyRs);
        kuttyMargin.trapOpenLegs = Math.max(0, kuttyMargin.trapOpenLegs - 1);
      }
      if (livePath?.deskGate) livePath.deskGate.release();
      dayNetByDate[day] = (dayNetByDate[day] ?? 0) + closed.indexPoints;
      if (closed.option) {
        chosenOption = closed.option;
        chosenBias = closed.direction;
        indexSpot = closed.indexEntry;
        chosenAsOf = closed.entryTime;
      }
      open = null;
      lastSignal = "Closed: End of range";
    }
  }
  if (open?.option) {
    chosenOption = open.option;
    chosenBias = open.direction;
    indexSpot = open.entry;
    chosenAsOf = open.entryTime;
  } else if (!chosenOption) {
    let lastIdx = -1;
    for (let i = candles.length - 1; i >= 0; i -= 1) {
      const day = extractTradeDate(candles[i].date);
      if (day >= fromDate && day <= toDate) {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx >= 0) {
      const candle = candles[lastIdx];
      const dayBars = candles.filter((c) => extractTradeDate(c.date) === extractTradeDate(candle.date));
      const orBars = dayBars.filter((c) => {
        const t = extractHhMm(c.date);
        return t >= NSE_SESSION.marketOpen && t < NSE_SESSION.firstHourEnd;
      });
      if (orBars.length) {
        const orHigh = Math.max(...orBars.map((b) => b.high));
        const orLow = Math.min(...orBars.map((b) => b.low));
        const mid = (orHigh + orLow) / 2;
        const bias = candle.close >= mid ? "BUY" : "SELL";
        const resolved = resolveAtmWeeklyOption({
          instruments,
          kind,
          direction: bias,
          spot: candle.close,
          asOfDateTime: candle.date
        });
        chosenOption = toOptionContract(resolved.instrument, resolved.source);
        chosenBias = bias;
        indexSpot = candle.close;
        chosenAsOf = candle.date;
        if (resolved.source === "chain" && resolved.instrument.instrumentToken > 0) {
          neededOptionTokens.add(resolved.instrument.instrumentToken);
        }
      }
    }
  } else if (trades.length) {
    const last = trades.at(-1);
    if (last.option) {
      chosenOption = last.option;
      chosenBias = last.direction;
      indexSpot = last.indexEntry;
      chosenAsOf = last.entryTime;
    }
  }
  return {
    instrumentId,
    instrumentName,
    kind,
    trades,
    dayNetByDate,
    lastSignal,
    open,
    strategyId: strategy.id,
    strategyName: strategy.name,
    chosenOption,
    chosenBias,
    indexSpot,
    chosenAsOf
  };
}

// src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-pdhl-evening.evaluator.ts
var CRUDE_RUPEES_PER_POINT = 10;
var CRUDE_STOP_PTS = 80;
var CRUDE_EVENING_TARGET_PTS = 150;
var CRUDE_MORNING_TARGET_PTS = 250;
var CRUDE_ENTRY_START = "18:30";
var CRUDE_ENTRY_END = "20:30";
var CRUDE_EXIT_BY = "23:10";
var CRUDE_MAX_TRADES_DAY = 0;
var CRUDE_MAX_TRADES_MONTH = 0;
var CRUDE_DAY_LOSS_STOP_PTS = 0;
var CRUDE_STRICT_DAY_LOSS_PTS = 0;
function crudeDayLossActive(dayLossStopPts) {
  return dayLossStopPts > 0;
}
function crudeTradeCapActive(maxTrades) {
  return maxTrades > 0;
}
function createCrudePdhlState() {
  return {
    tradingDate: null,
    tradingMonth: null,
    dayNetPts: 0,
    tradesToday: 0,
    morningTradesToday: 0,
    eveningTradesToday: 0,
    tradesThisMonth: 0,
    dayStoppedReason: null,
    pendingConfirm: null,
    wonToday: false
  };
}
function recordCrudeTradeClosed(state, points, dayLossStopPts = CRUDE_DAY_LOSS_STOP_PTS, book = "evening", dayProfitLockPts = 0, firstWinLock = false) {
  state.dayNetPts += points;
  state.tradesToday += 1;
  state.tradesThisMonth += 1;
  if (book === "morning") {
    state.morningTradesToday += 1;
  } else {
    state.eveningTradesToday += 1;
  }
  if (points > 0) {
    state.wonToday = true;
  }
  if (firstWinLock && state.wonToday) {
    state.dayStoppedReason = "First win lock \u2014 day done";
  } else if (dayProfitLockPts > 0 && state.dayNetPts >= dayProfitLockPts) {
    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;
  } else if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts <= -dayLossStopPts) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
  }
}
function prevDayHl(candles, beforeIndex, tradingDate) {
  let prevDate = null;
  for (let i = beforeIndex - 1; i >= 0; i -= 1) {
    const d = extractTradeDate(candles[i].date);
    if (d < tradingDate) {
      prevDate = d;
      break;
    }
  }
  if (!prevDate) {
    return null;
  }
  let pdh = -Infinity;
  let pdl = Infinity;
  for (let i = 0; i < beforeIndex; i += 1) {
    const c = candles[i];
    if (extractTradeDate(c.date) !== prevDate) {
      continue;
    }
    pdh = Math.max(pdh, c.high);
    pdl = Math.min(pdl, c.low);
  }
  if (!Number.isFinite(pdh) || !Number.isFinite(pdl)) {
    return null;
  }
  return { pdh, pdl };
}
function runCrudePdhlEvening(params) {
  const { candle, series, index, state } = params;
  const dayLossStopPts = params.dayLossStopPts ?? CRUDE_DAY_LOSS_STOP_PTS;
  const dayProfitLockPts = params.dayProfitLockPts ?? 0;
  const stopPts = params.stopPts ?? CRUDE_STOP_PTS;
  const targetPts = params.targetPts ?? CRUDE_EVENING_TARGET_PTS;
  const requireConfirm = params.requireConfirm === true;
  const entryStart = params.entryStart ?? CRUDE_ENTRY_START;
  const entryEnd = params.entryEnd ?? CRUDE_ENTRY_END;
  const maxTradesDay = params.maxTradesDay ?? CRUDE_MAX_TRADES_DAY;
  const tradingDate = extractTradeDate(candle.date);
  const month = tradingDate.slice(0, 7);
  const time = extractHhMm(candle.date);
  if (state.tradingDate !== tradingDate) {
    state.tradingDate = tradingDate;
    state.dayNetPts = 0;
    state.tradesToday = 0;
    state.morningTradesToday = 0;
    state.eveningTradesToday = 0;
    state.dayStoppedReason = null;
    state.pendingConfirm = null;
    state.wonToday = false;
  }
  if (state.tradingMonth !== month) {
    state.tradingMonth = month;
    state.tradesThisMonth = 0;
  }
  if (state.dayStoppedReason) {
    return wait2(candle, state.dayStoppedReason);
  }
  if (dayProfitLockPts > 0 && state.dayNetPts >= dayProfitLockPts) {
    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;
    return wait2(candle, state.dayStoppedReason);
  }
  if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts <= -dayLossStopPts) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
    return wait2(candle, state.dayStoppedReason);
  }
  if (crudeTradeCapActive(maxTradesDay) && state.eveningTradesToday >= maxTradesDay) {
    return wait2(candle, `Max ${maxTradesDay} evening trades/day`);
  }
  if (crudeTradeCapActive(CRUDE_MAX_TRADES_MONTH) && state.tradesThisMonth >= CRUDE_MAX_TRADES_MONTH) {
    return wait2(candle, `Max ${CRUDE_MAX_TRADES_MONTH} trades/month`);
  }
  if (state.pendingConfirm) {
    const p = state.pendingConfirm;
    state.pendingConfirm = null;
    if (time < entryStart || time > entryEnd) {
      return wait2(candle, "Confirm outside entry window");
    }
    const bullOk = p.dir === 1 && candle.close > candle.open && candle.close > p.signalClose;
    const bearOk = p.dir === -1 && candle.close < candle.open && candle.close < p.signalClose;
    if (!bullOk && !bearOk) {
      return wait2(candle, "PDHL confirm failed");
    }
    const action2 = p.dir === 1 ? "BUY" : "SELL";
    const entry2 = candle.open;
    const stopLoss2 = action2 === "BUY" ? entry2 - stopPts : entry2 + stopPts;
    const target2 = action2 === "BUY" ? entry2 + targetPts : entry2 - targetPts;
    if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts - stopPts < -dayLossStopPts) {
      return {
        action: "NO_TRADE",
        entryPrice: entry2,
        stopLoss: entry2,
        target: entry2,
        reason: "Next SL would breach day max loss"
      };
    }
    return {
      action: action2,
      entryPrice: entry2,
      stopLoss: stopLoss2,
      target: target2,
      reason: `${action2} PDHL confirm \xB7 SL ${stopPts} / TP ${targetPts} \xB7 day ${state.dayNetPts.toFixed(1)}`
    };
  }
  if (time < entryStart || time > entryEnd) {
    return wait2(candle, `Outside entry window (${entryStart}\u2013${entryEnd})`);
  }
  const levels = prevDayHl(series, index, tradingDate);
  if (!levels) {
    return wait2(candle, "Previous day H/L not ready");
  }
  let action = null;
  if (candle.close > levels.pdh && candle.close > candle.open) {
    action = "BUY";
  } else if (candle.close < levels.pdl && candle.close < candle.open) {
    action = "SELL";
  }
  if (!action) {
    return wait2(candle, `Waiting PDHL break (${levels.pdl.toFixed(1)}\u2013${levels.pdh.toFixed(1)})`);
  }
  if (requireConfirm) {
    state.pendingConfirm = {
      dir: action === "BUY" ? 1 : -1,
      signalClose: candle.close
    };
    return wait2(candle, `PDHL signal armed \xB7 waiting confirm (${action})`);
  }
  const entry = candle.close;
  const stopLoss = action === "BUY" ? entry - stopPts : entry + stopPts;
  const target = action === "BUY" ? entry + targetPts : entry - targetPts;
  if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts - stopPts < -dayLossStopPts) {
    return {
      action: "NO_TRADE",
      entryPrice: entry,
      stopLoss: entry,
      target: entry,
      reason: "Next SL would breach day max loss"
    };
  }
  return {
    action,
    entryPrice: entry,
    stopLoss,
    target,
    reason: `${action} PDHL \xB7 SL ${stopPts} / TP ${targetPts} \xB7 day ${state.dayNetPts.toFixed(1)}`
  };
}
function wait2(candle, reason) {
  return {
    action: "WAITING",
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    reason
  };
}

// src/app/core/strategy-engine/strategies/crude-orb-morning/crude-orb-morning.evaluator.ts
var CRUDE_MORNING_ENTRY_START = "10:00";
var CRUDE_MORNING_ENTRY_END = "12:00";
var CRUDE_MORNING_OR_START = "09:00";
var CRUDE_MORNING_OR_END = "10:00";
var CRUDE_MORNING_MAX_TRADES_DAY = 0;
var CRUDE_MORNING_MAX_OR_WIDTH = 0;
function orbRange(candles, tradingDate, orStart, orEnd) {
  let high = -Infinity;
  let low = Infinity;
  for (const c of candles) {
    if (extractTradeDate(c.date) !== tradingDate) {
      continue;
    }
    const t = extractHhMm(c.date);
    if (t < orStart || t > orEnd) {
      continue;
    }
    high = Math.max(high, c.high);
    low = Math.min(low, c.low);
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return null;
  }
  return { high, low };
}
function wait3(candle, reason) {
  return {
    action: "WAITING",
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    reason
  };
}
function runCrudeMorningOrb(params) {
  const { candle, series, state } = params;
  const dayLossStopPts = params.dayLossStopPts ?? CRUDE_DAY_LOSS_STOP_PTS;
  const dayProfitLockPts = params.dayProfitLockPts ?? 0;
  const stopPts = params.stopPts ?? CRUDE_STOP_PTS;
  const targetPts = params.targetPts ?? CRUDE_MORNING_TARGET_PTS;
  const tradingDate = extractTradeDate(candle.date);
  const month = tradingDate.slice(0, 7);
  const time = extractHhMm(candle.date);
  if (state.tradingDate !== tradingDate) {
    state.tradingDate = tradingDate;
    state.dayNetPts = 0;
    state.tradesToday = 0;
    state.morningTradesToday = 0;
    state.eveningTradesToday = 0;
    state.dayStoppedReason = null;
    state.pendingConfirm = null;
    state.wonToday = false;
  }
  if (state.tradingMonth !== month) {
    state.tradingMonth = month;
    state.tradesThisMonth = 0;
  }
  if (state.dayStoppedReason) {
    return wait3(candle, state.dayStoppedReason);
  }
  if (dayProfitLockPts > 0 && state.dayNetPts >= dayProfitLockPts) {
    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;
    return wait3(candle, state.dayStoppedReason);
  }
  if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts <= -dayLossStopPts) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
    return wait3(candle, state.dayStoppedReason);
  }
  if (crudeTradeCapActive(CRUDE_MORNING_MAX_TRADES_DAY) && state.morningTradesToday >= CRUDE_MORNING_MAX_TRADES_DAY) {
    return wait3(candle, `Max ${CRUDE_MORNING_MAX_TRADES_DAY} morning trade/day`);
  }
  if (crudeTradeCapActive(CRUDE_MAX_TRADES_MONTH) && state.tradesThisMonth >= CRUDE_MAX_TRADES_MONTH) {
    return wait3(candle, `Max ${CRUDE_MAX_TRADES_MONTH} trades/month`);
  }
  if (time < CRUDE_MORNING_ENTRY_START || time > CRUDE_MORNING_ENTRY_END) {
    return wait3(
      candle,
      `Outside morning window (${CRUDE_MORNING_ENTRY_START}\u2013${CRUDE_MORNING_ENTRY_END})`
    );
  }
  const orb = orbRange(series, tradingDate, CRUDE_MORNING_OR_START, CRUDE_MORNING_OR_END);
  if (!orb) {
    return wait3(candle, "Opening range not ready");
  }
  const orWidth = orb.high - orb.low;
  if (CRUDE_MORNING_MAX_OR_WIDTH > 0 && orWidth > CRUDE_MORNING_MAX_OR_WIDTH) {
    return wait3(
      candle,
      `OR too wide (${orWidth.toFixed(0)} > ${CRUDE_MORNING_MAX_OR_WIDTH})`
    );
  }
  let action = null;
  if (candle.close > orb.high && candle.close > candle.open) {
    action = "BUY";
  } else if (candle.close < orb.low && candle.close < candle.open) {
    action = "SELL";
  }
  if (!action) {
    return wait3(candle, `Waiting ORB break (${orb.low.toFixed(1)}\u2013${orb.high.toFixed(1)})`);
  }
  const entry = candle.close;
  const stopLoss = action === "BUY" ? entry - stopPts : entry + stopPts;
  const target = action === "BUY" ? entry + targetPts : entry - targetPts;
  if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts - stopPts < -dayLossStopPts) {
    return {
      action: "NO_TRADE",
      entryPrice: entry,
      stopLoss: entry,
      target: entry,
      reason: "Next SL would breach day max loss"
    };
  }
  return {
    action,
    entryPrice: entry,
    stopLoss,
    target,
    reason: `${action} morning ORB \xB7 SL ${stopPts} / TP ${targetPts} \xB7 day ${state.dayNetPts.toFixed(1)}`
  };
}

// src/app/core/strategy-engine/strategies/crude-trap-confirm/crude-trap-confirm.evaluator.ts
var CRUDE_TRAP_ENTRY_START = "10:00";
var CRUDE_TRAP_ENTRY_END = "22:00";
var CRUDE_TRAP_MAX_TRADES_DAY = 0;
var CRUDE_TRAP_SWING_LB = 5;
var CRUDE_TRAP_PIERCE = 8;
var CRUDE_TRAP_SL_PAD = 2;
var CRUDE_TRAP_MIN_RISK = 15;
var CRUDE_TRAP_MAX_RISK = 120;
var CRUDE_TRAP_RR = 3.5;
function createCrudeTrapState() {
  return {
    tradingDate: null,
    tradingMonth: null,
    dayNetPts: 0,
    tradesToday: 0,
    morningTradesToday: 0,
    eveningTradesToday: 0,
    tradesThisMonth: 0,
    dayStoppedReason: null,
    pendingConfirm: null,
    wonToday: false,
    pending: null
  };
}
function ema50(closes) {
  if (closes.length < 50) {
    return null;
  }
  const k = 2 / 51;
  let ema = closes.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
  for (let i = 50; i < closes.length; i += 1) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}
function swingHL2(dayBars, i, lb) {
  const start = Math.max(0, i - lb);
  const window = dayBars.slice(start, i);
  if (!window.length) {
    return { sh: dayBars[i].high, sl: dayBars[i].low };
  }
  return {
    sh: Math.max(...window.map((b) => b.high)),
    sl: Math.min(...window.map((b) => b.low))
  };
}
function wait4(candle, reason) {
  return {
    action: "WAITING",
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    reason
  };
}
function runCrudeTrapConfirm(params) {
  const { candle, series, state } = params;
  const dayLossStopPts = params.dayLossStopPts ?? CRUDE_DAY_LOSS_STOP_PTS;
  const dayProfitLockPts = params.dayProfitLockPts ?? 0;
  const rr = params.targetRMultiple ?? CRUDE_TRAP_RR;
  const entryStart = params.entryStart ?? CRUDE_TRAP_ENTRY_START;
  const entryEnd = params.entryEnd ?? CRUDE_TRAP_ENTRY_END;
  const maxDay = params.maxTradesDay ?? CRUDE_TRAP_MAX_TRADES_DAY;
  const pierce = params.pierce ?? CRUDE_TRAP_PIERCE;
  const style = params.trapEntryStyle ?? "both";
  const firstWinLock = params.firstWinLock === true;
  const fixedStop = (params.stopPts ?? 0) > 0 && (params.targetPts ?? 0) > 0 && !(params.targetRMultiple != null && params.targetRMultiple > 0);
  const stopPts = params.stopPts ?? 0;
  const targetPts = params.targetPts ?? 0;
  const tradingDate = extractTradeDate(candle.date);
  const month = tradingDate.slice(0, 7);
  const time = extractHhMm(candle.date);
  if (state.tradingDate !== tradingDate) {
    state.tradingDate = tradingDate;
    state.dayNetPts = 0;
    state.tradesToday = 0;
    state.morningTradesToday = 0;
    state.eveningTradesToday = 0;
    state.dayStoppedReason = null;
    state.pendingConfirm = null;
    state.wonToday = false;
    state.pending = null;
  }
  if (state.tradingMonth !== month) {
    state.tradingMonth = month;
    state.tradesThisMonth = 0;
  }
  if (state.dayStoppedReason) {
    return wait4(candle, state.dayStoppedReason);
  }
  if (dayProfitLockPts > 0 && state.dayNetPts >= dayProfitLockPts) {
    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;
    return wait4(candle, state.dayStoppedReason);
  }
  if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts <= -dayLossStopPts) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
    return wait4(candle, state.dayStoppedReason);
  }
  if (firstWinLock && state.wonToday) {
    return wait4(candle, "First-win lock \u2014 done for day");
  }
  if (crudeTradeCapActive(maxDay) && state.tradesToday >= maxDay) {
    return wait4(candle, `Max ${maxDay} trap trades/day`);
  }
  if (crudeTradeCapActive(CRUDE_MAX_TRADES_MONTH) && state.tradesThisMonth >= CRUDE_MAX_TRADES_MONTH) {
    return wait4(candle, `Max ${CRUDE_MAX_TRADES_MONTH} trades/month`);
  }
  const dayBars = series.filter((c) => extractTradeDate(c.date) === tradingDate);
  const i = dayBars.findIndex((b) => b.date === candle.date);
  if (i < 0) {
    return wait4(candle, "Bar not in day series");
  }
  if (state.pending) {
    const p = state.pending;
    state.pending = null;
    if (time < entryStart || time > entryEnd) {
      return wait4(candle, "Confirm outside entry window");
    }
    const bullOk = p.dir === 1 && candle.close > candle.open && candle.close > p.signalClose;
    const bearOk = p.dir === -1 && candle.close < candle.open && candle.close < p.signalClose;
    if (!(bullOk || bearOk)) {
      return wait4(candle, "Crude trap confirm failed");
    }
    const fill = candle.open;
    if (fixedStop) {
      const stop3 = p.dir === 1 ? fill - stopPts : fill + stopPts;
      const target2 = p.dir === 1 ? fill + targetPts : fill - targetPts;
      if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts - stopPts < -dayLossStopPts) {
        return {
          action: "NO_TRADE",
          entryPrice: fill,
          stopLoss: fill,
          target: fill,
          reason: "Next SL would breach day max loss"
        };
      }
      return {
        action: p.dir === 1 ? "BUY" : "SELL",
        entryPrice: fill,
        stopLoss: stop3,
        target: target2,
        reason: `NG trap confirm ${p.dir === 1 ? "BUY" : "SELL"} \xB7 SL${stopPts}/TP${targetPts} \xB7 day ${state.dayNetPts.toFixed(1)}`
      };
    }
    const stop2 = p.dir === 1 ? Math.min(p.stop, fill - 1) : Math.max(p.stop, fill + 1);
    const risk = Math.abs(fill - stop2);
    if (risk < CRUDE_TRAP_MIN_RISK || risk > CRUDE_TRAP_MAX_RISK) {
      return wait4(candle, `Risk ${risk.toFixed(1)} outside ${CRUDE_TRAP_MIN_RISK}\u2013${CRUDE_TRAP_MAX_RISK}`);
    }
    if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts - risk < -dayLossStopPts) {
      return {
        action: "NO_TRADE",
        entryPrice: fill,
        stopLoss: fill,
        target: fill,
        reason: "Next SL would breach day max loss"
      };
    }
    const target = p.dir === 1 ? fill + risk * rr : fill - risk * rr;
    return {
      action: p.dir === 1 ? "BUY" : "SELL",
      entryPrice: fill,
      stopLoss: stop2,
      target,
      reason: `Crude trap confirm ${p.dir === 1 ? "BUY" : "SELL"} \xB7 ${rr}R \xB7 day ${state.dayNetPts.toFixed(1)}`
    };
  }
  if (time < entryStart || time > entryEnd) {
    return wait4(candle, `Outside trap window (${entryStart}\u2013${entryEnd})`);
  }
  if (i < CRUDE_TRAP_SWING_LB) {
    return wait4(candle, "Warming crude swing lookback");
  }
  const closes = series.map((c) => c.close);
  const ema = ema50(closes);
  if (ema == null) {
    return wait4(candle, "EMA50 warming");
  }
  const { sh, sl } = swingHL2(dayBars, i, CRUDE_TRAP_SWING_LB);
  const cc = candle.close;
  const oo = candle.open;
  const hh = candle.high;
  const ll = candle.low;
  const pad = CRUDE_TRAP_SL_PAD;
  const rng = Math.max(hh - ll, 1e-9);
  const allowTrap = style === "trap" || style === "both";
  const allowBounce = style === "bounce" || style === "both";
  const trapBuy = allowTrap && ll < sl - pierce && cc > sl && cc > oo;
  const trapSell = allowTrap && hh > sh + pierce && cc < sh && cc < oo;
  const bounceBuy = allowBounce && ll <= sl + pierce && ll >= sl - pierce * 2 && cc > oo && cc >= sl && (hh - cc) / rng < 0.35;
  const bounceSell = allowBounce && hh >= sh - pierce && hh <= sh + pierce * 2 && cc < oo && cc <= sh && (cc - ll) / rng < 0.35;
  let dir = 0;
  let stop = 0;
  if ((trapBuy || bounceBuy) && cc > ema) {
    dir = 1;
    stop = fixedStop ? cc - stopPts : ll - pad;
  } else if ((trapSell || bounceSell) && cc < ema) {
    dir = -1;
    stop = fixedStop ? cc + stopPts : hh + pad;
  }
  if (!dir) {
    return wait4(candle, style === "trap" ? "No S/R trap" : "No crude S/R trap / bounce");
  }
  if (!fixedStop) {
    const risk = Math.abs(cc - stop);
    if (risk < CRUDE_TRAP_MIN_RISK || risk > CRUDE_TRAP_MAX_RISK) {
      return wait4(candle, `Arm risk ${risk.toFixed(1)} outside band`);
    }
  }
  state.pending = { dir, stop, signalClose: cc };
  return wait4(
    candle,
    dir === 1 ? "Trap BUY armed \u2014 wait confirm" : "Trap SELL armed \u2014 wait confirm"
  );
}

// src/app/core/strategy-engine/strategies/crude-session-or/crude-session-or.evaluator.ts
var CRUDE_SOR_ENTRY_START = "09:00";
var CRUDE_SOR_ENTRY_END = "23:00";
var CRUDE_SOR_OR_START = "09:00";
var CRUDE_SOR_OR_END = "09:30";
var CRUDE_SOR_MAX_OR_WIDTH = 0;
var CRUDE_SOR_MAX_TRADES_DAY = 0;
function sessionOr(candles, tradingDate, orStart, orEnd) {
  let high = -Infinity;
  let low = Infinity;
  for (const c of candles) {
    if (extractTradeDate(c.date) !== tradingDate) {
      continue;
    }
    const t = extractHhMm(c.date);
    if (t < orStart || t > orEnd) {
      continue;
    }
    high = Math.max(high, c.high);
    low = Math.min(low, c.low);
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return null;
  }
  return { high, low };
}
function wait5(candle, reason) {
  return {
    action: "WAITING",
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    reason
  };
}
function runCrudeSessionOr(params) {
  const { candle, series, state } = params;
  const dayLossStopPts = params.dayLossStopPts ?? CRUDE_DAY_LOSS_STOP_PTS;
  const dayProfitLockPts = params.dayProfitLockPts ?? 0;
  const stopPts = params.stopPts ?? 15;
  const targetPts = params.targetPts ?? 100;
  const requireConfirm = params.requireConfirm !== false;
  const firstWinLock = params.firstWinLock === true;
  const entryStart = params.entryStart ?? CRUDE_SOR_ENTRY_START;
  const entryEnd = params.entryEnd ?? CRUDE_SOR_ENTRY_END;
  const orStart = params.orStart ?? CRUDE_SOR_OR_START;
  const orEnd = params.orEnd ?? CRUDE_SOR_OR_END;
  const maxOrWidth = params.maxOrWidth ?? CRUDE_SOR_MAX_OR_WIDTH;
  const minOrWidth = params.minOrWidth ?? 0;
  const breakBufferPts = params.breakBufferPts ?? 0;
  const maxTradesDay = params.maxTradesDay ?? CRUDE_SOR_MAX_TRADES_DAY;
  const tradingDate = extractTradeDate(candle.date);
  const month = tradingDate.slice(0, 7);
  const time = extractHhMm(candle.date);
  if (state.tradingDate !== tradingDate) {
    state.tradingDate = tradingDate;
    state.dayNetPts = 0;
    state.tradesToday = 0;
    state.morningTradesToday = 0;
    state.eveningTradesToday = 0;
    state.dayStoppedReason = null;
    state.pendingConfirm = null;
    state.wonToday = false;
  }
  if (state.tradingMonth !== month) {
    state.tradingMonth = month;
    state.tradesThisMonth = 0;
  }
  if (state.dayStoppedReason) {
    return wait5(candle, state.dayStoppedReason);
  }
  if (firstWinLock && state.wonToday) {
    state.dayStoppedReason = "First win lock \u2014 day done";
    return wait5(candle, state.dayStoppedReason);
  }
  if (dayProfitLockPts > 0 && state.dayNetPts >= dayProfitLockPts) {
    state.dayStoppedReason = `Day profit lock +${state.dayNetPts.toFixed(1)} pts`;
    return wait5(candle, state.dayStoppedReason);
  }
  if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts <= -dayLossStopPts) {
    state.dayStoppedReason = `Day max loss ${state.dayNetPts.toFixed(1)} pts`;
    return wait5(candle, state.dayStoppedReason);
  }
  if (crudeTradeCapActive(maxTradesDay) && state.tradesToday >= maxTradesDay) {
    return wait5(candle, `Max ${maxTradesDay} afternoon trades/day`);
  }
  if (crudeTradeCapActive(CRUDE_MAX_TRADES_MONTH) && state.tradesThisMonth >= CRUDE_MAX_TRADES_MONTH) {
    return wait5(candle, `Max ${CRUDE_MAX_TRADES_MONTH} trades/month`);
  }
  if (state.pendingConfirm) {
    const p = state.pendingConfirm;
    state.pendingConfirm = null;
    if (time < entryStart || time > entryEnd) {
      return wait5(candle, "Confirm outside entry window");
    }
    const bullOk = p.dir === 1 && candle.close > candle.open && candle.close > p.signalClose;
    const bearOk = p.dir === -1 && candle.close < candle.open && candle.close < p.signalClose;
    if (!bullOk && !bearOk) {
      return wait5(candle, "Session OR confirm failed");
    }
    const action2 = p.dir === 1 ? "BUY" : "SELL";
    const entry2 = candle.open;
    const stopLoss2 = action2 === "BUY" ? entry2 - stopPts : entry2 + stopPts;
    const target2 = action2 === "BUY" ? entry2 + targetPts : entry2 - targetPts;
    if (crudeDayLossActive(dayLossStopPts) && state.dayNetPts - stopPts < -dayLossStopPts) {
      return {
        action: "NO_TRADE",
        entryPrice: entry2,
        stopLoss: entry2,
        target: entry2,
        reason: "Next SL would breach day max loss"
      };
    }
    return {
      action: action2,
      entryPrice: entry2,
      stopLoss: stopLoss2,
      target: target2,
      reason: `${action2} Session OR confirm \xB7 SL ${stopPts} / TP ${targetPts}`
    };
  }
  if (time < entryStart || time > entryEnd) {
    return wait5(candle, `Outside entry window (${entryStart}\u2013${entryEnd})`);
  }
  if (time <= orEnd) {
    return wait5(candle, `Building session OR (${orStart}\u2013${orEnd})`);
  }
  const orb = sessionOr(series, tradingDate, orStart, orEnd);
  if (!orb) {
    return wait5(candle, "Session OR not ready");
  }
  const width = orb.high - orb.low;
  if (maxOrWidth > 0 && width > maxOrWidth) {
    return wait5(candle, `OR too wide (${width.toFixed(1)}>${maxOrWidth})`);
  }
  if (minOrWidth > 0 && width < minOrWidth) {
    return wait5(candle, `OR too narrow (${width.toFixed(1)}<${minOrWidth})`);
  }
  let action = null;
  const upLevel = orb.high + breakBufferPts;
  const dnLevel = orb.low - breakBufferPts;
  if (candle.close > upLevel && candle.close > candle.open) {
    action = "BUY";
  } else if (candle.close < dnLevel && candle.close < candle.open) {
    action = "SELL";
  }
  if (!action) {
    return wait5(candle, `Waiting OR break (${orb.low.toFixed(1)}\u2013${orb.high.toFixed(1)})`);
  }
  if (requireConfirm) {
    state.pendingConfirm = {
      dir: action === "BUY" ? 1 : -1,
      signalClose: candle.close
    };
    return wait5(candle, `Session OR armed \xB7 waiting confirm (${action})`);
  }
  const entry = candle.close;
  const stopLoss = action === "BUY" ? entry - stopPts : entry + stopPts;
  const target = action === "BUY" ? entry + targetPts : entry - targetPts;
  return {
    action,
    entryPrice: entry,
    stopLoss,
    target,
    reason: `${action} Session OR \xB7 SL ${stopPts} / TP ${targetPts}`
  };
}

// src/app/core/strategy-engine/strategies/crude-pdhl-evening/crude-strategy-profile.ts
var PROTECT_OFF = {
  profitLockArmRs: 0,
  profitLockLockRs: 0,
  profitLockGivebackRs: 0,
  slConfirmCutoffEnabled: false,
  slConfirmCutoffFracR: 0.55,
  slConfirmCutoffMaxMfeR: 0.75,
  slConfirmSoftRs: 700
};
var PROTECT_TRADE_CUTOFF = {
  profitLockArmRs: 500,
  profitLockLockRs: 240,
  profitLockGivebackRs: 260,
  slConfirmCutoffEnabled: false,
  slConfirmCutoffFracR: 0.55,
  slConfirmCutoffMaxMfeR: 0.75,
  slConfirmSoftRs: 700
};
var CRUDE_ALL_GREEN_STOP_PTS = 15;
var CRUDE_ALL_GREEN_TARGET_PTS = 100;
var CRUDE_ALL_GREEN_PARAMS = {
  profileId: "all-green",
  label: "All-Green (09:00\u201323:00)",
  stopPts: CRUDE_ALL_GREEN_STOP_PTS,
  morningTargetPts: CRUDE_ALL_GREEN_TARGET_PTS,
  eveningTargetPts: CRUDE_ALL_GREEN_TARGET_PTS,
  targetRMultiple: 0,
  dayLossStopPts: CRUDE_DAY_LOSS_STOP_PTS,
  strictDayLossPts: CRUDE_STRICT_DAY_LOSS_PTS,
  dayProfitLockPts: 0,
  entryMode: "session-or",
  requireConfirm: true,
  firstWinLock: false,
  eveningEntryStart: CRUDE_SOR_ENTRY_START,
  eveningEntryEnd: CRUDE_SOR_ENTRY_END,
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: CRUDE_SOR_MAX_OR_WIDTH,
  maxEveningTradesDay: 0,
  defaultEnableMorning: false,
  defaultEnableEvening: true,
  dailyBandLabel: "OR 09:00\u201309:30 \xB7 SL\u20B9150 \xB7 trail \u20B9500\u2192\u20B9240 \xB7 no OR skip",
  ...PROTECT_TRADE_CUTOFF
};
/** After-NSE selective All-Green — no overlap with Nifty/Bank session (entries 16:00+). */
var CRUDE_LIVE_GREEN_PARAMS = {
  profileId: "live-crude-green",
  label: "Live Crude Green (after NSE close)",
  stopPts: 30,
  morningTargetPts: 80,
  eveningTargetPts: 80,
  targetRMultiple: 0,
  dayLossStopPts: 30,
  strictDayLossPts: 30,
  dayProfitLockPts: 150,
  entryMode: "session-or",
  requireConfirm: true,
  firstWinLock: true,
  eveningEntryStart: "16:00",
  eveningEntryEnd: "21:00",
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  minOrWidth: 40,
  maxOrWidth: 60,
  breakBufferPts: 0,
  maxEveningTradesDay: 1,
  defaultEnableMorning: false,
  defaultEnableEvening: true,
  dailyBandLabel: "After NSE \xB7 OR40\u201360 \xB7 16:00\u201321:00 \xB7 SL30/TP80 \xB7 trail \u20B9350\u2192\u20B9180 \xB7 max1 \xB7 first-win",
  profitLockArmRs: 350,
  profitLockLockRs: 180,
  profitLockGivebackRs: 170,
  slConfirmCutoffEnabled: false,
  slConfirmCutoffFracR: 0.55,
  slConfirmCutoffMaxMfeR: 0.75,
  slConfirmSoftRs: 700
};
var CRUDE_SELECTIVE_PARAMS = {
  profileId: "selective",
  label: "Selective (Trap SL50/TP200 \xB7 unlimited)",
  stopPts: 50,
  morningTargetPts: 200,
  eveningTargetPts: 200,
  targetRMultiple: 0,
  dayLossStopPts: 0,
  strictDayLossPts: 0,
  dayProfitLockPts: 0,
  entryMode: "trap-confirm",
  requireConfirm: true,
  firstWinLock: false,
  eveningEntryStart: "10:00",
  eveningEntryEnd: CRUDE_SOR_ENTRY_END,
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: 0,
  maxEveningTradesDay: 0,
  defaultEnableMorning: false,
  defaultEnableEvening: true,
  dailyBandLabel: "10:00\u201323:00 \xB7 Trap SL50/TP200 \xB7 confirm \xB7 unlimited",
  piercePts: 0,
  trapEntryStyle: "both",
  ...PROTECT_OFF
};
var CRUDE_DAILY_PROFIT_PARAMS = {
  profileId: "daily-profit",
  label: "Daily Profit (Trap-style)",
  stopPts: 20,
  morningTargetPts: 40,
  eveningTargetPts: 40,
  targetRMultiple: 0,
  dayLossStopPts: CRUDE_DAY_LOSS_STOP_PTS,
  strictDayLossPts: CRUDE_STRICT_DAY_LOSS_PTS,
  dayProfitLockPts: 0,
  entryMode: "orb-pdhl",
  requireConfirm: true,
  firstWinLock: false,
  eveningEntryStart: "18:30",
  eveningEntryEnd: "21:00",
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: CRUDE_SOR_MAX_OR_WIDTH,
  maxEveningTradesDay: 0,
  defaultEnableMorning: false,
  defaultEnableEvening: true,
  dailyBandLabel: "Eve PDHL+confirm \xB7 SL\u20B9200/TP\u20B9400 \xB7 unlimited \xB7 no day stop",
  ...PROTECT_OFF
};
var CRUDE_CHAMPION_PARAMS = {
  profileId: "champion",
  label: "Champion (hunt pair)",
  stopPts: CRUDE_STOP_PTS,
  morningTargetPts: CRUDE_MORNING_TARGET_PTS,
  eveningTargetPts: CRUDE_EVENING_TARGET_PTS,
  targetRMultiple: 0,
  dayLossStopPts: CRUDE_DAY_LOSS_STOP_PTS,
  strictDayLossPts: CRUDE_STRICT_DAY_LOSS_PTS,
  dayProfitLockPts: 0,
  entryMode: "orb-pdhl",
  requireConfirm: false,
  firstWinLock: false,
  eveningEntryStart: "18:30",
  eveningEntryEnd: "20:30",
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: CRUDE_SOR_MAX_OR_WIDTH,
  maxEveningTradesDay: 0,
  defaultEnableMorning: true,
  defaultEnableEvening: true,
  dailyBandLabel: "Champion SL80/TP250\xB7150 \xB7 unlimited \xB7 no day stop",
  ...PROTECT_OFF
};
var CRUDE_DAILY_INCOME_PARAMS = {
  profileId: "daily-income",
  label: "Daily Income (\u20B9300\u20131,000)",
  stopPts: 40,
  morningTargetPts: 80,
  eveningTargetPts: 50,
  targetRMultiple: 0,
  dayLossStopPts: CRUDE_DAY_LOSS_STOP_PTS,
  strictDayLossPts: CRUDE_STRICT_DAY_LOSS_PTS,
  dayProfitLockPts: 0,
  entryMode: "orb-pdhl",
  requireConfirm: false,
  firstWinLock: false,
  eveningEntryStart: "18:30",
  eveningEntryEnd: "20:30",
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: CRUDE_SOR_MAX_OR_WIDTH,
  maxEveningTradesDay: 0,
  defaultEnableMorning: true,
  defaultEnableEvening: true,
  dailyBandLabel: "SL40 / TP80\xB750 \xB7 unlimited \xB7 no day stop",
  ...PROTECT_OFF
};
var CRUDE_TRAP_CONFIRM_PARAMS = {
  profileId: "trap-confirm",
  label: "Trap Confirm (like Nifty Trap)",
  stopPts: 80,
  morningTargetPts: 0,
  eveningTargetPts: 0,
  targetRMultiple: CRUDE_TRAP_RR,
  dayLossStopPts: CRUDE_DAY_LOSS_STOP_PTS,
  strictDayLossPts: CRUDE_STRICT_DAY_LOSS_PTS,
  dayProfitLockPts: 0,
  entryMode: "trap-confirm",
  requireConfirm: true,
  firstWinLock: false,
  eveningEntryStart: "10:00",
  eveningEntryEnd: "22:00",
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: CRUDE_SOR_MAX_OR_WIDTH,
  maxEveningTradesDay: 0,
  defaultEnableMorning: true,
  defaultEnableEvening: true,
  dailyBandLabel: "S/R trap + confirm \xB7 3.5R \xB7 unlimited \xB7 no day stop",
  ...PROTECT_OFF
};
var NATGAS_DAILY_PROFIT_PARAMS = {
  profileId: "daily-profit-ng",
  label: "Daily Profit (NG)",
  stopPts: 1.5,
  morningTargetPts: 3,
  eveningTargetPts: 3,
  targetRMultiple: 0,
  dayLossStopPts: 3,
  strictDayLossPts: 3,
  dayProfitLockPts: 0,
  entryMode: "trap-confirm",
  requireConfirm: true,
  firstWinLock: true,
  eveningEntryStart: "10:00",
  eveningEntryEnd: "22:00",
  sessionOrStart: CRUDE_SOR_OR_START,
  sessionOrEnd: CRUDE_SOR_OR_END,
  maxOrWidth: CRUDE_SOR_MAX_OR_WIDTH,
  maxEveningTradesDay: 1,
  defaultEnableMorning: false,
  defaultEnableEvening: true,
  dailyBandLabel: "NG trap \xB7 pierce 0.2 \xB7 SL1.5/TP3 \xB7 confirm \xB7 first-win \xB7 max 1/day",
  piercePts: 0.2,
  trapEntryStyle: "trap",
  ...PROTECT_OFF
};
var CRUDE_STRATEGY_PROFILES = {
  "all-green": CRUDE_ALL_GREEN_PARAMS,
  "live-crude-green": CRUDE_LIVE_GREEN_PARAMS,
  selective: CRUDE_SELECTIVE_PARAMS,
  "daily-profit": CRUDE_DAILY_PROFIT_PARAMS,
  "daily-profit-ng": NATGAS_DAILY_PROFIT_PARAMS,
  champion: CRUDE_CHAMPION_PARAMS,
  "daily-income": CRUDE_DAILY_INCOME_PARAMS,
  "trap-confirm": CRUDE_TRAP_CONFIRM_PARAMS
};
function resolveCrudeStrategyProfile(profileId) {
  if (profileId && CRUDE_STRATEGY_PROFILES[profileId]) {
    return CRUDE_STRATEGY_PROFILES[profileId];
  }
  return CRUDE_ALL_GREEN_PARAMS;
}
function resolveCrudeProfileDayLossPts(params, strictDayStop) {
  return strictDayStop ? params.strictDayLossPts : params.dayLossStopPts;
}

// src/app/core/utils/crude-option.util.ts
function crudeStrikeStep() {
  return 50;
}
function roundCrudeStrike(spot, step = crudeStrikeStep()) {
  return Math.round(spot / step) * step;
}
function startOfDay2(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function crudeIstCalendarDay(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
function parseExpiry2(expiry) {
  if (!expiry) {
    return null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  }
  const d = new Date(expiry.includes("T") ? expiry : `${expiry}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : startOfDay2(d);
}
function formatExpiryIso2(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isMcxMiniOption(item, prefixes) {
  if (item.exchange !== "MCX") {
    return false;
  }
  const type = item.instrumentType?.toUpperCase() ?? "";
  if (type !== "CE" && type !== "PE") {
    return false;
  }
  const sym = item.tradingSymbol.toUpperCase();
  return prefixes.some((p) => sym.startsWith(p.toUpperCase()));
}
function isAnyCrudeOption(item) {
  if (item.exchange !== "MCX") {
    return false;
  }
  const type = item.instrumentType?.toUpperCase() ?? "";
  if (type !== "CE" && type !== "PE") {
    return false;
  }
  const sym = item.tradingSymbol.toUpperCase();
  return sym.startsWith("CRUDEOIL");
}
function listCrudeLiveExpiries(instruments, asOfDay, prefixes = ["CRUDEOILM"]) {
  const day = crudeIstCalendarDay(asOfDay);
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const item of instruments) {
    if (!isMcxMiniOption(item, prefixes) && !(prefixes.includes("CRUDEOILM") && isAnyCrudeOption(item))) {
      continue;
    }
    const exp = parseExpiry2(item.expiry);
    if (!exp || exp.getTime() <= day.getTime()) {
      continue;
    }
    const key = exp.getTime();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(exp);
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}
function resolveCrudeFrontExpiry(asOfDay, liveExpiries) {
  if (!liveExpiries.length) {
    return null;
  }
  return liveExpiries[0];
}
function resolveAtmCrudeMiniOption(params) {
  const prefixes = (params.prefixes?.length ? params.prefixes : ["CRUDEOILM"]).map(
    (p) => p.toUpperCase()
  );
  const strikeStep2 = params.strikeStep && params.strikeStep > 0 ? params.strikeStep : crudeStrikeStep();
  const syntheticName = params.syntheticName || prefixes[0] || "CRUDEOILM";
  const optType = params.direction === "BUY" ? "CE" : "PE";
  const strike = roundCrudeStrike(params.spot, strikeStep2);
  const asOf = new Date(
    params.asOfDateTime.includes("T") ? params.asOfDateTime : params.asOfDateTime.replace(" ", "T")
  );
  const asOfDay = Number.isNaN(asOf.getTime()) ? crudeIstCalendarDay(/* @__PURE__ */ new Date()) : crudeIstCalendarDay(asOf);
  const pool = params.instruments.filter(
    (item) => isMcxMiniOption(item, prefixes) || prefixes.some((p) => p.startsWith("CRUDE")) && isAnyCrudeOption(item)
  ).filter((item) => item.instrumentType.toUpperCase() === optType).sort((a, b) => {
    const aMini = prefixes.some((p) => a.tradingSymbol.toUpperCase().startsWith(p)) ? 0 : 1;
    const bMini = prefixes.some((p) => b.tradingSymbol.toUpperCase().startsWith(p)) ? 0 : 1;
    return aMini - bMini;
  });
  const liveExpiries = listCrudeLiveExpiries(params.instruments, asOfDay, prefixes);
  const front = resolveCrudeFrontExpiry(asOfDay, liveExpiries);
  const withExpiry = pool.map((item) => ({ item, exp: parseExpiry2(item.expiry) })).filter((row) => row.exp != null).filter((row) => {
    if (row.exp.getTime() <= asOfDay.getTime()) {
      return false;
    }
    if (!front) {
      return true;
    }
    return row.exp.getTime() === front.getTime();
  });
  const exact = withExpiry.filter((row) => Math.abs(row.item.strike - strike) < 0.01).sort((a, b) => a.exp.getTime() - b.exp.getTime());
  if (exact[0]) {
    return { instrument: exact[0].item, source: "chain" };
  }
  const near = withExpiry.filter((row) => Math.abs(row.item.strike - strike) <= strikeStep2).sort(
    (a, b) => Math.abs(a.item.strike - strike) - Math.abs(b.item.strike - strike) || a.exp.getTime() - b.exp.getTime()
  );
  if (near[0]) {
    return { instrument: near[0].item, source: "chain" };
  }
  return {
    instrument: buildSyntheticCrudeOption(
      params.direction,
      params.spot,
      asOfDay,
      front ?? void 0,
      { strikeStep: strikeStep2, name: syntheticName }
    ),
    source: "synthetic"
  };
}
/**
 * Kite/MCX trading lot_size is 1 (1 order qty = 1 lot). Do NOT inflate to 10 —
 * that placed 10 lots when Autobot asked for 1 (see kite.trade/forum/14531).
 */
function crudeMiniLotSize(lotSize) {
  const n = Math.floor(Number(lotSize) || 0);
  return n > 0 ? n : 1;
}
/** Premium is ₹/barrel; 1 Kite qty = 10 bbl mini. Skip if lotSize already 10. */
function crudeMiniPremiumPnlMult(lotSize) {
  const n = Math.floor(Number(lotSize) || 0);
  return n >= 10 ? 1 : 10;
}
function toCrudePaperOption(instrument, source) {
  return {
    tradingSymbol: instrument.tradingSymbol,
    instrumentToken: instrument.instrumentToken,
    strike: instrument.strike,
    expiry: instrument.expiry,
    optionType: instrument.instrumentType === "PE" ? "PE" : "CE",
    lotSize: crudeMiniLotSize(instrument.lotSize),
    source,
    exchange: "MCX",
    product: "MIS"
  };
}
function buildSyntheticCrudeOption(direction, spot, asOfDay, frontExpiry, opts) {
  const optType = direction === "BUY" ? "CE" : "PE";
  const step = opts?.strikeStep && opts.strikeStep > 0 ? opts.strikeStep : crudeStrikeStep();
  const name = opts?.name || "CRUDEOILM";
  const strike = roundCrudeStrike(spot, step);
  const day = crudeIstCalendarDay(asOfDay);
  let exp = frontExpiry ? crudeIstCalendarDay(frontExpiry) : day;
  if (exp.getTime() <= day.getTime()) {
    exp = new Date(day);
    exp.setDate(exp.getDate() + 1);
  }
  const expiry = formatExpiryIso2(exp);
  return {
    instrumentToken: 0,
    exchangeToken: 0,
    tradingSymbol: `${name} ATM ${strike} ${optType}`,
    name,
    exchange: "MCX",
    segment: "MCX-OPT",
    instrumentType: optType,
    expiry,
    strike,
    tickSize: 0.05,
    lotSize: 1,
    lastPrice: 0
  };
}

// src/app/core/paper-desk/crude-paper-engine.ts
function applyCrudePeakTrail(candle, open, tradeParams) {
  const armRs = tradeParams.profitLockArmRs;
  if (!(armRs > 0)) {
    return false;
  }
  const rs = CRUDE_RUPEES_PER_POINT;
  const armPts = armRs / rs;
  const barMfe = open.direction === "BUY" ? candle.high - open.entry : open.entry - candle.low;
  const peak = Math.max(open.peakMfePts ?? 0, Math.max(0, barMfe));
  open.peakMfePts = peak;
  if (peak < armPts) {
    return false;
  }
  const peakRs = peak * rs;
  const floorRs = Math.max(
    tradeParams.profitLockLockRs,
    peakRs - Math.max(0, tradeParams.profitLockGivebackRs)
  );
  const floorPts = floorRs / rs;
  if (open.direction === "BUY") {
    const lockStop = open.entry + floorPts;
    if (lockStop > open.stop) {
      open.stop = lockStop;
      return true;
    }
  } else {
    const lockStop = open.entry - floorPts;
    if (lockStop < open.stop) {
      open.stop = lockStop;
      return true;
    }
  }
  return false;
}
function applyCrudeSoftCutoff(candle, open, tradeParams) {
  if (!tradeParams.slConfirmCutoffEnabled) {
    return null;
  }
  const risk0 = open.riskPts ?? Math.abs(open.entry - open.stop);
  if (!(risk0 > 0)) {
    return null;
  }
  const rs = CRUDE_RUPEES_PER_POINT;
  const mfe = open.peakMfePts ?? 0;
  const mae = open.direction === "BUY" ? open.entry - candle.low : candle.high - open.entry;
  const against = open.direction === "BUY" ? candle.close < open.entry : candle.close > open.entry;
  const conf = open.direction === "BUY" ? candle.close < candle.open : candle.close > candle.open;
  if (mfe >= tradeParams.slConfirmCutoffMaxMfeR * risk0) {
    return null;
  }
  const hitFrac = mae >= tradeParams.slConfirmCutoffFracR * risk0;
  const hitSoft = tradeParams.slConfirmSoftRs > 0 && mae * rs >= tradeParams.slConfirmSoftRs;
  if ((hitFrac || hitSoft) && against && conf) {
    return { exitPrice: candle.close, reason: "SL cutoff \u2014 confirmed adverse" };
  }
  return null;
}
function checkFuturesExit(candle, open, tradeParams) {
  const time = extractHhMm(candle.date);
  const armed = applyCrudePeakTrail(candle, open, tradeParams);
  const soft = applyCrudeSoftCutoff(candle, open, tradeParams);
  if (soft) {
    return soft;
  }
  if (open.direction === "BUY") {
    if (candle.low <= open.stop) {
      return {
        exitPrice: open.stop,
        reason: armed ? "Profit drained \u2014 cut & rehunt" : "Stop loss hit"
      };
    }
    if (candle.high >= open.target) {
      return { exitPrice: open.target, reason: "Target hit" };
    }
  } else {
    if (candle.high >= open.stop) {
      return {
        exitPrice: open.stop,
        reason: armed ? "Profit drained \u2014 cut & rehunt" : "Stop loss hit"
      };
    }
    if (candle.low <= open.target) {
      return { exitPrice: open.target, reason: "Target hit" };
    }
  }
  if (time >= CRUDE_EXIT_BY) {
    return { exitPrice: candle.close, reason: `Session exit (${CRUDE_EXIT_BY})` };
  }
  return null;
}
function normalizeMinute2(ts) {
  return ts.replace("T", " ").slice(0, 16);
}
function lookupPremium2(optionCandles, when, edge = "exit") {
  if (!optionCandles?.length) {
    return null;
  }
  const target = normalizeMinute2(when);
  const targetDay = target.slice(0, 10);
  let best = null;
  for (const c of optionCandles) {
    const norm = normalizeMinute2(c.date);
    if (norm.slice(0, 10) !== targetDay) {
      continue;
    }
    if (norm <= target) {
      best = c;
    }
  }
  if (!best) {
    return null;
  }
  return edge === "entry" ? best.open : best.close;
}
function estimatePremiumMove(points) {
  return estimatedPremiumMove(points, "crude-oil-mini");
}
var tradeSeq2 = 0;
function closePaperTrade2(params) {
  const { open } = params;
  const lots = Math.max(1, Math.floor(params.lotsMultiplier ?? 1) || 1);
  const indexPoints = open.direction === "BUY" ? params.exitPrice - open.entry : open.entry - params.exitPrice;
  let optionExitPremium = null;
  let optionPnlRs = null;
  let premiumEstimated = open.premiumEstimated;
  if (open.option) {
    optionExitPremium = lookupPremium2(
      params.optionCandlesByToken.get(open.option.instrumentToken),
      params.exitTime,
      "exit"
    );
    const pnlMult = crudeMiniPremiumPnlMult(open.option.lotSize);
    if (open.optionEntryPremium != null && optionExitPremium != null && !premiumEstimated) {
      optionPnlRs = (optionExitPremium - open.optionEntryPremium) * open.option.lotSize * lots * pnlMult;
      premiumEstimated = false;
    } else {
      const estMove = estimatePremiumMove(indexPoints);
      const entryPx = open.optionEntryPremium ?? Math.max(10, Math.abs(estMove) + 20);
      optionExitPremium = entryPx + estMove;
      optionPnlRs = estMove * open.option.lotSize * lots * pnlMult;
      premiumEstimated = true;
    }
  }
  tradeSeq2 += 1;
  const closed = {
    id: `crude-${tradeSeq2}-${params.exitTime}`,
    instrumentId: params.instrumentId,
    instrumentName: params.instrumentName,
    direction: open.direction,
    indexEntry: open.entry,
    indexStop: open.stop,
    indexTarget: open.target,
    indexExit: params.exitPrice,
    indexPoints,
    entryTime: open.entryTime,
    exitTime: params.exitTime,
    exitReason: params.exitReason,
    option: open.option,
    optionEntryPremium: open.optionEntryPremium,
    optionExitPremium,
    optionPnlRs,
    premiumEstimated,
    outcome: optionPnlRs != null ? optionPnlRs > 0 ? "WIN" : optionPnlRs < 0 ? "LOSS" : "FLAT" : indexPoints > 0 ? "WIN" : indexPoints < 0 ? "LOSS" : "FLAT"
  };
  // Charge-adjust when both premiums are known (live fee parity with index books).
  if (optionPnlRs != null && open.optionEntryPremium != null && optionExitPremium != null && open.option) {
    const qty = Math.max(0, Math.floor(open.option.lotSize || 0) * lots);
    if (qty > 0) {
      const charged = applyChargesToOptionTrade({
        segment: "mcx_option",
        entryPremium: open.optionEntryPremium,
        exitPremium: optionExitPremium,
        quantity: qty,
        grossPnlRs: optionPnlRs
      });
      closed.chargesRs = charged.chargesRs;
      closed.netOptionPnlRs = charged.netPnlRs;
    }
  }
  return closed;
}
function replayPaperOnCrude(params) {
  const {
    instrumentId,
    instrumentName,
    candles,
    fromDate,
    toDate,
    instruments,
    optionCandlesByToken,
    neededOptionTokens
  } = params;
  const forceCloseOpen = params.forceCloseOpen !== false;
  const lotsMultiplier = Math.max(1, Math.floor(params.lotsMultiplier ?? 1) || 1);
  const tradeParams = params.tradeParams ?? resolveCrudeStrategyProfile("selective");
  const dayLossStopPts = params.dayLossStopPts ?? tradeParams.dayLossStopPts;
  const dayProfitLockPts = tradeParams.dayProfitLockPts;
  const liveHook = params.liveHook;
  const afterBar = liveHook?.afterBarTime ?? null;
  const hookActive = (barTime) => !!liveHook && (!afterBar || barTime > afterBar);
  const optionResolve = {
    prefixes: params.optionPrefixes,
    strikeStep: params.strikeStep,
    syntheticName: params.syntheticName
  };
  const enableMorning = params.enableMorning !== false;
  const enableEvening = params.enableEvening !== false;
  const trapMode = tradeParams.entryMode === "trap-confirm";
  const sessionOrMode = tradeParams.entryMode === "session-or";
  const state = trapMode ? createCrudeTrapState() : createCrudePdhlState();
  const trades = [];
  const dayNetByDate = {};
  let open = null;
  let lastSignal = "Waiting";
  let chosenOption = null;
  let chosenBias = null;
  let indexSpot = null;
  let chosenAsOf = null;
  for (let i = 40; i < candles.length; i += 1) {
    const candle = candles[i];
    const day = extractTradeDate(candle.date);
    if (day < fromDate || day > toDate) {
      continue;
    }
    if (open) {
      const exit = checkFuturesExit(candle, open, tradeParams);
      if (exit) {
        const bookLabel = open.book === "morning" ? "Morning" : sessionOrMode ? "Afternoon" : open.book === "evening" ? "Evening" : "Trap";
        const futPts = open.direction === "BUY" ? exit.exitPrice - open.entry : open.entry - exit.exitPrice;
        const futLabel = `fut ${futPts >= 0 ? "+" : ""}${futPts.toFixed(1)}`;
        const closed = closePaperTrade2({
          instrumentId,
          instrumentName,
          open,
          exitPrice: exit.exitPrice,
          exitTime: candle.date,
          exitReason: `${exit.reason} \xB7 ${futLabel} \xB7 ${bookLabel}`,
          optionCandlesByToken,
          lotsMultiplier
        });
        trades.push(closed);
        if (hookActive(candle.date)) {
          liveHook?.onClose?.(closed.entryTime, closed.exitReason);
        }
        recordCrudeTradeClosed(
          state,
          closed.indexPoints,
          dayLossStopPts,
          open.book,
          dayProfitLockPts,
          tradeParams.firstWinLock
        );
        dayNetByDate[day] = (dayNetByDate[day] ?? 0) + closed.indexPoints;
        open = null;
        lastSignal = `Closed: ${exit.reason}`;
      }
      continue;
    }
    let signal = null;
    let book = "morning";
    if (trapMode) {
      const fixedTrap = tradeParams.targetRMultiple <= 0 && tradeParams.stopPts > 0 && (tradeParams.eveningTargetPts > 0 || tradeParams.morningTargetPts > 0);
      const trap = runCrudeTrapConfirm({
        candle,
        series: candles,
        state,
        dayLossStopPts,
        dayProfitLockPts,
        targetRMultiple: fixedTrap ? 0 : tradeParams.targetRMultiple || void 0,
        stopPts: fixedTrap ? tradeParams.stopPts : void 0,
        targetPts: fixedTrap ? tradeParams.eveningTargetPts || tradeParams.morningTargetPts : void 0,
        pierce: tradeParams.piercePts,
        trapEntryStyle: tradeParams.trapEntryStyle,
        entryStart: tradeParams.eveningEntryStart,
        entryEnd: tradeParams.eveningEntryEnd,
        maxTradesDay: tradeParams.maxEveningTradesDay,
        firstWinLock: tradeParams.firstWinLock
      });
      if (trap.action === "BUY" || trap.action === "SELL") {
        signal = trap;
        book = "evening";
      } else {
        lastSignal = trap.reason;
      }
    } else if (sessionOrMode) {
      if (enableEvening) {
        const afternoon = runCrudeSessionOr({
          candle,
          series: candles,
          state,
          dayLossStopPts,
          dayProfitLockPts,
          stopPts: tradeParams.stopPts,
          targetPts: tradeParams.eveningTargetPts,
          requireConfirm: tradeParams.requireConfirm,
          firstWinLock: tradeParams.firstWinLock,
          entryStart: tradeParams.eveningEntryStart,
          entryEnd: tradeParams.eveningEntryEnd,
          orStart: tradeParams.sessionOrStart,
          orEnd: tradeParams.sessionOrEnd,
          maxOrWidth: tradeParams.maxOrWidth,
          minOrWidth: tradeParams.minOrWidth,
          breakBufferPts: tradeParams.breakBufferPts,
          maxTradesDay: tradeParams.maxEveningTradesDay
        });
        if (afternoon.action === "BUY" || afternoon.action === "SELL") {
          signal = afternoon;
          book = "evening";
        } else {
          lastSignal = afternoon.reason;
        }
      }
    } else {
      if (enableMorning) {
        const morning = runCrudeMorningOrb({
          candle,
          series: candles,
          state,
          dayLossStopPts,
          dayProfitLockPts,
          stopPts: tradeParams.stopPts,
          targetPts: tradeParams.morningTargetPts
        });
        if (morning.action === "BUY" || morning.action === "SELL") {
          signal = morning;
          book = "morning";
        } else {
          lastSignal = morning.reason;
        }
      }
      if (!signal && enableEvening) {
        const evening = runCrudePdhlEvening({
          candle,
          series: candles,
          index: i,
          state,
          dayLossStopPts,
          dayProfitLockPts,
          stopPts: tradeParams.stopPts,
          targetPts: tradeParams.eveningTargetPts,
          requireConfirm: tradeParams.requireConfirm,
          entryStart: tradeParams.eveningEntryStart,
          entryEnd: tradeParams.eveningEntryEnd,
          maxTradesDay: tradeParams.maxEveningTradesDay
        });
        if (evening.action === "BUY" || evening.action === "SELL") {
          signal = evening;
          book = "evening";
        } else {
          lastSignal = evening.reason;
        }
      }
    }
    if (!enableMorning && !enableEvening) {
      lastSignal = "No session window on";
    }
    if (!signal || signal.action !== "BUY" && signal.action !== "SELL") {
      continue;
    }
    const resolved = resolveAtmCrudeMiniOption({
      instruments,
      direction: signal.action,
      spot: candle.close,
      asOfDateTime: candle.date,
      ...optionResolve
    });
    const option = toCrudePaperOption(resolved.instrument, resolved.source);
    chosenOption = option;
    chosenBias = signal.action;
    indexSpot = candle.close;
    chosenAsOf = candle.date;
    if (option.instrumentToken > 0) {
      neededOptionTokens.add(option.instrumentToken);
    }
    const entryPremium = lookupPremium2(
      optionCandlesByToken.get(option.instrumentToken),
      candle.date,
      "entry"
    );
    open = {
      direction: signal.action,
      entry: signal.entryPrice,
      stop: signal.stopLoss,
      target: signal.target,
      entryTime: candle.date,
      book,
      option,
      optionEntryPremium: entryPremium,
      premiumEstimated: entryPremium == null,
      peakMfePts: 0,
      riskPts: Math.abs(signal.entryPrice - signal.stopLoss)
    };
    if (hookActive(candle.date)) {
      liveHook?.onOpen?.({
        direction: signal.action,
        entryTime: candle.date,
        indexEntry: signal.entryPrice,
        indexStop: signal.stopLoss,
        option,
        optionEntryPremium: entryPremium
      });
    }
    lastSignal = `${signal.action} @ ${signal.entryPrice.toFixed(1)} \xB7 ${option.tradingSymbol}`;
  }
  if (open && forceCloseOpen) {
    const last = candles.at(-1);
    const futPts = open.direction === "BUY" ? last.close - open.entry : open.entry - last.close;
    const futLabel = `fut ${futPts >= 0 ? "+" : ""}${futPts.toFixed(1)}`;
    const bookWindow = open.book === "morning" ? "Morning" : `${tradeParams.eveningEntryStart}\u2013${tradeParams.eveningEntryEnd}`;
    const closed = closePaperTrade2({
      instrumentId,
      instrumentName,
      open,
      exitPrice: last.close,
      exitTime: last.date,
      exitReason: `${MCX_CRUDE_SESSION.sessionCloseLabel} \xB7 ${futLabel} \xB7 ${bookWindow}`,
      optionCandlesByToken,
      lotsMultiplier
    });
    trades.push(closed);
    if (hookActive(last.date)) {
      liveHook?.onClose?.(closed.entryTime, closed.exitReason);
    }
    recordCrudeTradeClosed(
      state,
      closed.indexPoints,
      dayLossStopPts,
      open.book,
      dayProfitLockPts,
      tradeParams.firstWinLock
    );
    dayNetByDate[extractTradeDate(last.date)] = (dayNetByDate[extractTradeDate(last.date)] ?? 0) + closed.indexPoints;
    open = null;
    lastSignal = `Closed: ${MCX_CRUDE_SESSION.sessionCloseLabel}`;
  }
  if (open?.option) {
    chosenOption = open.option;
    chosenBias = open.direction;
    indexSpot = open.entry;
    chosenAsOf = open.entryTime;
  } else if (!chosenOption) {
    let lastIdx = -1;
    for (let i = candles.length - 1; i >= 0; i -= 1) {
      const day = extractTradeDate(candles[i].date);
      if (day >= fromDate && day <= toDate) {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx < 0 && candles.length) {
      lastIdx = candles.length - 1;
    }
    if (lastIdx >= 0) {
      const candle = candles[lastIdx];
      const bias = "BUY";
      const resolved = resolveAtmCrudeMiniOption({
        instruments,
        direction: bias,
        spot: candle.close,
        asOfDateTime: candle.date,
        ...optionResolve
      });
      chosenOption = toCrudePaperOption(resolved.instrument, resolved.source);
      chosenBias = bias;
      indexSpot = candle.close;
      chosenAsOf = candle.date;
      if (resolved.source === "chain" && resolved.instrument.instrumentToken > 0) {
        neededOptionTokens.add(resolved.instrument.instrumentToken);
      }
    }
  } else if (trades.length) {
    const last = trades.at(-1);
    if (last.option) {
      chosenOption = last.option;
      chosenBias = last.direction;
      indexSpot = last.indexEntry;
      chosenAsOf = last.entryTime;
    }
  }
  return {
    instrumentId,
    instrumentName,
    trades,
    dayNetByDate,
    lastSignal,
    open,
    state,
    chosenOption,
    chosenBias,
    indexSpot,
    chosenAsOf
  };
}

// src/app/core/strategy-manager/config/strategy-dna-caps.ts
var TRAP_1LOT_DAILY_DNA_EXTRAS = {
  piercePts: 20,
  bankPiercePts: 60,
  /** 1-lot bands — Paper/Live multiply by lotsMultiplier. */
  profitLockArmRs: 100,
  profitLockLockRs: 50,
  profitLockGivebackRs: 50,
  slConfirmCutoffEnabled: false,
  slConfirmCutoffFracR: 0,
  slConfirmCutoffMaxMfeR: 0,
  slConfirmSoftRs: 0,
  trapMode: "both",
  /** Must stay 0 — bounce-OR widen drifts DNA and hurts option money. */
  bounceOrPierceMult: 0,
  bounceOrPierceCap: 0,
  /** Live Green: cut when option ₹ adverse ≥ this (0 = off for pure paper DNA). */
  optionStandDownRs: 350
};
function dnaCapsForStrategy(strategyId, channel) {
  switch (strategyId) {
    case MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM:
      return { maxTradesPerDay: 3, targetRMultiple: 3.5 };
    case MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE:
      return channel === "bank" ? { maxTradesPerDay: 0, targetRMultiple: 1.5 } : { maxTradesPerDay: 0, targetRMultiple: 3 };
    case MANAGED_STRATEGY_IDS.SMART_PULLBACK_PRO:
      return { maxTradesPerDay: 0, targetRMultiple: 1.5 };
    case MANAGED_STRATEGY_IDS.DONCH_RETEST_OR_MID_2R:
      return { maxTradesPerDay: 0, targetRMultiple: 2 };
    case MANAGED_STRATEGY_IDS.GAP_FADE_500:
      return { maxTradesPerDay: 0 };
    case MANAGED_STRATEGY_IDS.INSIDE_BREAK:
      return { maxTradesPerDay: 0 };
    case MANAGED_STRATEGY_IDS.CHAMPION_PDHL:
      return { maxTradesPerDay: 0 };
    case MANAGED_STRATEGY_IDS.SWING_RETEST_EMA50_2R:
    case MANAGED_STRATEGY_IDS.VOL_EXPAND_DONCH15:
    case MANAGED_STRATEGY_IDS.SWING5_PREV_DAY:
    case MANAGED_STRATEGY_IDS.DONCHIAN_20:
    case MANAGED_STRATEGY_IDS.DONCHIAN_55_TURTLE:
      return { maxTradesPerDay: 0, targetRMultiple: 2 };
    default:
      return { maxTradesPerDay: 0 };
  }
}

// src/app/core/strategy-manager/engines/smart-pullback-pro.engine.ts
var DEFAULT_SMART_PB_EXTRAS = {
  retestTolerancePts: 10,
  minBarsBetweenSignals: 15,
  avgBodyLen: 10,
  strongBodyMult: 0.6,
  atrSidewaysMult: 0.7,
  emaFlatPts: 10,
  skipSideways: true,
  signalMode: "breakout",
  requireOrMid: true,
  requireCloseThird: true,
  donchianLength: 20,
  genieRouterEnabled: true,
  geniePeerDrive: null,
  geniePeerGap: null,
  geniePeerBias: null,
  genieNiftyBias: null
};
var BANK_OVERLAY_SMART_PB_EXTRAS = {
  ...DEFAULT_SMART_PB_EXTRAS,
  signalMode: "armed_retest",
  strongBodyMult: 0.8,
  retestTolerancePts: 12,
  minBarsBetweenSignals: 30,
  requireCloseThird: false,
  requireOrMid: true,
  skipSideways: true,
  donchianLength: 20
};
function weekdayMon0(date) {
  const parsed = /* @__PURE__ */ new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  const sun0 = parsed.getDay();
  return sun0 === 0 ? 6 : sun0 - 1;
}
function orDrive(or) {
  const width = Math.max(or.high - or.low, 1e-9);
  return Math.abs(or.lastClose - or.firstOpen) / width;
}
function aloneByDrive(f) {
  return f.nDrive >= f.bDrive ? "NIFTY" : "BANK";
}
function drvSkip(f, minDrive) {
  if (Math.max(f.nDrive, f.bDrive) < minDrive) {
    return "SKIP";
  }
  return f.aligned ? "BOTH" : aloneByDrive(f);
}
function resolveGenieV3Route(f) {
  if (f.wd < 0 || f.wd > 4) {
    return "SKIP";
  }
  if (f.wd === 1) {
    return "SKIP";
  }
  if (f.wd === 4) {
    return "BOTH";
  }
  if (f.wd === 0) {
    return drvSkip(f, 0.35);
  }
  if (f.wd === 2) {
    return drvSkip(f, 0.25);
  }
  return f.aligned ? "BOTH" : aloneByDrive(f);
}
function resolveGenieV3LocalRoute(wd, localDrive) {
  if (wd < 0 || wd > 4) {
    return "SKIP";
  }
  if (wd === 1) {
    return "SKIP";
  }
  if (wd === 0 && localDrive < 0.35) {
    return "SKIP";
  }
  if (wd === 2 && localDrive < 0.25) {
    return "SKIP";
  }
  return "BOTH";
}
function instrumentAllowedByGenieRoute(route, instrumentId) {
  if (route === "SKIP") {
    return false;
  }
  const bank = /bank/i.test(instrumentId ?? "");
  if (route === "BOTH") {
    return true;
  }
  if (route === "NIFTY") {
    return !bank;
  }
  if (route === "BANK") {
    return bank;
  }
  return false;
}
function createSmartPbDayState() {
  return {
    ...createRuleDayState(),
    lastBuyBar: null,
    lastSellBar: null,
    barSeq: 0
  };
}
function channelProfileExtras(instrumentId) {
  const bank = /bank/i.test(instrumentId ?? "");
  if (bank) {
    return {
      extras: { ...BANK_OVERLAY_SMART_PB_EXTRAS },
      targetRMultiple: 1.5,
      maxTradesPerDay: 0,
      minBarsBetweenSignals: 30,
      emaFlatPts: 25
    };
  }
  return {
    extras: { ...DEFAULT_SMART_PB_EXTRAS },
    targetRMultiple: 3,
    maxTradesPerDay: 0,
    minBarsBetweenSignals: 15,
    emaFlatPts: 10
  };
}
function readExtras(settings) {
  const x = settings.extras ?? {};
  const mode = x["signalMode"];
  const signalMode = mode === "breakout" || mode === "pullback" || mode === "both" || mode === "armed_retest" ? mode : DEFAULT_SMART_PB_EXTRAS.signalMode;
  return {
    retestTolerancePts: num(x["retestTolerancePts"], DEFAULT_SMART_PB_EXTRAS.retestTolerancePts),
    minBarsBetweenSignals: num(
      x["minBarsBetweenSignals"],
      DEFAULT_SMART_PB_EXTRAS.minBarsBetweenSignals
    ),
    avgBodyLen: num(x["avgBodyLen"], DEFAULT_SMART_PB_EXTRAS.avgBodyLen),
    strongBodyMult: num(x["strongBodyMult"], DEFAULT_SMART_PB_EXTRAS.strongBodyMult),
    atrSidewaysMult: num(x["atrSidewaysMult"], DEFAULT_SMART_PB_EXTRAS.atrSidewaysMult),
    emaFlatPts: num(x["emaFlatPts"], DEFAULT_SMART_PB_EXTRAS.emaFlatPts),
    skipSideways: typeof x["skipSideways"] === "boolean" ? x["skipSideways"] : DEFAULT_SMART_PB_EXTRAS.skipSideways,
    signalMode,
    requireOrMid: typeof x["requireOrMid"] === "boolean" ? x["requireOrMid"] : DEFAULT_SMART_PB_EXTRAS.requireOrMid,
    requireCloseThird: typeof x["requireCloseThird"] === "boolean" ? x["requireCloseThird"] : DEFAULT_SMART_PB_EXTRAS.requireCloseThird,
    donchianLength: num(x["donchianLength"], DEFAULT_SMART_PB_EXTRAS.donchianLength),
    genieRouterEnabled: typeof x["genieRouterEnabled"] === "boolean" ? x["genieRouterEnabled"] : DEFAULT_SMART_PB_EXTRAS.genieRouterEnabled,
    geniePeerDrive: typeof x["geniePeerDrive"] === "number" && Number.isFinite(x["geniePeerDrive"]) ? x["geniePeerDrive"] : null,
    geniePeerGap: typeof x["geniePeerGap"] === "number" && Number.isFinite(x["geniePeerGap"]) ? x["geniePeerGap"] : null,
    geniePeerBias: x["geniePeerBias"] === "BUY" || x["geniePeerBias"] === "SELL" || x["geniePeerBias"] === "FLAT" ? x["geniePeerBias"] : null,
    genieNiftyBias: x["genieNiftyBias"] === "BUY" || x["genieNiftyBias"] === "SELL" || x["genieNiftyBias"] === "FLAT" ? x["genieNiftyBias"] : null
  };
}
function num(v, fallback) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function sma(values, len) {
  if (values.length < len || len <= 0) {
    return null;
  }
  let sum = 0;
  for (let i = values.length - len; i < values.length; i += 1) {
    sum += values[i];
  }
  return sum / len;
}
function strongByAvgBody(candle, series, avgBodyLen, strongBodyMult) {
  const body = Math.abs(candle.close - candle.open);
  if (series.length < avgBodyLen + 1) {
    return { strongBull: false, strongBear: false, bodySize: body, avgBody: null };
  }
  const bodies = [];
  for (let i = series.length - avgBodyLen; i < series.length; i += 1) {
    const c = series[i];
    bodies.push(Math.abs(c.close - c.open));
  }
  const avg = bodies.reduce((a, b) => a + b, 0) / avgBodyLen;
  const strong = body > avg * strongBodyMult;
  return {
    strongBull: candle.close > candle.open && strong,
    strongBear: candle.close < candle.open && strong,
    bodySize: body,
    avgBody: avg
  };
}
function isSidewaysSmartPb(series, emaLen, atrSidewaysMult, emaFlatPts) {
  const atr = atrAt(series, 14);
  if (atr == null || series.length < 35) {
    return { sideways: false, atr, atrSma: null, emaDrift: null };
  }
  const trs = [];
  for (let i = 1; i < series.length; i += 1) {
    const c = series[i];
    const p = series[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const atrSeries = [];
  let window = 0;
  for (let i = 0; i < trs.length; i += 1) {
    window += trs[i];
    if (i >= 14) {
      window -= trs[i - 14];
    }
    if (i >= 13) {
      atrSeries.push(window / 14);
    }
  }
  const atrSma = sma(atrSeries, 20);
  const closes = series.map((c) => c.close);
  const emaNow = emaLast2(closes, emaLen);
  const emaPrev = emaLast2(closes.slice(0, -5), emaLen);
  if (atrSma == null || emaNow == null || emaPrev == null) {
    return { sideways: false, atr, atrSma, emaDrift: null };
  }
  const emaDrift = Math.abs(emaNow - emaPrev);
  const sideways = atr < atrSma * atrSidewaysMult && emaDrift < emaFlatPts;
  return { sideways, atr, atrSma, emaDrift };
}
function runSmartPullbackPro(ctx, state, settings) {
  const candle = ctx.candle5m;
  const day = extractTradeDate(candle.date);
  const time = extractHhMm(candle.date);
  const series = seriesAt(ctx);
  const extras = readExtras(settings);
  state.barSeq = series.length;
  if (state.tradingDate !== day) {
    state.tradingDate = day;
    state.dayNetPts = 0;
    state.tradesToday = 0;
    state.dayStopped = false;
    state.brokeRes = false;
    state.brokeSup = false;
    state.brokeLevelRes = null;
    state.brokeLevelSup = null;
  }
  const wait6 = (reason, analysis = {}) => ({
    action: "WAITING",
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { strategy: "smart-pullback-pro", ...analysis }
  });
  const skip = (reason, analysis = {}) => ({
    action: "SKIPPED",
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { strategy: "smart-pullback-pro", ...analysis }
  });
  if (state.dayStopped) {
    return skip(`Day stopped (net ${state.dayNetPts.toFixed(1)})`);
  }
  if (settings.maxTradesPerDay > 0 && state.tradesToday >= settings.maxTradesPerDay) {
    return skip(
      `Max trades per day reached (${state.tradesToday}/${settings.maxTradesPerDay})`
    );
  }
  if (time < settings.entryTimeStart) {
    return wait6(`Before entry window ${settings.entryTimeStart}`);
  }
  if (time > settings.entryTimeEnd) {
    return skip(`After entry window ${settings.entryTimeEnd}`);
  }
  const dayBars = barsOnDay(series, day);
  const or = openingRange2(dayBars, "09:15", settings.orEnd);
  if (!or) {
    return wait6("Opening range not ready");
  }
  if (series.length < 2) {
    return wait6("Need prior bar");
  }
  const closes = series.map((c) => c.close);
  const ema = emaLast2(closes, settings.emaLength);
  if (ema == null) {
    return wait6(`EMA-${settings.emaLength} warming up`);
  }
  const bankLike = /bank/i.test(ctx.instrumentId ?? "");
  const localDrive = orDrive(or);
  const prevBars = previousDayBars(series, day);
  const prevClose = prevBars.length ? prevBars[prevBars.length - 1].close : dayBars[0].open;
  const localGap = dayBars[0].open - prevClose;
  const wd = weekdayMon0(day);
  const peerReady = extras.geniePeerDrive != null && Number.isFinite(extras.geniePeerDrive);
  let genieRoute = "BOTH";
  if (extras.genieRouterEnabled) {
    if (peerReady) {
      const nDrive = bankLike ? extras.geniePeerDrive : localDrive;
      const bDrive = bankLike ? localDrive : extras.geniePeerDrive;
      const nGap = bankLike ? extras.geniePeerGap ?? 0 : localGap;
      const bGap = bankLike ? localGap : extras.geniePeerGap ?? 0;
      const localBias = candle.close >= ema ? "BUY" : "SELL";
      const peerBias = extras.geniePeerBias;
      const niftyBias = bankLike ? extras.genieNiftyBias ?? peerBias : localBias;
      const bankBias = bankLike ? localBias : peerBias ?? localBias;
      const aligned = niftyBias != null && bankBias != null && niftyBias !== "FLAT" && niftyBias === bankBias;
      genieRoute = resolveGenieV3Route({
        wd,
        nDrive,
        bDrive,
        nGap,
        bGap,
        aligned
      });
    } else {
      genieRoute = resolveGenieV3LocalRoute(wd, localDrive);
    }
    if (!instrumentAllowedByGenieRoute(genieRoute, ctx.instrumentId)) {
      return skip(`GENIE ${genieRoute}: sit out this leg`, {
        genieRoute,
        wd,
        localDrive,
        localGap,
        peerReady
      });
    }
  }
  const prev = series[series.length - 2];
  const { strongBull, strongBear, bodySize, avgBody } = strongByAvgBody(
    candle,
    series,
    extras.avgBodyLen,
    extras.strongBodyMult
  );
  const range = candle.high - candle.low;
  const closeThirdBull = range > 0 && (candle.close - candle.low) / range >= 0.66;
  const closeThirdBear = range > 0 && (candle.high - candle.close) / range >= 0.66;
  const bullBreakout = candle.close > prev.high && candle.close > ema;
  const bearBreakout = candle.close < prev.low && candle.close < ema;
  const bullRetest = candle.low <= prev.low + extras.retestTolerancePts;
  const bearRetest = candle.high >= prev.high - extras.retestTolerancePts;
  const breakoutBuy = bullBreakout && bullRetest && strongBull && (!extras.requireCloseThird || closeThirdBull);
  const breakoutSell = bearBreakout && bearRetest && strongBear && (!extras.requireCloseThird || closeThirdBear);
  const pullbackBuy = candle.close > ema && candle.close > candle.open && candle.low <= ema;
  const pullbackSell = candle.close < ema && candle.close < candle.open && candle.high >= ema;
  const ch = donchian(series, extras.donchianLength, true);
  if (ch) {
    if (candle.close > ch.high) {
      state.brokeRes = true;
      state.brokeLevelRes = ch.high;
    }
    if (candle.close < ch.low) {
      state.brokeSup = true;
      state.brokeLevelSup = ch.low;
    }
  }
  const armedBuy = state.brokeRes && state.brokeLevelRes != null && candle.low <= state.brokeLevelRes && candle.close >= state.brokeLevelRes && candle.close > ema && strongBull;
  const armedSell = state.brokeSup && state.brokeLevelSup != null && candle.high >= state.brokeLevelSup && candle.close <= state.brokeLevelSup && candle.close < ema && strongBear;
  let buySignal = false;
  let sellSignal = false;
  let setup = null;
  let level = null;
  if (extras.signalMode === "breakout" || extras.signalMode === "both") {
    if (breakoutBuy) {
      buySignal = true;
      setup = "breakout";
      level = prev.high;
    }
    if (breakoutSell) {
      sellSignal = true;
      setup = setup ?? "breakout";
      level = prev.low;
    }
  }
  if (extras.signalMode === "pullback" || extras.signalMode === "both") {
    if (pullbackBuy && !buySignal) {
      buySignal = true;
      setup = "pullback";
      level = ema;
    }
    if (pullbackSell && !sellSignal) {
      sellSignal = true;
      setup = setup === "breakout" ? "breakout" : "pullback";
      level = ema;
    }
  }
  if (extras.signalMode === "armed_retest") {
    if (armedBuy) {
      buySignal = true;
      setup = "armed_retest";
      level = state.brokeLevelRes;
    } else if (armedSell) {
      sellSignal = true;
      setup = "armed_retest";
      level = state.brokeLevelSup;
    }
  }
  const side = isSidewaysSmartPb(
    series,
    settings.emaLength,
    extras.atrSidewaysMult,
    extras.emaFlatPts
  );
  const analysisBase = {
    ema,
    setup,
    breakoutBuy,
    breakoutSell,
    pullbackBuy,
    pullbackSell,
    armedBuy,
    armedSell,
    strongBull,
    strongBear,
    bodySize,
    avgBody,
    sideways: side.sideways,
    atr: side.atr,
    atrSma: side.atrSma,
    emaDrift: side.emaDrift,
    orHigh: or.high,
    orLow: or.low,
    orMid: or.mid,
    dayNetPts: state.dayNetPts,
    tradesToday: state.tradesToday,
    genieRoute,
    wd,
    localDrive,
    localGap,
    extras
  };
  if (!buySignal && !sellSignal) {
    return wait6("No Smart PB setup", analysisBase);
  }
  if (extras.skipSideways && side.sideways) {
    return skip("Sideways market (ATR compressed + flat EMA)", analysisBase);
  }
  let direction = null;
  if (buySignal && !sellSignal) {
    direction = "BUY";
  } else if (sellSignal && !buySignal) {
    direction = "SELL";
  } else if (buySignal && sellSignal) {
    direction = candle.close >= ema ? "BUY" : "SELL";
  }
  if (!direction) {
    return wait6("No Smart PB setup", analysisBase);
  }
  if (bankLike && extras.genieNiftyBias != null && extras.genieNiftyBias !== "FLAT" && direction !== extras.genieNiftyBias) {
    return skip(
      `Bank bias-sync: signal ${direction} \u2260 Nifty bias ${extras.genieNiftyBias}`,
      { ...analysisBase, genieRoute, genieNiftyBias: extras.genieNiftyBias }
    );
  }
  if (extras.requireOrMid) {
    if (direction === "BUY" && candle.close < or.mid) {
      return skip("OR-mid confluence failed (BUY below mid)", analysisBase);
    }
    if (direction === "SELL" && candle.close > or.mid) {
      return skip("OR-mid confluence failed (SELL above mid)", analysisBase);
    }
  }
  const lastBar = direction === "BUY" ? state.lastBuyBar : state.lastSellBar;
  if (lastBar != null && state.barSeq !== lastBar && state.barSeq - lastBar <= extras.minBarsBetweenSignals) {
    return skip(
      `Duplicate filter: ${direction} within ${extras.minBarsBetweenSignals} bars`,
      { ...analysisBase, lastSignalBar: lastBar, barSeq: state.barSeq }
    );
  }
  const close = candle.close;
  let stop = direction === "BUY" ? candle.low : candle.high;
  if (setup === "pullback" || setup === "armed_retest") {
    stop = direction === "BUY" ? Math.min(stop, ema - 1) : Math.max(stop, ema + 1);
  }
  if (level != null && Number.isFinite(level)) {
    stop = direction === "BUY" ? Math.min(stop, level - 1) : Math.max(stop, level + 1);
  }
  let risk = Math.abs(close - stop);
  if (risk < settings.minStopPts) {
    return skip(`Risk ${risk.toFixed(1)} < min ${settings.minStopPts}`, analysisBase);
  }
  const stopCap = bankLike ? settings.bankStopLossPts : settings.stopLossPts;
  if (risk > stopCap) {
    stop = direction === "BUY" ? close - stopCap : close + stopCap;
    risk = stopCap;
  }
  if (settings.dayStopPts > 0 && state.dayNetPts - risk < -settings.dayStopPts) {
    return skip("Day stop would be breached by this risk", analysisBase);
  }
  let target = close;
  let rr = 0;
  if (settings.targetRMultiple > 0) {
    target = direction === "BUY" ? close + risk * settings.targetRMultiple : close - risk * settings.targetRMultiple;
    rr = settings.targetRMultiple;
  } else {
    target = direction === "BUY" ? close + risk * 10 : close - risk * 10;
    rr = 10;
  }
  if (direction === "BUY") {
    state.lastBuyBar = state.barSeq;
    if (setup === "armed_retest") {
      state.brokeRes = false;
      state.brokeLevelRes = null;
    }
  } else {
    state.lastSellBar = state.barSeq;
    if (setup === "armed_retest") {
      state.brokeSup = false;
      state.brokeLevelSup = null;
    }
  }
  return {
    action: direction,
    entryPrice: close,
    stopLoss: stop,
    target,
    riskRewardRatio: rr,
    reason: `smart-pb ${setup} ${direction} \xB7 EMA${settings.emaLength} \xB7 risk ${risk.toFixed(1)}`,
    analysis: {
      ...analysisBase,
      direction,
      risk,
      stop,
      target,
      level
    }
  };
}
function smartPbExitLogic(candle, open, closes, settings, series, instrumentId = "") {
  const spec = { entry: "swing_retest", bias: "ema", exit: "eod" };
  applyIndexRuleProfitProtect(candle, open, settings);
  const armed = armPeakTrailFloor(candle, open, settings, instrumentId);
  const cutoff = applySlConfirmCutoff(candle, open, settings, instrumentId);
  if (cutoff) {
    return cutoff;
  }
  const exit = indexRuleExitLogic(candle, open, closes, settings, spec, series);
  if (exit) {
    if (armed && exit.reason === "Stop loss hit") {
      return { ...exit, reason: "Profit drained \u2014 cut & rehunt" };
    }
    return exit;
  }
  if (!armed) {
    return null;
  }
  const closePts = open.direction === "BUY" ? candle.close - open.entry : open.entry - candle.close;
  const stopPts = Math.abs(open.stop - open.entry);
  if (closePts <= stopPts) {
    return {
      exitPrice: open.stop,
      reason: "Profit drained \u2014 cut & rehunt"
    };
  }
  return null;
}
function recordSmartPbTradeClosed(state, points, dayStopPts) {
  recordRuleTradeClosed(state, points, dayStopPts);
}

// src/app/core/live-desk/option-sl-premium.util.ts
function isMcxOptionContext(exchange, tradingSymbol) {
  if ((exchange ?? "").toUpperCase() === "MCX") {
    return true;
  }
  const sym = (tradingSymbol ?? "").toUpperCase();
  return sym.startsWith("CRUDEOIL") || sym.startsWith("NATURALGAS") || sym.startsWith("NATGAS");
}
function roundOptionPremiumTick(price) {
  return Math.max(0.05, Math.round(price / 0.05) * 0.05);
}
function mcxMinSlGapPts(fillPremium) {
  return Math.max(25, fillPremium * 0.05);
}
function computeProtectiveSlTrigger(params) {
  const fill = Math.max(0, params.fillPremium);
  const risk = Math.max(0, params.indexRiskPts);
  const mcx = isMcxOptionContext(params.exchange, params.tradingSymbol);
  const delta = mcx ? 1 : 0.5;
  const fromRisk = fill - risk * delta;
  const nfoMinGap = Math.max(3, fill * 0.03);
  const fromMinGap = mcx ? fill - mcxMinSlGapPts(fill) : fill - nfoMinGap;
  let trigger = roundOptionPremiumTick(Math.max(0.05, Math.min(fromRisk, fromMinGap)));
  const ltp = params.ltp;
  if (ltp != null && ltp > 0 && trigger >= ltp - 0.049) {
    const cushion = Math.max(
      risk * delta,
      mcx ? mcxMinSlGapPts(ltp) : Math.max(nfoMinGap, ltp * 0.03),
      mcx ? 25 : 3
    );
    trigger = roundOptionPremiumTick(Math.max(0.05, ltp - cushion));
  }
  return trigger;
}

// src/app/core/paper-desk/option-peak-trail.util.ts
function clampTrailLots(lots) {
  return Math.max(1, Math.floor(Number(lots) || 1) || 1);
}
function scaleOptionPeakTrailSettings(base, lots) {
  const n = clampTrailLots(lots);
  return {
    armRs: base.armRs * n,
    lockRs: base.lockRs * n,
    givebackRs: base.givebackRs * n
  };
}
function optionPeakTrailSettingsFromExtras(extras, lots = 1) {
  const x = extras ?? {};
  const base = {
    armRs: typeof x["profitLockArmRs"] === "number" ? x["profitLockArmRs"] : 600,
    lockRs: typeof x["profitLockLockRs"] === "number" ? x["profitLockLockRs"] : 300,
    givebackRs: typeof x["profitLockGivebackRs"] === "number" ? x["profitLockGivebackRs"] : 300
  };
  return scaleOptionPeakTrailSettings(base, lots);
}
function evaluateOptionPeakTrail(params) {
  const entry = params.entryPremium;
  const units = params.lotUnits;
  if (!(entry > 0) || !(units > 0) || !(params.armRs > 0)) {
    return null;
  }
  if (!(params.optionPeakMfeRs >= params.armRs)) {
    return {
      armed: false,
      floorRs: 0,
      floorPremium: entry,
      hit: false
    };
  }
  const floorRs = Math.max(
    params.lockRs,
    params.optionPeakMfeRs - Math.max(0, params.givebackRs)
  );
  const floorPremium = roundOptionPremiumTick(entry + floorRs / units);
  return {
    armed: true,
    floorRs,
    floorPremium,
    hit: params.optionBarLow <= floorPremium + 1e-9
  };
}

// src/app/core/strategy-manager/engines/sr-trap-confirm.engine.ts
function createSrTrapDayState() {
  return {
    ...createRuleDayState(),
    pending: null,
    barSeq: 0,
    peTradesToday: 0
  };
}
function recordSrTrapTradeClosed(state, points, dayStopPts, dayProfitLockPts = 0, money = null) {
  recordRuleTradeClosed(state, points, dayStopPts, dayProfitLockPts, money);
}
function num2(v, fallback) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function readTrapExtras(settings) {
  const x = settings.extras ?? {};
  const mode = x["trapMode"] === "trap" ? "trap" : "both";
  const allowRaw = String(x["allowDirection"] || x["allowedDirection"] || "").toUpperCase();
  const allowDirection = allowRaw === "BUY" || allowRaw === "SELL" ? allowRaw : "";
  const peAllowRaw = String(x["peAllowDirection"] || "").toUpperCase();
  const peAllowDirection = peAllowRaw === "BUY" || peAllowRaw === "SELL" ? peAllowRaw : "";
  return {
    swingLb: Math.max(3, Math.floor(num2(x["swingLb"], 5))),
    piercePts: num2(x["piercePts"], 15),
    bankPiercePts: Math.max(0, num2(x["bankPiercePts"], 0)),
    mode,
    allowDirection,
    sessionCutTime: String(x["sessionCutTime"] || ""),
    peEntryStart: String(x["peEntryStart"] || ""),
    peEntryEnd: String(x["peEntryEnd"] || ""),
    peAllowDirection,
    peMaxTrades: Math.max(0, Math.floor(num2(x["peMaxTrades"], 0))),
    peTrapMode: x["peTrapMode"] === "trap" ? "trap" : x["peTrapMode"] === "both" ? "both" : "",
    minRisk: num2(x["minRiskPts"], 4),
    maxRisk: num2(x["maxRiskPts"], 28),
    slPad: num2(x["slPadPts"], 2),
    minConfirmBody: num2(x["minConfirmBody"], 0),
    bounceOrPierceMult: Math.max(0, num2(x["bounceOrPierceMult"], 0)),
    bounceOrPierceCap: Math.max(0, num2(x["bounceOrPierceCap"], 0)),
    fadeBarEntry: x["fadeBarEntry"] === true,
    fadeBarTime: String(x["fadeBarTime"] || "09:50"),
    fadeBarLo: num2(x["fadeBarLo"], 0.4),
    fadeBarHi: num2(x["fadeBarHi"], 0.6),
    fadeBarMinStopPts: num2(x["fadeBarMinStopPts"], 12),
    fadeBarMidDir: String(x["fadeBarMidDir"] || "").toUpperCase() === "BUY"
      ? "BUY"
      : String(x["fadeBarMidDir"] || "").toUpperCase() === "SELL"
        ? "SELL"
        : "",
    fadeConfirmNext: x["fadeConfirmNext"] === true,
    fadeCeMaxPreNet: x["fadeCeMaxPreNet"] == null ? null : num2(x["fadeCeMaxPreNet"], 0),
    fadePeMaxBody: x["fadePeMaxBody"] == null ? null : num2(x["fadePeMaxBody"], 0),
    fadePeMaxLowerWick: x["fadePeMaxLowerWick"] == null ? null : num2(x["fadePeMaxLowerWick"], 0),
    fadeSkipBreakout: x["fadeSkipBreakout"] === true,
    fadeSkipBreakdown: x["fadeSkipBreakdown"] === true,
    optionOnlyExit: x["optionOnlyExit"] === true
  };
}

function fadeQualityBlock(extras, fadeDir, candle, dayBars) {
  const pre = dayBars.filter((b) => {
    const t = extractHhMm(b.date);
    return t >= "09:15" && t <= "09:45";
  });
  const fadeRng = Math.max(candle.high - candle.low, 1e-9);
  const bodyPct = Math.abs(candle.close - candle.open) / fadeRng;
  const dnWick = Math.min(candle.open, candle.close) - candle.low;
  const hod = pre.length ? Math.max(...pre.map((b) => b.high)) : Number.POSITIVE_INFINITY;
  const lod = pre.length ? Math.min(...pre.map((b) => b.low)) : Number.NEGATIVE_INFINITY;
  const preNet = pre.length ? pre[pre.length - 1].close - pre[0].open : 0;
  if (fadeDir === 1) {
    if (extras.fadeCeMaxPreNet != null && preNet > extras.fadeCeMaxPreNet) {
      return `Fade skip CE — morning already up ${preNet.toFixed(0)}`;
    }
    if (extras.fadeSkipBreakdown && candle.close < lod) {
      return "Fade skip CE — opening-range breakdown";
    }
  }
  if (fadeDir === -1) {
    if (extras.fadeSkipBreakout && candle.close > hod) {
      return "Fade skip PE — opening-range breakout";
    }
    if (extras.fadePeMaxBody != null && bodyPct >= extras.fadePeMaxBody) {
      return "Fade skip PE — strong bull bar";
    }
    if (extras.fadePeMaxLowerWick != null && dnWick / fadeRng >= extras.fadePeMaxLowerWick) {
      return "Fade skip PE — hammer";
    }
  }
  return "";
}
function trapActiveSession(time, settings, extras) {
  const peStart = extras.peEntryStart || "";
  const peEnd = extras.peEntryEnd || "";
  if (peStart && peEnd && time >= peStart && time <= peEnd) {
    return {
      id: "pe",
      start: peStart,
      end: peEnd,
      allow: extras.peAllowDirection || "SELL"
    };
  }
  const cut = extras.sessionCutTime || settings.entryTimeEnd;
  if (time >= settings.entryTimeStart && (!cut || time < cut)) {
    return {
      id: "am",
      start: settings.entryTimeStart,
      end: cut || settings.entryTimeEnd,
      allow: extras.allowDirection || ""
    };
  }
  return null;
}
function morningOrWidth(dayBars, orEnd) {
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of dayBars) {
    const t = extractHhMm(b.date);
    if (t < "09:15" || t > orEnd) {
      continue;
    }
    hi = Math.max(hi, b.high);
    lo = Math.min(lo, b.low);
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi < lo) {
    return 0;
  }
  return hi - lo;
}
function swingHL3(dayBars, i, lb) {
  const start = Math.max(0, i - lb);
  const window = dayBars.slice(start, i);
  if (!window.length) {
    return { sh: dayBars[i].high, sl: dayBars[i].low };
  }
  return {
    sh: Math.max(...window.map((b) => b.high)),
    sl: Math.min(...window.map((b) => b.low))
  };
}
function runSrTrapConfirm(ctx, state, settings) {
  const candle = ctx.candle5m;
  const day = extractTradeDate(candle.date);
  const time = extractHhMm(candle.date);
  const series = seriesAt(ctx);
  const extras = readTrapExtras(settings);
  state.barSeq = series.length;
  if (state.tradingDate !== day) {
    state.tradingDate = day;
    state.dayNetPts = 0;
    state.dayNetOptionRs = 0;
    state.tradesToday = 0;
    state.dayStopped = false;
    state.pending = null;
    state.peTradesToday = 0;
    state.fadeDone = false;
  }
  const sess = trapActiveSession(time, settings, extras);
  if (state.pending && extras.sessionCutTime && time >= extras.sessionCutTime && state.pending.session !== "pe") {
    state.pending = null;
  }
  const wait6 = (reason, analysis = {}) => ({
    action: "WAITING",
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { strategy: "sr-trap-confirm", ...analysis }
  });
  const skip = (reason, analysis = {}) => ({
    action: "SKIPPED",
    entryPrice: candle.close,
    stopLoss: candle.close,
    target: candle.close,
    riskRewardRatio: 0,
    reason,
    analysis: { strategy: "sr-trap-confirm", ...analysis }
  });
  const peMax = extras.peMaxTrades || 0;
  const peOpen = sess && sess.id === "pe" && peMax > 0 && (state.peTradesToday || 0) < peMax;
  if (state.dayStopped && !peOpen) {
    const rs = state.dayNetOptionRs || 0;
    const netLabel =
      settings.dayProfitLockRs > 0 || settings.dayStopRs > 0
        ? `\u20B9${Math.round(rs)}`
        : `${state.dayNetPts.toFixed(1)} pts`;
    return skip(`Day stopped (net ${netLabel})`);
  }
  if (peOpen) {
    if ((state.peTradesToday || 0) >= peMax) {
      return skip(`PE session filled (${state.peTradesToday}/${peMax})`);
    }
  } else if (settings.maxTradesPerDay > 0 && state.tradesToday >= settings.maxTradesPerDay) {
    return skip(
      `Max trades per day reached (${state.tradesToday}/${settings.maxTradesPerDay})`
    );
  }
  const dayBars = barsOnDay(series, day);
  const i = dayBars.findIndex((b) => b.date === candle.date);
  if (i < extras.swingLb) {
    return wait6("Warming swing lookback");
  }
  const fadeBook = extras.fadeBarEntry && sess && sess.id !== "pe";
  const fadeTime = extras.fadeBarTime || "09:50";
  const fadeEnter = (fadeDir, fadePos, fill, stopFade, reason) => {
    const riskFade = Math.max(Math.abs(fill - stopFade), 1);
    const rrFade = settings.targetRMultiple > 0 ? settings.targetRMultiple : 3.5;
    const targetFade = fadeDir === 1 ? fill + riskFade * rrFade : fill - riskFade * rrFade;
    state.pending = null;
    state.fadeDone = true;
    return {
      action: fadeDir === 1 ? "BUY" : "SELL",
      entryPrice: fill,
      stopLoss: stopFade,
      target: targetFade,
      riskRewardRatio: rrFade,
      reason,
      analysis: {
        strategy: "sr-trap-confirm",
        setup: "fade_bar",
        fadePos,
        risk: riskFade,
        rr: rrFade
      }
    };
  };
  if (fadeBook && state.pending && state.pending.fade) {
    if (time <= fadeTime) {
      return wait6("Fade confirm wait");
    }
    const p = state.pending;
    state.pending = null;
    state.fadeDone = true;
    const ok = p.dir === 1 ? candle.close > p.signalClose : candle.close < p.signalClose;
    if (!ok) {
      return wait6(`Fade confirm failed ${p.dir === 1 ? "CE" : "PE"}`);
    }
    return fadeEnter(
      p.dir,
      p.fadePos,
      candle.close,
      p.stopFade,
      `Fade-bar ${fadeTime} ${p.dir === 1 ? "CE" : "PE"} pos${Number(p.fadePos).toFixed(2)} confirm ${time}`,
    );
  }
  if (fadeBook && time === fadeTime && !state.fadeDone) {
    const fadeRng = Math.max(candle.high - candle.low, 1e-9);
    const fadePos = (candle.close - candle.low) / fadeRng;
    const fadeLo = extras.fadeBarLo != null ? extras.fadeBarLo : 0.4;
    const fadeHi = extras.fadeBarHi != null ? extras.fadeBarHi : 0.6;
    let fadeDir = 0;
    if (fadePos <= fadeLo) fadeDir = 1;
    else if (fadePos >= fadeHi) fadeDir = -1;
    else if (extras.fadeBarMidDir === "BUY") fadeDir = 1;
    else if (extras.fadeBarMidDir === "SELL") fadeDir = -1;
    if (fadeDir && !(sess.allow === "SELL" && fadeDir === 1) && !(sess.allow === "BUY" && fadeDir === -1)) {
      const blocked = fadeQualityBlock(extras, fadeDir, candle, dayBars);
      if (blocked) {
        state.fadeDone = true;
        state.pending = null;
        return wait6(blocked);
      }
      const fill = candle.close;
      const minStop = extras.fadeBarMinStopPts > 0 ? extras.fadeBarMinStopPts : 12;
      const rawStop = fadeDir === 1 ? candle.low - extras.slPad : candle.high + extras.slPad;
      const stopFade = fadeDir === 1
        ? Math.min(rawStop, fill - minStop)
        : Math.max(rawStop, fill + minStop);
      if (extras.fadeConfirmNext) {
        state.pending = {
          fade: true,
          dir: fadeDir,
          fadePos,
          signalClose: fill,
          stopFade,
        };
        return wait6(`Fade ${fadeDir === 1 ? "CE" : "PE"} pos${fadePos.toFixed(2)} — wait confirm`);
      }
      return fadeEnter(
        fadeDir,
        fadePos,
        fill,
        stopFade,
        `Fade-bar ${time} ${fadeDir === 1 ? "CE" : "PE"} pos${fadePos.toFixed(2)}`,
      );
    }
    state.fadeDone = true;
    state.pending = null;
    return wait6(`Fade mid-skip pos${fadePos.toFixed(2)}`);
  }
  if (fadeBook) {
    return wait6(state.fadeDone ? "Fade-only desk" : "Waiting fade bar");
  }
  if (state.pending) {
    const p = state.pending;
    state.pending = null;
    const confirmSess = sess || trapActiveSession(time, settings, extras);
    if (!confirmSess || time < confirmSess.start || time > confirmSess.end) {
      return wait6("Confirm outside entry window");
    }
    if (confirmSess.allow === "SELL" && p.dir === 1) {
      return wait6("CE blocked — PE-only desk");
    }
    if (confirmSess.allow === "BUY" && p.dir === -1) {
      return wait6("PE blocked — CE-only desk");
    }
    const body = Math.abs(candle.close - candle.open);
    const bullOk = p.dir === 1 && candle.close > candle.open && candle.close > p.signalClose;
    const bearOk = p.dir === -1 && candle.close < candle.open && candle.close < p.signalClose;
    if (!(bullOk || bearOk)) {
      return wait6("Trap confirm failed");
    }
    if (extras.minConfirmBody > 0 && body < extras.minConfirmBody) {
      return wait6("Confirm body too small");
    }
    const fill = candle.open;
    const stop2 = p.dir === 1 ? Math.min(p.stop, fill - 1) : Math.max(p.stop, fill + 1);
    const risk2 = Math.abs(fill - stop2);
    const bank2 = /bank/i.test(ctx.instrumentId ?? "");
    const maxRisk2 = bank2 ? Math.max(extras.maxRisk, 50) : extras.maxRisk;
    const minRisk2 = bank2 ? Math.max(extras.minRisk, 8) : extras.minRisk;
    if (risk2 < minRisk2 || risk2 > maxRisk2) {
      return wait6(`Risk ${risk2.toFixed(1)} outside ${minRisk2}\u2013${maxRisk2}`);
    }
    const rr = settings.targetRMultiple > 0 ? settings.targetRMultiple : 3.5;
    const target = p.dir === 1 ? fill + risk2 * rr : fill - risk2 * rr;
    if (confirmSess.id === "pe") {
      state.peTradesToday = (state.peTradesToday || 0) + 1;
    }
    return {
      action: p.dir === 1 ? "BUY" : "SELL",
      entryPrice: fill,
      stopLoss: stop2,
      target,
      riskRewardRatio: rr,
      reason: `S/R trap confirm ${p.dir === 1 ? "BUY" : "SELL"} \xB7 ${rr}R`,
      analysis: {
        strategy: "sr-trap-confirm",
        setup: "trap_next_confirm",
        risk: risk2,
        rr
      }
    };
  }
  if (!sess) {
    if (extras.peEntryEnd && time > extras.peEntryEnd) {
      return skip(`After entry window ${extras.peEntryEnd}`);
    }
    if (time < settings.entryTimeStart) {
      return wait6(`Before entry window ${settings.entryTimeStart}`);
    }
    if (extras.sessionCutTime && time >= extras.sessionCutTime && !extras.peEntryStart) {
      return skip(`After session cut ${extras.sessionCutTime}`);
    }
    return wait6("Outside entry window");
  }
  const closes = series.map((c) => c.close);
  const ema = emaLast2(closes, settings.emaLength);
  if (ema == null) {
    return wait6(`EMA-${settings.emaLength} warming up`);
  }
  const { sh, sl } = swingHL3(dayBars, i, extras.swingLb);
  const isBank = /bank/i.test(ctx.instrumentId ?? "");
  const trapPierce = isBank && extras.bankPiercePts > 0 ? extras.bankPiercePts : extras.piercePts;
  let bouncePierce = trapPierce;
  if (extras.bounceOrPierceMult > 0) {
    const orW = morningOrWidth(dayBars, settings.orEnd || "09:45");
    if (orW > 0) {
      bouncePierce = Math.max(trapPierce, orW * extras.bounceOrPierceMult);
      if (extras.bounceOrPierceCap > 0) {
        bouncePierce = Math.min(bouncePierce, extras.bounceOrPierceCap);
      }
    }
  }
  const cc = candle.close;
  const oo = candle.open;
  const hh = candle.high;
  const ll = candle.low;
  const trapBuy = ll < sl - trapPierce && cc > sl && cc > oo;
  const trapSell = hh > sh + trapPierce && cc < sh && cc < oo;
  const rng = Math.max(hh - ll, 1e-9);
  const bounceBuy = ll <= sl + bouncePierce && ll >= sl - bouncePierce * 2 && cc > oo && cc >= sl && (hh - cc) / rng < 0.35;
  const bounceSell = hh >= sh - bouncePierce && hh <= sh + bouncePierce * 2 && cc < oo && cc <= sh && (cc - ll) / rng < 0.35;
  let dir = 0;
  let stop = 0;
  const sessionMode = sess.id === "pe" && extras.peTrapMode ? extras.peTrapMode : extras.mode;
  if (trapBuy || sessionMode === "both" && bounceBuy) {
    if (cc > ema) {
      dir = 1;
      stop = ll - extras.slPad;
    }
  } else if (trapSell || sessionMode === "both" && bounceSell) {
    if (cc < ema) {
      dir = -1;
      stop = hh + extras.slPad;
    }
  }
  if (!dir) {
    return wait6("No S/R trap / bounce", { sh, sl, ema });
  }
  if (sess.allow === "SELL" && dir === 1) {
    return wait6("CE blocked — PE-only desk", { sh, sl, ema });
  }
  if (sess.allow === "BUY" && dir === -1) {
    return wait6("PE blocked — CE-only desk", { sh, sl, ema });
  }
  const risk = Math.abs(cc - stop);
  const bank = /bank/i.test(ctx.instrumentId ?? "");
  const maxRisk = bank ? Math.max(extras.maxRisk, 50) : extras.maxRisk;
  const minRisk = bank ? Math.max(extras.minRisk, 8) : extras.minRisk;
  if (risk < minRisk || risk > maxRisk) {
    return wait6(`Signal risk ${risk.toFixed(1)} outside band`);
  }
  state.pending = {
    dir,
    stop,
    signalClose: cc,
    barSeq: state.barSeq,
    session: sess.id
  };
  return wait6(dir === 1 ? "Trap BUY armed \u2014 wait confirm" : "Trap SELL armed \u2014 wait confirm", {
    sh,
    sl,
    ema,
    armed: dir
  });
}
function srTrapExitLogic(candle, open, closes, settings, ctx) {
  const extras = readTrapExtras(settings);
  const time = extractHhMm(candle.date);
  const entryTm = extractHhMm(open.entryTime || "");
  if (extras.sessionCutTime && entryTm && entryTm < extras.sessionCutTime && time >= extras.sessionCutTime) {
    return {
      exitPrice: candle.close,
      reason: `Session cut ${extras.sessionCutTime}`
    };
  }
  const { armRs, lockRs, givebackRs } = optionPeakTrailSettingsFromExtras(
    settings.extras,
    open.lotsMultiplier
  );
  const optionMarksKnown = typeof open.optionPeakMfeRs === "number" && open.optionEntryPremium != null && open.optionEntryPremium > 0 && open.optionBarLow != null && open.optionLotUnits != null && open.optionLotUnits > 0;
  // Live Green: hard option-₹ stand-down (cuts before index SL / trail lag).
  // Band is defined per 1 lot — scale with desk lots (MAE already includes lotUnits).
  const standDownRs =
    num2(settings.extras?.optionStandDownRs, 0) * clampTrailLots(open.lotsMultiplier);
  if (standDownRs > 0 && optionMarksKnown) {
    const maeRs = Math.max(0, (open.optionEntryPremium - open.optionBarLow) * open.optionLotUnits);
    if (maeRs >= standDownRs) {
      return {
        exitPrice: candle.close,
        reason: `Option stand-down \u2212\u20B9${Math.round(maeRs)}`,
        optionExitPremium: open.optionBarLow
      };
    }
  }
  const bankRs =
    num2(settings.extras?.optionBankRs, 0) * clampTrailLots(open.lotsMultiplier);
  if (bankRs > 0 && optionMarksKnown && open.optionPeakMfeRs >= bankRs) {
    const takePrem = roundOptionPremiumTick(
      open.optionEntryPremium + bankRs / open.optionLotUnits
    );
    return {
      exitPrice: candle.close,
      reason: `Option bank \u20B9${Math.round(bankRs)}`,
      optionExitPremium: takePrem
    };
  }
  if (extras.optionOnlyExit && optionMarksKnown) {
    if (time >= (settings.exitTime || "15:15")) {
      return { exitPrice: candle.close, reason: "EOD / session exit" };
    }
    return null;
  }
  const armedIndex = armPeakTrailFloor(candle, open, settings, ctx.instrumentId ?? "");
  const cutoff = applySlConfirmCutoff(candle, open, settings, ctx.instrumentId ?? "");
  if (cutoff) {
    return cutoff;
  }
  const exit = indexRuleExitLogic(
    candle,
    open,
    closes,
    settings,
    { entry: "swing", bias: "ema", exit: "eod" },
    seriesAt(ctx)
  );
  if (exit) {
    if (!optionMarksKnown && armedIndex && exit.reason === "Stop loss hit") {
      return { ...exit, reason: "Profit drained \u2014 cut & rehunt" };
    }
    return exit;
  }
  if (optionMarksKnown) {
    const trail = evaluateOptionPeakTrail({
      entryPremium: open.optionEntryPremium,
      optionPeakMfeRs: open.optionPeakMfeRs,
      optionBarLow: open.optionBarLow,
      lotUnits: open.optionLotUnits,
      armRs,
      lockRs,
      givebackRs
    });
    if (trail?.hit) {
      return {
        exitPrice: candle.close,
        reason: "Profit drained \u2014 cut & rehunt",
        optionExitPremium: trail.floorPremium
      };
    }
    return null;
  }
  if (!armedIndex) {
    return null;
  }
  const closePts = open.direction === "BUY" ? candle.close - open.entry : open.entry - candle.close;
  const stopPts = Math.abs(open.stop - open.entry);
  if (closePts <= stopPts) {
    return {
      exitPrice: open.stop,
      reason: "Profit drained \u2014 cut & rehunt"
    };
  }
  return null;
}

// src/app/core/utils/instrument-resolver.util.ts
function resolveCrudeOilMiniFuturesToken(instruments) {
  return resolveMcxMiniFuturesToken(instruments, ["CRUDEOILM"]);
}
function resolveMcxMiniFuturesToken(instruments, prefixes) {
  const today = startOfDay3(/* @__PURE__ */ new Date());
  const prefs = prefixes.map((p) => p.toUpperCase());
  const pool = instruments.filter(
    (item) => item.exchange === "MCX" && item.instrumentType === "FUT" && prefs.some((p) => item.tradingSymbol.toUpperCase().startsWith(p))
  ).sort((left, right) => expiryTime(left) - expiryTime(right));
  const next = pool.find((item) => {
    if (!item.expiry) {
      return true;
    }
    return startOfDay3(new Date(item.expiry)) > today;
  });
  if (next) {
    return next;
  }
  return pool.find((item) => {
    if (!item.expiry) {
      return true;
    }
    return startOfDay3(new Date(item.expiry)) >= today;
  });
}
function expiryTime(instrument) {
  if (!instrument.expiry) {
    return Number.MAX_SAFE_INTEGER;
  }
  const time = new Date(instrument.expiry).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}
function startOfDay3(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// scripts/server-live/bundle-entry.ts
var trapCaps = dnaCapsForStrategy(MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM, "nifty");
var TRAP_DEFAULTS = defaultStrategySettings({
  entryTimeStart: "09:45",
  entryTimeEnd: "14:45",
  exitTime: "15:15",
  orEnd: "09:45",
  stopLossPts: 30,
  bankStopLossPts: 50,
  emaLength: 50,
  maxTradesPerDay: trapCaps.maxTradesPerDay,
  instrumentType: "futures",
  dayStopPts: 60,
  dayProfitLockPts: 0,
  targetRMultiple: trapCaps.targetRMultiple ?? 3.5,
  profitProtectEnabled: true,
  profitProtectArmR: 1,
  profitProtectLockR: 0,
  regimeFilterEnabled: false,
  positionSizeLots: 1,
  extras: {
    trapMode: "both",
    swingLb: 5,
    minRiskPts: 4,
    maxRiskPts: 28,
    slPadPts: 2,
    minConfirmBody: 0,
    ...TRAP_1LOT_DAILY_DNA_EXTRAS
  }
});
var GENIE_DEFAULTS = defaultStrategySettings({
  entryTimeStart: "10:15",
  entryTimeEnd: "14:30",
  exitTime: "15:15",
  orEnd: "09:45",
  stopLossPts: 30,
  bankStopLossPts: 45,
  emaLength: 50,
  maxTradesPerDay: 0,
  instrumentType: "futures",
  dayStopPts: 60,
  targetRMultiple: 3,
  profitProtectEnabled: false,
  regimeFilterEnabled: false,
  positionSizeLots: 1,
  extras: {
    ...DEFAULT_SMART_PB_EXTRAS,
    genieRouterEnabled: true,
    profitLockArmRs: 600,
    profitLockLockRs: 300,
    profitLockGivebackRs: 300,
    slConfirmCutoffEnabled: true,
    slConfirmCutoffFracR: 0.55,
    slConfirmCutoffMaxMfeR: 0.75,
    slConfirmSoftRs: 700
  }
});
function createTrapStrategy() {
  let settings = mergeSettings(TRAP_DEFAULTS, {});
  let state = createSrTrapDayState();
  const api = {
    id: MANAGED_STRATEGY_IDS.SR_TRAP_CONFIRM,
    name: "Trap",
    version: "1.2.0",
    description: "Server Live Trap \xB7 pierce20 \xB7 Bank40 \xB7 peak\u20B9100 \xB7 max3 \xB7 3.5R \xB7 Paper\u2261Live",
    supports: ["nifty", "bank"],
    defaultSettings: TRAP_DEFAULTS,
    initialize(partial) {
      settings = mergeSettings(TRAP_DEFAULTS, partial);
      state = createSrTrapDayState();
    },
    reset() {
      state = createSrTrapDayState();
    },
    analyze(ctx) {
      const signal = api.generateSignal(ctx);
      return { lastReason: signal.reason, ...signal.analysis };
    },
    generateSignal(ctx) {
      const bank = /bank/i.test(ctx.instrumentId ?? "");
      const effective = mergeSettings(settings, {
        extras: {
          ...settings.extras,
          maxRiskPts: bank ? 50 : 28,
          minRiskPts: bank ? 8 : 4
        }
      });
      return runSrTrapConfirm(ctx, state, effective);
    },
    calculateStopLoss(_ctx, entryPrice, direction) {
      const bank = /bank/i.test(_ctx.instrumentId ?? "");
      const cap = bank ? settings.bankStopLossPts : settings.stopLossPts;
      return direction === "BUY" ? entryPrice - cap : entryPrice + cap;
    },
    calculateTarget(_ctx, entryPrice, stopLoss, direction) {
      const risk = Math.abs(entryPrice - stopLoss);
      const mult = settings.targetRMultiple > 0 ? settings.targetRMultiple : 3.5;
      return {
        target: direction === "BUY" ? entryPrice + risk * mult : entryPrice - risk * mult,
        riskRewardRatio: mult
      };
    },
    exitLogic(candle, open, closes, ctx) {
      return srTrapExitLogic(candle, open, closes, settings, ctx);
    },
    onTradeClosed(points, _day, optionRs) {
      const useMoney = settings.dayProfitLockRs > 0 || settings.dayStopRs > 0;
      const money = useMoney
        ? {
            netRs: optionRs != null ? Number(optionRs) : 0,
            dayProfitLockRs: settings.dayProfitLockRs || 0,
            dayStopRs: settings.dayStopRs || 0
          }
        : null;
      recordSrTrapTradeClosed(
        state,
        points,
        useMoney ? 0 : settings.dayStopPts,
        useMoney ? 0 : settings.dayProfitLockPts ?? 0,
        money
      );
    },
    getSettings() {
      return { ...settings, extras: { ...settings.extras } };
    },
    updateSettings(partial) {
      settings = mergeSettings(settings, partial);
    }
  };
  return api;
}
function createGenieStrategy() {
  let settings = mergeSettings(GENIE_DEFAULTS, {});
  let state = createSmartPbDayState();
  const api = {
    id: MANAGED_STRATEGY_IDS.ALIGN_COMBO_GENIE,
    name: "Genie",
    version: "1.1.0",
    description: "Server Live Genie",
    supports: ["nifty", "bank", "stocks"],
    defaultSettings: GENIE_DEFAULTS,
    initialize(partial) {
      settings = mergeSettings(GENIE_DEFAULTS, partial);
      state = createSmartPbDayState();
    },
    reset() {
      state = createSmartPbDayState();
    },
    analyze(ctx) {
      const signal = api.generateSignal(ctx);
      return { lastReason: signal.reason, ...signal.analysis };
    },
    generateSignal(ctx) {
      const profile = channelProfileExtras(ctx.instrumentId);
      const effective = mergeSettings(settings, {
        targetRMultiple: profile.targetRMultiple,
        maxTradesPerDay: profile.maxTradesPerDay,
        extras: {
          ...settings.extras,
          ...profile.extras,
          genieRouterEnabled: true,
          minBarsBetweenSignals: profile.minBarsBetweenSignals,
          emaFlatPts: profile.emaFlatPts
        }
      });
      const signal = runSmartPullbackPro(ctx, state, effective);
      if (signal.action === "BUY" || signal.action === "SELL") {
        return {
          ...signal,
          reason: `align-combo ${signal.reason}`,
          analysis: { ...signal.analysis, strategy: "align-combo-genie" }
        };
      }
      return {
        ...signal,
        analysis: { ...signal.analysis, strategy: "align-combo-genie" }
      };
    },
    calculateStopLoss(ctx, entryPrice, direction) {
      const signal = api.generateSignal(ctx);
      if (signal.action === "BUY" || signal.action === "SELL") {
        return signal.stopLoss;
      }
      const bank = /bank/i.test(ctx.instrumentId ?? "");
      const cap = bank ? settings.bankStopLossPts : settings.stopLossPts;
      return direction === "BUY" ? entryPrice - cap : entryPrice + cap;
    },
    calculateTarget(_ctx, entryPrice, stopLoss, direction) {
      const risk = Math.abs(entryPrice - stopLoss);
      const profile = channelProfileExtras(_ctx.instrumentId);
      const mult = profile.targetRMultiple || settings.targetRMultiple || 3;
      return {
        target: direction === "BUY" ? entryPrice + risk * mult : entryPrice - risk * mult,
        riskRewardRatio: mult
      };
    },
    exitLogic(candle, open, closes, ctx) {
      return smartPbExitLogic(candle, open, closes, settings, ctx);
    },
    onTradeClosed(points) {
      recordSmartPbTradeClosed(state, points, settings.dayStopPts, settings.dayProfitLockPts ?? 0);
    },
    getSettings() {
      return { ...settings, extras: { ...settings.extras } };
    },
    updateSettings(partial) {
      settings = mergeSettings(settings, partial);
    }
  };
  return api;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BANK_NIFTY_INSTRUMENT,
  CRUDE_OIL_MINI_INSTRUMENT,
  NIFTY_50_INSTRUMENT,
  applySlConfirmCutoff,
  armPeakTrailFloor,
  computeProtectiveSlTrigger,
  createGenieStrategy,
  createTrapStrategy,
  effectiveProtectiveStop,
  replayPaperOnCrude,
  replayPaperOnIndex,
  resolveAtmCrudeMiniOption,
  resolveAtmWeeklyOption,
  resolveCrudeOilMiniFuturesToken,
  resolveCrudeProfileDayLossPts,
  resolveCrudeStrategyProfile
});
