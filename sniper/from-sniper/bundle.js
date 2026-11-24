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

// sniper/from-sniper/index.ts
var index_exports = {};
__export(index_exports, {
  emptySniperSession: () => emptySniperSession,
  runSniperTick: () => runSniperTick,
  sniperIstDay: () => sniperIstDay
});
module.exports = __toCommonJS(index_exports);

// ../palagai/src/app/core/live-desk/live-start-guard.util.ts
function parseIstTimestamp(value) {
  if (!value) {
    return 0;
  }
  const raw = value.trim().replace(" ", "T");
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const ms = Date.parse(hasZone ? raw : `${raw}+05:30`);
  return Number.isFinite(ms) ? ms : 0;
}

// ../palagai/src/app/core/paper-desk/kite-bar.util.ts
function kiteBar(row) {
  const raw = String(row[0] || "");
  const ms = parseIstTimestamp(raw);
  if (!ms) return { day: "", min: 0, open: 0, high: 0, low: 0, close: 0 };
  const ist = new Date(ms + 330 * 60 * 1e3);
  return {
    day: ist.toISOString().slice(0, 10),
    min: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    open: Number(row[1]) || 0,
    high: Number(row[2]) || 0,
    low: Number(row[3]) || 0,
    close: Number(row[4]) || 0
  };
}

// ../palagai/src/app/core/utils/csv.util.ts
function parseKiteInstrumentsCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return [];
  }
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    return {
      instrumentToken: Number(cols[0]) || 0,
      exchangeToken: Number(cols[1]) || 0,
      tradingSymbol: (cols[2] ?? "").trim(),
      name: (cols[3] ?? "").trim(),
      lastPrice: Number(cols[4]) || 0,
      expiry: (cols[5] ?? "").trim(),
      strike: Number(cols[6]) || 0,
      tickSize: Number(cols[7]) || 0,
      lotSize: Number(cols[8]) || 0,
      instrumentType: (cols[9] ?? "").trim(),
      segment: (cols[10] ?? "").trim(),
      exchange: (cols[11] ?? "").trim()
    };
  }).filter((item) => item.instrumentToken > 0);
}
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// ../palagai/src/app/core/paper-desk/option-14k-plan.ts
var OPTION_14K_PREMIUM_BUDGET_RS = 3500;
var INDEX_BACKUP = {
  trend: ["trap", "all_three", "fade_trap"],
  range: ["trap", "vwap_fade", "fade_trap"],
  quiet: ["fade", "trap", "fade_trap"],
  stand: ["trap", "vwap_fade", "fade"]
};
var OPTION_14K_BOOKS = {
  nifty: {
    id: "nifty",
    label: "Nifty 50",
    exchange: "NFO",
    name: "NIFTY",
    lot: 65,
    strikeStep: 50,
    otmPts: 200,
    targetPremRs: 50,
    openCostRs: 3250,
    oneStopRs: 325,
    slPrem: 5,
    tpPrem: 10,
    scratchPrem: 2.4,
    rsPt: 65,
    product: "cheap CE/PE \u20B950 \xD765",
    expiryNote: "Nifty weekly is Tuesday. On expiry day trade the next Tuesday \u2014 never the dying week.",
    orS: 9 * 60 + 15,
    orE: 10 * 60 + 15,
    entryS: 10 * 60 + 15,
    flat: 15 * 60 + 15,
    quietW: 30,
    pdMax: 500,
    orMin: 20,
    orMax: 180,
    trapP: 12,
    vwapMin: 15,
    primary: { trend: "pdhl", range: "fade", quiet: "vwap_fade" },
    backup: INDEX_BACKUP
  },
  bank: {
    id: "bank",
    label: "Bank Nifty",
    exchange: "NFO",
    name: "BANKNIFTY",
    lot: 30,
    strikeStep: 100,
    otmPts: 400,
    targetPremRs: 100,
    openCostRs: 3e3,
    oneStopRs: 300,
    slPrem: 10,
    tpPrem: 22,
    scratchPrem: 5,
    rsPt: 30,
    product: "cheap CE/PE \u20B9100 \xD730",
    expiryNote: "Bank Nifty is monthly (last Tuesday). On expiry day trade the next month.",
    orS: 9 * 60 + 15,
    orE: 9 * 60 + 45,
    entryS: 9 * 60 + 45,
    flat: 15 * 60 + 15,
    quietW: 80,
    pdMax: 900,
    orMin: 40,
    orMax: 350,
    trapP: 25,
    vwapMin: 30,
    primary: { trend: "pdhl", range: "fade", quiet: "vwap_fade" },
    backup: INDEX_BACKUP
  },
  sensex: {
    id: "sensex",
    label: "Sensex",
    exchange: "BFO",
    name: "SENSEX",
    lot: 20,
    strikeStep: 100,
    otmPts: 500,
    targetPremRs: 150,
    openCostRs: 3e3,
    oneStopRs: 320,
    slPrem: 16,
    tpPrem: 32,
    scratchPrem: 8,
    rsPt: 20,
    product: "cheap CE/PE \u20B9150 \xD720",
    expiryNote: "Sensex weekly is Friday. On expiry day trade the next Friday \u2014 never the dying week.",
    orS: 9 * 60 + 15,
    orE: 9 * 60 + 45,
    entryS: 9 * 60 + 45,
    flat: 15 * 60 + 15,
    quietW: 100,
    pdMax: 1e3,
    orMin: 50,
    orMax: 400,
    trapP: 30,
    vwapMin: 35,
    primary: { trend: "pdhl", range: "fade", quiet: "vwap_fade" },
    backup: INDEX_BACKUP
  },
  crude: {
    id: "crude",
    label: "Crude Mini",
    exchange: "MCX",
    name: "CRUDEOILM",
    lot: 10,
    strikeStep: 50,
    otmPts: 100,
    targetPremRs: 150,
    openCostRs: 1500,
    oneStopRs: 200,
    slPrem: 20,
    tpPrem: 25,
    scratchPrem: 10,
    rsPt: 10,
    product: "cheap CE/PE \u20B9150 \xD710",
    expiryNote: "CRUDEOILM options: on expiry day skip the dying month and trade the next listed expiry.",
    orS: 10 * 60,
    orE: 10 * 60 + 30,
    entryS: 10 * 60 + 30,
    flat: 23 * 60 + 10,
    quietW: 25,
    pdMax: 400,
    orMin: 12,
    orMax: 220,
    trapP: 8,
    vwapMin: 18,
    primary: { trend: "pdhl", range: "orb_fade", quiet: "vwap_fade" },
    backup: {
      trend: ["trap", "orb_break", "all_three"],
      range: ["trap", "vwap_fade", "fade_trap"],
      quiet: ["orb_fade", "trap", "fade_trap"],
      stand: ["trap", "vwap_fade", "orb_fade"]
    }
  }
};
var OPTION_14K_LIST = [
  OPTION_14K_BOOKS.crude,
  OPTION_14K_BOOKS.nifty,
  OPTION_14K_BOOKS.bank,
  OPTION_14K_BOOKS.sensex
];

