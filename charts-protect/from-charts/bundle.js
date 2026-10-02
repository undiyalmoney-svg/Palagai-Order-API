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

// charts-protect/from-charts/index.ts
var index_exports = {};
__export(index_exports, {
  RS_PER_LOT: () => RS_PER_LOT,
  SmcAlertTracker: () => SmcAlertTracker,
  analyzeSmc: () => analyzeSmc,
  atmOrderFields: () => atmOrderFields,
  buildAtmOrderPlan: () => buildAtmOrderPlan,
  lotsFromAvailableFunds: () => lotsFromAvailableFunds,
  resolveCrudeOilMiniFuturesToken: () => resolveCrudeOilMiniFuturesToken
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

// ../palagai/src/app/core/paper-desk/forming-bar.util.ts
var LIVE_BAR_MINUTES = 5;
function isBarComplete(barDate, now = /* @__PURE__ */ new Date(), intervalMinutes = LIVE_BAR_MINUTES) {
  const startMs = parseIstTimestamp(barDate);
  if (!startMs) {
    return false;
  }
  return now.getTime() >= startMs + intervalMinutes * 6e4;
}
function dropFormingBars(candles, now = /* @__PURE__ */ new Date(), intervalMinutes = LIVE_BAR_MINUTES) {
  let end = candles.length;
  while (end > 0 && !isBarComplete(candles[end - 1].date, now, intervalMinutes)) {
    end -= 1;
  }
  return end === candles.length ? candles : candles.slice(0, end);
}

// ../palagai/src/app/core/charts/smc/smc.config.ts
var DEFAULT_SMC_CONFIG = {
  swingLength: 3,
  atrPeriod: 14,
  eqTolAtr: 0.1,
  eqLookbackSwings: 6,
  breakBufferAtr: 0,
  rangeSwings: 4,
  sidewaysRangeAtr: 2,
  swingLengthHtf: 3,
  requireHtfTrend: true,
  useDiscountPremium: true,
  useOrderBlock: true,
  useFvg: true,
  useLiquiditySweep: true,
  pdThreshold: 0.5,
  obMaxAtr: 3,
  fvgMinAtr: 0.1,
  minConfluence: 1,
  requireSweepOrReaction: true,
  reactionWickRatio: 0.3,
  setupExpiryBars: 30,
  cooldownBars: 3,
  entryTrigger: "both",
  confirmWindowBars: 2,
  slMethod: "swing",
  slBufferAtr: 0.1,
  slAtrMult: 1.5,
  minRiskAtr: 0.3,
  maxRiskAtr: 6,
  minRR: 2,
  targetMultiplier: 1.5,
  tpMethod: "rr",
  structureFallback: true,
  tp1Fraction: 1 / 3,
  tp2Fraction: 2 / 3,
  partialPct: [33, 33, 34],
  moveStopToBreakeven: true,
  exitOnOppositeStructure: true,
  exitOnTrendReversal: true,
  exitOnObInvalidation: true,
  riskPerTradePct: 1,
  maxOpenPositions: 1,
  initialCapital: 1e5,
  maxLiquidityLines: 3,
  maxOrderBlocks: 3,
  maxFvgs: 3
};
var SMC_MARKET_PRESETS = {
  nifty: {},
  bank: { eqTolAtr: 0.12, slBufferAtr: 0.12, fvgMinAtr: 0.12 },
  crude: { eqTolAtr: 0.12, slBufferAtr: 0.15, fvgMinAtr: 0.12, obMaxAtr: 3.5 }
};
function resolveSmcConfig(market, overrides = {}) {
  return sanitizeSmcConfig({
    ...DEFAULT_SMC_CONFIG,
    ...SMC_MARKET_PRESETS[market],
    ...overrides
  });
}
function sanitizeSmcConfig(config) {
  const num = (value, fallback, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  const int = (value, fallback, min, max) => Math.round(num(value, fallback, min, max));
  const d = DEFAULT_SMC_CONFIG;
  const partial = Array.isArray(config.partialPct) ? config.partialPct : d.partialPct;
  const parts = [0, 1, 2].map((i) => Math.max(0, Number(partial[i]) || 0));
  const sum = parts[0] + parts[1] + parts[2];
  const partialPct = sum > 0 ? [parts[0] / sum * 100, parts[1] / sum * 100, parts[2] / sum * 100] : [...d.partialPct];
  const tp1 = num(config.tp1Fraction, d.tp1Fraction, 0.05, 0.95);
  const tp2 = num(config.tp2Fraction, d.tp2Fraction, tp1 + 0.01, 0.99);
  return {
    ...config,
    swingLength: int(config.swingLength, d.swingLength, 1, 20),
    swingLengthHtf: int(config.swingLengthHtf, d.swingLengthHtf, 1, 20),
    atrPeriod: int(config.atrPeriod, d.atrPeriod, 2, 100),
    eqTolAtr: num(config.eqTolAtr, d.eqTolAtr, 0, 2),
    eqLookbackSwings: int(config.eqLookbackSwings, d.eqLookbackSwings, 1, 30),
    breakBufferAtr: num(config.breakBufferAtr, d.breakBufferAtr, 0, 2),
    rangeSwings: int(config.rangeSwings, d.rangeSwings, 2, 12),
    sidewaysRangeAtr: num(config.sidewaysRangeAtr, d.sidewaysRangeAtr, 0, 20),
    pdThreshold: num(config.pdThreshold, d.pdThreshold, 0.1, 0.9),
    obMaxAtr: num(config.obMaxAtr, d.obMaxAtr, 0.5, 20),
    fvgMinAtr: num(config.fvgMinAtr, d.fvgMinAtr, 0, 5),
    minConfluence: int(config.minConfluence, d.minConfluence, 1, 4),
    reactionWickRatio: num(config.reactionWickRatio, d.reactionWickRatio, 0, 0.9),
    setupExpiryBars: int(config.setupExpiryBars, d.setupExpiryBars, 1, 500),
    cooldownBars: int(config.cooldownBars, d.cooldownBars, 0, 100),
    confirmWindowBars: int(config.confirmWindowBars, d.confirmWindowBars, 0, 20),
    slBufferAtr: num(config.slBufferAtr, d.slBufferAtr, 0, 5),
    slAtrMult: num(config.slAtrMult, d.slAtrMult, 0.1, 20),
    minRiskAtr: num(config.minRiskAtr, d.minRiskAtr, 0, 10),
    maxRiskAtr: num(config.maxRiskAtr, d.maxRiskAtr, 0.5, 50),
    minRR: num(config.minRR, d.minRR, 0.5, 20),
    targetMultiplier: num(config.targetMultiplier, d.targetMultiplier, 0.5, 10),
    tp1Fraction: tp1,
    tp2Fraction: tp2,
    partialPct,
    riskPerTradePct: num(config.riskPerTradePct, d.riskPerTradePct, 0.05, 100),
    maxOpenPositions: int(config.maxOpenPositions, d.maxOpenPositions, 1, 10),
    initialCapital: num(config.initialCapital, d.initialCapital, 1, 1e12),
    maxLiquidityLines: int(config.maxLiquidityLines, d.maxLiquidityLines, 0, 20),
    maxOrderBlocks: int(config.maxOrderBlocks, d.maxOrderBlocks, 0, 20),
    maxFvgs: int(config.maxFvgs, d.maxFvgs, 0, 20),
    slMethod: ["swing", "orderBlock", "atr"].includes(config.slMethod) ? config.slMethod : d.slMethod,
    tpMethod: config.tpMethod === "structure" ? "structure" : "rr",
    entryTrigger: ["both", "choch", "bos"].includes(config.entryTrigger) ? config.entryTrigger : d.entryTrigger
  };
}

// ../palagai/src/app/core/charts/smc/smc.types.ts
var SMC_MARKET_NAMES = {
  nifty: "NIFTY 50",
  bank: "BANK NIFTY",
  crude: "CRUDE OIL"
};

// ../palagai/src/app/core/charts/smc/smc-structure.ts
var StructureTracker = class {
  constructor(opts, idPrefix = "") {
    this.opts = opts;
    this.idPrefix = idPrefix;
  }
  opts;
  idPrefix;
  bars = [];
  atr = [];
  swings = [];
  events = [];
  equalLevels = [];
  trendAt = [];
  trend = "sideways";
  /** Direction of the last confirmed break: 1 up, -1 down, 0 none yet. */
  dir = 0;
  /** Most recent confirmed swings that no close has gone through yet. */
  lastHigh = null;
  lastLow = null;
  atrValue = 0;
  trSum = 0;
  highs = [];
  lows = [];
  step(bar) {
    const i = this.bars.length;
    this.bars.push(bar);
    this.pushAtr(bar, i);
    const swings = [];
    const equalLevels = [];
    const n = this.opts.swingLength;
    const p = i - n;
    if (p >= n) {
      if (this.isPivot(p, "high")) {
        const swing = this.registerSwing("high", p, i);
        if (swing) {
          swings.push(swing);
          const eq = this.findEqual(swing);
          if (eq) equalLevels.push(eq);
        }
      }
      if (this.isPivot(p, "low")) {
        const swing = this.registerSwing("low", p, i);
        if (swing) {
          swings.push(swing);
          const eq = this.findEqual(swing);
          if (eq) equalLevels.push(eq);
        }
      }
    }
    const event = this.detectBreak(bar, i);
    this.trend = this.classifyTrend(i);
    this.trendAt.push(this.trend);
    return { swings, event, equalLevels };
  }
  pushAtr(bar, i) {
    const prevClose = i > 0 ? this.bars[i - 1].close : bar.open;
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prevClose),
      Math.abs(bar.low - prevClose)
    );
    const period = this.opts.atrPeriod;
    if (i < period) {
      this.trSum += tr;
      this.atrValue = this.trSum / (i + 1);
    } else {
      this.atrValue = (this.atrValue * (period - 1) + tr) / period;
    }
    this.atr.push(this.atrValue);
  }
  /** Pivot bar `p` against `swingLength` neighbours each side, ties allowed. */
  isPivot(p, kind) {
    const n = this.opts.swingLength;
    const bars = this.bars;
    const pivot = kind === "high" ? bars[p].high : bars[p].low;
    for (let k = p - n; k <= p + n; k += 1) {
      if (k === p) continue;
      const other = kind === "high" ? bars[k].high : bars[k].low;
      if (kind === "high" ? other > pivot : other < pivot) return false;
    }
    return true;
  }
  registerSwing(kind, p, i) {
    const list = kind === "high" ? this.highs : this.lows;
    const price = kind === "high" ? this.bars[p].high : this.bars[p].low;
    const prev = list[list.length - 1] ?? null;
    if (prev && p - prev.index <= this.opts.swingLength && prev.price === price) {
      return null;
    }
    const tol = this.opts.eqTolAtr * this.atr[i];
    let label = null;
    if (prev) {
      if (Math.abs(price - prev.price) <= tol) label = kind === "high" ? "EQH" : "EQL";
      else if (price > prev.price) label = kind === "high" ? "HH" : "HL";
      else label = kind === "high" ? "LH" : "LL";
    }
    const swing = {
      id: `${this.idPrefix}${kind === "high" ? "sh" : "sl"}${p}`,
      kind,
      index: p,
      price,
      confirmedAt: i,
      label,
      brokenAt: null
    };
    list.push(swing);
    this.swings.push(swing);
    if (kind === "high") this.lastHigh = swing;
    else this.lastLow = swing;
    return swing;
  }
  findEqual(swing) {
    const list = swing.kind === "high" ? this.highs : this.lows;
    const tol = this.opts.eqTolAtr * this.atr[swing.confirmedAt];
    const from = Math.max(0, list.length - 1 - this.opts.eqLookbackSwings);
    for (let k = list.length - 2; k >= from; k -= 1) {
      const other = list[k];
      if (swing.index - other.index <= this.opts.swingLength) continue;
      if (Math.abs(other.price - swing.price) <= tol) {
        const level = {
          id: `${this.idPrefix}${swing.kind === "high" ? "eqh" : "eql"}${other.index}-${swing.index}`,
          kind: swing.kind === "high" ? "EQH" : "EQL",
          price: swing.kind === "high" ? Math.max(other.price, swing.price) : Math.min(other.price, swing.price),
          indexA: other.index,
          indexB: swing.index,
          confirmedAt: swing.confirmedAt
        };
        this.equalLevels.push(level);
        return level;
      }
    }
    return null;
  }
  detectBreak(bar, i) {
    const buffer = this.opts.breakBufferAtr * this.atr[i];
    const high = this.lastHigh;
    const low = this.lastLow;
    const upBreak = high != null && bar.close > high.price + buffer;
    const downBreak = low != null && bar.close < low.price - buffer;
    if (!upBreak && !downBreak) return null;
    let up = upBreak;
    if (upBreak && downBreak) {
      up = bar.close - bar.low >= bar.high - bar.close;
    }
    const swing = up ? high : low;
    const kind = up && this.dir < 0 || !up && this.dir > 0 ? "CHoCH" : "BOS";
    const event = {
      id: `${this.idPrefix}${kind}-${up ? "bull" : "bear"}-${i}`,
      kind,
      dir: up ? "bull" : "bear",
      level: swing.price,
      swingIndex: swing.index,
      index: i,
      confirmedAt: i,
      date: bar.date
    };
    swing.brokenAt = i;
    if (up) this.lastHigh = null;
    else this.lastLow = null;
    this.dir = up ? 1 : -1;
    this.events.push(event);
    return event;
  }
  /**
   * Trend from confirmed structure alone: the direction of the last break,
   * unless the structure has gone flat.
   *
   * Flat means either the latest swings span only a sliver of ATR, or the
   * last three breaks keep flipping direction (a chop of CHoCH / CHoCH).
   */
  classifyTrend(i) {
    if (this.dir === 0) return "sideways";
    const evs = this.events;
    if (evs.length >= 3) {
      const [a, b, c] = evs.slice(-3);
      if (a.dir !== b.dir && b.dir !== c.dir) return "sideways";
    }
    const recent = this.swings.slice(-this.opts.rangeSwings);
    if (recent.length >= this.opts.rangeSwings) {
      let hi = -Infinity;
      let lo = Infinity;
      for (const s of recent) {
        if (s.price > hi) hi = s.price;
        if (s.price < lo) lo = s.price;
      }
      if (hi - lo < this.opts.sidewaysRangeAtr * this.atr[i]) return "sideways";
    }
    return this.dir > 0 ? "bullish" : "bearish";
  }
  /** Latest labels for the panel, e.g. `HH / HL`. */
  structureText() {
    const label = (list) => {
      for (let k = list.length - 1; k >= 0; k -= 1) {
        const l2 = list[k].label;
        if (l2) return l2;
      }
      return null;
    };
    const h = label(this.highs);
    const l = label(this.lows);
    if (!h && !l) return "\u2014";
    return [h ?? "\u2014", l ?? "\u2014"].join(" / ");
  }
};

// ../palagai/src/app/core/charts/smc/smc-utils.ts
function candleTs(date) {
  if (!date) return 0;
  const raw = String(date).trim().replace(" ", "T");
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const ms = Date.parse(hasZone ? raw : `${raw}+05:30`);
  return Number.isFinite(ms) ? ms : 0;
}
function sessionDay(date) {
  return String(date).slice(0, 10);
}

// ../palagai/src/app/core/charts/smc/smc-engine.ts
var SmcEngine = class {
  constructor(cfg, htf, barMinutes) {
    this.cfg = cfg;
    this.htf = htf;
    this.barMs = barMinutes * 6e4;
    this.equity = cfg.initialCapital;
    this.tracker = new StructureTracker({
      swingLength: cfg.swingLength,
      atrPeriod: cfg.atrPeriod,
      eqTolAtr: cfg.eqTolAtr,
      eqLookbackSwings: cfg.eqLookbackSwings,
      breakBufferAtr: cfg.breakBufferAtr,
      rangeSwings: cfg.rangeSwings,
      sidewaysRangeAtr: cfg.sidewaysRangeAtr
    });
  }
  cfg;
  htf;
  tracker;
  orderBlocks = [];
  fvgs = [];
  liquidity = [];
  trades = [];
  signals = [];
  alerts = [];
  htfTrendAt = [];
  range = null;
  setups = { BUY: null, SELL: null };
  equity;
  pending = { BUY: null, SELL: null };
  lastEntryAt = { BUY: -1e9, SELL: -1e9 };
  rangeHi = NaN;
  rangeLo = NaN;
  tradeSeq = 0;
  barMs;
  get bars() {
    return this.tracker.bars;
  }
  /**
   * Feed the next CLOSED candle. `asOfTs` caps the clock the higher timeframe
   * is read at, and is only used for the preview of a still-forming candle.
   */
  step(bar, asOfTs) {
    const st = this.tracker.step(bar);
    const i = this.tracker.bars.length - 1;
    const atr = this.tracker.atr[i];
    const ts = candleTs(bar.date);
    const closeTs = ts + this.barMs;
    const htfClock = asOfTs != null ? Math.min(closeTs, asOfTs) : closeTs;
    const htfTrend = this.htf ? this.htf.trendAt(htfClock) : null;
    const prevHtf = i > 0 ? this.htfTrendAt[i - 1] ?? null : null;
    this.htfTrendAt.push(htfTrend);
    const flags = this.sweepLiquidity(bar, i);
    for (const swing of st.swings) this.addLiquidity(swing, i);
    for (const eq of st.equalLevels) this.addEqualLiquidity(eq, i);
    this.updateOrderBlocks(bar, i);
    this.updateFvgs(bar, i);
    const event = st.event;
    if (event) {
      this.alertStructure(event, bar);
      this.createOrderBlock(event, i, atr);
    }
    this.detectFvg(i, atr);
    this.updateRange(st.swings, bar, i, atr);
    this.manageTrades(bar, i, ts, event, htfTrend, prevHtf);
    for (const side of ["BUY", "SELL"]) {
      this.updateSetup(side, bar, i, flags, event, htfTrend);
      this.confirmEntry(side, bar, i, ts, atr);
    }
  }
  // ---------------------------------------------------------------- liquidity
  addLiquidity(swing, i) {
    this.liquidity.push({
      id: `liq-${swing.id}`,
      side: swing.kind === "high" ? "BSL" : "SSL",
      price: swing.price,
      index: swing.index,
      confirmedAt: i,
      equal: false,
      sweptAt: null,
      rejected: false
    });
  }
  addEqualLiquidity(eq, i) {
    this.liquidity.push({
      id: `liq-${eq.id}`,
      side: eq.kind === "EQH" ? "BSL" : "SSL",
      price: eq.price,
      index: eq.indexB,
      confirmedAt: i,
      equal: true,
      sweptAt: null,
      rejected: false
    });
  }
  /** Resting stops above highs / below lows that this candle traded through. */
  sweepLiquidity(bar, i) {
    const flags = { sweptSsl: false, sweptBsl: false };
    for (const level of this.liquidity) {
      if (level.sweptAt != null) continue;
      if (level.side === "BSL" && bar.high > level.price) {
        level.sweptAt = i;
        level.rejected = bar.close < level.price;
        flags.sweptBsl = true;
      } else if (level.side === "SSL" && bar.low < level.price) {
        level.sweptAt = i;
        level.rejected = bar.close > level.price;
        flags.sweptSsl = true;
      }
    }
    return flags;
  }
  // ------------------------------------------------------------- order blocks
  createOrderBlock(event, i, atr) {
    const bars = this.tracker.bars;
    const bull = event.dir === "bull";
    let pick = -1;
    for (let k = Math.max(0, event.swingIndex); k < i; k += 1) {
      if (pick < 0) {
        pick = k;
        continue;
      }
      if (bull ? bars[k].low <= bars[pick].low : bars[k].high >= bars[pick].high) pick = k;
    }
    if (pick < 0) return;
    const src = bars[pick];
    let lo = src.low;
    let hi = src.high;
    const cap = this.cfg.obMaxAtr * atr;
    if (hi - lo > cap) {
      lo = Math.min(src.open, src.close);
      hi = Math.max(src.open, src.close);
      if (hi - lo > cap) return;
    }
    if (!(hi > lo)) return;
    this.orderBlocks.push({
      id: `ob-${event.dir}-${i}`,
      dir: event.dir,
      index: pick,
      confirmedAt: i,
      lo,
      hi,
      touchedAt: null,
      status: "active",
      endedAt: null,
      eventId: event.id
    });
  }
  updateOrderBlocks(bar, i) {
    for (const ob of this.orderBlocks) {
      if (ob.status !== "active" || ob.confirmedAt >= i) continue;
      if (ob.dir === "bull") {
        if (bar.close < ob.lo) {
          ob.status = "invalidated";
          ob.endedAt = i;
        } else if (ob.touchedAt == null && bar.low <= ob.hi) {
          ob.touchedAt = i;
        }
      } else if (bar.close > ob.hi) {
        ob.status = "invalidated";
        ob.endedAt = i;
      } else if (ob.touchedAt == null && bar.high >= ob.lo) {
        ob.touchedAt = i;
      }
    }
  }
  // ---------------------------------------------------------------------- FVG
  detectFvg(i, atr) {
    if (i < 2) return;
    const bars = this.tracker.bars;
    const a = bars[i - 2];
    const c = bars[i];
    const min = this.cfg.fvgMinAtr * atr;
    if (c.low > a.high && c.low - a.high >= min && c.low - a.high > 0) {
      this.fvgs.push({
        id: `fvg-bull-${i - 1}`,
        dir: "bull",
        index: i - 1,
        confirmedAt: i,
        lo: a.high,
        hi: c.low,
        status: "active",
        endedAt: null
      });
    } else if (c.high < a.low && a.low - c.high >= min && a.low - c.high > 0) {
      this.fvgs.push({
        id: `fvg-bear-${i - 1}`,
        dir: "bear",
        index: i - 1,
        confirmedAt: i,
        lo: c.high,
        hi: a.low,
        status: "active",
        endedAt: null
      });
    }
  }
  updateFvgs(bar, i) {
    for (const gap of this.fvgs) {
      if (gap.status !== "active" || gap.confirmedAt >= i) continue;
      if (gap.dir === "bull" ? bar.close < gap.lo : bar.close > gap.hi) {
        gap.status = "filled";
        gap.endedAt = i;
      }
    }
  }
  // -------------------------------------------------------- premium / discount
  /**
   * Dealing range: the latest confirmed swing high to the latest confirmed
   * swing low, stretched by any newer extreme. Everything in it is causal.
   */
  updateRange(newSwings, bar, i, atr) {
    const bars = this.tracker.bars;
    for (const swing of newSwings) {
      let value = swing.price;
      for (let k = swing.index + 1; k <= i; k += 1) {
        value = swing.kind === "high" ? Math.max(value, bars[k].high) : Math.min(value, bars[k].low);
      }
      if (swing.kind === "high") this.rangeHi = value;
      else this.rangeLo = value;
    }
    if (Number.isFinite(this.rangeHi)) this.rangeHi = Math.max(this.rangeHi, bar.high);
    if (Number.isFinite(this.rangeLo)) this.rangeLo = Math.min(this.rangeLo, bar.low);
    const hi = this.rangeHi;
    const lo = this.rangeLo;
    if (Number.isFinite(hi) && Number.isFinite(lo) && hi - lo >= atr) {
      const startIndex = Math.min(
        this.lastSwingIndex("high") ?? i,
        this.lastSwingIndex("low") ?? i
      );
      this.range = { hi, lo, eq: (hi + lo) / 2, since: i, startIndex };
    } else {
      this.range = null;
    }
  }
  lastSwingIndex(kind) {
    const swings = this.tracker.swings;
    for (let k = swings.length - 1; k >= 0; k -= 1) {
      if (swings[k].kind === kind) return swings[k].index;
    }
    return null;
  }
  // ------------------------------------------------------------ setup / entry
  /** The trend an entry is checked against: HTF where it exists. */
  gateTrend(htfTrend) {
    if (this.htf) return htfTrend;
    return this.tracker.trend;
  }
  updateSetup(side, bar, i, flags, event, htfTrend) {
    const long = side === "BUY";
    const cfg = this.cfg;
    const gate = this.gateTrend(htfTrend);
    const trendOk = !cfg.requireHtfTrend || gate === (long ? "bullish" : "bearish");
    if (!trendOk) {
      this.setups[side] = null;
      this.pending[side] = null;
      return;
    }
    let setup = this.setups[side];
    if (setup && i - setup.lastTouchAt > cfg.setupExpiryBars) {
      setup = null;
      this.setups[side] = null;
      this.pending[side] = null;
    }
    const poi = [];
    let obId = null;
    if (i - this.lastEntryAt[side] > cfg.cooldownBars) {
      const range = this.range;
      if (cfg.useDiscountPremium && range) {
        const span = range.hi - range.lo;
        const hit = long ? bar.low <= range.lo + cfg.pdThreshold * span : bar.high >= range.hi - cfg.pdThreshold * span;
        if (hit) poi.push(long ? "Discount" : "Premium");
      }
      if (cfg.useOrderBlock) {
        const ob = this.touchedOrderBlock(long ? "bull" : "bear", bar, i);
        if (ob) {
          poi.push("Order block");
          obId = ob.id;
        }
      }
      if (cfg.useFvg && this.touchedFvg(long ? "bull" : "bear", bar, i)) poi.push("FVG");
      if (cfg.useLiquiditySweep && (long ? flags.sweptSsl : flags.sweptBsl)) {
        poi.push("Liquidity sweep");
      }
    }
    const touching = poi.length >= cfg.minConfluence;
    if (touching) {
      if (!setup) {
        setup = {
          side,
          armedAt: i,
          armedDate: bar.date,
          lastTouchAt: i,
          poi: [],
          reacted: false,
          extreme: long ? bar.low : bar.high,
          obId: null
        };
        this.setups[side] = setup;
      }
      setup.lastTouchAt = i;
      for (const label of poi) if (!setup.poi.includes(label)) setup.poi.push(label);
      if (obId) setup.obId = obId;
      const sweep = long ? flags.sweptSsl : flags.sweptBsl;
      if (sweep || this.isReaction(long, bar)) setup.reacted = true;
    } else if (setup && (long ? flags.sweptSsl : flags.sweptBsl)) {
      setup.reacted = true;
    }
    if (setup) {
      setup.extreme = long ? Math.min(setup.extreme, bar.low) : Math.max(setup.extreme, bar.high);
      if (setup.obId) {
        const ob = this.orderBlocks.find((o) => o.id === setup.obId);
        if (ob && ob.status !== "active") setup.obId = null;
      }
    }
    if (event && setup && event.dir === (long ? "bull" : "bear")) {
      const allowed = cfg.entryTrigger === "both" || cfg.entryTrigger === "choch" && event.kind === "CHoCH" || cfg.entryTrigger === "bos" && event.kind === "BOS";
      if (allowed && (!cfg.requireSweepOrReaction || setup.reacted)) {
        this.pending[side] = { event, expiresAt: i + cfg.confirmWindowBars };
      }
    }
  }
  touchedOrderBlock(dir, bar, i) {
    let best = null;
    for (const ob of this.orderBlocks) {
      if (ob.dir !== dir || ob.status !== "active" || ob.confirmedAt >= i) continue;
      if (bar.low <= ob.hi && bar.high >= ob.lo) {
        if (!best || ob.confirmedAt > best.confirmedAt) best = ob;
      }
    }
    return best;
  }
  touchedFvg(dir, bar, i) {
    return this.fvgs.some(
      (g) => g.dir === dir && g.status === "active" && g.confirmedAt < i && bar.low <= g.hi && bar.high >= g.lo
    );
  }
  /** Rejection candle: closes in its favour with a long wick into the level. */
  isReaction(long, bar) {
    const range = bar.high - bar.low;
    if (range <= 0) return false;
    if (long) {
      return bar.close > bar.open && (Math.min(bar.open, bar.close) - bar.low) / range >= this.cfg.reactionWickRatio;
    }
    return bar.close < bar.open && (bar.high - Math.max(bar.open, bar.close)) / range >= this.cfg.reactionWickRatio;
  }
  confirmEntry(side, bar, i, ts, atr) {
    const pending = this.pending[side];
    const setup = this.setups[side];
    if (!pending || !setup) return;
    const long = side === "BUY";
    const level = pending.event.level;
    if (long ? bar.close < level : bar.close > level) {
      this.pending[side] = null;
      return;
    }
    const confirming = long ? bar.close > bar.open && bar.close > level : bar.close < bar.open && bar.close < level;
    if (!confirming) {
      if (i >= pending.expiresAt) this.pending[side] = null;
      return;
    }
    this.pending[side] = null;
    const open = this.trades.filter((t) => t.status === "open");
    if (open.length >= this.cfg.maxOpenPositions) return;
    const ob = setup.obId ? this.orderBlocks.find((o) => o.id === setup.obId) ?? null : null;
    const plan = this.planTrade(side, bar.close, atr, setup, pending.event, ob);
    this.setups[side] = null;
    this.lastEntryAt[side] = i;
    if (!plan) return;
    this.openTrade(side, bar, i, ts, plan, setup, pending.event, ob);
  }
  // -------------------------------------------------- stop loss / take profit
  planTrade(side, entry, atr, setup, event, ob) {
    const sl = this.planStop(side, entry, atr, setup, event, ob);
    if (sl == null) return null;
    const risk = Math.abs(entry - sl);
    if (!(risk > 0) || risk > this.cfg.maxRiskAtr * atr) return null;
    const targets = this.planTargets(side, entry, risk);
    if (!targets) return null;
    return { entry, sl, risk, ...targets };
  }
  planStop(side, entry, atr, setup, event, ob) {
    const cfg = this.cfg;
    const long = side === "BUY";
    const buffer = cfg.slBufferAtr * atr;
    let sl;
    if (cfg.slMethod === "atr") {
      sl = long ? entry - cfg.slAtrMult * atr : entry + cfg.slAtrMult * atr;
    } else if (cfg.slMethod === "orderBlock" && ob) {
      sl = long ? ob.lo - buffer : ob.hi + buffer;
    } else {
      const bars = this.tracker.bars;
      let extreme = setup.extreme;
      for (let k = Math.max(0, event.swingIndex); k < bars.length; k += 1) {
        extreme = long ? Math.min(extreme, bars[k].low) : Math.max(extreme, bars[k].high);
      }
      sl = long ? extreme - buffer : extreme + buffer;
    }
    const floor = cfg.minRiskAtr * atr;
    if (long ? entry - sl < floor : sl - entry < floor) {
      sl = long ? entry - floor : entry + floor;
    }
    if (long ? sl >= entry : sl <= entry) return null;
    return sl;
  }
  planTargets(side, entry, risk) {
    const cfg = this.cfg;
    const long = side === "BUY";
    const dirSign = long ? 1 : -1;
    let finalDistance = risk * Math.max(cfg.minRR, cfg.minRR * cfg.targetMultiplier);
    if (cfg.tpMethod === "structure") {
      let best = null;
      for (const level of this.liquidity) {
        if (level.sweptAt != null) continue;
        if (long ? level.side !== "BSL" || level.price <= entry : level.side !== "SSL" || level.price >= entry) {
          continue;
        }
        const distance = Math.abs(level.price - entry);
        if (distance / risk + 1e-9 < cfg.minRR) continue;
        if (best == null || distance < best) best = distance;
      }
      if (best != null) finalDistance = best;
      else if (!cfg.structureFallback) return null;
    }
    const rr = finalDistance / risk;
    if (rr + 1e-9 < cfg.minRR) return null;
    return {
      tp1: entry + dirSign * finalDistance * cfg.tp1Fraction,
      tp2: entry + dirSign * finalDistance * cfg.tp2Fraction,
      tpFinal: entry + dirSign * finalDistance,
      rr
    };
  }
  openTrade(side, bar, i, ts, plan, setup, event, ob) {
    const id = `T${this.tradeSeq += 1}-${side}-${i}`;
    const units = this.equity * (this.cfg.riskPerTradePct / 100) / plan.risk;
    const trade = {
      id,
      side,
      entryIndex: i,
      entryDate: bar.date,
      entryTs: ts,
      entryPrice: plan.entry,
      sl: plan.sl,
      slNow: plan.sl,
      tp1: plan.tp1,
      tp2: plan.tp2,
      tpFinal: plan.tpFinal,
      risk: plan.risk,
      rr: plan.rr,
      units,
      poi: [...setup.poi],
      triggerKind: event.kind,
      triggerEventId: event.id,
      obId: ob?.id ?? null,
      status: "open",
      fills: [],
      remaining: 1,
      exitIndex: null,
      exitDate: null,
      exitTs: null,
      exitPrice: null,
      exitReason: null,
      rMultiple: null,
      returnPct: null
    };
    this.trades.push(trade);
    this.signals.push({
      id: `sig-${id}`,
      side,
      index: i,
      date: bar.date,
      price: plan.entry,
      tradeId: id
    });
    this.pushAlert(side, i, bar.date, plan.entry, `Confirmed ${side} @ ${fmtPrice(plan.entry)}`, id);
  }
  // --------------------------------------------------------------------- exit
  manageTrades(bar, i, ts, event, htfTrend, prevHtf) {
    for (const trade of this.trades) {
      if (trade.status !== "open" || trade.entryIndex >= i) continue;
      this.manageTrade(trade, bar, i, ts, event, htfTrend, prevHtf);
    }
  }
  manageTrade(t, bar, i, ts, event, htfTrend, prevHtf) {
    const cfg = this.cfg;
    const long = t.side === "BUY";
    const hit = (level) => long ? bar.high >= level : bar.low <= level;
    if (long ? bar.low <= t.slNow : bar.high >= t.slNow) {
      const price = long ? Math.min(t.slNow, bar.open) : Math.max(t.slNow, bar.open);
      const moved = long ? t.slNow > t.sl : t.slNow < t.sl;
      this.fill(t, "STOP", i, bar.date, price, t.remaining);
      this.alertForTrade(t, "STOP_LOSS", i, bar, price, `Stop loss ${t.side} @ ${fmtPrice(price)}`);
      this.close(t, i, bar.date, ts, moved ? "breakeven_stop" : "stop_loss");
      return;
    }
    const p = cfg.partialPct;
    if (!t.fills.some((f) => f.kind === "TP1") && hit(t.tp1)) {
      this.fill(t, "TP1", i, bar.date, t.tp1, Math.min(t.remaining, p[0] / 100));
      this.alertForTrade(t, "TP1", i, bar, t.tp1, `TP1 hit ${t.side} @ ${fmtPrice(t.tp1)}`);
      if (cfg.moveStopToBreakeven) t.slNow = t.entryPrice;
    }
    if (t.fills.some((f) => f.kind === "TP1") && !t.fills.some((f) => f.kind === "TP2") && hit(t.tp2)) {
      this.fill(t, "TP2", i, bar.date, t.tp2, Math.min(t.remaining, p[1] / 100));
      this.alertForTrade(t, "TP2", i, bar, t.tp2, `TP2 hit ${t.side} @ ${fmtPrice(t.tp2)}`);
      if (cfg.moveStopToBreakeven) t.slNow = t.tp1;
    }
    if (t.fills.some((f) => f.kind === "TP2") && hit(t.tpFinal)) {
      this.fill(t, "FINAL", i, bar.date, t.tpFinal, t.remaining);
      this.alertForTrade(t, "FINAL_TP", i, bar, t.tpFinal, `Final TP ${t.side} @ ${fmtPrice(t.tpFinal)}`);
      this.close(t, i, bar.date, ts, "take_profit");
      return;
    }
    if (t.remaining <= 1e-9) {
      this.close(t, i, bar.date, ts, "take_profit");
      return;
    }
    const opposite = long ? "bearish" : "bullish";
    let reason = null;
    if (cfg.exitOnTrendReversal && htfTrend === opposite && prevHtf !== opposite) {
      reason = "trend_reversal";
    } else if (cfg.exitOnObInvalidation && t.obId) {
      const ob = this.orderBlocks.find((o) => o.id === t.obId);
      if (ob && ob.status === "invalidated" && ob.endedAt === i) reason = "setup_invalidated";
    }
    if (!reason && cfg.exitOnOppositeStructure && event && event.dir === (long ? "bear" : "bull")) {
      reason = "opposite_structure";
    }
    if (reason) {
      this.fill(t, "EXIT", i, bar.date, bar.close, t.remaining);
      this.close(t, i, bar.date, ts, reason);
    }
  }
  fill(t, kind, index, date, price, fraction) {
    const share = Math.max(0, Math.min(t.remaining, fraction));
    t.fills.push({ kind, index, date, price, fraction: share });
    t.remaining = Math.max(0, t.remaining - share);
  }
  close(t, index, date, ts, reason) {
    const long = t.side === "BUY";
    let weighted = 0;
    let size = 0;
    let r = 0;
    for (const f of t.fills) {
      weighted += f.price * f.fraction;
      size += f.fraction;
      r += (long ? f.price - t.entryPrice : t.entryPrice - f.price) / t.risk * f.fraction;
    }
    t.status = "closed";
    t.remaining = 0;
    t.exitIndex = index;
    t.exitDate = date;
    t.exitTs = ts;
    t.exitPrice = size > 0 ? weighted / size : t.entryPrice;
    t.exitReason = reason;
    t.rMultiple = r;
    t.returnPct = r * this.cfg.riskPerTradePct;
    this.equity *= 1 + t.returnPct / 100;
    this.pushAlert(
      "EXIT",
      index,
      date,
      t.exitPrice,
      `Exit ${t.side} @ ${fmtPrice(t.exitPrice)} \u2014 ${EXIT_TEXT[reason]}`,
      t.id
    );
  }
  // ------------------------------------------------------------------- alerts
  alertStructure(event, bar) {
    const type = event.kind === "BOS" ? event.dir === "bull" ? "BOS_BULL" : "BOS_BEAR" : event.dir === "bull" ? "CHOCH_BULL" : "CHOCH_BEAR";
    this.pushAlert(
      type,
      event.index,
      bar.date,
      bar.close,
      `${event.dir === "bull" ? "Bullish" : "Bearish"} ${event.kind} @ ${fmtPrice(event.level)}`,
      event.id
    );
  }
  alertForTrade(t, type, index, bar, price, message) {
    this.pushAlert(type, index, bar.date, price, message, t.id);
  }
  pushAlert(type, index, date, price, message, key) {
    this.alerts.push({
      id: `${type}|${key}|${index}`,
      type,
      index,
      date,
      ts: candleTs(date),
      price,
      message
    });
  }
};
var EXIT_TEXT = {
  stop_loss: "stop loss",
  breakeven_stop: "protective stop",
  take_profit: "final target",
  opposite_structure: "opposite structure",
  trend_reversal: "trend reversal",
  setup_invalidated: "setup invalidated"
};
function fmtPrice(value) {
  return value.toFixed(2);
}

// ../palagai/src/app/core/charts/candle-aggregate.util.ts
function aggregateCandles(candles, groupSize) {
  const size = Math.max(1, Math.floor(groupSize) || 1);
  if (size === 1 || candles.length === 0) {
    return candles.slice();
  }
  const out = [];
  let bucket = [];
  let day = sessionDay(candles[0].date);
  const flush = () => {
    if (bucket.length) {
      out.push(mergeCandles(bucket));
      bucket = [];
    }
  };
  for (const candle of candles) {
    const candleDay = sessionDay(candle.date);
    if (candleDay !== day) {
      flush();
      day = candleDay;
    }
    bucket.push(candle);
    if (bucket.length === size) {
      flush();
    }
  }
  flush();
  return out;
}
function mergeCandles(run) {
  const first = run[0];
  let high = first.high;
  let low = first.low;
  let volume = 0;
  for (const candle of run) {
    if (candle.high > high) high = candle.high;
    if (candle.low < low) low = candle.low;
    volume += candle.volume || 0;
  }
  return {
    // Stamp the bucket with its opening bar, as exchanges label candles.
    date: first.date,
    open: first.open,
    high,
    low,
    close: run[run.length - 1].close,
    volume
  };
}

// ../palagai/src/app/core/charts/smc/smc-htf.ts
function buildHtfTimeline(htfBars, htfMinutes, config) {
  const tracker = new StructureTracker(
    {
      swingLength: config.swingLengthHtf,
      atrPeriod: config.atrPeriod,
      eqTolAtr: config.eqTolAtr,
      eqLookbackSwings: config.eqLookbackSwings,
      breakBufferAtr: config.breakBufferAtr,
      rangeSwings: config.rangeSwings,
      sidewaysRangeAtr: config.sidewaysRangeAtr
    },
    "h"
  );
  const closeTs = [];
  const trends = [];
  const span = htfMinutes * 6e4;
  for (const bar of htfBars) {
    tracker.step(bar);
    closeTs.push(candleTs(bar.date) + span);
    trends.push(tracker.trend);
  }
  return {
    length: htfBars.length,
    trendAt(ts) {
      let lo = 0;
      let hi = closeTs.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = lo + hi >> 1;
        if (closeTs[mid] <= ts) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return found >= 0 ? trends[found] : null;
    }
  };
}
function deriveHtfBars(ltfBars, ltfMinutes, htfMinutes) {
  if (ltfMinutes <= 0 || htfMinutes < ltfMinutes) return null;
  const ratio = htfMinutes / ltfMinutes;
  if (!Number.isInteger(ratio)) return null;
  return aggregateCandles(ltfBars, ratio);
}

// ../palagai/src/app/core/charts/smc/smc-stats.ts
var BREAKEVEN_R = 0.05;
function computeSmcStats(trades, riskPerTradePct) {
  const closed = trades.filter((t) => t.status === "closed" && t.rMultiple != null).sort((a, b) => (a.exitTs ?? 0) - (b.exitTs ?? 0) || (a.exitIndex ?? 0) - (b.exitIndex ?? 0));
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let sumR = 0;
  let sumPct = 0;
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (const t of closed) {
    const r = t.rMultiple;
    sumR += r;
    if (r > BREAKEVEN_R) {
      wins += 1;
      grossWin += r;
    } else if (r < -BREAKEVEN_R) {
      losses += 1;
      grossLoss += -r;
    } else {
      breakeven += 1;
    }
    const pct = t.returnPct ?? r * riskPerTradePct;
    sumPct += pct;
    equity *= 1 + pct / 100;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  const total = closed.length;
  const plannedRr = trades.reduce((sum, t) => sum + t.rr, 0);
  return {
    totalTrades: total,
    wins,
    losses,
    breakeven,
    winRate: total ? wins / total * 100 : null,
    avgPlannedRr: trades.length ? plannedRr / trades.length : null,
    avgR: total ? sumR / total : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    maxDrawdownPct: maxDd * 100,
    netReturnPct: (equity - 1) * 100,
    avgTradePct: total ? sumPct / total : null,
    buySignals: trades.filter((t) => t.side === "BUY").length,
    sellSignals: trades.filter((t) => t.side === "SELL").length,
    openTrades: trades.filter((t) => t.status === "open").length
  };
}
function splitSmcStats(trades, riskPerTradePct, liveFromTs) {
  const live = liveFromTs == null ? [] : trades.filter((t) => t.entryTs >= liveFromTs);
  const back = liveFromTs == null ? trades : trades.filter((t) => t.entryTs < liveFromTs);
  return {
    backtest: computeSmcStats(back, riskPerTradePct),
    live: computeSmcStats(live, riskPerTradePct),
    liveFromTs
  };
}

// ../palagai/src/app/core/charts/smc/smc-analyze.ts
var EXITED_BARS = 5;
function analyzeSmc(input) {
  const cfg = resolveSmcConfig(input.market, input.config);
  const now = input.now ?? /* @__PURE__ */ new Date();
  const closed = dropFormingBars(input.candles, now, input.intervalMinutes);
  const forming = input.candles.length > closed.length ? input.candles[closed.length] : null;
  const timeline = buildTimeline(input, closed, cfg);
  const engine = runEngine(closed, cfg, timeline, input.intervalMinutes);
  let preview = null;
  if (forming) {
    const ghost = runEngine(
      [...closed, forming],
      cfg,
      timeline,
      input.intervalMinutes,
      now.getTime()
    );
    preview = derivePreview(ghost, closed.length);
  }
  const liveFromTs = input.live ? istSessionStart(now) : null;
  const stats = splitSmcStats(engine.trades, cfg.riskPerTradePct, liveFromTs);
  const snapshot = buildSnapshot(input.market, engine, preview, cfg);
  return {
    market: input.market,
    config: cfg,
    bars: closed.length,
    swings: engine.tracker.swings,
    structure: engine.tracker.events,
    orderBlocks: engine.orderBlocks,
    fvgs: engine.fvgs,
    liquidity: engine.liquidity,
    equalLevels: engine.tracker.equalLevels,
    range: engine.range,
    zone: snapshot.zone,
    trendAt: engine.tracker.trendAt,
    htfTrendAt: engine.htfTrendAt,
    trades: engine.trades,
    signals: engine.signals,
    alerts: engine.alerts,
    setup: engine.setups.BUY ?? engine.setups.SELL,
    preview,
    snapshot,
    stats,
    atr: engine.tracker.atr.length ? engine.tracker.atr[engine.tracker.atr.length - 1] : null,
    htfAvailable: timeline != null
  };
}
function runEngine(bars, cfg, timeline, minutes, asOfTs) {
  const engine = new SmcEngine(cfg, timeline, minutes);
  for (let i = 0; i < bars.length; i += 1) {
    engine.step(bars[i], i === bars.length - 1 ? asOfTs : void 0);
  }
  return engine;
}
function buildTimeline(input, closed, cfg) {
  const minutes = input.htfMinutes ?? input.htf?.minutes ?? input.intervalMinutes;
  if (input.htf && input.htf.candles.length) {
    return buildHtfTimeline(input.htf.candles, input.htf.minutes, cfg);
  }
  if (!closed.length) return null;
  if (minutes === input.intervalMinutes) {
    return buildHtfTimeline(closed, minutes, cfg);
  }
  const derived = deriveHtfBars(closed, input.intervalMinutes, minutes);
  return derived ? buildHtfTimeline(derived, minutes, cfg) : null;
}
function derivePreview(ghost, formingIndex) {
  const entered = ghost.trades.find((t) => t.entryIndex === formingIndex);
  if (entered) {
    return {
      kind: "entry",
      side: entered.side,
      index: formingIndex,
      entry: entered.entryPrice,
      sl: entered.sl,
      tp1: entered.tp1,
      tp2: entered.tp2,
      tpFinal: entered.tpFinal,
      rr: entered.rr,
      label: "SETUP \u2014 NOT CONFIRMED"
    };
  }
  const armed = ghost.setups.BUY ?? ghost.setups.SELL;
  if (armed) {
    return {
      kind: "setup",
      side: armed.side,
      index: formingIndex,
      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      tpFinal: null,
      rr: null,
      label: "SETUP \u2014 NOT CONFIRMED"
    };
  }
  return null;
}
function buildSnapshot(market, engine, preview, cfg) {
  const tracker = engine.tracker;
  const last = tracker.bars.length - 1;
  const ltfTrend = last >= 0 ? tracker.trendAt[last] : "sideways";
  const htfTrend = last >= 0 ? engine.htfTrendAt[last] ?? null : null;
  const events = tracker.events;
  const lastOf = (kind) => {
    for (let k = events.length - 1; k >= 0; k -= 1) {
      if (events[k].kind === kind) return events[k].dir === "bull" ? "Bullish" : "Bearish";
    }
    return null;
  };
  const trades = engine.trades;
  const open = [...trades].reverse().find((t) => t.status === "open") ?? null;
  const latest = trades.length ? trades[trades.length - 1] : null;
  const justExited = latest != null && latest.status === "closed" && latest.exitIndex != null && last - latest.exitIndex < EXITED_BARS;
  let position = "Waiting";
  if (open) position = open.side === "BUY" ? "Long" : "Short";
  else if (justExited) position = "Exited";
  const levelsFrom = open ?? (justExited ? latest : null);
  const armed = preview?.kind === "setup" ? preview.side : (engine.setups.BUY ?? engine.setups.SELL)?.side;
  const setupSide = preview?.side ?? armed ?? null;
  let signal = "NONE";
  if (open) signal = open.side;
  else if (latest && latest.entryIndex === last) signal = latest.side;
  const lv = levelsFrom;
  const entry = lv?.entryPrice ?? preview?.entry ?? null;
  const range = engine.range;
  const close = last >= 0 ? tracker.bars[last].close : null;
  return {
    market,
    marketName: SMC_MARKET_NAMES[market],
    trend: htfTrend ?? ltfTrend,
    ltfTrend,
    htfTrend,
    structure: tracker.structureText(),
    lastBos: lastOf("BOS"),
    lastChoch: lastOf("CHoCH"),
    setup: setupSide === "BUY" ? "Buy Setup" : setupSide === "SELL" ? "Sell Setup" : "None",
    setupUnconfirmed: setupSide != null,
    signal,
    entry,
    sl: lv ? lv.slNow : preview?.sl ?? null,
    tp1: lv?.tp1 ?? preview?.tp1 ?? null,
    tp2: lv?.tp2 ?? preview?.tp2 ?? null,
    tpFinal: lv?.tpFinal ?? preview?.tpFinal ?? null,
    rr: lv?.rr ?? preview?.rr ?? null,
    position,
    zone: range && close != null ? pdZone(close, range.lo, range.hi, cfg.pdThreshold) : null,
    lastPrice: close
  };
}
function pdZone(price, lo, hi, threshold) {
  const pos = (price - lo) / (hi - lo);
  if (Math.abs(pos - 0.5) <= 0.05) return "equilibrium";
  if (pos < threshold) return "discount";
  if (pos > 1 - threshold) return "premium";
  return "equilibrium";
}
function istSessionStart(now) {
  const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return candleTs(`${day}T00:00:00`);
}

// ../palagai/src/app/core/charts/smc/smc-alerts.ts
var SmcAlertTracker = class {
  seen = /* @__PURE__ */ new Map();
  /**
   * @param scope    one stream, e.g. `nifty|15m`
   * @param events   every alert the engine currently derives for it
   * @param enabled  types the user wants to hear about
   * @returns        events not announced before, oldest first
   */
  ingest(scope, events, enabled = null) {
    let known = this.seen.get(scope);
    if (!known) {
      known = new Set(events.map((e) => e.id));
      this.seen.set(scope, known);
      return [];
    }
    const fresh = [];
    for (const event of events) {
      if (known.has(event.id)) continue;
      known.add(event.id);
      if (!enabled || enabled.has(event.type)) fresh.push(event);
    }
    return fresh;
  }
  /** Forget a stream, e.g. after the timeframe or date changed. */
  reset(scope) {
    if (scope) this.seen.delete(scope);
    else this.seen.clear();
  }
};

// ../palagai/src/app/core/utils/option-chain.util.ts
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

// ../palagai/src/app/core/utils/crude-option.util.ts
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
function crudeMiniLotSize(lotSize) {
  const n = Math.floor(Number(lotSize) || 0);
  return Math.max(10, n > 0 ? n : 10);
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
    lotSize: 10,
    lastPrice: 0
  };
}

// ../palagai/src/app/core/orders/atm-order.util.ts
var INDEX_KIND = {
  nifty: "nifty",
  bank: "banknifty"
};
function buildAtmOrderPlan(params) {
  const { book, instruments, side, spot, asOfDateTime } = params;
  const lots = Math.floor(params.lots);
  if (!Number.isFinite(spot) || spot <= 0) {
    return { ok: false, reason: "No live price for this book yet." };
  }
  if (!Number.isFinite(lots) || lots < 1) {
    return { ok: false, reason: "Lots must be at least 1." };
  }
  if (!instruments.length) {
    return {
      ok: false,
      reason: "Instrument list is empty. Refresh instruments in Settings."
    };
  }
  const direction = side === "CE" ? "BUY" : "SELL";
  const kind = INDEX_KIND[book];
  const resolved = kind ? resolveAtmWeeklyOption({ instruments, kind, direction, spot, asOfDateTime }) : resolveAtmCrudeMiniOption({ instruments, direction, spot, asOfDateTime });
  if (resolved.source === "synthetic") {
    return {
      ok: false,
      reason: kind ? "No live ATM contract in the instrument list. Refresh instruments in Settings." : "No live CRUDEOILM ATM contract. Refresh instruments in Settings \u2014 the front month rolls monthly."
    };
  }
  const option = resolved.instrument;
  if (!option.instrumentToken) {
    return { ok: false, reason: "Resolved contract has no Kite token; refusing to order." };
  }
  const crude = !kind;
  const unitsPerLot = crude ? crudeMiniLotSize(option.lotSize) : lotUnits(option);
  const quantity = (crude ? 1 : lotUnits(option)) * lots;
  return {
    ok: true,
    ticket: {
      book,
      side,
      tradingSymbol: option.tradingSymbol,
      instrumentToken: option.instrumentToken,
      exchange: crude ? "MCX" : "NFO",
      product: "MIS",
      strike: option.strike,
      expiry: option.expiry,
      lots,
      quantity,
      unitsPerLot,
      spot
    }
  };
}
function atmOrderFields(ticket) {
  return {
    exchange: ticket.exchange,
    tradingsymbol: ticket.tradingSymbol,
    transaction_type: "BUY",
    order_type: "MARKET",
    quantity: String(ticket.quantity),
    product: ticket.product,
    validity: "DAY",
    market_protection: "-1",
    // Distinct from the desk's PALAGAI tag so manual buys are separable in the
    // order book, and so the desk's own fill seeding never counts them.
    tag: "PALAGAI_CHART"
  };
}
function lotUnits(option) {
  return Math.max(1, Math.floor(Number(option.lotSize) || 0) || 1);
}

// ../palagai/src/app/core/constants/instruments.const.ts
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
var TESTER_TAB_IDS = [NIFTY_50_INSTRUMENT.id, BANK_NIFTY_INSTRUMENT.id];

// ../palagai/src/app/core/utils/instrument-resolver.util.ts
function resolveCrudeOilMiniFuturesToken(instruments, asOf) {
  return resolveMcxMiniFuturesToken(instruments, ["CRUDEOILM"], asOf);
}
function resolveMcxMiniFuturesToken(instruments, prefixes, asOf) {
  const today = startOfDay3(asOf ?? /* @__PURE__ */ new Date());
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

// ../palagai/src/app/core/paper-desk/lots-from-funds.ts
var RS_PER_LOT = 4e4;
var CRUDE_LOTS_PER_BAND = 3;
var MAX_DESK_LOTS = 10;
var MAX_CRUDE_LOTS = MAX_DESK_LOTS * CRUDE_LOTS_PER_BAND;
function lotsFromAvailableFunds(capitalRs, book = "index") {
  const c = Math.max(0, Math.floor(Number(capitalRs) || 0));
  const nifty = !(c > 0) ? 1 : Math.min(MAX_DESK_LOTS, Math.max(1, Math.floor(c / RS_PER_LOT)));
  if (book !== "crude") return nifty;
  return Math.min(MAX_CRUDE_LOTS, Math.max(CRUDE_LOTS_PER_BAND, nifty * CRUDE_LOTS_PER_BAND));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RS_PER_LOT,
  SmcAlertTracker,
  analyzeSmc,
  atmOrderFields,
  buildAtmOrderPlan,
  lotsFromAvailableFunds,
  resolveCrudeOilMiniFuturesToken
});
