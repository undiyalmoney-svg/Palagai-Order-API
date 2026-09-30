'use strict';

/**
 * SIMULATED market-data provider (mock/paper provider).
 *
 * Used when no broker/market-data credentials are available so the whole
 * application still runs end to end. Prices are generated deterministically
 * (seeded PRNG) from a market-regime path, sector cycles and persistent
 * stock-level drift. Consequences you must keep in mind:
 *
 *  - It is NOT real market data. The generator deliberately contains
 *    persistent sector/stock drift (i.e. a momentum effect), so strategy
 *    results on this data demonstrate how the engine behaves, not how it would
 *    perform in real markets.
 *  - History is append-only: generating more days never changes past days, so
 *    stored rows stay valid as the calendar advances.
 */

const { BENCHMARK, UNIVERSE } = require('./universe');
const { makeRng } = require('../utils/rng');
const { addDays, isTradingDay, lastCompletedTradingDate, marketStatus, toIstParts } = require('../utils/dates');
const { roundPrice, round } = require('../utils/math');

const HISTORY_START = '2018-01-01';

const STATES = {
  BULL: { mu: 0.0007, sigma: 0.0075 },
  SIDE: { mu: 0.0001, sigma: 0.0085 },
  BEAR: { mu: -0.001, sigma: 0.0135 },
  CRASH: { mu: -0.0045, sigma: 0.026 },
};

/** Macro path by date window; dates after the last window follow a Markov chain. */
const TIMELINE = [
  ['2018-01-01', '2018-09-15', 'BULL'],
  ['2018-09-16', '2019-03-15', 'BEAR'],
  ['2019-03-16', '2019-12-31', 'SIDE'],
  ['2020-01-01', '2020-02-17', 'BULL'],
  ['2020-02-18', '2020-03-23', 'CRASH'],
  ['2020-03-24', '2021-09-30', 'BULL'],
  ['2021-10-01', '2022-06-30', 'BEAR'],
  ['2022-07-01', '2023-03-15', 'BULL'],
  ['2023-03-16', '2023-04-15', 'SIDE'],
  ['2023-04-16', '2024-09-30', 'BULL'],
  ['2024-10-01', '2025-03-31', 'BEAR'],
  ['2025-04-01', '2026-04-30', 'BULL'],
  ['2026-05-01', '2026-06-30', 'SIDE'],
  ['2026-07-01', '2026-12-31', 'BULL'],
];

const MARKOV = {
  BULL: { BULL: 0.985, SIDE: 0.012, BEAR: 0.003, CRASH: 0 },
  SIDE: { BULL: 0.02, SIDE: 0.965, BEAR: 0.015, CRASH: 0 },
  BEAR: { BULL: 0.01, SIDE: 0.03, BEAR: 0.955, CRASH: 0.005 },
  CRASH: { BULL: 0.05, SIDE: 0.05, BEAR: 0.1, CRASH: 0.8 },
};

const SECTOR_BETA = {
  ENERGY: 1.0,
  IT: 0.9,
  BANK: 1.15,
  FINANCE: 1.25,
  AUTO: 1.1,
  PHARMA: 0.75,
  FMCG: 0.6,
  METALS: 1.4,
  INFRA: 1.1,
  CEMENT: 0.95,
  CONSUMER: 1.0,
  TELECOM: 0.8,
};

const SECTORS = Object.keys(SECTOR_BETA);

function scriptedState(date) {
  for (const [from, to, state] of TIMELINE) {
    if (date >= from && date <= to) return state;
  }
  return null;
}

function nextState(state, u) {
  const row = MARKOV[state];
  let acc = 0;
  for (const k of Object.keys(row)) {
    acc += row[k];
    if (u < acc) return k;
  }
  return state;
}

class SyntheticProvider {
  constructor({ seed = 'palagai-sim-v1', now = () => new Date() } = {}) {
    this.id = 'synthetic';
    this.label = 'Simulated data (mock provider)';
    this.isSimulated = true;
    this.seed = seed;
    this.nowFn = now;
    this.cache = null;
  }

  async status() {
    return {
      id: this.id,
      label: this.label,
      simulated: true,
      ready: true,
      note: 'Deterministic simulated prices. Not real market data.',
    };
  }

  async listInstruments() {
    return UNIVERSE.map((u) => ({ symbol: u.symbol, name: u.name, sector: u.sector }));
  }

  benchmarkSymbol() {
    return BENCHMARK.symbol;
  }

  lastDate() {
    return lastCompletedTradingDate(this.nowFn());
  }

  ensureGenerated() {
    const end = this.lastDate();
    if (this.cache && this.cache.end >= end) return this.cache;
    this.cache = this.generate(end);
    return this.cache;
  }

  generate(end) {
    const rng = makeRng(`${this.seed}:market`);
    const dates = [];
    for (let d = HISTORY_START; d <= end; d = addDays(d, 1)) {
      if (isTradingDay(d)) dates.push(d);
    }
    const n = dates.length;

    const marketRet = new Float64Array(n);
    const states = new Array(n);
    let state = 'BULL';
    for (let i = 0; i < n; i += 1) {
      const scripted = scriptedState(dates[i]);
      const u = rng.rand();
      state = scripted || nextState(state, u);
      states[i] = state;
      const { mu, sigma } = STATES[state];
      const z = rng.normal();
      const fat = rng.rand() < 0.04 ? 1.8 : 1;
      marketRet[i] = mu + sigma * z * fat;
    }

    const sectorTheta = {};
    const sectorRng = {};
    for (const s of SECTORS) {
      sectorTheta[s] = 0;
      sectorRng[s] = makeRng(`${this.seed}:sector:${s}`);
    }
    const sectorRet = {};
    for (const s of SECTORS) sectorRet[s] = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      for (const s of SECTORS) {
        const r = sectorRng[s];
        sectorTheta[s] = sectorTheta[s] * (1 - 1 / 70) + 0.00007 * r.normal();
        sectorRet[s][i] = sectorTheta[s] + 0.004 * r.normal();
      }
    }