// ../palagai/src/app/core/utils/crude-option.util.ts
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
function crudeMiniLotSize(lotSize) {
  const n = Math.floor(Number(lotSize) || 0);
  return Math.max(10, n > 0 ? n : 10);
}

// ../palagai/src/app/core/utils/option-chain.util.ts
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

// ../palagai/src/app/core/utils/pick-cheap-otm.util.ts
function parseExpiry(expiry) {
  if (!expiry) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  const d = new Date(expiry.includes("T") ? expiry : `${expiry}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function formatExpiryIso(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function asOfDay(asOf) {
  return istCalendarDay(asOf);
}
function isBookOption(item, book) {
  const type = (item.instrumentType || "").toUpperCase();
  if (type !== "CE" && type !== "PE") return false;
  const ex = (item.exchange || "").toUpperCase();
  const sym = (item.tradingSymbol || "").toUpperCase();
  const nm = (item.name || "").toUpperCase();
  if (book === "nifty") {
    if (ex !== "NFO") return false;
    if (sym.startsWith("BANKNIFTY") || nm === "BANKNIFTY") return false;
    if (sym.startsWith("FINNIFTY") || nm === "FINNIFTY") return false;
    if (sym.startsWith("MIDCPNIFTY") || nm === "MIDCPNIFTY") return false;
    if (sym.startsWith("NIFTYNXT")) return false;
    return sym.startsWith("NIFTY") || nm === "NIFTY";
  }
  if (book === "bank") {
    return ex === "NFO" && (sym.startsWith("BANKNIFTY") || nm === "BANKNIFTY");
  }
  if (book === "sensex") {
    if (ex !== "BFO") return false;
    if (sym.startsWith("SENSEX50") || nm.startsWith("SENSEX50")) return false;
    if (sym.startsWith("BANKEX") || nm === "BANKEX") return false;
    return sym.startsWith("SENSEX") || nm === "SENSEX";
  }
  if (ex !== "MCX") return false;
  return sym.startsWith("CRUDEOILM") || nm === "CRUDEOILM";
}
function lotOf(item, book) {
  if (book === "crude") return crudeMiniLotSize(item.lotSize);
  const n = Math.floor(Number(item.lotSize) || 0);
  return n > 0 ? n : OPTION_14K_BOOKS[book].lot;
}
function roundStrike(spot, step) {
  return Math.round(spot / step) * step;
}
function nextFriday(day, rollSameDay) {
  const dow = day.getDay();
  let add = (5 - dow + 7) % 7;
  if (add === 0 && rollSameDay) add = 7;
  const exp = new Date(day);
  exp.setDate(exp.getDate() + add);
  return exp;
}
function syntheticExpiry(book, day) {
  if (book === "sensex") return nextFriday(day, true);
  const exp = new Date(day);
  exp.setDate(exp.getDate() + (book === "bank" ? 28 : 7));
  return exp;
}
function buildSynthetic(book, side, strike, expiry) {
  const plan = OPTION_14K_BOOKS[book];
  return {
    instrumentToken: 0,
    exchangeToken: 0,
    tradingSymbol: `${plan.name} OTM ${strike} ${side}`,
    name: plan.name,
    exchange: plan.exchange,
    segment: `${plan.exchange}-OPT`,
    instrumentType: side,
    expiry: formatExpiryIso(expiry),
    strike,
    tickSize: 0.05,
    lotSize: plan.lot,
    lastPrice: plan.targetPremRs
  };
}
function toPick(item, book, source, budget) {
  const side = item.instrumentType.toUpperCase() === "PE" ? "PE" : "CE";
  const lotSize = lotOf(item, book);
  const lastPrice = Number(item.lastPrice) || OPTION_14K_BOOKS[book].targetPremRs;
  const openCostRs = Math.round(lastPrice * lotSize);
  return {
    instrument: item,
    source,
    side,
    strike: item.strike,
    expiry: item.expiry,
    lotSize,
    lastPrice,
    openCostRs,
    fitsBudget: openCostRs > 0 && openCostRs <= budget
  };
}
function pickCheapOtm(params) {
  const plan = OPTION_14K_BOOKS[params.book];
  const budget = params.premiumBudgetRs ?? OPTION_14K_PREMIUM_BUDGET_RS;
  const side = params.direction === "BUY" ? "CE" : "PE";
  const day = params.book === "crude" ? crudeIstCalendarDay(params.asOf) : asOfDay(params.asOf);
  const atm = roundStrike(params.spot, plan.strikeStep);
  const otm = params.otmPts ?? plan.otmPts;
  const target = side === "CE" ? atm + otm : atm - otm;
  const want = roundStrike(target, plan.strikeStep);
  const pool = params.instruments.filter((item) => isBookOption(item, params.book) && item.instrumentType.toUpperCase() === side).map((item) => ({ item, exp: parseExpiry(item.expiry) })).filter((row) => row.exp != null && row.exp.getTime() > day.getTime()).sort((a, b) => a.exp.getTime() - b.exp.getTime());
  const front = pool[0]?.exp ?? null;
  const frontPool = front ? pool.filter((row) => row.exp.getTime() === front.getTime()) : [];
  const scored = frontPool.map((row) => {
    const strike = row.item.strike;
    const otmOk = side === "CE" ? strike >= atm : strike <= atm;
    const dist = Math.abs(strike - want);
    const last = Number(row.item.lastPrice) || 0;
    const cost = last > 0 ? last * lotOf(row.item, params.book) : plan.openCostRs;
    const over = cost > budget ? 1 : 0;
    return { row, otmOk, dist, over, cost };
  }).sort((a, b) => a.over - b.over || Number(b.otmOk) - Number(a.otmOk) || a.dist - b.dist);
  if (scored[0]) {
    return toPick(scored[0].row.item, params.book, "chain", budget);
  }
  const synExp = front ?? syntheticExpiry(params.book, day);
  return toPick(buildSynthetic(params.book, side, want, synExp), params.book, "synthetic", budget);
}

// ../palagai/src/app/core/sniper/sniper.models.ts
var SNIPER_STOP_RS = 750;
var SNIPER_TARGET_RS = 750;
var SNIPER_DEFAULT_LOTS = 1;
var SNIPER_BAR_MIN = 5;
var SNIPER_OPEN_MIN = 9 * 60 + 15;
var SNIPER_OR_END_MIN = 9 * 60 + 30;
var SNIPER_TICK_RS = 0.05;
var SNIPER_STRONG_RED = 0.4;
var SNIPER_PULSE_KEEP = 40;
var SNIPER_BOOKS = [
  {
    id: "bank",
    label: "Bank Nifty",
    openMin: SNIPER_OPEN_MIN,
    lastEntryMin: 15 * 60 + 15,
    flatMin: 15 * 60 + 30,
    venue: "NSE",
    exchange: "NFO",
    underNames: ["NIFTY BANK"],
    underExchange: "NSE"
  }
];
var SNIPER_HONEST = "Bank Nifty PE. Down ORB only. 40% red tagged at its high. One trade. SL \u20B9750, sell \u20B9750. Token on the Token page.";

// ../palagai/src/app/core/sniper/sniper-clock.ts
function sniperIstDay(d = /* @__PURE__ */ new Date()) {
  const ist = new Date(d.getTime() + 330 * 60 * 1e3);
  return ist.toISOString().slice(0, 10);
}
function sniperIstMinutes(d = /* @__PURE__ */ new Date()) {
  const ist = new Date(d.getTime() + 330 * 60 * 1e3);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}
function hhmm(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function completedSniperBars(bars, day, nowMin) {
  return bars.filter((b) => b.day < day || b.day === day && b.min + SNIPER_BAR_MIN <= nowMin);
}
function sniperOrBars(bars, day) {
  return bars.filter((b) => b.day === day && b.min >= SNIPER_OPEN_MIN && b.min < SNIPER_OR_END_MIN);
}
function sniperOrbReady(nowMin) {
  return nowMin >= SNIPER_OR_END_MIN;
}

// ../palagai/src/app/core/paper-desk/option-charges.util.ts
var SCHEDULE = {
  NSE: { tax: 15e-4, txn: 3553e-7, stamp: 3e-5 },
  BSE: { tax: 15e-4, txn: 325e-6, stamp: 3e-5 },
  MCX: { tax: 5e-4, txn: 418e-6, stamp: 3e-5 }
};
var BROKERAGE_ROUND_TRIP_RS = 40;
function optionChargeBreakdown(buyPremium, sellPremium, qty, venue) {
  const zero2 = {
    brokerage: 0,
    sttCtt: 0,
    exchangeTxn: 0,
    sebi: 0,
    stamp: 0,
    ipft: 0,
    gst: 0,
    total: 0
  };
  if (!(qty > 0) || !(buyPremium > 0) || !(sellPremium >= 0)) return zero2;
  const p = SCHEDULE[venue];
  const buyVal = buyPremium * qty;
  const sellVal = sellPremium * qty;
  const turnover = buyVal + sellVal;
  const brokerage = BROKERAGE_ROUND_TRIP_RS;
  const sttCtt = p.tax * sellVal;
  const exchangeTxn = p.txn * turnover;
  const sebi = 10 * turnover / 1e7;
  const stamp = p.stamp * buyVal;
  const ipft = 0.01 * turnover / 1e7;
  const gst = 0.18 * (brokerage + exchangeTxn + sebi);
  const total = brokerage + sttCtt + exchangeTxn + sebi + stamp + ipft + gst;
  return { brokerage, sttCtt, exchangeTxn, sebi, stamp, ipft, gst, total };
}

// ../palagai/src/app/core/sniper/sniper-charges.ts
var zero = {
  entryTurnover: 0,
  exitTurnover: 0,
  brokerage: 0,
  stt: 0,
  exchange: 0,
  sebi: 0,
  stamp: 0,
  ipft: 0,
  gst: 0,
  total: 0
};
function r2(n) {
  return Math.round(n * 100) / 100;
}
function sniperCharges(entry, exit, qty, venue) {
  if (!(qty > 0) || !(entry > 0) || !(exit >= 0)) return { ...zero };
  const raw = optionChargeBreakdown(entry, exit, qty, venue);
  const entryTurnover = r2(entry * qty);
  const exitTurnover = r2(exit * qty);
  return {
    entryTurnover,
    exitTurnover,
    brokerage: r2(raw.brokerage),
    stt: r2(raw.sttCtt),
    exchange: r2(raw.exchangeTxn),
    sebi: r2(raw.sebi),
    stamp: r2(raw.stamp),
    ipft: r2(raw.ipft),
    gst: r2(raw.gst),
    total: r2(raw.total)
  };
}
function sniperGrossRs(entry, exit, qty) {
  return r2((exit - entry) * qty);
}
function sniperNetRs(entry, exit, qty, venue) {
  const gross = sniperGrossRs(entry, exit, qty);
  const ch = sniperCharges(entry, exit, qty, venue);
  return r2(gross - ch.total);
}

// ../palagai/src/app/core/sniper/sniper-size.ts
function r22(n) {
  return Math.round(n * 100) / 100;
}
function stopPx(entry, qty, venue, stopRs) {
  let lo = SNIPER_TICK_RS;
  let hi = entry;
  let best = 0;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const net = sniperNetRs(entry, mid, qty, venue);
    if (net >= -stopRs) {
      best = mid;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  if (!(best > 0)) return 0;
  const tick = SNIPER_TICK_RS;
  let sl = Math.floor(best / tick) * tick;
  while (sl < entry && sniperNetRs(entry, sl, qty, venue) < -stopRs) {
    sl = r22(sl + tick);
  }
  if (sl >= entry || sniperNetRs(entry, sl, qty, venue) < -stopRs) return 0;
  return r22(sl);
}
function targetPx(entry, qty, venue, targetRs) {
  if (!(qty > 0) || !(targetRs > 0)) return r22(entry);
  let pts = targetRs / qty;
  for (let i = 0; i < 3; i++) {
    const ch = sniperCharges(entry, entry + pts, qty, venue).total;
    pts = (targetRs + ch) / qty;
  }
  const tick = SNIPER_TICK_RS;
  return r22(Math.ceil((entry + pts) / tick) * tick);
}
function sniperSize(lots, lotSize, premium, venue, stopRs = SNIPER_STOP_RS, targetRs = SNIPER_TARGET_RS) {
  const empty = { lots: 0, qty: 0, sl: 0, tp: 0, skip: "" };
  const n = Math.floor(Number(lots) || 0);
  const lot = Math.floor(Number(lotSize) || 0);
  const px = Number(premium);
  const risk = Number(stopRs) > 0 ? Number(stopRs) : SNIPER_STOP_RS;
  const bank = Number(targetRs) > 0 ? Number(targetRs) : SNIPER_TARGET_RS;
  if (!(n > 0) || !(lot > 0) || !(px > 0)) return { ...empty, skip: "lots" };
  const qty = n * lot;
  const scratch = sniperCharges(px, px, qty, venue).total;
  if (scratch >= risk) return { ...empty, skip: `charges \u20B9${Math.round(scratch)} over SL \u20B9${risk}` };
  const sl = stopPx(px, qty, venue, risk);
  if (!(sl > 0) || sl >= px) return { ...empty, skip: `cannot place \u20B9${risk} stop` };
  return { lots: n, qty, sl, tp: targetPx(px, qty, venue, bank), skip: "" };
}

// ../palagai/src/app/core/sniper/sniper-engine.ts
function candleDir(bar) {
  if (bar.close > bar.open) return "green";
  if (bar.close < bar.open) return "red";
  return "doji";
}
function sniperStrongRed(bar) {
  if (candleDir(bar) !== "red") return false;
  const range = bar.high - bar.low;
  if (!(range > 0)) return false;
  return (bar.open - bar.close) / range >= SNIPER_STRONG_RED;
}
function sniperOrbLevels(bars, day) {
  const orBars = sniperOrBars(bars, day);
  if (!orBars.length) return null;
  return {
    high: Math.max(...orBars.map((b) => b.high)),
    low: Math.min(...orBars.map((b) => b.low))
  };
}
function sniperClearCut(bar, or) {
  if (!or || bar.min < SNIPER_OR_END_MIN) return "";
  if (bar.close > or.high) return "up";
  if (bar.close < or.low) return "down";
  return "";
}
function sniperHighGreen(bars, redMin) {
  const greens = bars.filter((b) => b.min <= redMin && candleDir(b) === "green");
  if (!greens.length) return null;
  return greens.reduce((a, b) => b.high >= a.high ? b : a);
}
function emptySniperBook(cfg) {
  return {
    id: cfg.id,
    label: cfg.label,
    watch: true,
    orHigh: null,
    orLow: null,
    orReady: false,
    cut: "",
    cutMin: null,
    cutColor: "",
    event: "watching",
    bars: [],
    capital: 0,
    peakCapital: 0,
    troughCapital: 0,
    side: "flat",
    dir: "",
    breakDir: "",
    optionType: "",
    strike: null,
    expiry: "",
    optionSymbol: "",
    optionToken: 0,
    lotSize: 0,
    lots: 0,
    qty: 0,
    entry: null,
    sl: null,
    tp: null,
    stopRs: null,
    indexSl: null,
    redHigh: null,
    entryMin: null,
    entryAt: "",
    intervalEnd: null,
    underOpen: null,
    underClose: null,
    entryBid: null,
    entryAsk: null,
    last: null,
    liveRs: 0,
    status: "watching",
    reason: "",
    fills: [],
    skips: [],
    kiteBuyOrderId: "",
    kiteSlOrderId: "",
    kiteNote: "",
    kiteHalt: false,
    exception: false,
    spot: null,
    minute: null,
    minutes: [],
    forming5m: null,
    peBid: null,
    peAsk: null,
    peLast: null,
    pulse: []
  };
}
function emptySniperSession(day, asOf = (/* @__PURE__ */ new Date()).toISOString(), keep) {
  const books = SNIPER_BOOKS.map((cfg) => {
    const b = emptySniperBook(cfg);
    const prev = keep?.books?.find((x) => x.id === cfg.id);
    if (prev) {
      b.pulse = Array.isArray(prev.pulse) ? prev.pulse.slice(-SNIPER_PULSE_KEEP) : [];
    }
    return b;
  });
  return {
    day,
    running: false,
    mode: keep?.mode === "live" ? "live" : "paper",
    paperOn: keep?.paperOn !== false,
    liveArmed: keep?.liveArmed === true,
    lots: Math.max(1, Math.floor(Number(keep?.lots) || SNIPER_DEFAULT_LOTS)),
    stopRs: SNIPER_STOP_RS,
    targetRs: SNIPER_TARGET_RS,
    selected: "",
    replayDay: "",
    startedAt: "",
    asOf,
    source: "idle",
    kiteError: null,
    honest: SNIPER_HONEST,
    books,
    incomplete: false
  };
}
function rupee(n) {
  return Math.round(n * 10) / 10;
}
function markBook(book, px, venue) {
  if (book.side !== "long" || book.entry == null || !(book.qty > 0) || px == null) {
    book.liveRs = 0;
    book.last = px;
    return;
  }
  book.last = px;
  book.liveRs = rupee(sniperNetRs(book.entry, px, book.qty, venue));
}
function closeFill(book, cfg, exit, exitMin, at, day, reason, bid, ask, incomplete = false) {
  if (book.side !== "long" || book.entry == null || !(book.qty > 0)) return { ...book, side: "flat", exception: false };
  const charges = sniperCharges(book.entry, exit, book.qty, cfg.venue);
  const grossRs = rupee(sniperGrossRs(book.entry, exit, book.qty));
  const netRs = rupee(grossRs - charges.total);
  const capital = rupee(book.capital + netRs);
  const fill = {
    n: book.fills.length + 1,
    under: book.id,
    label: book.label,
    day,
    entryAt: book.entryAt || at,
    exitAt: at,
    entryMin: book.entryMin || exitMin,
    exitMin,
    underOpen: book.underOpen || 0,
    underClose: book.underClose || 0,
    dir: book.dir || "red",
    breakDir: book.breakDir || "",
    optionType: book.optionType === "PE" ? "PE" : "CE",
    strike: book.strike || 0,
    expiry: book.expiry,
    optionSymbol: book.optionSymbol,
    entry: book.entry,
    exit,
    qty: book.qty,
    lots: book.lots,
    grossRs,
    charges,
    netRs,
    capitalAfter: capital,
    reason,
    entryBid: book.entryBid,
    entryAsk: book.entryAsk,
    exitBid: bid,
    exitAsk: ask,
    incomplete
  };
  return {
    ...book,
    side: "flat",
    qty: 0,
    last: exit,
    liveRs: 0,
    status: "done",
    event: "trade_closed",
    reason,
    capital,
    peakCapital: Math.max(book.peakCapital, capital),
    troughCapital: Math.min(book.troughCapital, capital),
    fills: [...book.fills, fill],
    kiteHalt: false,
    exception: reason === "exception"
  };
}
function nearbyBars(bars) {
  return bars.filter((b) => b.min >= SNIPER_OPEN_MIN).slice(-24);
}
function completedMinutes(bars, day, nowMin) {
  return (bars || []).filter((b) => b.day < day || b.day === day && b.min + 1 <= nowMin);
}
function formingMinuteBar(bars, day, nowMin, spot) {
  const exact = (bars || []).find((b) => b.day === day && b.min === nowMin);
  if (exact) return exact;
  const done = completedMinutes(bars, day, nowMin);
  const last = done.length ? done[done.length - 1] : null;
  if (spot == null && !last) return null;
  const open = last ? last.close : spot;
  const px = spot != null ? spot : last.close;
  return {
    day,
    min: nowMin,
    open,
    high: Math.max(open, px),
    low: Math.min(open, px),
    close: px
  };
}
function formingFiveBar(minutes, day, nowMin) {
  const start = nowMin - nowMin % SNIPER_BAR_MIN;
  const slice = (minutes || []).filter((b) => b.day === day && b.min >= start && b.min <= nowMin);
  if (!slice.length) return null;
  return {
    day,
    min: start,
    open: slice[0].open,
    high: Math.max(...slice.map((b) => b.high)),
    low: Math.min(...slice.map((b) => b.low)),
    close: slice[slice.length - 1].close
  };
}
function sniperPulseLine(book, nowMin) {
  const t = hhmm(nowMin);
  const spot = book.spot != null ? `Bank ${book.spot}` : "Bank \u2014";
  const pe = book.optionSymbol ? ` \xB7 ${book.optionSymbol}${book.peAsk != null ? ` ask ${book.peAsk}` : book.peLast != null ? ` last ${book.peLast}` : ""}` : "";
  if (book.side === "long") {
    const live = book.liveRs ? ` \xB7 live \u20B9${book.liveRs}` : "";
    return `${t} ${spot}${pe}${live} \xB7 SL \u20B9${book.sl ?? SNIPER_STOP_RS} sell \u20B9${book.tp ?? SNIPER_TARGET_RS}`;
  }
  if (book.fills.length) {
    const last = book.fills[book.fills.length - 1];
    return `${t} ${spot} \xB7 closed ${last.reason} \u20B9${last.netRs}${pe}`;
  }
  if (book.cut === "up") {
    return `${t} ${spot} \xB7 up ORB \xB7 skip CE \xB7 no trade today`;
  }
  return `${t} ${spot}${pe} \xB7 ${book.reason || "watching"}`;
}
function appendPulse(book, nowMin, nowIso) {
  const text = sniperPulseLine(book, nowMin);
  const row = { min: nowMin, at: nowIso, spot: book.spot, peLast: book.peLast, text };
  const prev = Array.isArray(book.pulse) ? book.pulse.filter((p) => p.min !== nowMin) : [];
  return [...prev, row].slice(-SNIPER_PULSE_KEEP);
}
function paintOrb(book, bars, day, nowMin) {
  const next = { ...book, bars: nearbyBars(bars), watch: true };
  const or = sniperOrbLevels(bars, day);
  next.orReady = sniperOrbReady(nowMin) && !!or;
  next.orHigh = or?.high ?? null;
  next.orLow = or?.low ?? null;
  if (next.cut || next.side === "long" || next.fills.length > 0 || next.event === "parked") {
    return next;
  }
  next.event = "watching";
  next.status = "watching";
  next.reason = nowMin < SNIPER_OPEN_MIN || !next.orReady ? `ORB ${hhmm(SNIPER_OPEN_MIN)}\u2013${hhmm(SNIPER_OR_END_MIN)}` : `ORB ${next.orLow}\u2013${next.orHigh} \xB7 wait first close below`;
  return next;
}
function firstCut(books, barsBy) {
  let best = null;
  for (const book of books) {
    if (!book.watch || !book.orReady || book.orHigh == null || book.orLow == null) continue;
    const or = { high: book.orHigh, low: book.orLow };
    for (const bar of barsBy[book.id] || []) {
      const dir = sniperClearCut(bar, or);
      if (!dir) continue;
      const dist = dir === "up" ? bar.close - or.high : or.low - bar.close;
      if (!best || bar.min < best.min || bar.min === best.min && dist > best.dist) {
        best = { id: book.id, dir, min: bar.min, dist, color: candleDir(bar) };
      }
      break;
    }
  }
  return best ? { id: best.id, dir: best.dir, min: best.min, color: best.color } : null;
}
function manageOpen(book, cfg, day, nowMin, nowIso, opt, stopRs, targetRs) {
  const next = { ...book, fills: [...book.fills], skips: [...book.skips] };
  const bid = opt.bid;
  const mark = bid ?? opt.last;
  markBook(next, mark, cfg.venue);
  if (mark == null) {
    if (nowMin >= cfg.flatMin) {
      next.exception = true;
      next.reason = "no exit quote";
      next.status = "exception";
    }
    return next;
  }
  const net = sniperNetRs(next.entry, mark, next.qty, cfg.venue);
  if (net >= targetRs || next.tp != null && mark >= next.tp) {
    return closeFill(next, cfg, mark, nowMin, nowIso, day, "tp", bid, opt.ask);
  }
  if (net <= -stopRs || next.sl != null && mark <= next.sl) {
    return closeFill(next, cfg, next.sl != null ? next.sl : mark, nowMin, nowIso, day, "sl", bid, opt.ask);
  }
  if (nowMin >= cfg.flatMin) {
    return closeFill(next, cfg, mark, nowMin, nowIso, day, "eod", bid, opt.ask);
  }
  next.reason = `open PE \xB7 SL \u20B9${next.sl} \xB7 sell \u20B9${next.tp}`;
  next.status = "open";
  next.event = "trade_taken";
  return next;
}
function stampLive(book, spots, feed, minutesBy, day, nowMin, nowIso) {
  const opt = feed[book.id]?.opt || { bid: null, ask: null, last: null };
  const pick = feed[book.id]?.pick || null;
  const spot = spots[book.id] ?? book.spot ?? null;
  const rawMins = minutesBy[book.id] || [];
  const minute = formingMinuteBar(rawMins, day, nowMin, spot);
  const doneMins = completedMinutes(rawMins, day, nowMin);
  const minutes = [...doneMins, ...minute && minute.min === nowMin ? [minute] : []];
  const next = {
    ...book,
    watch: true,
    spot,
    minute,
    minutes: nearbyBars(minutes).slice(-20),
    forming5m: formingFiveBar(minutes, day, nowMin),
    peBid: opt.bid,
    peAsk: opt.ask,
    peLast: opt.last ?? book.last
  };
  if (next.side === "flat" && !next.fills.length && pick?.listed) {
    next.optionType = pick.optionType;
    next.strike = pick.strike;
    next.expiry = pick.expiry;
    next.optionSymbol = pick.optionSymbol;
    next.optionToken = pick.optionToken;
    next.lotSize = pick.lotSize;
  }
  next.pulse = appendPulse(next, nowMin, nowIso);
  return next;
}
function tickSniperDesk(session, barsBy, spots, feed, day, nowMin, nowIso, minutesBy = {}) {
  const lots = Math.max(1, Math.floor(Number(session.lots) || SNIPER_DEFAULT_LOTS));
  const stopRs = SNIPER_STOP_RS;
  const targetRs = SNIPER_TARGET_RS;
  const allowEntry = session.paperOn !== false || session.liveArmed === true;
  const done = {};
  for (const cfg of SNIPER_BOOKS) {
    done[cfg.id] = completedSniperBars(barsBy[cfg.id] || [], day, nowMin);
  }
  let books = SNIPER_BOOKS.map((cfg) => {
    const prev = session.books.find((b) => b.id === cfg.id) || emptySniperBook(cfg);
    return paintOrb({ ...prev, fills: [...prev.fills], skips: [...prev.skips], pulse: [...prev.pulse || []] }, done[cfg.id] || [], day, nowMin);
  });
  const taken = books.some((b) => b.side === "long" || b.fills.length > 0);
  let selected = session.selected === "bank" ? "bank" : "";
  if (!selected && !taken) {
    const cut = firstCut(books, done);
    if (cut) {
      selected = cut.id;
      books = books.map(
        (b) => b.id === cut.id ? {
          ...b,
          cut: cut.dir,
          cutMin: cut.min,
          cutColor: cut.color,
          breakDir: cut.dir,
          event: cut.dir === "up" ? "parked" : "orb_break",
          status: cut.dir === "up" ? "skip" : "cut",
          reason: cut.dir === "up" ? `up ORB ${hhmm(cut.min)} \xB7 skip CE \xB7 no trade today` : `ORB break down ${hhmm(cut.min)} \xB7 wait 40% red`
        } : b
      );
    }
  } else if (selected) {
    books = books.map((b) => b.id === selected && !b.cut ? { ...b, cut: b.breakDir || b.cut, status: b.status } : b);
  }
  books = books.map((book) => {
    const cfg = SNIPER_BOOKS.find((c) => c.id === book.id) || SNIPER_BOOKS[0];
    const opt = feed[book.id]?.opt || { bid: null, ask: null, last: null };
    const pick = feed[book.id]?.pick || null;
    const spot = spots[book.id] ?? null;
    const bars = done[book.id] || [];
    if (book.side === "long" && book.entry != null) {
      return manageOpen(book, cfg, day, nowMin, nowIso, opt, stopRs, targetRs);
    }
    if (book.fills.length) {
      return { ...book, event: "trade_closed", status: "done", reason: book.reason || "done" };
    }
    if (book.id !== selected) return book;
    const breakDir = book.cut || book.breakDir;
    if (breakDir === "up") {
      return {
        ...book,
        event: "parked",
        status: "skip",
        reason: book.reason || `up ORB \xB7 skip CE \xB7 no trade today`
      };
    }
    if (nowMin >= cfg.flatMin) return { ...book, event: book.event || "orb_break", reason: "session closed" };
    if (nowMin > cfg.lastEntryMin) return { ...book, event: book.event || "orb_break", reason: "last entry passed" };
    if (!allowEntry) return { ...book, event: book.event || "orb_break", reason: book.reason || "paper off" };
    if (!breakDir || book.cutMin == null) {
      return { ...book, event: "orb_break", reason: "ORB break" };
    }
    const after = bars.filter((b) => b.min >= book.cutMin);
    const red = after.find((b) => sniperStrongRed(b)) || null;
    if (!red) {
      return { ...book, breakDir, event: "orb_break", reason: `ORB break down \xB7 wait 40% red` };
    }
    const green = sniperHighGreen(bars, red.min);
    const indexSl = green ? green.low : red.low;
    const triggered = spot != null && spot >= red.high || after.some((b) => b.min > red.min && b.high >= red.high);
    if (!triggered) {
      return {
        ...book,
        breakDir,
        redHigh: red.high,
        indexSl,
        event: "breakout_candle",
        reason: `40% red ${hhmm(red.min)} \xB7 wait tag ${red.high}`
      };
    }
    if (spot == null || !(spot > 0)) {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: "found_entry", reason: "waiting Bank spot" };
    }
    const want = sniperWantType(breakDir);
    if (want !== "PE") {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: "parked", reason: "skip CE \xB7 no trade today" };
    }
    if (!pick || !pick.listed || !pick.optionSymbol) {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: "found_entry", reason: "waiting ATM PE" };
    }
    if (pick.optionType !== "PE") {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: "found_entry", reason: "waiting PE" };
    }
    const fillPx = opt.ask ?? opt.last;
    if (fillPx == null || !(fillPx > 0)) {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: "found_entry", reason: "waiting PE quote" };
    }
    const size = sniperSize(lots, pick.lotSize, fillPx, cfg.venue, stopRs, targetRs);
    if (!size.lots) {
      return { ...book, breakDir, redHigh: red.high, indexSl, event: "found_entry", reason: size.skip || "lots" };
    }
    const next = {
      ...book,
      side: "long",
      dir: "red",
      breakDir,
      optionType: "PE",
      strike: pick.strike,
      expiry: pick.expiry,
      optionSymbol: pick.optionSymbol,
      optionToken: pick.optionToken,
      lotSize: pick.lotSize,
      lots: size.lots,
      qty: size.qty,
      entry: fillPx,
      sl: size.sl,
      tp: size.tp,
      stopRs,
      indexSl,
      redHigh: red.high,
      entryMin: nowMin,
      entryAt: nowIso,
      intervalEnd: cfg.flatMin,
      underOpen: red.open,
      underClose: red.close,
      entryBid: opt.bid,
      entryAsk: opt.ask,
      last: fillPx,
      status: "open",
      event: "trade_taken",
      reason: `open PE \xB7 SL \u20B9${size.sl} \xB7 sell \u20B9${size.tp}`,
      exception: false
    };
    markBook(next, fillPx, cfg.venue);
    return next;
  });
  books = books.map((b) => stampLive(b, spots, feed, minutesBy, day, nowMin, nowIso));
  return summarizeSniper(session, {
    day,
    lots,
    stopRs,
    targetRs,
    selected: selected || "",
    books,
    asOf: nowIso
  });
}
function summarizeSniper(session, patch = {}) {
  const src = patch.books ?? session.books;
  const books = src.map((b) => ({
    ...b,
    peakCapital: Math.max(b.peakCapital, b.capital),
    troughCapital: Math.min(b.troughCapital, b.capital)
  }));
  return {
    ...session,
    ...patch,
    stopRs: SNIPER_STOP_RS,
    targetRs: SNIPER_TARGET_RS,
    books,
    honest: SNIPER_HONEST,
    incomplete: books.some(
      (b) => b.fills.some((f) => f.incomplete) || /waiting ATM|waiting quote|waiting PE|waiting Bank/.test(b.reason)
    )
  };
}
function sniperWantType(dir) {
  if (dir === "down") return "PE";
  return null;
}

// ../palagai/src/app/core/sniper/sniper-tick.run.ts
function splitCsvLine2(line) {
  if (!line.includes('"')) return line.split(",");
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function findNamed(csv, names) {
  const want = names.map((n) => n.toUpperCase());
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const cols = splitCsvLine2(line);
    if (cols.length < 12) continue;
    const sym = cols[2].trim().toUpperCase();
    const name = cols[3].trim().toUpperCase();
    const itype = cols[9].trim().toUpperCase();
    if (itype === "CE" || itype === "PE") continue;
    if (want.includes(sym) || want.includes(name)) {
      return { tradingSymbol: cols[2].trim(), token: Number(cols[0]) || 0, exchange: cols[11].trim() };
    }
  }
  return null;
}
function findQuote(quotes, key) {
  const want = key.toUpperCase();
  for (const [k, v] of Object.entries(quotes)) {
    if (k.toUpperCase() === want) return v;
  }
  return null;
}
function sniperBestBidAsk(q) {
  const bid = Number(q?.depth?.buy?.[0]?.price);
  const ask = Number(q?.depth?.sell?.[0]?.price);
  return {
    bid: Number.isFinite(bid) && bid > 0 ? bid : null,
    ask: Number.isFinite(ask) && ask > 0 ? ask : null
  };
}
function lastOf(quotes, key) {
  const n = Number(findQuote(quotes, key)?.last_price);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function underKey(cfg) {
  return `${cfg.underExchange}:${cfg.underNames[0]}`;
}
function optionKey(exchange, symbol) {
  return `${exchange}:${symbol}`;
}
function optionPremiumPx(px, underLast) {
  const p = Number(px);
  if (!Number.isFinite(p) || p <= 0) return null;
  if (p >= 5e3) return null;
  const spot = Number(underLast);
  if (Number.isFinite(spot) && spot > 1e3 && p >= spot * 0.2) return null;
  return p;
}
function asBar(row) {
  const b = kiteBar(row);
  return { day: b.day, min: b.min, open: b.open, high: b.high, low: b.low, close: b.close };
}
async function loadBars(fetchHistorical, token, day, interval) {
  if (!token) return [];
  const candles = await fetchHistorical(token, interval, day, day).catch(() => []);
  return (candles || []).map(asBar).filter((b) => b.day);
}
function atmPick(chain, cfg, optionType, spot, asOf) {
  const picked = pickCheapOtm({
    instruments: chain,
    book: cfg.id,
    direction: optionType === "CE" ? "BUY" : "SELL",
    spot,
    asOf,
    premiumBudgetRs: 1e7,
    otmPts: 0
  });
  const listed = picked.source === "chain" && picked.instrument.instrumentToken > 0;
  return {
    optionType: picked.side,
    strike: picked.strike,
    expiry: picked.expiry,
    optionSymbol: picked.instrument.tradingSymbol,
    optionToken: picked.instrument.instrumentToken,
    lotSize: picked.lotSize,
    listed
  };
}
var FALLBACK = {
  bank: { tradingSymbol: "NIFTY BANK", token: 260105, exchange: "NSE" }
};
async function runSniperTick(io) {
  const now = io.now || /* @__PURE__ */ new Date();
  const day = io.session.replayDay || sniperIstDay(now);
  const nowMin = sniperIstMinutes(now);
  const raw = io.session.day === day ? io.session : emptySniperSession(day, now.toISOString(), io.session);
  const csv = String(await io.fetchCsv() || "");
  const chain = parseKiteInstrumentsCsv(csv);
  const named = {};
  for (const cfg of SNIPER_BOOKS) {
    named[cfg.id] = findNamed(csv, cfg.underNames) || FALLBACK[cfg.id];
  }
  const underKeys = SNIPER_BOOKS.map((cfg) => underKey(cfg)).filter(Boolean);
  const openKeys = raw.books.filter((b) => b.side !== "flat" && b.optionSymbol).map((b) => optionKey(SNIPER_BOOKS.find((c) => c.id === b.id)?.exchange || "NFO", b.optionSymbol));
  let quotes = await io.fetchQuotes([.../* @__PURE__ */ new Set([...underKeys, ...openKeys])]);
  const barsBy = {};
  const minutesBy = {};
  await Promise.all(
    SNIPER_BOOKS.map(async (cfg) => {
      const inst = named[cfg.id];
      if (!inst?.token) {
        barsBy[cfg.id] = [];
        minutesBy[cfg.id] = [];
        return;
      }
      const token = String(inst.token);
      const [five, one] = await Promise.all([
        loadBars(io.fetchHistorical, token, day, "5minute"),
        loadBars(io.fetchHistorical, token, day, "minute")
      ]);
      barsBy[cfg.id] = five;
      minutesBy[cfg.id] = one;
    })
  );
  const nowIso = now.toISOString();
  const spots = {};
  for (const cfg of SNIPER_BOOKS) {
    spots[cfg.id] = lastOf(quotes, underKey(cfg));
  }
  const probe = raw.selected || raw.books.some((b) => b.side === "long" || b.fills.length > 0) ? raw : tickSniperDesk(raw, barsBy, spots, {}, day, nowMin, nowIso, minutesBy);
  const selected = probe.selected;
  const cutDir = probe.books.find((b) => b.id === selected)?.cut || probe.books.find((b) => b.id === selected)?.breakDir || "";
  const want = selected ? sniperWantType(cutDir) : "PE";
  const extra = [];
  const picks = /* @__PURE__ */ new Map();
  for (const cfg of SNIPER_BOOKS) {
    const book = probe.books.find((b) => b.id === cfg.id);
    const spot = spots[cfg.id];
    const openType = book?.side === "long" && (book.optionType === "CE" || book.optionType === "PE") ? book.optionType : null;
    const fadeType = openType || want || "PE";
    if (spot && fadeType) {
      const pick = atmPick(chain, cfg, fadeType, spot, now);
      picks.set(cfg.id, pick);
      if (pick?.listed) extra.push(optionKey(cfg.exchange, pick.optionSymbol));
    } else {
      picks.set(cfg.id, null);
    }
  }
  const need = extra.filter((k) => !underKeys.includes(k) && !openKeys.includes(k));
  if (need.length) quotes = { ...quotes, ...await io.fetchQuotes(need) || {} };
  const feed = {};
  for (const cfg of SNIPER_BOOKS) {
    const prev = probe.books.find((b) => b.id === cfg.id);
    const pick = picks.get(cfg.id) || null;
    const okey = prev.optionSymbol ? optionKey(cfg.exchange, prev.optionSymbol) : pick?.listed ? optionKey(cfg.exchange, pick.optionSymbol) : "";
    const q = okey ? findQuote(quotes, okey) : null;
    const { bid, ask } = sniperBestBidAsk(q);
    const last = optionPremiumPx(q?.last_price, spots[cfg.id]) ?? optionPremiumPx(prev.last, spots[cfg.id]);
    feed[cfg.id] = {
      pick,
      opt: {
        bid: optionPremiumPx(bid, spots[cfg.id]),
        ask: optionPremiumPx(ask, spots[cfg.id]),
        last
      }
    };
  }
  const next = tickSniperDesk(probe, barsBy, spots, feed, day, nowMin, nowIso, minutesBy);
  return summarizeSniper(raw, {
    ...next,
    running: true,
    asOf: nowIso,
    source: "kite",
    kiteError: null,
    startedAt: raw.startedAt || nowIso
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  emptySniperSession,
  runSniperTick,
  sniperIstDay
});
