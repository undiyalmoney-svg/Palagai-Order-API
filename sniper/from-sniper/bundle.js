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
var SNIPER_CAPITAL_RS = 5e4;
var SNIPER_MAX_LOSS_RS = 100;
var SNIPER_BAR_MIN = 5;
var SNIPER_ENTRY_GRACE_MIN = 1;
var SNIPER_TICK_RS = 0.05;
var SNIPER_DAY_FLOOR_RS = 25e3;
var SNIPER_BOOKS = [
  {
    id: "nifty",
    label: "Nifty 50",
    openMin: 9 * 60 + 15,
    lastEntryMin: 15 * 60 + 25,
    flatMin: 15 * 60 + 30,
    venue: "NSE",
    exchange: "NFO",
    underNames: ["NIFTY 50"],
    underExchange: "NSE"
  },
  {
    id: "bank",
    label: "Bank Nifty",
    openMin: 9 * 60 + 15,
    lastEntryMin: 15 * 60 + 25,
    flatMin: 15 * 60 + 30,
    venue: "NSE",
    exchange: "NFO",
    underNames: ["NIFTY BANK"],
    underExchange: "NSE"
  },
  {
    id: "sensex",
    label: "Sensex",
    openMin: 9 * 60 + 15,
    lastEntryMin: 15 * 60 + 25,
    flatMin: 15 * 60 + 30,
    venue: "BSE",
    exchange: "BFO",
    underNames: ["SENSEX"],
    underExchange: "BSE"
  },
  {
    id: "crude",
    label: "Crude Mini",
    openMin: 9 * 60,
    lastEntryMin: 23 * 60 + 25,
    flatMin: 23 * 60 + 30,
    venue: "MCX",
    exchange: "MCX",
    underNames: ["CRUDEOILM"],
    underExchange: "MCX"
  }
];
var SNIPER_HONEST = "5-Minute Sniper is an experiment, not Arise. Previous completed 5-minute candle: green buys ATM CE, red buys ATM PE, doji skips. Each of Nifty 50, Bank Nifty, Sensex and Crude Mini starts at \u20B950,000. Max loss \u20B9100 per ticket after Kite charges. Index 09:20\u201315:25 IST. Crude Mini 09:05\u201323:25 IST on MCX. Paper records on the droplet with the tab closed. Live Kite needs an extra confirm. Not a guaranteed profit.";

// ../palagai/src/app/core/sniper/sniper-clock.ts
function sniperIstDay(d = /* @__PURE__ */ new Date()) {
  const ist = new Date(d.getTime() + 330 * 60 * 1e3);
  return ist.toISOString().slice(0, 10);
}
function sniperIstMinutes(d = /* @__PURE__ */ new Date()) {
  const ist = new Date(d.getTime() + 330 * 60 * 1e3);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}
