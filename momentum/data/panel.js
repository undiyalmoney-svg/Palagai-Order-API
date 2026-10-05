'use strict';

const { computeBase, computeParamDependent } = require('../indicators/indicators');
const { computeFeatures } = require('../engine/features');
const { indicatorKey } = require('../config/defaults');
const { percentRank, mean } = require('../utils/math');

/**
 * MarketPanel — calendar-aligned OHLCV for the whole universe.
 *
 * The panel itself may contain the full history (including the "future" of a
 * backtest date). The decision engine never sees the panel: it only gets a
 * MarketView bound to a single bar index, which can only read bars <= that
 * index. That is the look-ahead firewall.
 */
class MarketPanel {
  constructor({ dates, series, benchmark }) {
    this.dates = dates;
    this.benchmark = benchmark;
    this.dateIndex = new Map(dates.map((d, i) => [d, i]));
    this.meta = new Map();
    this.data = new Map();
    const n = dates.length;
    for (const s of series) {
      const arrays = {
        open: new Float64Array(n).fill(NaN),
        high: new Float64Array(n).fill(NaN),
        low: new Float64Array(n).fill(NaN),
        close: new Float64Array(n).fill(NaN),
        volume: new Float64Array(n).fill(NaN),
      };
      let firstIdx = -1;
      for (const r of s.rows) {
        const i = this.dateIndex.get(r.date);
        if (i === undefined) continue;
        arrays.open[i] = r.open;
        arrays.high[i] = r.high;
        arrays.low[i] = r.low;
        arrays.close[i] = r.close;
        arrays.volume[i] = r.volume;
        if (firstIdx < 0 || i < firstIdx) firstIdx = i;
      }
      if (firstIdx < 0) continue;
      this.meta.set(s.symbol, { symbol: s.symbol, name: s.name, sector: s.sector, firstIdx });
      this.data.set(s.symbol, arrays);
    }
    this.baseCache = new Map();
    this.indCache = new Map();
    this.featCache = new Map();
  }

  get length() {
    return this.dates.length;
  }

  get lastIndex() {
    return this.dates.length - 1;
  }

  symbols() {
    return [...this.meta.keys()].filter((s) => s !== this.benchmark);
  }

  sectorOf(symbol) {
    return this.meta.get(symbol)?.sector || 'OTHER';
  }

  nameOf(symbol) {
    return this.meta.get(symbol)?.name || symbol;
  }

  /** Index of the last trading day <= date (or -1 if the date precedes the data). */
  indexOnOrBefore(date) {
    if (this.dateIndex.has(date)) return this.dateIndex.get(date);
    let lo = 0;
    let hi = this.dates.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.dates[mid] <= date) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  base(symbol) {
    let b = this.baseCache.get(symbol);
    if (!b) {
      b = computeBase(this.data.get(symbol));
      this.baseCache.set(symbol, b);
    }
    return b;
  }

  indicators(symbol, params) {
    const key = `${symbol}|${indicatorKey(params)}`;
    let ind = this.indCache.get(key);
    if (!ind) {
      const base = this.base(symbol);
      ind = { ...base, ...computeParamDependent(this.data.get(symbol), params) };
      this.indCache.set(key, ind);
    }
    return ind;
  }

  featuresAt(symbol, idx, params) {
    const key = `${indicatorKey(params)}|${params.breakoutFreshBars}|${idx}|${symbol}`;
    let f = this.featCache.get(key);
    if (!f) {
      const ind = this.indicators(symbol, params);
      const bench = this.benchmark && this.data.has(this.benchmark) ? this.indicators(this.benchmark, params) : null;
      f = computeFeatures(ind, idx, bench, params);
      if (this.featCache.size > 400_000) this.featCache.clear();
      this.featCache.set(key, f);
    }
    return f;
  }

  view(idx, params) {
    return new MarketView(this, idx, params);
  }

  /** New panel containing only bars up to and including `idx` (used to prove no look-ahead). */
  truncate(idx) {
    const dates = this.dates.slice(0, idx + 1);
    const series = [];
    for (const [symbol, m] of this.meta) {
      const a = this.data.get(symbol);
      const rows = [];
      for (let i = m.firstIdx; i <= idx; i += 1) {
        if (Number.isNaN(a.close[i])) continue;
        rows.push({ date: this.dates[i], open: a.open[i], high: a.high[i], low: a.low[i], close: a.close[i], volume: a.volume[i] });
      }
      series.push({ symbol, name: m.name, sector: m.sector, rows });
    }
    return new MarketPanel({ dates, series, benchmark: this.benchmark });
  }
}

class MarketView {
  constructor(panel, idx, params) {
    this.panel = panel;
    this.idx = idx;
    this.params = params;
    this.asOf = panel.dates[idx];
    this.ctx = null;
    this.symbolList = null;
  }

  dateAt(i) {
    return i <= this.idx ? this.panel.dates[i] : null;
  }

  /** Symbols that have a bar on this date and enough history to evaluate. */
  symbols() {
    if (!this.symbolList) {
      this.symbolList = this.panel.symbols().filter((s) => {
        const m = this.panel.meta.get(s);
        return m.firstIdx <= this.idx && Number.isFinite(this.panel.data.get(s).close[this.idx]);
      });
    }
    return this.symbolList;
  }

  barsAvailable(symbol) {
    const m = this.panel.meta.get(symbol);
    return m ? this.idx - m.firstIdx + 1 : 0;
  }

  sector(symbol) {
    return this.panel.sectorOf(symbol);
  }

  name(symbol) {
    return this.panel.nameOf(symbol);
  }

  has(symbol) {
    return this.symbols().includes(symbol);
  }