    const series = new Map();
    for (const u of UNIVERSE) {
      series.set(u.symbol, this.generateStock(u, dates, marketRet, states, sectorRet[u.sector]));
    }

    const idx = new Float64Array(n);
    const idxSeries = { symbol: BENCHMARK.symbol, name: BENCHMARK.name, sector: 'INDEX', rows: [] };
    let level = BENCHMARK.basePrice;
    const idxRng = makeRng(`${this.seed}:index`);
    let prev = level;
    for (let i = 0; i < n; i += 1) {
      level *= 1 + marketRet[i];
      idx[i] = level;
      const open = prev * (1 + 0.25 * marketRet[i] + 0.0015 * idxRng.normal());
      const hi = Math.max(open, level) * (1 + Math.abs(0.003 * idxRng.normal()));
      const lo = Math.min(open, level) * (1 - Math.abs(0.003 * idxRng.normal()));
      const vol = Math.round(250_000_000 * Math.exp(0.15 * idxRng.normal()) * (1 + 14 * Math.abs(marketRet[i])));
      idxSeries.rows.push({
        date: dates[i],
        open: round(open, 2),
        high: round(hi, 2),
        low: round(lo, 2),
        close: round(level, 2),
        volume: vol,
      });
      prev = level;
    }
    series.set(BENCHMARK.symbol, idxSeries);
    return { end, dates, series, states };
  }

  generateStock(u, dates, marketRet, states, secRet) {
    const rng = makeRng(`${this.seed}:stock:${u.symbol}`);
    const beta = (SECTOR_BETA[u.sector] || 1) * (0.85 + 0.3 * rng.rand());
    const idioSigma = 0.007 + 0.006 * rng.rand();
    const tradedValue = 4e8 * Math.exp(1.2 * rng.normal()) + 6e7;
    const rows = [];
    let alpha = 0;
    let price = u.basePrice;
    let prevClose = price;
    const listed = u.listed || HISTORY_START;
    for (let i = 0; i < dates.length; i += 1) {
      const date = dates[i];
      alpha = alpha * (1 - 1 / 95) + 0.00006 * rng.normal();
      const zi = rng.normal();
      const zgap = rng.normal();
      const zrange1 = rng.normal();
      const zrange2 = rng.normal();
      const zvol = rng.normal();
      if (date < listed) continue;
      let r = alpha + beta * marketRet[i] + 0.9 * secRet[i] + idioSigma * zi;
      r = Math.max(-0.18, Math.min(0.18, r));
      const first = rows.length === 0;
      price = first ? u.basePrice : prevClose * (1 + r);
      const open = first ? price : prevClose * (1 + 0.3 * r + 0.003 * zgap);
      const hi = Math.max(open, price) * (1 + Math.abs(0.007 * zrange1) + Math.abs(r) * 0.15);
      const lo = Math.min(open, price) * (1 - Math.abs(0.007 * zrange2) - Math.abs(r) * 0.15);
      const volume = Math.max(
        1000,
        Math.round((tradedValue / price) * Math.exp(0.3 * zvol) * (1 + 16 * Math.abs(r))),
      );
      rows.push({
        date,
        open: roundPrice(open),
        high: roundPrice(hi),
        low: roundPrice(lo),
        close: roundPrice(price),
        volume,
      });
      prevClose = price;
    }
    return { symbol: u.symbol, name: u.name, sector: u.sector, rows };
  }

  async fetchDaily(symbol, from, to) {
    const { series } = this.ensureGenerated();
    const s = series.get(symbol);
    if (!s) throw new Error(`Unknown symbol ${symbol}`);
    return s.rows.filter((r) => r.date >= from && r.date <= to);
  }

  async fetchQuotes(symbols, now = this.nowFn()) {
    const { series } = this.ensureGenerated();
    const status = marketStatus(now);
    const p = toIstParts(now);
    const minuteKey = Math.floor(now.getTime() / 60_000);
    const out = {};
    for (const symbol of symbols) {
      const s = series.get(symbol);
      if (!s || !s.rows.length) continue;
      const lastBar = s.rows[s.rows.length - 1];
      let last = lastBar.close;
      let open = lastBar.open;
      let high = lastBar.high;
      let low = lastBar.low;
      let volume = lastBar.volume;
      let prevClose = s.rows.length > 1 ? s.rows[s.rows.length - 2].close : lastBar.close;
      if (status.open) {
        const r = makeRng(`${this.seed}:tick:${symbol}:${minuteKey}`);
        const dayRng = makeRng(`${this.seed}:day:${symbol}:${status.date}`);
        const dayDrift = 0.008 * dayRng.normal();
        const minutesIn = p.hour * 60 + p.minute - (9 * 60 + 15);
        const frac = Math.max(0.02, Math.min(1, minutesIn / 375));
        prevClose = lastBar.close;
        last = roundPrice(prevClose * (1 + dayDrift * frac + 0.0015 * r.normal()));
        open = roundPrice(prevClose * (1 + 0.2 * dayDrift));
        high = Math.max(open, last);
        low = Math.min(open, last);
        volume = Math.round(lastBar.volume * frac);
      }
      out[symbol] = { symbol, last, open, high, low, prevClose, volume, ts: now.toISOString(), simulated: true };
    }
    return out;
  }
}

module.exports = { SyntheticProvider, HISTORY_START };