function sniperIntervalStart(cfg, nowMin) {
  if (nowMin < cfg.openMin + SNIPER_BAR_MIN) return cfg.openMin;
  const steps = Math.floor((nowMin - cfg.openMin) / SNIPER_BAR_MIN);
  return cfg.openMin + steps * SNIPER_BAR_MIN;
}
function sniperPrevCandleMin(cfg, nowMin) {
  return sniperIntervalStart(cfg, nowMin) - SNIPER_BAR_MIN;
}
function hhmm(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function completedSniperBars(bars, day, nowMin) {
  return bars.filter((b) => b.day < day || b.day === day && b.min + SNIPER_BAR_MIN <= nowMin);
}
function barAt(bars, day, min) {
  return bars.find((b) => b.day === day && b.min === min) || null;
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
function sniperSize(capital, premium, lotSize, venue) {
  const empty = { lots: 0, qty: 0, sl: 0, skip: "" };
  const lot = Math.floor(Number(lotSize) || 0);
  const px = Number(premium);
  if (!(lot > 0) || !(px > 0)) return { ...empty, skip: "invalid premium or lot" };
  const qty1 = lot;
  const cost1 = px * qty1;
  if (!(capital >= cost1)) return { ...empty, skip: "one lot does not fit capital" };
  const scratch = sniperCharges(px, px, qty1, venue).total;
  if (scratch >= SNIPER_MAX_LOSS_RS) return { ...empty, skip: "charges already at \u20B9100 risk" };
  let lots = 1;
  while (true) {
    const next = lots + 1;
    const qty2 = next * lot;
    if (px * qty2 > capital) break;
    const sl2 = stopPx(px, qty2, venue);
    if (!(sl2 > 0) || px - sl2 < SNIPER_TICK_RS) break;
    lots = next;
  }
  const qty = lots * lot;
  const sl = stopPx(px, qty, venue);
  if (!(sl > 0) || sl >= px) return { ...empty, skip: "cannot place a \u20B9100 stop on one lot" };
  return { lots, qty, sl: r22(sl), skip: "" };
}
function stopPx(entry, qty, venue) {
  let lo = SNIPER_TICK_RS;
  let hi = entry;
  let best = 0;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const net = sniperNetRs(entry, mid, qty, venue);
    if (net >= -SNIPER_MAX_LOSS_RS) {
      best = mid;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  if (!(best > 0)) return 0;
  const tick = SNIPER_TICK_RS;
  let sl = Math.floor(best / tick) * tick;
  while (sl < entry && sniperNetRs(entry, sl, qty, venue) < -SNIPER_MAX_LOSS_RS) {
    sl = r22(sl + tick);
  }
  if (sl >= entry || sniperNetRs(entry, sl, qty, venue) < -SNIPER_MAX_LOSS_RS) return 0;
  return r22(sl);
}

// ../palagai/src/app/core/sniper/sniper-engine.ts
function candleDir(bar) {
  if (bar.close > bar.open) return "green";
  if (bar.close < bar.open) return "red";
  return "doji";
}
function emptySniperBook(cfg, capital = SNIPER_CAPITAL_RS) {
  return {
    id: cfg.id,
    label: cfg.label,
    capital,
    peakCapital: capital,
    troughCapital: capital,
    side: "flat",
    dir: "",
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
    exception: false
  };
}
function emptySniperSession(day, asOf = (/* @__PURE__ */ new Date()).toISOString()) {
  return {
    day,
    running: false,
    mode: "paper",
    liveArmed: false,
    replayDay: "",
    startedAt: "",
    asOf,
    source: "idle",
    kiteError: null,
    honest: SNIPER_HONEST,
    books: SNIPER_BOOKS.map((cfg) => emptySniperBook(cfg)),
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
function skip(book, min, at, reason) {
  return {
    ...book,
    status: "watching",
    reason,
    skips: [...book.skips, { at, min, reason }].slice(-400)
  };
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
    dir: book.dir || "doji",
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
    dir: "",
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
    entryMin: null,
    entryAt: "",
    intervalEnd: null,
    underOpen: null,
    underClose: null,
    entryBid: null,
    entryAsk: null,
    last: exit,
    liveRs: 0,
    status: "watching",
    reason,
    capital,
    peakCapital: Math.max(book.peakCapital, capital),
    troughCapital: Math.min(book.troughCapital, capital),
    fills: [...book.fills, fill],
    kiteHalt: false,
    exception: reason === "exception"
  };
}
function tickSniperBook(book, cfg, bars, day, nowMin, nowIso, spot, opt, pick) {
  const next = { ...book, fills: [...book.fills], skips: [...book.skips] };
  const done = completedSniperBars(bars, day, nowMin);
  const bid = opt.bid;
  const ask = opt.ask;
  const last = opt.last;
  const mark = bid ?? last;
  if (next.side === "long" && next.entry != null) {
    markBook(next, mark, cfg.venue);
    const end = next.intervalEnd ?? (next.entryMin || 0) + SNIPER_BAR_MIN;
    if (mark == null) {
      if (nowMin >= end || nowMin >= cfg.flatMin) {
        next.exception = true;
        next.reason = "execution exception: no exit quote";
        next.status = "exception";
      }
      return next;
    }
    const net = sniperNetRs(next.entry, mark, next.qty, cfg.venue);
    if (net <= -SNIPER_MAX_LOSS_RS || next.sl != null && mark <= next.sl) {
      return closeFill(next, cfg, mark, nowMin, nowIso, day, "sl", bid, ask);
    }
    if (nowMin >= cfg.flatMin) {
      return closeFill(next, cfg, mark, nowMin, nowIso, day, "eod", bid, ask);
    }
    if (nowMin >= end) {
      return closeFill(next, cfg, mark, nowMin, nowIso, day, "time", bid, ask);
    }
    next.reason = `holding \xB7 ${hhmm(end)} exit \xB7 SL \u20B9${next.sl}`;
    next.status = "open";
    return next;
  }
  if (nowMin >= cfg.flatMin) {
    next.reason = "session closed";
    next.status = "watching";
    return next;
  }
  if (nowMin < cfg.openMin + SNIPER_BAR_MIN) {
    next.reason = `waiting first candle (${hhmm(cfg.openMin)}\u2013${hhmm(cfg.openMin + SNIPER_BAR_MIN)})`;
    return next;
  }
  if (nowMin > cfg.lastEntryMin + SNIPER_ENTRY_GRACE_MIN) {
    next.reason = "last entry passed";
    return next;
  }
  const slot = sniperIntervalStart(cfg, nowMin);
  if (slot < cfg.openMin + SNIPER_BAR_MIN || slot > cfg.lastEntryMin) {
    next.reason = "outside entry window";
    return next;
  }
  if (nowMin - slot > SNIPER_ENTRY_GRACE_MIN) {
    return skip(next, slot, nowIso, `missed ${hhmm(slot)} open (desk was not checking)`);
  }
  if (next.fills.some((f) => f.entryMin === slot) || next.skips.some((s) => s.min === slot)) {
    next.reason = next.reason || "slot already used";
    return next;
  }
  if (next.capital < SNIPER_DAY_FLOOR_RS) {
    return skip(next, slot, nowIso, `day floor \u20B9${SNIPER_DAY_FLOOR_RS}`);
  }
  const prevMin = sniperPrevCandleMin(cfg, nowMin);
  const candle = barAt(done, day, prevMin);
  if (!candle) {
    return skip(next, slot, nowIso, `skipped: no completed candle at ${hhmm(prevMin)}`);
  }
  const dir = candleDir(candle);
  if (dir === "doji") {
    return skip(next, slot, nowIso, `skipped: doji at ${hhmm(prevMin)}`);
  }
  if (spot == null || !(spot > 0)) {
    return skip(next, slot, nowIso, "skipped: no spot");
  }
  if (!pick || !pick.listed || !pick.optionSymbol) {
    return skip(next, slot, nowIso, "skipped: no listed ATM");
  }
  const fillPx = ask ?? last;
  if (fillPx == null || !(fillPx > 0)) {
    return skip(next, slot, nowIso, "skipped: no option quote");
  }
  const size = sniperSize(next.capital, fillPx, pick.lotSize, cfg.venue);
  if (!size.lots) {
    return skip(next, slot, nowIso, `skipped: ${size.skip}`);
  }
  next.side = "long";
  next.dir = dir;
  next.optionType = pick.optionType;
  next.strike = pick.strike;
  next.expiry = pick.expiry;
  next.optionSymbol = pick.optionSymbol;
  next.optionToken = pick.optionToken;
  next.lotSize = pick.lotSize;
  next.lots = size.lots;
  next.qty = size.qty;
  next.entry = fillPx;
  next.sl = size.sl;
  next.entryMin = slot;
  next.entryAt = nowIso;
  next.intervalEnd = slot + SNIPER_BAR_MIN;
  next.underOpen = candle.open;
  next.underClose = candle.close;
  next.entryBid = bid;
  next.entryAsk = ask;
  next.last = fillPx;
  next.status = "open";
  next.reason = `${dir} ${pick.optionType} ${pick.strike} \xB7 hold to ${hhmm(slot + SNIPER_BAR_MIN)}`;
  next.exception = false;
  markBook(next, fillPx, cfg.venue);
  return next;
}
function summarizeSniper(session, patch = {}) {
  const books = session.books.map((b) => ({
    ...b,
    peakCapital: Math.max(b.peakCapital, b.capital),
    troughCapital: Math.min(b.troughCapital, b.capital)
  }));
  return {
    ...session,
    ...patch,
    books,
    honest: SNIPER_HONEST,
    incomplete: books.some((b) => b.fills.some((f) => f.incomplete) || /no completed candle|no listed ATM|no option quote/.test(b.reason))
  };
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
function findCrudeMini(csv, today) {
  const rows = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const cols = splitCsvLine2(line);
    if (cols.length < 12) continue;
    if (cols[11].trim().toUpperCase() !== "MCX" || cols[9].trim().toUpperCase() !== "FUT") continue;
    if (!cols[2].toUpperCase().startsWith("CRUDEOILM")) continue;
    const exp = /^(\d{4}-\d{2}-\d{2})/.exec((cols[5] || "").trim());
    rows.push({
      token: Number(cols[0]) || 0,
      tradingSymbol: cols[2].trim(),
      exchange: "MCX",
      expiry: exp ? exp[1] : ""
    });
  }
  rows.sort((a, b) => a.expiry.localeCompare(b.expiry));
  return rows.find((r) => !r.expiry || r.expiry > today) || rows.find((r) => r.expiry >= today) || rows[0] || null;
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
function underKey(cfg, inst) {
  if (cfg.id === "nifty") return "NSE:NIFTY 50";
  if (cfg.id === "bank") return "NSE:NIFTY BANK";
  if (cfg.id === "sensex") return "BSE:SENSEX";
  return inst ? `MCX:${inst.tradingSymbol}` : "";
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
async function load5m(fetchHistorical, token, day) {
  if (!token) return [];
  const candles = await fetchHistorical(token, "5minute", day, day).catch(() => []);
  return (candles || []).map(asBar).filter((b) => b.day);
}
function atmPick(chain, cfg, dir, spot, asOf) {
  const picked = pickCheapOtm({
    instruments: chain,
    book: cfg.id,
    direction: dir === "green" ? "BUY" : "SELL",
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
  nifty: { tradingSymbol: "NIFTY 50", token: 256265, exchange: "NSE" },
  bank: { tradingSymbol: "NIFTY BANK", token: 260105, exchange: "NSE" },
  sensex: { tradingSymbol: "SENSEX", token: 265, exchange: "BSE" },
  crude: { tradingSymbol: "CRUDEOILM", token: 0, exchange: "MCX" }
};
async function runSniperTick(io) {
  const now = io.now || /* @__PURE__ */ new Date();
  const day = io.session.replayDay || sniperIstDay(now);
  const nowMin = sniperIstMinutes(now);
  const raw = io.session.day === day ? io.session : emptySniperSession(day, now.toISOString());
  const csv = String(await io.fetchCsv() || "");
  const chain = parseKiteInstrumentsCsv(csv);
  const named = {
    nifty: findNamed(csv, ["NIFTY 50"]) || FALLBACK.nifty,
    bank: findNamed(csv, ["NIFTY BANK"]) || FALLBACK.bank,
    sensex: findNamed(csv, ["SENSEX"]) || FALLBACK.sensex,
    crude: findCrudeMini(csv, day)
  };
  const underKeys = SNIPER_BOOKS.map((cfg) => underKey(cfg, named[cfg.id])).filter(Boolean);
  const openKeys = raw.books.filter((b) => b.side !== "flat" && b.optionSymbol).map((b) => optionKey(SNIPER_BOOKS.find((c) => c.id === b.id)?.exchange || "NFO", b.optionSymbol));
  let quotes = await io.fetchQuotes([.../* @__PURE__ */ new Set([...underKeys, ...openKeys])]);
  const barsBy = /* @__PURE__ */ new Map();
  await Promise.all(
    SNIPER_BOOKS.map(async (cfg) => {
      const inst = named[cfg.id];
      const bars = inst?.token ? await load5m(io.fetchHistorical, String(inst.token), day) : [];
      barsBy.set(cfg.id, bars);
    })
  );
  const extra = [];
  const picks = /* @__PURE__ */ new Map();
  for (const cfg of SNIPER_BOOKS) {
    const inst = named[cfg.id];
    const key = underKey(cfg, inst);
    const spot = lastOf(quotes, key);
    const book = raw.books.find((b) => b.id === cfg.id);
    const bars = completedSniperBars(barsBy.get(cfg.id) || [], day, nowMin);
    const signal = barAt(bars, day, sniperPrevCandleMin(cfg, nowMin));
    const dir = book?.side === "long" && book.optionType ? book.optionType === "CE" ? "green" : "red" : signal ? candleDir(signal) : null;
    if (spot && dir && dir !== "doji") {
      const pick = atmPick(chain, cfg, dir, spot, now);
      picks.set(cfg.id, pick);
      if (pick?.listed) extra.push(optionKey(cfg.exchange, pick.optionSymbol));
    } else {
      picks.set(cfg.id, null);
    }
  }
  const need = extra.filter((k) => !underKeys.includes(k) && !openKeys.includes(k));
  if (need.length) quotes = { ...quotes, ...await io.fetchQuotes(need) || {} };
  const books = SNIPER_BOOKS.map((cfg) => {
    const prev = raw.books.find((b) => b.id === cfg.id) || emptySniperSession(day).books.find((b) => b.id === cfg.id);
    const inst = named[cfg.id];
    const ukey = underKey(cfg, inst);
    const spot = lastOf(quotes, ukey);
    const pick = picks.get(cfg.id) || null;
    const okey = prev.optionSymbol ? optionKey(cfg.exchange, prev.optionSymbol) : pick?.listed ? optionKey(cfg.exchange, pick.optionSymbol) : "";
    const q = okey ? findQuote(quotes, okey) : null;
    const { bid, ask } = sniperBestBidAsk(q);
    const last = optionPremiumPx(q?.last_price, spot) ?? optionPremiumPx(prev.last, spot);
    const opt = {
      bid: optionPremiumPx(bid, spot),
      ask: optionPremiumPx(ask, spot),
      last
    };
    return tickSniperBook(prev, cfg, barsBy.get(cfg.id) || [], day, nowMin, now.toISOString(), spot, opt, pick);
  });
  return summarizeSniper(raw, {
    day,
    running: true,
    asOf: now.toISOString(),
    source: "kite",
    kiteError: null,
    books,
    startedAt: raw.startedAt || now.toISOString()
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  emptySniperSession,
  runSniperTick,
  sniperIstDay
});