  features(symbol) {
    if (!this.panel.data.has(symbol)) return null;
    if (this.idx > this.panel.lastIndex) return null;
    return this.panel.featuresAt(symbol, this.idx, this.params);
  }

  featuresAtOffset(symbol, offset) {
    const i = this.idx - offset;
    if (i < 0) return null;
    return this.panel.featuresAt(symbol, i, this.params);
  }

  benchmarkFeatures() {
    return this.panel.benchmark ? this.features(this.panel.benchmark) : null;
  }

  /** Last `n` values (ending today) of a named indicator array. */
  indicatorWindow(symbol, name, n) {
    const arr = this.panel.indicators(symbol, this.params)[name];
    const out = [];
    for (let i = Math.max(0, this.idx - n + 1); i <= this.idx; i += 1) out.push(arr[i]);
    return out;
  }

  benchmarkCloses(n) {
    return this.closes(this.panel.benchmark, n);
  }

  closes(symbol, n) {
    const a = this.panel.data.get(symbol)?.close;
    if (!a) return [];
    const out = [];
    for (let i = Math.max(0, this.idx - n + 1); i <= this.idx; i += 1) out.push(a[i]);
    return out;
  }

  dailyReturns(symbol, n) {
    const c = this.closes(symbol, n + 1);
    const out = [];
    for (let i = 1; i < c.length; i += 1) {
      if (Number.isFinite(c[i]) && Number.isFinite(c[i - 1]) && c[i - 1] > 0) out.push(c[i] / c[i - 1] - 1);
      else out.push(0);
    }
    return out;
  }

  /** Highest close from `date` (inclusive) through today. Never reads beyond the view date. */
  highestCloseSince(symbol, date) {
    const a = this.panel.data.get(symbol)?.close;
    if (!a) return NaN;
    let start = this.panel.indexOnOrBefore(date);
    if (start < 0) start = 0;
    let m = -Infinity;
    for (let i = start; i <= this.idx; i += 1) if (a[i] > m) m = a[i];
    return m;
  }

  bar(symbol) {
    const d = this.panel.data.get(symbol);
    if (!d) return null;
    return {
      open: d.open[this.idx],
      high: d.high[this.idx],
      low: d.low[this.idx],
      close: d.close[this.idx],
      volume: d.volume[this.idx],
    };
  }

  price(symbol) {
    return this.panel.data.get(symbol)?.close[this.idx];
  }

  /** Cross-sectional context: percentile ranks, sector stats, breadth. Built once per view. */
  context() {
    if (this.ctx) return this.ctx;
    const syms = this.symbols().filter((s) => this.features(s)?.valid);
    const keys = ['d1', 'w1', 'm1', 'm3', 'm6', 'm12', 'm12x1'];
    const cols = {};
    for (const k of keys) cols[k] = [];
    const rs3 = [];
    const rs6 = [];
    const bySector = new Map();
    let aboveMid = 0;
    let aboveLong = 0;
    let pos3m = 0;
    let adv = 0;
    for (const s of syms) {
      const f = this.features(s);
      for (const k of keys) if (Number.isFinite(f.ret[k])) cols[k].push(f.ret[k]);
      if (Number.isFinite(f.rs.vsIndex3m)) rs3.push(f.rs.vsIndex3m);
      if (Number.isFinite(f.rs.vsIndex6m)) rs6.push(f.rs.vsIndex6m);
      if (f.trend.aboveMid) aboveMid += 1;
      if (f.trend.aboveLong) aboveLong += 1;
      if (f.ret.m3 > 0) pos3m += 1;
      if (f.ret.d1 > 0) adv += 1;
      const sec = this.sector(s);
      if (!bySector.has(sec)) bySector.set(sec, { m1: [], m3: [], aboveMid: 0, n: 0 });
      const b = bySector.get(sec);
      b.n += 1;
      if (Number.isFinite(f.ret.m1)) b.m1.push(f.ret.m1);
      if (Number.isFinite(f.ret.m3)) b.m3.push(f.ret.m3);
      if (f.trend.aboveMid) b.aboveMid += 1;
    }
    const sectors = new Map();
    for (const [sec, b] of bySector) {
      sectors.set(sec, {
        sector: sec,
        n: b.n,
        ret1m: b.m1.length ? mean(b.m1) : NaN,
        ret3m: b.m3.length ? mean(b.m3) : NaN,
        pctAboveMid: b.n ? b.aboveMid / b.n : NaN,
      });
    }
    const n = syms.length || 1;
    this.ctx = {
      n: syms.length,
      percentile: (key, value) => percentRank(cols[key] || [], value),
      percentileRs3: (v) => percentRank(rs3, v),
      percentileRs6: (v) => percentRank(rs6, v),
      sectors,
      breadth: {
        n: syms.length,
        pctAboveMid: aboveMid / n,
        pctAboveLong: aboveLong / n,
        pctPositive3m: pos3m / n,
        advancers: adv / n,
      },
    };
    return this.ctx;
  }
}

function panelFromStore(store, benchmark) {
  const stocks = new Map(store.listStocks().map((s) => [s.symbol, s]));
  const rows = store.allPriceRows();
  const bySymbol = new Map();
  for (const r of rows) {
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
    bySymbol.get(r.symbol).push(r);
  }
  const benchRows = bySymbol.get(benchmark) || [];
  const dates = benchRows.map((r) => r.date);
  if (!dates.length) throw new Error('No market data loaded yet - run a data sync first');
  const series = [];
  for (const [symbol, list] of bySymbol) {
    const meta = stocks.get(symbol) || { name: symbol, sector: 'OTHER' };
    series.push({ symbol, name: meta.name, sector: meta.sector, rows: list });
  }
  return new MarketPanel({ dates, series, benchmark });
}

module.exports = { MarketPanel, MarketView, panelFromStore };
