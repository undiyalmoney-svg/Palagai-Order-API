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

// paper-live/from-paper/index.ts
var index_exports = {};
__export(index_exports, {
  LIVE_PAPER_BOOKS: () => LIVE_PAPER_BOOKS,
  emptySession: () => emptySession,
  istDay: () => istDay,
  keepPaperOnKite: () => keepPaperOnKite,
  paperLiveArmedFor: () => paperLiveArmedFor,
  runPaperTick: () => runPaperTick,
  underOf: () => underOf
});
module.exports = __toCommonJS(index_exports);

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
function option14kToPaperCfg(plan) {
  return {
    id: plan.id,
    label: plan.label,
    product: plan.product,
    sl: plan.slPrem,
    tp: plan.tpPrem,
    scratch: plan.scratchPrem,
    rsPt: plan.rsPt,
    orS: plan.orS,
    orE: plan.orE,
    entryS: plan.entryS,
    flat: plan.flat,
    quietW: plan.quietW,
    pdMax: plan.pdMax,
    premiumRs: plan.openCostRs,
    orMin: plan.orMin,
    orMax: plan.orMax,
    trapP: plan.trapP,
    vwapMin: plan.vwapMin,
    primary: plan.primary,
    backup: plan.backup,
    buyOption: true,
    freshCross: true,
    strategy: "rules",
    expiryAfterTomorrow: true
  };
}

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
  const lastPrice2 = Number(item.lastPrice) || OPTION_14K_BOOKS[book].targetPremRs;
  const openCostRs = Math.round(lastPrice2 * lotSize);
  return {
    instrument: item,
    source,
    side,
    strike: item.strike,
    expiry: item.expiry,
    lotSize,
    lastPrice: lastPrice2,
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

// ../palagai/src/app/core/paper-desk/live-fill.util.ts
function liveBuyPrice(ask, last) {
  const a = Number(ask);
  if (Number.isFinite(a) && a > 0) return { price: a, atAsk: true };
  const l = Number(last);
  if (Number.isFinite(l) && l > 0) return { price: l, atAsk: false };
  return { price: null, atAsk: false };
}
function lotCostRs(price, lot) {
  return Math.round(price * lot);
}
function neededLotQuote(contract, lot, ask, last) {
  const fill = liveBuyPrice(ask, last);
  if (fill.price == null || lot <= 0) return null;
  return {
    contract,
    premium: Math.round(fill.price * 100) / 100,
    costRs: lotCostRs(fill.price, lot),
    atAsk: fill.atAsk,
    lot
  };
}
function replayBudgetSkips(book) {
  if (book.side !== "flat" || book.fills.length > 0) return book;
  const skips = book.skips || [];
  if (!skips.some((s) => s.reason === "premium-over-budget")) return book;
  return {
    ...book,
    lastBarMin: -1,
    pendingDir: 0,
    pendingSig: 0,
    pendingMode: "",
    status: "watching",
    reason: "replay \u2014 taking the live-priced option",
    skips: skips.filter((s) => s.reason !== "premium-over-budget")
  };
}

// ../palagai/src/app/core/paper-desk/live-assume.engine.ts
var LIVE_ASSUME_CAPITAL = 14e3;
var LIVE_ASSUME_CHARGE = 50;
var LIVE_ASSUME_CRUDE_MIN = 8e3;
function momentumGauge(bars, i) {
  const b = bars[i];
  if (!b || i < 20) return null;
  let sessionBars = 1;
  for (let k = i - 1; k >= 0 && bars[k].day === b.day; k--) sessionBars++;
  let sum = 0;
  for (let k = i - 20; k < i; k++) sum += bars[k].high - bars[k].low;
  const move = i >= 6 ? b.close - bars[i - 6].close : 0;
  return { move, need: 1.5 * (sum / 20) * Math.sqrt(6), sessionBars };
}
function momentumSignal(bars, i, k = 1.5) {
  const g = momentumGauge(bars, i);
  if (!g || g.sessionBars < 7) return 0;
  const need = k / 1.5 * g.need;
  if (g.move > need) return 1;
  if (g.move < -need) return -1;
  return 0;
}
var LIVE_ASSUME_BOOKS = [
  {
    id: "crude",
    label: "Crude Mini FUT",
    product: "1 lot \xB7 \u20B910/pt",
    sl: 20,
    tp: 25,
    scratch: 10,
    rsPt: 10,
    orS: 10 * 60,
    orE: 10 * 60 + 30,
    entryS: 10 * 60 + 30,
    flat: 23 * 60 + 10,
    quietW: 25,
    pdMax: 400,
    premiumRs: 0,
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
  },
  {
    id: "nifty",
    label: "Nifty 50",
    product: "cheap CE/PE \u20B950 \xD765",
    sl: 25,
    tp: 50,
    scratch: 12,
    rsPt: 13,
    orS: 9 * 60 + 15,
    orE: 10 * 60 + 15,
    entryS: 10 * 60 + 15,
    flat: 15 * 60 + 15,
    quietW: 30,
    pdMax: 500,
    premiumRs: 3250,
    orMin: 20,
    orMax: 180,
    trapP: 12,
    vwapMin: 15,
    primary: { trend: "pdhl", range: "fade", quiet: "vwap_fade" },
    backup: {
      trend: ["trap", "all_three", "fade_trap"],
      range: ["trap", "vwap_fade", "fade_trap"],
      quiet: ["fade", "trap", "fade_trap"],
      stand: ["trap", "vwap_fade", "fade"]
    }
  },
  {
    id: "bank",
    label: "Bank Nifty",
    product: "cheap CE/PE \u20B9100 \xD730",
    sl: 50,
    tp: 110,
    scratch: 25,
    rsPt: 6,
    orS: 9 * 60 + 15,
    orE: 9 * 60 + 45,
    entryS: 9 * 60 + 45,
    flat: 15 * 60 + 15,
    quietW: 80,
    pdMax: 900,
    premiumRs: 3e3,
    orMin: 40,
    orMax: 350,
    trapP: 25,
    vwapMin: 30,
    primary: { trend: "pdhl", range: "fade", quiet: "vwap_fade" },
    backup: {
      trend: ["trap", "all_three", "fade_trap"],
      range: ["trap", "vwap_fade", "fade_trap"],
      quiet: ["fade", "trap", "fade_trap"],
      stand: ["trap", "vwap_fade", "fade"]
    }
  },
  {
    id: "sensex",
    label: "Sensex",
    product: "cheap CE/PE \u20B9150 \xD720",
    sl: 80,
    tp: 160,
    scratch: 40,
    rsPt: 4,
    orS: 9 * 60 + 15,
    orE: 9 * 60 + 45,
    entryS: 9 * 60 + 45,
    flat: 15 * 60 + 15,
    quietW: 100,
    pdMax: 1e3,
    premiumRs: 3e3,
    orMin: 50,
    orMax: 400,
    trapP: 30,
    vwapMin: 35,
    primary: { trend: "pdhl", range: "fade", quiet: "vwap_fade" },
    backup: {
      trend: ["trap", "all_three", "fade_trap"],
      range: ["trap", "vwap_fade", "fade_trap"],
      quiet: ["fade", "trap", "fade_trap"],
      stand: ["trap", "vwap_fade", "fade"]
    }
  }
];
function sessionVwap(bars, i) {
  const b = bars[i];
  if (!b) return null;
  const sess = bars.filter((x) => x.day === b.day && x.min <= b.min);
  if (!sess.length) return null;
  return sess.reduce((s, x) => s + (x.high + x.low + x.close) / 3, 0) / sess.length;
}
function morningStructure(bars, day, orS, orE, quietW) {
  const or = bars.filter((b) => b.day === day && b.min >= orS && b.min <= orE);
  if (or.length < 2) return "stand";
  const hi = Math.max(...or.map((b) => b.high));
  const lo = Math.min(...or.map((b) => b.low));
  const width = hi - lo;
  if (width <= 0) return "stand";
  const o0 = or[0].open;
  const c1 = or[or.length - 1].close;
  const mid = (hi + lo) / 2;
  if (width < quietW) return "quiet";
  if (c1 >= mid + 0.2 * width && c1 > o0) return "trend";
  if (c1 <= mid - 0.2 * width && c1 < o0) return "trend";
  return "range";
}
function sessionOr(bars, day, orS, orE) {
  const or = bars.filter((b) => b.day === day && b.min >= orS && b.min <= orE);
  if (!or.length) return null;
  return { hi: Math.max(...or.map((b) => b.high)), lo: Math.min(...or.map((b) => b.low)) };
}
function prevHl(bars, day) {
  const days = [...new Set(bars.map((b) => b.day))].sort();
  const i = days.indexOf(day);
  if (i <= 0) return null;
  const prev = bars.filter((b) => b.day === days[i - 1]);
  if (!prev.length) return null;
  return { hi: Math.max(...prev.map((b) => b.high)), lo: Math.min(...prev.map((b) => b.low)) };
}
function bookSignal(mode, bars, i, cfg) {
  const b = bars[i];
  const up = b.close > b.open;
  const dn = b.close < b.open;
  const pdhl = () => {
    const lv = prevHl(bars, b.day);
    if (!lv || lv.hi - lv.lo > cfg.pdMax) return 0;
    const prior = i > 0 ? bars[i - 1] : null;
    const crossedUp = !cfg.freshCross || prior != null && prior.close <= lv.hi;
    const crossedDn = !cfg.freshCross || prior != null && prior.close >= lv.lo;
    if (b.close > lv.hi && up && crossedUp) return 1;
    if (b.close < lv.lo && dn && crossedDn) return -1;
    return 0;
  };
  const fade = () => {
    if (b.min <= cfg.orE) return 0;
    const orb = sessionOr(bars, b.day, cfg.orS, cfg.orE);
    if (!orb) return 0;
    const w = orb.hi - orb.lo;
    if (w < cfg.orMin || w > cfg.orMax) return 0;
    if (b.high > orb.hi && b.close < orb.hi && dn) return -1;
    if (b.low < orb.lo && b.close > orb.lo && up) return 1;
    return 0;
  };
  const trap = () => {
    const from = Math.max(0, i - 6);
    const win = bars.slice(from, i);
    if (win.length < 3) return 0;
    const sh = Math.max(...win.map((x) => x.high));
    const sl = Math.min(...win.map((x) => x.low));
    if (b.low < sl - cfg.trapP && b.close > sl && up) return 1;
    if (b.high > sh + cfg.trapP && b.close < sh && dn) return -1;
    return 0;
  };
  const vwapFade = () => {
    const typ = sessionVwap(bars, i);
    if (typ == null) return 0;
    const dist = b.close - typ;
    const need = cfg.vwapPct != null && typ > 0 ? typ * cfg.vwapPct : cfg.vwapMin;
    if (Math.abs(dist) < need) return 0;
    if (dist > 0 && dn) return -1;
    if (dist < 0 && up) return 1;
    return 0;
  };
  const orbBreak = () => {
    if (b.min <= cfg.orE) return 0;
    const orb = sessionOr(bars, b.day, cfg.orS, cfg.orE);
    if (!orb) return 0;
    if (orb.hi - orb.lo > cfg.orMax) return 0;
    if (b.close > orb.hi && up) return 1;
    if (b.close < orb.lo && dn) return -1;
    return 0;
  };
  if (mode === "momentum") return momentumSignal(bars, i, cfg.momK ?? 1.5);
  if (mode === "pdhl") return pdhl();
  if (mode === "fade" || mode === "orb_fade") return fade();
  if (mode === "trap") return trap();
  if (mode === "vwap_fade") return vwapFade();
  if (mode === "orb_break") return orbBreak();
  if (mode === "pdhl_fade") return pdhl() || fade();
  if (mode === "fade_trap") return fade() || trap();
  if (mode === "all_three") return pdhl() || fade() || trap();
  return 0;
}

// ../palagai/src/app/core/paper-desk/paper-mix.util.ts
var MIX_MODES = ["momentum", "orb_break", "pdhl", "vwap_fade", "trap"];
var MIX_CONTINUATION = /* @__PURE__ */ new Set(["momentum", "orb_break", "pdhl"]);
var MIX_FADE = /* @__PURE__ */ new Set(["vwap_fade", "trap"]);
var MIX_NEED = 4;
var MIX_SPREAD_PCT = 0.03;
function usesMix(cfg) {
  return cfg.mix === true;
}
function mixVotes(bars, i, cfg) {
  return MIX_MODES.map((mode) => ({ mode, dir: bookSignal(mode, bars, i, cfg) })).filter((v) => v.dir);
}
function mixGate(bars, i, cfg, hit, structure) {
  if (!usesMix(cfg) || !hit.dir) {
    return { ok: true, score: MIX_NEED, need: MIX_NEED, reason: "", bits: [] };
  }
  const fade = MIX_FADE.has(hit.mode);
  const bits = [hit.mode];
  let score = 2;
  const vwap = sessionVwap(bars, i);
  const close = bars[i]?.close;
  const withVwap = vwap != null && close != null && (hit.dir === 1 ? close >= vwap : close <= vwap);
  if (vwap != null && close != null) {
    if (!fade && withVwap) {
      score += 1;
      bits.push("with-vwap");
    }
    if (fade && !withVwap) {
      score += 1;
      bits.push("stretch-vwap");
    }
  }
  const stOk = fade ? structure !== "trend" : structure !== "quiet";
  if (stOk && structure !== "stand" && structure !== "wait") {
    score += 1;
    bits.push(structure);
  }
  const votes = mixVotes(bars, i, cfg);
  const ally = votes.find((v) => v.dir === hit.dir && v.mode !== hit.mode);
  if (ally) {
    score += 1;
    bits.push(`+${ally.mode}`);
  }
  const oppCont = votes.filter((v) => MIX_CONTINUATION.has(v.mode) && v.dir === -hit.dir);
  if (!fade && vwap != null && !withVwap) {
    return { ok: false, score, need: MIX_NEED, reason: "mix: continuation against VWAP", bits };
  }
  if (fade && structure === "trend") {
    return { ok: false, score, need: MIX_NEED, reason: "mix: no fade on trend day", bits };
  }
  if (fade && oppCont.length >= 2) {
    return {
      ok: false,
      score,
      need: MIX_NEED,
      reason: `mix: fade vs ${oppCont.map((v) => v.mode).join("+")}`,
      bits
    };
  }
  const ok = score >= MIX_NEED;
  return {
    ok,
    score,
    need: MIX_NEED,
    reason: ok ? `mix ${score}/${MIX_NEED} ${bits.join(",")}` : `mix ${score}/${MIX_NEED} need ${MIX_NEED}`,
    bits
  };
}

// ../palagai/src/app/core/paper-desk/option-charges.util.ts
var SCHEDULE = {
  NSE: { tax: 15e-4, txn: 3553e-7, stamp: 3e-5 },
  BSE: { tax: 15e-4, txn: 325e-6, stamp: 3e-5 },
  MCX: { tax: 5e-4, txn: 418e-6, stamp: 3e-5 }
};
var BROKERAGE_ROUND_TRIP_RS = 40;
function optionChargeBreakdown(buyPremium, sellPremium, qty, venue) {
  const zero = {
    brokerage: 0,
    sttCtt: 0,
    exchangeTxn: 0,
    sebi: 0,
    stamp: 0,
    ipft: 0,
    gst: 0,
    total: 0
  };
  if (!(qty > 0) || !(buyPremium > 0) || !(sellPremium >= 0)) return zero;
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
function optionRoundTripCharges(buyPremium, sellPremium, qty, venue) {
  return optionChargeBreakdown(buyPremium, sellPremium, qty, venue).total;
}
function venueForBook(bookId) {
  if (bookId.includes("sensex")) return "BSE";
  if (bookId.includes("crude")) return "MCX";
  return "NSE";
}
function gstOn(brokerage, txn, sebi) {
  return 0.18 * (brokerage + txn + sebi);
}
var FUT_SCHED = {
  NSE: { tax: 5e-4, txn: 183e-7, stamp: 2e-5 },
  BSE: { tax: 5e-4, txn: 0, stamp: 2e-5 },
  MCX: { tax: 1e-4, txn: 21e-6, stamp: 2e-5 }
};
function futuresRoundTripCharges(entry, exit, qty, venue) {
  if (!(qty > 0) || !(entry > 0) || !(exit >= 0)) return 0;
  const p = FUT_SCHED[venue];
  const buyVal = entry * qty;
  const sellVal = exit * qty;
  const turnover = buyVal + sellVal;
  const brokerage = Math.min(20, 3e-4 * buyVal) + Math.min(20, 3e-4 * sellVal);
  const sttCtt = p.tax * sellVal;
  const exchangeTxn = p.txn * turnover;
  const sebi = 10 * turnover / 1e7;
  const stamp = p.stamp * buyVal;
  const ipft = 0.01 * turnover / 1e7;
  return brokerage + sttCtt + exchangeTxn + sebi + stamp + ipft + gstOn(brokerage, exchangeTxn, sebi);
}
function equityMisRoundTripCharges(entry, exit, qty) {
  if (!(qty > 0) || !(entry > 0) || !(exit >= 0)) return 0;
  const buyVal = entry * qty;
  const sellVal = exit * qty;
  const turnover = buyVal + sellVal;
  const brokerage = Math.min(20, 3e-4 * buyVal) + Math.min(20, 3e-4 * sellVal);
  const sttCtt = 25e-5 * sellVal;
  const exchangeTxn = 297e-7 * turnover;
  const sebi = 10 * turnover / 1e7;
  const stamp = 3e-5 * buyVal;
  const ipft = 10 * turnover / 1e7;
  return brokerage + sttCtt + exchangeTxn + sebi + stamp + ipft + gstOn(brokerage, exchangeTxn, sebi);
}

// ../palagai/src/app/core/paper-desk/live-paper.engine.ts
var ALL = (mode) => ({ trend: mode, range: mode, quiet: mode, stand: mode });
var LIVE_PAPER_BANK_RS = 370;
var LIVE_PAPER_TARGET_RS = 370;
var LIVE_PAPER_STOP_RS = 370;
function paperFillGrade(f) {
  const rs = Number(f.rs) || 0;
  const why = String(f.reason || "");
  if (why === "tp" || rs >= LIVE_PAPER_BANK_RS) return "A";
  if (rs > 0) return "B";
  if (why === "scratch" || rs === 0) return "C";
  if (why === "sl" || rs <= -LIVE_PAPER_STOP_RS) return "F";
  return "D";
}
var LIVE_PAPER_CRUDE_TARGET_RS = 370;
var LIVE_PAPER_CRUDE_STOP_RS = 370;
var LIVE_PAPER_CRUDE_MOM_K = 0.8;
var EXIT = {
  backup: {},
  stopPct: 0.4,
  targetPct: 1,
  holdBars: 24,
  maxTradesPerDay: 3,
  minGapBars: 12,
  atm: true,
  noConfirm: false,
  dayStops: true,
  expiryAfterTomorrow: false,
  freshCross: true
};
function deskPatch(under) {
  if (under === "crude") {
    return {
      strategy: "momentum",
      primary: ALL("momentum"),
      orS: 9 * 60,
      orE: 9 * 60 + 15,
      entryS: 9 * 60 + 15,
      maxTradesPerDay: 5,
      barMinutes: 1,
      momK: LIVE_PAPER_CRUDE_MOM_K,
      minGapMin: 10,
      holdBars: 60,
      stopRs: LIVE_PAPER_CRUDE_STOP_RS,
      targetRs: LIVE_PAPER_CRUDE_TARGET_RS
    };
  }
  return {
    strategy: "momentum",
    primary: ALL("momentum"),
    orS: 9 * 60 + 15,
    orE: 9 * 60 + 30,
    entryS: 9 * 60 + 45,
    maxTradesPerDay: 5,
    barMinutes: 1,
    momK: 0.8,
    minGapMin: 10,
    holdBars: 60,
    stopRs: LIVE_PAPER_STOP_RS,
    targetRs: LIVE_PAPER_TARGET_RS
  };
}
var PAPER_MOMENTUM = { ...EXIT, ...deskPatch("nifty") };
var PAPER_TEST_HONEST = "Index-proxy pick, not a lock. ATM CE (up) or PE (down), 1 lot at the live ask, next 1-min confirm, exact charges. Daily bank \u20B9370 net after charges / stop \u20B9370, 0.8\xD7 1-min thrust from 09:45. Nifty, Bank, Sensex and Crude Mini each take their own fill, up to five, so a wrong trade can be corrected. Target fills at the live bid when it is already through. A +\u20B9370 win does not sit the book. Each closed fill is graded A\u2013F (A banks \u20B9370, F is a stop). Crude Mini: from 09:00 MCX open, 0.8\xD7 thrust, up to five fills, flatten 23:10. Same \u20B9370 target. Paper always records, Live on or off. Live Kite on a ticked book adds a 1 lot MARKET buy and a resting SL \u2014 a Kite reject does not drop the paper fill. A refresh does not arm Live. Cousin \u20B9375 rule on 15 live 1-min sessions tagged 3 wins on 11 days \u2014 not every day, not 8 months. Nothing here is a guaranteed \u20B9370. Forward paper is unproven until 400 trades and a one-sided 95% lower bound above zero on live asks. Not a guaranteed profit.";
var LIVE_PAPER_BOOKS = OPTION_14K_LIST.map((plan) => ({
  ...option14kToPaperCfg(plan),
  ...EXIT,
  ...deskPatch(plan.id),
  id: `${plan.id}-momentum`,
  under: plan.id,
  desk: "momentum",
  product: `ATM CE/PE \xD7${plan.lot}`
}));
var SCALP_EXIT = {
  buyOption: false,
  strategy: "watch",
  primary: ALL("vwap_fade"),
  backup: {},
  stopPct: 15e-4,
  targetPct: 25e-4,
  vwapPct: 25e-4,
  holdBars: 12,
  maxTradesPerDay: 3,
  minGapBars: 6,
  noConfirm: true,
  dayStops: true,
  desk: "scalp",
  freshCross: true,
  atm: false
};
var NIFTY_PLAN = option14kToPaperCfg(OPTION_14K_BOOKS.nifty);
var CRUDE_PLAN = option14kToPaperCfg(OPTION_14K_BOOKS.crude);
function scalpStock(id, label, symbol, qty) {
  return {
    ...NIFTY_PLAN,
    ...SCALP_EXIT,
    id: `${id}-scalp`,
    under: id,
    desk: "scalp",
    label,
    product: `MIS \xD7${qty}`,
    kind: "eq",
    qty,
    rsPt: qty,
    nseSymbol: symbol,
    misPct: 0.2,
    sl: 2,
    tp: 4,
    scratch: 2,
    entryS: 9 * 60 + 30,
    orS: 9 * 60 + 15,
    orE: 9 * 60 + 30,
    flat: 15 * 60 + 15
  };
}
var PAPER_SCALP_BOOKS = [
  {
    ...CRUDE_PLAN,
    ...SCALP_EXIT,
    id: "crude-scalp",
    under: "crude",
    desk: "scalp",
    label: "Crude Mini",
    product: "FUT \xD710",
    kind: "fut",
    qty: 10,
    rsPt: 10,
    nseSymbol: "CRUDEOILM",
    capitalRs: 28450,
    sl: 15,
    tp: 25,
    scratch: 15,
    entryS: 9 * 60 + 15,
    orS: 9 * 60,
    orE: 9 * 60 + 15,
    flat: 23 * 60 + 10
  },
  scalpStock("reliance", "Reliance", "RELIANCE", 50),
  scalpStock("hdfcbank", "HDFC Bank", "HDFCBANK", 50),
  scalpStock("infy", "Infosys", "INFY", 50)
];
var ALL_PAPER_BOOKS = LIVE_PAPER_BOOKS;
function underOf(id) {
  const u = id.split("-")[0];
  return u === "crude" || u === "nifty" || u === "bank" || u === "sensex" ? u : "nifty";
}
function paperTickOrder(cfgs) {
  const rank = (id) => {
    const u = underOf(id);
    if (u === "bank") return 0;
    if (u === "sensex") return 1;
    if (u === "nifty") return 2;
    return 3;
  };
  return [...cfgs].sort((a, b) => rank(a.id) - rank(b.id));
}
function indexDeskBlockReason(_cfgId, _books, _day) {
  return null;
}
function deskOf(id) {
  return id.split("-").slice(1).join("-") || "momentum";
}
var LIVE_PAPER_CAPITAL = LIVE_ASSUME_CAPITAL;
var LIVE_PAPER_CHARGE = LIVE_ASSUME_CHARGE;
var LIVE_PAPER_COOLDOWN_MIN = 60;
var LIVE_PAPER_MAX_SIGNAL_AGE_MIN = 10;
var LIVE_PAPER_MAX_LOSSES = 2;
var LIVE_PAPER_STOP_RANGE_MULT = 1.5;
var LIVE_PAPER_TARGET_R = 2;
var MIN_RANGE_BARS = 3;
var RANGE_LOOKBACK_BARS = 12;
function emptyBook(cfg) {
  return {
    id: cfg.id,
    desk: cfg.desk || deskOf(cfg.id),
    under: cfg.under || underOf(cfg.id),
    label: cfg.label,
    product: cfg.product,
    instrument: cfg.label,
    last: null,
    structure: "wait",
    mode: "stand",
    side: "flat",
    entry: null,
    sl: null,
    tp: null,
    scratch: null,
    livePts: 0,
    liveRs: 0,
    closedRs: 0,
    fund: LIVE_PAPER_CAPITAL,
    status: "watching",
    pendingDir: 0,
    pendingSig: 0,
    pendingMode: "",
    lastBarMin: -1,
    reason: "",
    fills: [],
    optionSymbol: "",
    optionType: "",
    strike: null,
    expiry: "",
    lot: cfg.qty || 0,
    optionToken: 0,
    neededCeRs: null,
    neededCe: "",
    neededPeRs: null,
    neededPe: "",
    neededLot: 0,
    neededAtAsk: false,
    lossesToday: 0,
    cooldownUntil: -1,
    entryMin: null,
    lastSignalMin: -1,
    capitalUsed: capitalUsedOf(cfg, { last: null, entry: null })
  };
}
function capitalUsedOf(cfg, book) {
  if (cfg.capitalRs) return cfg.capitalRs;
  const px = book.last ?? book.entry ?? 0;
  const qty = cfg.qty || cfg.rsPt || 0;
  const pct = cfg.misPct ?? 0.2;
  if (!(px > 0) || !(qty > 0)) return 0;
  return Math.round(px * qty * pct);
}
function isOptionBuy(cfg) {
  return cfg.buyOption === true;
}
function optionRangePts(bars) {
  const ranges = bars.slice(-RANGE_LOOKBACK_BARS).map((b) => b.high - b.low).filter((r) => Number.isFinite(r) && r >= 0).sort((a, b) => a - b);
  if (ranges.length < MIN_RANGE_BARS) return null;
  const mid = Math.floor(ranges.length / 2);
  const med = ranges.length % 2 ? ranges[mid] : (ranges[mid - 1] + ranges[mid]) / 2;
  return med > 0 ? med : null;
}
function optionStopPts(cfg, rangePts) {
  const sl = Math.max(cfg.sl, rangePts != null ? LIVE_PAPER_STOP_RANGE_MULT * rangePts : 0);
  const r = (n) => Math.round(n * 100) / 100;
  return { sl: r(sl), tp: r(Math.max(cfg.tp, LIVE_PAPER_TARGET_R * sl)) };
}
function optionPctStopPts(cfg, prem, lot) {
  let sl = prem * (cfg.stopPct ?? 0);
  if (cfg.maxStopRs != null && lot > 0) sl = Math.min(sl, cfg.maxStopRs / lot);
  const r = (n) => Math.round(n * 100) / 100;
  return { sl: r(sl), tp: r(prem * (cfg.targetPct ?? 0)) };
}
function optionRupeeStopPts(cfg, lot) {
  const r = (n) => Math.round(n * 100) / 100;
  return { sl: r((cfg.stopRs ?? 0) / lot), tp: r((cfg.targetRs ?? 0) / lot) };
}
function optionNetTargetPts(cfg, prem, lot) {
  const r = (n) => Math.round(n * 100) / 100;
  const targetRs = cfg.targetRs ?? 0;
  if (!(lot > 0) || !(targetRs > 0)) return r(targetRs);
  if (!(prem > 0)) return r(targetRs / lot);
  const venue = venueForBook(cfg.under || cfg.id);
  let pts = targetRs / lot;
  for (let i = 0; i < 3; i++) {
    const charges = optionRoundTripCharges(prem, prem + pts, lot, venue);
    pts = (targetRs + charges) / lot;
  }
  return r(pts);
}
function optionBoundStops(cfg, prem, lot, rangePts = null) {
  if (cfg.stopRs != null && cfg.targetRs != null && lot > 0) return optionRupeeStopPts(cfg, lot);
  if (cfg.stopPct != null && cfg.targetPct != null) return optionPctStopPts(cfg, prem, lot);
  return optionStopPts(cfg, rangePts);
}
function bindOptionFill(book, cfg, prem, pick, rangePts = null, atMin) {
  if (book.side === "flat" || prem <= 0) return book;
  const next = { ...book, fills: [...book.fills] };
  const stop = optionBoundStops(cfg, prem, pick.lotSize, rangePts);
  const tpPts = cfg.targetRs != null && pick.lotSize > 0 ? optionNetTargetPts(cfg, prem, pick.lotSize) : stop.tp;
  next.entry = prem;
  next.sl = Math.max(0.05, Math.round((prem - stop.sl) * 100) / 100);
  next.tp = Math.round((prem + tpPts) * 100) / 100;
  next.scratch = next.sl;
  next.instrument = pick.instrument.tradingSymbol;
  next.optionSymbol = pick.instrument.tradingSymbol;
  next.optionType = pick.side;
  next.strike = pick.strike;
  next.expiry = pick.expiry;
  next.lot = pick.lotSize;
  next.optionToken = pick.instrument.instrumentToken;
  next.last = prem;
  next.reason = `open ${pick.side} ${pick.instrument.tradingSymbol}`;
  next.kiteBuyOrderId = "";
  next.kiteSlOrderId = "";
  next.kiteNote = "";
  next.kiteHalt = false;
  if (atMin != null) {
    next.entryMin = atMin;
    next.lastBarMin = Math.max(next.lastBarMin, atMin);
  }
  markLive(next, prem, cfg);
  return next;
}
function emptySession(day, asOf = (/* @__PURE__ */ new Date()).toISOString()) {
  const books = ALL_PAPER_BOOKS.map((cfg) => emptyBook(cfg));
  return summarizePaper(books, {
    running: false,
    day,
    startedAt: null,
    asOf,
    source: "idle",
    kiteFunds: null,
    kiteError: null
  });
}
function hhmm(min) {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}
function istDay(d = /* @__PURE__ */ new Date()) {
  const ist = new Date(d.getTime() + 330 * 60 * 1e3);
  return ist.toISOString().slice(0, 10);
}
function istMinutes(d = /* @__PURE__ */ new Date()) {
  const ist = new Date(d.getTime() + 330 * 60 * 1e3);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}
function completedBars(bars, day, nowMin, barMinutes = 5) {
  return bars.filter((b) => b.day < day || b.day === day && b.min + barMinutes <= nowMin);
}
function netRs(cfg, book, entry, exit, pts) {
  const qty = book.lot || cfg.qty || cfg.rsPt;
  if (cfg.kind === "eq") {
    const charges2 = equityMisRoundTripCharges(entry, Math.max(0, exit), qty);
    return Math.round((pts * qty - charges2) * 10) / 10;
  }
  if (cfg.kind === "fut") {
    const charges2 = futuresRoundTripCharges(entry, Math.max(0, exit), qty, venueForBook(cfg.under || cfg.id));
    return Math.round((pts * qty - charges2) * 10) / 10;
  }
  if (!isOptionBuy(cfg)) return Math.round((pts * cfg.rsPt - LIVE_PAPER_CHARGE) * 10) / 10;
  const charges = optionRoundTripCharges(entry, Math.max(0, exit), qty, venueForBook(cfg.under || cfg.id));
  return Math.round((pts * qty - charges) * 10) / 10;
}
function markLive(book, last, cfg) {
  book.last = last;
  if (book.side === "flat" || book.entry == null) {
    book.livePts = 0;
    book.liveRs = 0;
    return;
  }
  const px = last ?? book.entry;
  const pts = isOptionBuy(cfg) ? px - book.entry : (book.side === "long" ? 1 : -1) * (px - book.entry);
  book.livePts = Math.round(pts * 10) / 10;
  book.liveRs = netRs(cfg, book, book.entry, px, pts);
}
function closeAt(book, cfg, exitPx, reason, day, nowMin) {
  if (book.side === "flat" || book.entry == null) return;
  const pts = isOptionBuy(cfg) ? exitPx - book.entry : (book.side === "long" ? 1 : -1) * (exitPx - book.entry);
  const rs = netRs(cfg, book, book.entry, exitPx, pts);
  const qty = book.lot || cfg.qty || cfg.rsPt;
  const charges = cfg.kind === "eq" ? equityMisRoundTripCharges(book.entry, Math.max(0, exitPx), qty) : cfg.kind === "fut" ? futuresRoundTripCharges(book.entry, Math.max(0, exitPx), qty, venueForBook(cfg.under || cfg.id)) : isOptionBuy(cfg) ? optionRoundTripCharges(book.entry, Math.max(0, exitPx), qty, venueForBook(cfg.under || cfg.id)) : LIVE_PAPER_CHARGE;
  book.fills.push({
    day,
    book: book.id,
    label: book.label,
    desk: book.desk || deskOf(book.id),
    under: book.under || underOf(book.id),
    side: book.side,
    entry: book.entry,
    exit: exitPx,
    sl: book.sl || 0,
    tp: book.tp || 0,
    pts: Math.round(pts * 10) / 10,
    rs,
    grade: paperFillGrade({ rs, reason }),
    charges: Math.round(charges * 10) / 10,
    reason,
    mode: book.mode,
    optionSymbol: book.optionSymbol,
    optionType: book.optionType,
    strike: book.strike,
    expiry: book.expiry,
    lot: book.lot,
    structure: book.structure,
    entryBid: book.entryBid ?? null,
    entryAsk: book.entryAsk ?? null,
    entryAt: book.entryAt,
    signal: book.signal ?? null,
    holdMin: book.entryMin != null ? Math.max(0, (nowMin ?? book.lastBarMin ?? 0) - book.entryMin) : void 0,
    gaugeMove: book.gauge?.move ?? null,
    gaugeNeed: book.gauge?.need ?? null,
    exitMin: book.lastBarMin,
    underEntry: book.last != null && book.optionSymbol ? null : book.last
  });
  book.closedRs = Math.round((book.closedRs + rs) * 10) / 10;
  book.fund = Math.round((LIVE_PAPER_CAPITAL + book.closedRs) * 10) / 10;
  book.side = "flat";
  book.entry = null;
  book.sl = null;
  book.tp = null;
  book.scratch = null;
  book.livePts = 0;
  book.liveRs = 0;
  book.status = "closed";
  book.reason = reason;
  book.pendingDir = 0;
  book.pendingSig = 0;
  book.pendingMode = "";
  book.optionSymbol = "";
  book.optionType = "";
  book.strike = null;
  book.expiry = "";
  book.lot = 0;
  book.optionToken = 0;
  book.entryBid = null;
  book.entryAsk = null;
  book.entryAt = "";
  book.entryMin = null;
  book.signal = null;
}
function hitExit(book, high, low, close, cfg, day, open = close, nowMin, fillBid) {
  if (book.side === "flat" || book.entry == null || book.sl == null || book.tp == null || book.scratch == null) {
    return false;
  }
  const long = isOptionBuy(cfg) || book.side === "long";
  const hasBid = fillBid != null && fillBid > 0;
  if (long) {
    const throughSl = hasBid ? fillBid <= book.sl : low <= book.sl;
    if (throughSl) {
      closeAt(book, cfg, hasBid ? fillBid : Math.min(book.sl, open), "sl", day, nowMin);
      return true;
    }
    const throughScratch = hasBid ? fillBid <= book.scratch : low <= book.scratch;
    if (throughScratch) {
      closeAt(book, cfg, hasBid ? fillBid : Math.min(book.scratch, open), "scratch", day, nowMin);
      return true;
    }
    const throughTp = hasBid ? fillBid >= book.tp : high >= book.tp;
    if (throughTp) {
      closeAt(book, cfg, hasBid ? fillBid : book.tp, "tp", day, nowMin);
      return true;
    }
    return false;
  }
  if (high >= book.sl) {
    closeAt(book, cfg, book.sl, "sl", day, nowMin);
    return true;
  }
  if (high >= book.scratch) {
    closeAt(book, cfg, book.scratch, "scratch", day, nowMin);
    return true;
  }
  if (low <= book.tp) {
    closeAt(book, cfg, book.tp, "tp", day, nowMin);
    return true;
  }
  return false;
}
function canOpen(book, cfg, atMin, day) {
  if (cfg.strategy === "watch") return "watch only: no tested edge";
  if (underOf(cfg.id) === "crude" && LIVE_PAPER_CAPITAL < LIVE_ASSUME_CRUDE_MIN) return "need \u20B98,000 free for Crude";
  if (cfg.maxTradesPerDay != null || cfg.maxWinsPerDay != null || cfg.minDayNetRs != null) {
    const modes = new Set(Object.values(cfg.primary));
    const today = book.fills.filter((f) => f.day === day && modes.has(f.mode));
    const dayNet = today.reduce((s, f) => s + (f.rs || 0), 0);
    if (cfg.minDayNetRs != null && dayNet >= cfg.minDayNetRs) {
      return `banked \u20B9${cfg.minDayNetRs} today`;
    }
    if (cfg.maxWinsPerDay != null && today.filter((f) => f.rs > 0).length >= cfg.maxWinsPerDay) {
      return `banked ${cfg.maxWinsPerDay} wins today`;
    }
    if (cfg.maxTradesPerDay != null && today.length >= cfg.maxTradesPerDay) {
      return `max ${cfg.maxTradesPerDay} trade${cfg.maxTradesPerDay === 1 ? "" : "s"} today`;
    }
  }
  if (cfg.dayStops !== false) {
    if ((book.lossesToday || 0) >= LIVE_PAPER_MAX_LOSSES) return `day stop: ${LIVE_PAPER_MAX_LOSSES} losses`;
    if (book.cooldownUntil != null && atMin < book.cooldownUntil) return "cooldown after loss";
  }
  if (book.fund <= 0) return "fund empty";
  return null;
}
function openAt(book, cfg, dir, entry, mode, atMin, day) {
  const block = canOpen(book, cfg, atMin, day);
  if (block) {
    book.reason = block;
    book.status = "watching";
    book.pendingDir = 0;
    return;
  }
  const d = dir === 1 ? 1 : -1;
  book.side = d === 1 ? "long" : "short";
  book.entry = entry;
  if (cfg.kind === "eq" || cfg.kind === "fut") {
    const stop = entry * (cfg.stopPct || 15e-4);
    const tgt = entry * (cfg.targetPct || 25e-4);
    book.sl = Math.round((entry - d * stop) * 100) / 100;
    book.tp = Math.round((entry + d * tgt) * 100) / 100;
    book.scratch = book.sl;
    book.lot = cfg.qty || book.lot;
  } else if (isOptionBuy(cfg)) {
    book.sl = Math.max(0.05, entry - cfg.sl);
    book.tp = entry + cfg.tp;
    book.scratch = book.sl;
  } else {
    book.sl = entry - d * cfg.sl;
    book.tp = entry + d * cfg.tp;
    book.scratch = entry - d * cfg.scratch;
  }
  book.mode = mode;
  book.status = "open";
  book.reason = "open";
  book.entryMin = atMin + (cfg.barMinutes ?? 5);
  book.pendingDir = 0;
  book.pendingSig = 0;
  book.pendingMode = "";
}
function pickSignal(bars, i, cfg, structure) {
  const primary = cfg.primary[structure];
  if (primary) {
    const dir = bookSignal(primary, bars, i, cfg);
    if (dir) return { dir, mode: primary };
  }
  for (const alt of cfg.backup[structure] || []) {
    const dir = bookSignal(alt, bars, i, cfg);
    if (dir) return { dir, mode: alt };
  }
  return { dir: 0, mode: primary || "stand" };
}
function tickBook(book, cfg, bars, last, day, nowMin, instrument, optionBars = [], exec = {}) {
  const next = {
    ...book,
    fills: [...book.fills],
    instrument: instrument || book.instrument
  };
  const done = completedBars(bars, day, nowMin, cfg.barMinutes ?? 5);
  if (cfg.strategy === "momentum" && done.length) {
    const g = done[done.length - 1].day === day ? momentumGauge(done, done.length - 1) : null;
    next.gauge = g ? {
      move: Math.round(g.move * 10) / 10,
      need: Math.round((cfg.momK ?? 1.5) / 1.5 * g.need * 10) / 10,
      barMin: done[done.length - 1].min,
      sessionBars: g.sessionBars
    } : null;
  }
  if (nowMin >= cfg.orE) {
    const st = morningStructure(done, day, cfg.orS, cfg.orE, cfg.quietW);
    if (st !== "stand" || next.structure === "wait" || !next.structure) next.structure = st;
  }
  if (exec.blockOpen && next.side === "flat" && next.pendingDir) {
    next.pendingDir = 0;
    next.pendingSig = 0;
    next.pendingMode = "";
    next.status = "watching";
    next.reason = exec.blockOpen;
  }
  const fillsBefore = next.fills.length;
  const barMin = cfg.barMinutes ?? 5;
  const sellPx = isOptionBuy(cfg) && exec.bid != null && exec.bid > 0 ? exec.bid : last;
  if (next.side === "long" || next.side === "short") {
    const exitBars = isOptionBuy(cfg) ? completedBars(optionBars, day, nowMin, barMin) : done;
    for (const bar of exitBars) {
      if (bar.day !== day || bar.min <= next.lastBarMin) continue;
      if (isOptionBuy(cfg) && next.entryMin != null && bar.min <= next.entryMin) {
        next.lastBarMin = bar.min;
        continue;
      }
      if (hitExit(next, bar.high, bar.low, bar.close, cfg, day, bar.open, nowMin, exec.bid)) {
        next.lastBarMin = bar.min;
        break;
      }
      next.lastBarMin = bar.min;
    }
    if ((next.side === "long" || next.side === "short") && nowMin >= cfg.flat && last != null) {
      closeAt(next, cfg, sellPx ?? last, "eod", day, nowMin);
    }
    if ((next.side === "long" || next.side === "short") && cfg.holdBars != null && next.entryMin != null && nowMin >= next.entryMin + cfg.holdBars * barMin && last != null) {
      closeAt(next, cfg, sellPx ?? last, "time", day, nowMin);
    }
    const tickExitPx = sellPx ?? last;
    const tooSoon = isOptionBuy(cfg) && next.entryMin != null && nowMin <= next.entryMin + barMin;
    const bid = exec.bid != null && exec.bid > 0 ? exec.bid : null;
    const bidThrough = isOptionBuy(cfg) && bid != null && (next.sl != null && bid <= next.sl || next.scratch != null && bid <= next.scratch || next.tp != null && bid >= next.tp);
    const barsHandleExit = isOptionBuy(cfg) && optionBars.length > 0 && !bidThrough;
    if ((next.side === "long" || next.side === "short") && tickExitPx != null && !tooSoon && !barsHandleExit) {
      hitExit(next, tickExitPx, tickExitPx, tickExitPx, cfg, day, tickExitPx, nowMin, exec.bid);
    }
  }
  const closedNow = next.fills.slice(fillsBefore);
  if (closedNow.length) {
    const losses = closedNow.filter((f) => f.rs < 0).length;
    if (losses) {
      next.lossesToday = (next.lossesToday || 0) + losses;
      next.cooldownUntil = nowMin + LIVE_PAPER_COOLDOWN_MIN;
    }
    const today = done.filter((b) => b.day === day);
    if (today.length) next.lastBarMin = Math.max(next.lastBarMin, today[today.length - 1].min);
  }
  if (next.side === "flat" && !closedNow.length) {
    const barMin2 = cfg.barMinutes ?? 5;
    if (next.lastBarMin < 0) next.lastBarMin = nowMin - LIVE_PAPER_MAX_SIGNAL_AGE_MIN - 1;
    for (let i = 0; i < done.length; i++) {
      const bar = done[i];
      if (bar.day !== day || bar.min <= next.lastBarMin) continue;
      next.lastBarMin = bar.min;
      const stale = nowMin - (bar.min + barMin2) > LIVE_PAPER_MAX_SIGNAL_AGE_MIN;
      if (next.pendingDir) {
        if (nowMin >= cfg.flat || stale) {
          next.pendingDir = 0;
          next.pendingSig = 0;
          next.pendingMode = "";
          next.status = "watching";
          next.reason = nowMin >= cfg.flat ? "session closed" : `missed confirm at ${hhmm(bar.min)} (desk was not checking)`;
          continue;
        }
        if (exec.blockOpen) {
          next.pendingDir = 0;
          next.pendingSig = 0;
          next.pendingMode = "";
          next.status = "watching";
          next.reason = exec.blockOpen;
          continue;
        }
        const ok = next.pendingDir === 1 ? bar.close > bar.open && bar.close > next.pendingSig : bar.close < bar.open && bar.close < next.pendingSig;
        if (ok) {
          openAt(next, cfg, next.pendingDir, bar.open, next.pendingMode || next.mode, bar.min, day);
        } else {
          next.pendingDir = 0;
          next.pendingSig = 0;
          next.status = "watching";
          next.reason = "confirm failed";
        }
        if (next.side !== "flat") break;
        continue;
      }
      if (bar.min < cfg.entryS || bar.min > cfg.flat - 30) continue;
      if (nowMin >= cfg.flat) {
        next.reason = "session closed";
        continue;
      }
      const st = next.structure === "wait" ? "stand" : next.structure;
      const hit = pickSignal(done, i, cfg, st);
      if (!hit.dir) continue;
      if (stale) {
        next.reason = `missed ${hit.dir === 1 ? "up" : "down"} signal at ${hhmm(bar.min + 5)} (desk was not checking)`;
        continue;
      }
      if (cfg.skipStructures?.includes(st)) {
        next.reason = `skipped: ${st} morning`;
        continue;
      }
      const blocked = canOpen(next, cfg, bar.min, day) || exec.blockOpen || null;
      if (blocked) {
        next.reason = blocked;
        continue;
      }
      const mix = mixGate(done, i, cfg, hit, st);
      if (!mix.ok) {
        next.reason = mix.reason;
        continue;
      }
      const gapMin = cfg.minGapMin ?? (cfg.minGapBars != null ? cfg.minGapBars * barMin2 : null);
      if (gapMin != null) {
        if (next.lastSignalMin != null && next.lastSignalMin >= 0 && bar.min - next.lastSignalMin <= gapMin) continue;
        next.lastSignalMin = bar.min;
      }
      if (cfg.noConfirm) {
        next.mode = hit.mode;
        openAt(next, cfg, hit.dir, bar.close, hit.mode, bar.min, day);
        if (next.side !== "flat") break;
        continue;
      }
      next.pendingDir = hit.dir;
      next.pendingSig = bar.close;
      next.pendingMode = hit.mode;
      next.mode = hit.mode;
      next.status = "pending";
      next.reason = `confirm ${hit.mode}`;
    }
  }
  markLive(next, next.side !== "flat" && isOptionBuy(cfg) && sellPx != null ? sellPx : last, cfg);
  next.capitalUsed = capitalUsedOf(cfg, next);
  return next;
}
function summarizePaper(books, extra) {
  const liveRs = Math.round(books.reduce((s, b) => s + (b.side === "flat" ? 0 : b.liveRs), 0) * 10) / 10;
  const closedRs = Math.round(books.reduce((s, b) => s + b.closedRs, 0) * 10) / 10;
  const fundsLine = extra.kiteFunds ? `Kite equity \u20B9${extra.kiteFunds.equityCash.toLocaleString("en-IN")} \xB7 commodity \u20B9${extra.kiteFunds.commodityCash.toLocaleString("en-IN")}. ` : "";
  const live = !!extra.liveOrders;
  return {
    assumed: true,
    liveOrders: live,
    guaranteed: false,
    armedOnCrudeBest: false,
    running: extra.running,
    day: extra.day,
    startedAt: extra.startedAt,
    asOf: extra.asOf,
    source: extra.source,
    kiteFunds: extra.kiteFunds,
    kiteError: extra.kiteError,
    books,
    liveRs,
    closedRs,
    honest: live ? `Paper always records. LIVE Kite also sends a 1 lot MARKET buy and a resting SL on ticked books. A Kite reject does not drop the paper fill. Motto: buy CE/PE. ${fundsLine}${PAPER_TEST_HONEST}` : `Paper always records, Live on or off. No Kite order until Live Kite is selected and a book is ticked. Each book takes 1 lot at the live ask and shows that cash. Motto: buy CE/PE. SL, target, and live P/L come from the option. ${fundsLine}${PAPER_TEST_HONEST}`
  };
}

// ../palagai/src/app/core/paper-desk/paper-live-order.util.ts
var PAPER_LIVE_UNDERS = ["nifty", "bank", "sensex", "crude"];
function paperLiveArmed(live, books) {
  return !!live && PAPER_LIVE_UNDERS.some((u) => !!books[u]);
}
function paperLiveArmedFor(live, books, under) {
  return !!live && !!books[under];
}
function keepPaperOnKite(paper, kite) {
  return {
    ...paper,
    kiteBuyOrderId: kite.kiteBuyOrderId ?? paper.kiteBuyOrderId,
    kiteSlOrderId: kite.kiteSlOrderId ?? paper.kiteSlOrderId,
    kiteNote: kite.kiteNote ?? paper.kiteNote,
    kiteHalt: kite.kiteHalt ?? paper.kiteHalt
  };
}

// ../palagai/src/app/core/paper-desk/signal-card.util.ts
var MODE_REASON = {
  pdhl: "Index closed beyond the previous-day high/low in the signal direction (trend continuation).",
  fade: "Index swept the opening-range edge, closed back inside and reversed (range fade).",
  orb_fade: "Index swept the opening-range edge, closed back inside and reversed (opening-range fade).",
  trap: "Index swept a 6-bar swing extreme and closed back inside (liquidity trap reversal).",
  vwap_fade: "Index stretched away from its session average and the bar reversed toward it (mean reversion).",
  orb_break: "Index closed beyond the opening range in the signal direction (opening-range breakout).",
  pdhl_fade: "Previous-day break or opening-range fade.",
  fade_trap: "Opening-range fade or swing trap.",
  all_three: "Previous-day break, opening-range fade or swing trap."
};
var STRUCTURE_REASON = {
  trend: "Morning opening range resolved into a trend.",
  range: "Morning opening range stayed inside a range.",
  quiet: "Morning opening range was narrow (quiet session).",
  stand: "Morning structure not yet decided.",
  wait: "Morning structure not yet decided."
};
function r2(n) {
  return Math.round(n * 100) / 100;
}
function buildSignalCard(i) {
  const risk = Math.max(0, i.entry - i.sl) * i.qty + optionRoundTripCharges(i.entry, i.sl, i.qty, i.venue);
  const reward = Math.max(0, i.tp - i.entry) * i.qty - optionRoundTripCharges(i.entry, i.tp, i.qty, i.venue);
  const rewardRisk = risk > 0 ? r2(reward / risk) : null;
  const checks = [
    { label: "Morning structure decided", pass: i.structure !== "wait" && i.structure !== "stand" },
    { label: "Primary rule for this structure", pass: i.primaryRule },
    { label: "Confirmation candle agreed", pass: true },
    { label: "Inside entry window", pass: i.entryMinute >= i.entryStartMin && i.entryMinute <= i.flatMin - 30 },
    { label: "Live ask on a listed contract", pass: i.liveAsk && i.premiumCostRs > 0 },
    { label: "Day-loss headroom left", pass: i.dayClosedRs > -i.dayLossCapRs / 2 },
    { label: "Reward at least 1.5x risk", pass: rewardRisk != null && rewardRisk >= 1.5 },
    {
      label: "Bid/ask spread under 3%",
      pass: i.spreadPct != null && i.spreadPct <= 0.03
    }
  ];
  const passed = checks.filter((c) => c.pass).length;
  const reasons = [
    MODE_REASON[i.mode] ?? `Rule ${i.mode}.`,
    STRUCTURE_REASON[i.structure] ?? "",
    i.primaryRule ? "Rule is the primary one for this structure." : "Rule is a backup for this structure.",
    i.spreadPct == null ? "No bid/ask was observed at entry; cost is modelled." : `Observed spread ${r2(i.spreadPct * 100)}% of premium.`
  ].filter(Boolean);
  return {
    ruleScore: Math.round(passed / checks.length * 100),
    checks,
    reasons,
    entry: i.entry,
    sl: i.sl,
    tp: i.tp,
    qty: i.qty,
    riskRs: r2(risk),
    rewardRs: r2(reward),
    rewardRisk
  };
}

// ../palagai/src/app/core/paper-desk/paper-tick.run.ts
var UNDERS = ["crude", "nifty", "bank", "sensex"];
var NO_BUDGET_CAP = 1e7;
async function runPaperTick(io) {
  const now = io.now || /* @__PURE__ */ new Date();
  const day = istDay(now);
  const nowMin = istMinutes(now);
  const raw = io.session.day === day ? io.session : emptySession(day, now.toISOString());
  const cur = { ...raw, books: raw.books.map(replayBudgetSkips) };
  const [margins, csv] = await Promise.all([io.fetchMargins(), io.fetchCsv()]);
  const funds = margins ? parseFunds(margins) : cur.kiteFunds;
  const dump = String(csv || "");
  const chain = parseKiteInstrumentsCsv(dump);
  const crude = findCrudeMini(dump, day);
  const nifty = findNamed(dump, ["NIFTY 50"]) || { tradingSymbol: "NIFTY 50", token: 256265, exchange: "NSE" };
  const bank = findNamed(dump, ["NIFTY BANK"]) || { tradingSymbol: "NIFTY BANK", token: 260105, exchange: "NSE" };
  const sensex = findNamed(dump, ["SENSEX"]) || { tradingSymbol: "SENSEX", token: 265, exchange: "BSE" };
  const underKeys = [
    crude ? `MCX:${crude.tradingSymbol}` : "",
    "NSE:NIFTY 50",
    "NSE:NIFTY BANK",
    "BSE:SENSEX"
  ].filter(Boolean);
  const openOptKeys = cur.books.filter((b) => b.side !== "flat" && b.optionSymbol).map((b) => optionKey(b));
  const keys = [.../* @__PURE__ */ new Set([...underKeys, ...openOptKeys])];
  let quotes = keys.length ? await io.fetchQuotes(keys) || {} : {};
  const cheapByUnder = /* @__PURE__ */ new Map();
  const cheapKeys = [];
  const asOfCfg = LIVE_PAPER_BOOKS[0];
  for (const under of UNDERS) {
    const inst = instOf(under, crude, nifty, bank, sensex);
    const spot = lastPrice(quotes, under, inst?.tradingSymbol || "") ?? 0;
    const pair = cheapPair(chain, under, spot, pickAsOf(asOfCfg, now), asOfCfg.atm ? 0 : void 0);
    cheapByUnder.set(under, pair);
    for (const pick of [pair.ce, pair.pe]) {
      if (pick.instrument.instrumentToken > 0) {
        cheapKeys.push(`${pick.instrument.exchange}:${pick.instrument.tradingSymbol}`);
      }
    }
  }
  const extraKeys = [...new Set(cheapKeys.filter((k) => !keys.includes(k)))];
  if (extraKeys.length) {
    quotes = { ...quotes, ...await io.fetchQuotes(extraKeys) || {} };
  }
  const from = shiftDay(day, -8);
  const barCache = /* @__PURE__ */ new Map();
  for (const under of UNDERS) {
    const inst = instOf(under, crude, nifty, bank, sensex);
    let bars = [];
    if (inst?.token) {
      const candles = await io.fetchHistorical(String(inst.token), "minute", from, day);
      bars = (candles || []).map(kiteBar).filter((b) => b.day);
    }
    barCache.set(under, bars);
  }
  const nextById = /* @__PURE__ */ new Map();
  for (const cfg of paperTickOrder(LIVE_PAPER_BOOKS)) {
    const under = underOf(cfg.id);
    const inst = instOf(under, crude, nifty, bank, sensex);
    const prev = cur.books.find((b) => b.id === cfg.id) || emptySession(day).books.find((b) => b.id === cfg.id);
    const bars = barCache.get(under) || [];
    const underLast = lastPrice(quotes, under, inst?.tradingSymbol || "");
    const optQuote = prev.optionSymbol ? findQuote(quotes, optionKey(prev)) : null;
    const optLast = optQuote ? lastByKey(quotes, optionKey(prev)) : null;
    const { bid: optBid, ask: optAsk } = bestBidAsk(optQuote);
    const lastForTick = optionMarkLast({
      buyOption: !!cfg.buyOption,
      side: prev.side,
      optionSymbol: prev.optionSymbol,
      optLast,
      prevLast: prev.last,
      underLast
    });
    let optionBars = [];
    if (prev.side !== "flat" && prev.optionToken) {
      const candles = await io.fetchHistorical(String(prev.optionToken), cfg.barMinutes === 1 ? "minute" : "5minute", day, day).catch(() => []);
      optionBars = (candles || []).map(kiteBar).filter((b) => b.day);
    }
    const peers = LIVE_PAPER_BOOKS.map(
      (c) => nextById.get(c.id) || cur.books.find((b) => b.id === c.id) || emptySession(day).books.find((b) => b.id === c.id)
    );
    let next = tickBook(
      prev,
      cfg,
      bars,
      lastForTick,
      day,
      nowMin,
      prev.optionSymbol || inst?.tradingSymbol || cfg.label,
      optionBars,
      { bid: optBid, ask: optAsk, blockOpen: indexDeskBlockReason(cfg.id, peers, day) }
    );
    if (cfg.buyOption && needsOption(next)) {
      const spot = underLast ?? (next.optionSymbol ? next.last : null) ?? 0;
      const pair = cheapByUnder.get(under);
      next = await bindCheap(next, cfg, chain, spot, quotes, nowMin, io, pair, now);
    }
    if (cfg.buyOption && next.side !== "flat" && !next.optionSymbol) {
      next = {
        ...next,
        side: "flat",
        entry: null,
        sl: null,
        tp: null,
        scratch: null,
        livePts: 0,
        liveRs: 0,
        status: "watching",
        reason: "skipped: no option fill"
      };
    } else if (next.side !== "flat" && next.optionSymbol && optLast != null) {
      const mark = optBid != null && optLast < optBid ? optBid : optLast;
      next = { ...next, last: mark };
    }
    if (next.fills.length > prev.fills.length && prev.optionSymbol) {
      const q = findQuote(quotes, optionKey(prev));
      const { bid, ask } = bestBidAsk(q);
      const stamp = now.toISOString();
      const fills = next.fills.map(
        (f, idx) => idx >= prev.fills.length ? { ...f, exitBid: bid, exitAsk: ask, exitAt: stamp } : f
      );
      next = { ...next, fills };
    }
    const underQuote = findQuote(quotes, underKeyFor(under, inst?.tradingSymbol, inst?.exchange));
    nextById.set(cfg.id, {
      ...next,
      ...neededFields(cheapByUnder.get(under), quotes),
      quoteAt: quoteStamp(underQuote) || next.quoteAt || ""
    });
  }
  const books = LIVE_PAPER_BOOKS.map((c) => nextById.get(c.id) || cur.books.find((b) => b.id === c.id));
  return summarizePaper(books, {
    running: true,
    day,
    startedAt: cur.startedAt || now.toISOString(),
    asOf: now.toISOString(),
    source: "kite",
    kiteFunds: funds,
    kiteError: null,
    liveOrders: paperLiveArmed(io.live, io.liveBooks)
  });
}
async function bindCheap(book, cfg, chain, spot, quotes, nowMin, io, pair, now) {
  const id = underOf(cfg.id);
  const pick = (book.side === "long" ? pair?.ce : pair?.pe) || pickCheapOtm({
    instruments: chain,
    book: id,
    direction: book.side === "long" ? "BUY" : "SELL",
    spot,
    asOf: pickAsOf(cfg, now),
    premiumBudgetRs: NO_BUDGET_CAP,
    otmPts: cfg.atm ? 0 : void 0
  });
  const listed = pick.instrument.instrumentToken > 0;
  const key = `${pick.instrument.exchange}:${pick.instrument.tradingSymbol}`;
  const q = listed ? findQuote(quotes, key) : null;
  const { bid, ask } = bestBidAsk(q);
  const liveLast = listed ? lastByKey(quotes, key) : null;
  const fill = liveBuyPrice(ask, liveLast);
  const flat = (reason, skip) => ({
    ...book,
    side: "flat",
    entry: null,
    sl: null,
    tp: null,
    scratch: null,
    status: "watching",
    reason,
    livePts: 0,
    liveRs: 0,
    skips: [...book.skips || [], skip].slice(-100)
  });
  if (bid != null && ask != null && ask > 0) {
    const mid2 = (bid + ask) / 2;
    if (mid2 > 0 && (ask - bid) / mid2 > MIX_SPREAD_PCT) {
      return flat("skipped: spread over 3%", {
        at: now.toISOString(),
        day: istDay(now),
        book: cfg.id,
        side: pick.side,
        mode: book.mode,
        structure: book.structure,
        contract: pick.instrument.tradingSymbol,
        premium: fill.price,
        lot: pick.lotSize,
        costRs: null,
        budgetRs: 0,
        reason: "spread-over-3pct"
      });
    }
  }
  if (!listed || fill.price == null) {
    const skip = {
      at: now.toISOString(),
      day: istDay(now),
      book: cfg.id,
      side: pick.side,
      mode: book.mode,
      structure: book.structure,
      contract: listed ? `${pick.instrument.tradingSymbol}` : `${pick.side} ${pick.strike} (not listed)`,
      premium: null,
      lot: pick.lotSize,
      costRs: null,
      budgetRs: 0,
      reason: listed ? "no-live-quote" : "no-listed-contract"
    };
    return flat(listed ? "skipped: no live quote" : "skipped: no listed contract", skip);
  }
  const prem = fill.price;
  const cost = lotCostRs(prem, pick.lotSize);
  const range = await optionRange(pick.instrument.instrumentToken, istDay(now), nowMin, io);
  const stop = optionBoundStops(cfg, prem, pick.lotSize, range);
  const stopPts = Math.min(stop.sl, prem - 0.05);
  const riskRs = Math.round(
    (stopPts * pick.lotSize + optionRoundTripCharges(prem, prem - stopPts, pick.lotSize, venueForBook(cfg.under || cfg.id))) * 10
  ) / 10;
  if (cfg.dayStops !== false && book.closedRs < 0 && -book.closedRs > riskRs) {
    return flat(`day stop: today \u2212\u20B9${Math.abs(book.closedRs)} > one stop \u20B9${riskRs}`, {
      at: now.toISOString(),
      day: istDay(now),
      book: cfg.id,
      side: pick.side,
      mode: book.mode,
      structure: book.structure,
      contract: pick.instrument.tradingSymbol,
      premium: prem,
      lot: pick.lotSize,
      costRs: riskRs,
      budgetRs: 0,
      reason: "day-stop"
    });
  }
  pick.lastPrice = prem;
  pick.openCostRs = cost;
  pick.fitsBudget = true;
  const bound = bindOptionFill(book, cfg, prem, pick, range, nowMin);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
  const spreadPct = mid != null && mid > 0 ? (ask - bid) / mid : null;
  const signal = bound.entry != null && bound.sl != null && bound.tp != null ? buildSignalCard({
    book: cfg.id,
    venue: venueForBook(cfg.under || cfg.id),
    mode: bound.mode,
    structure: bound.structure,
    primaryRule: cfg.primary[bound.structure === "wait" ? "stand" : bound.structure] === bound.mode,
    entry: bound.entry,
    sl: bound.sl,
    tp: bound.tp,
    qty: pick.lotSize,
    premiumCostRs: cost,
    liveAsk: fill.atAsk,
    spreadPct,
    entryMinute: nowMin,
    entryStartMin: cfg.entryS,
    flatMin: cfg.flat,
    dayClosedRs: book.closedRs,
    dayLossCapRs: (cfg.dayStops === false ? cfg.maxTradesPerDay || 3 : 2) * riskRs
  }) : null;
  return { ...bound, entryBid: bid, entryAsk: ask, entryAt: now.toISOString(), signal };
}
async function optionRange(token, day, nowMin, io) {
  if (!(token > 0)) return null;
  const candles = await io.fetchHistorical(String(token), "5minute", shiftDay(day, -3), day).catch(() => []);
  const bars = (candles || []).map(kiteBar).filter((b) => b.day);
  return optionRangePts(completedBars(bars, day, nowMin));
}
function nextExpiryAsOf(asOf) {
  return new Date(asOf.getTime() + 24 * 60 * 60 * 1e3);
}
function pickAsOf(cfg, asOf) {
  return cfg.expiryAfterTomorrow === false ? asOf : nextExpiryAsOf(asOf);
}
function cheapPair(chain, book, spot, asOf, otmPts) {
  return {
    ce: pickCheapOtm({
      instruments: chain,
      book,
      direction: "BUY",
      spot,
      asOf,
      premiumBudgetRs: NO_BUDGET_CAP,
      otmPts
    }),
    pe: pickCheapOtm({
      instruments: chain,
      book,
      direction: "SELL",
      spot,
      asOf,
      premiumBudgetRs: NO_BUDGET_CAP,
      otmPts
    })
  };
}
function neededFields(pair, quotes) {
  if (!pair) {
    return { neededCeRs: null, neededCe: "", neededPeRs: null, neededPe: "", neededLot: 0, neededAtAsk: false };
  }
  const quoteOf = (pick) => {
    if (pick.instrument.instrumentToken <= 0) return null;
    const key = `${pick.instrument.exchange}:${pick.instrument.tradingSymbol}`;
    const { ask } = bestBidAsk(findQuote(quotes, key));
    return neededLotQuote(pick.instrument.tradingSymbol, pick.lotSize, ask, lastByKey(quotes, key));
  };
  const ce = quoteOf(pair.ce);
  const pe = quoteOf(pair.pe);
  return {
    neededCe: ce?.contract || pair.ce.instrument.tradingSymbol || "",
    neededCeRs: ce?.costRs ?? null,
    neededPe: pe?.contract || pair.pe.instrument.tradingSymbol || "",
    neededPeRs: pe?.costRs ?? null,
    neededLot: ce?.lot || pe?.lot || pair.ce.lotSize || pair.pe.lotSize || 0,
    neededAtAsk: !!(ce?.atAsk || pe?.atAsk)
  };
}
function parseFunds(payload) {
  const already = payload;
  if (already && typeof already === "object" && Number.isFinite(Number(already.equityCash))) {
    return {
      equityCash: Math.round(Number(already.equityCash) || 0),
      equityNet: Math.round(Number(already.equityNet) || 0),
      commodityCash: Math.round(Number(already.commodityCash) || 0),
      commodityNet: Math.round(Number(already.commodityNet) || 0)
    };
  }
  const root = payload?.data || {};
  const pocket = (seg) => {
    const a = seg?.available || {};
    const live = Number(a.live_balance);
    if (Number.isFinite(live) && live > 0) return Math.round(live);
    const cash = Number(a.cash);
    if (Number.isFinite(cash) && cash > 0) return Math.round(cash);
    return Math.round(Number(seg?.net) || 0);
  };
  return {
    equityCash: pocket(root.equity),
    equityNet: Math.round(Number(root.equity?.net) || 0),
    commodityCash: pocket(root.commodity),
    commodityNet: Math.round(Number(root.commodity?.net) || 0)
  };
}
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
function findCrudeMini(csv, today) {
  const rows = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const cols = splitCsvLine2(line);
    if (cols.length < 12) continue;
    if (cols[11].trim().toUpperCase() !== "MCX" || cols[9].trim().toUpperCase() !== "FUT") continue;
    if (!cols[2].toUpperCase().startsWith("CRUDEOILM")) continue;
    rows.push({
      token: Number(cols[0]) || 0,
      tradingSymbol: cols[2].trim(),
      exchange: "MCX",
      expiry: (cols[5] || "").slice(0, 10)
    });
  }
  rows.sort((a, b) => a.expiry.localeCompare(b.expiry));
  return rows.find((r) => !r.expiry || r.expiry > today) || null;
}
function findNamed(csv, names) {
  const want = names.map((n) => n.toUpperCase());
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const cols = splitCsvLine2(line);
    if (cols.length < 12) continue;
    const sym = cols[2].trim().toUpperCase();
    const name = cols[3].trim().toUpperCase();
    if (want.includes(sym) || want.includes(name)) {
      return { tradingSymbol: cols[2].trim(), token: Number(cols[0]) || 0, exchange: cols[11].trim() };
    }
  }
  return null;
}
function kiteBar(row) {
  const raw = String(row[0] || "");
  const d = new Date(raw);
  const ist = new Date(d.getTime() + 330 * 60 * 1e3);
  const day = raw.slice(0, 10);
  const hh = Number.isNaN(d.getTime()) ? Number(raw.slice(11, 13)) : ist.getUTCHours();
  const mm = Number.isNaN(d.getTime()) ? Number(raw.slice(14, 16)) : ist.getUTCMinutes();
  return {
    day,
    min: hh * 60 + mm,
    open: Number(row[1]) || 0,
    high: Number(row[2]) || 0,
    low: Number(row[3]) || 0,
    close: Number(row[4]) || 0
  };
}
function needsOption(next) {
  return next.side !== "flat" && !next.optionSymbol;
}
function optionMarkLast(args) {
  if (!args.buyOption) return args.underLast;
  if (args.side !== "flat" && args.optionSymbol) return args.optLast ?? args.prevLast;
  if (args.side !== "flat") return args.prevLast;
  return args.underLast;
}
function instOf(under, crude, nifty, bank, sensex) {
  return under === "crude" ? crude : under === "nifty" ? nifty : under === "bank" ? bank : sensex;
}
function optionKey(book) {
  const under = underOf(book.id);
  const ex = under === "crude" ? "MCX" : under === "sensex" ? "BFO" : "NFO";
  return `${ex}:${book.optionSymbol}`;
}
function underKeyFor(id, symbol, exchange) {
  if (id === "nifty") return "NSE:NIFTY 50";
  if (id === "bank") return "NSE:NIFTY BANK";
  if (id === "sensex") return "BSE:SENSEX";
  return `${exchange || "MCX"}:${symbol || ""}`;
}
function findQuote(quotes, key) {
  const want = key.toUpperCase();
  for (const [k, v] of Object.entries(quotes)) {
    if (k.toUpperCase() === want) return v;
  }
  return null;
}
function bestBidAsk(q) {
  const bid = Number(q?.depth?.buy?.[0]?.price);
  const ask = Number(q?.depth?.sell?.[0]?.price);
  return {
    bid: Number.isFinite(bid) && bid > 0 ? bid : null,
    ask: Number.isFinite(ask) && ask > 0 ? ask : null
  };
}
function quoteStamp(q) {
  return String(q?.timestamp || q?.last_trade_time || "");
}
function lastByKey(quotes, key) {
  const want = key.toUpperCase();
  for (const [k, v] of Object.entries(quotes)) {
    if (k.toUpperCase() === want || k.toUpperCase().endsWith(want.split(":")[1] || "")) {
      const n = Number(v.last_price);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}
function lastPrice(quotes, id, symbol) {
  for (const [k, v] of Object.entries(quotes)) {
    const key = k.toUpperCase();
    if (id === "crude" && key.includes("CRUDEOILM") && !key.includes("CE") && !key.includes("PE")) {
      return Number(v.last_price) || null;
    }
    if (id === "nifty" && key.includes("NIFTY 50")) return Number(v.last_price) || null;
    if (id === "bank" && key.includes("BANK")) return Number(v.last_price) || null;
    if (id === "sensex" && key.includes("SENSEX")) return Number(v.last_price) || null;
    if (symbol && key.includes(symbol.toUpperCase())) return Number(v.last_price) || null;
  }
  return null;
}
function shiftDay(day, delta) {
  const d = /* @__PURE__ */ new Date(`${day}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + delta);
  return istDay(d);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LIVE_PAPER_BOOKS,
  emptySession,
  istDay,
  keepPaperOnKite,
  paperLiveArmedFor,
  runPaperTick,
  underOf
});
