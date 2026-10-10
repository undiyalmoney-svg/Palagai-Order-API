'use strict';

const COL = {
  experiments: 'research_experiments',
  strategies: 'research_strategies',
  accounts: 'research_accounts',
  instruments: 'research_instruments',
  candles: 'research_candles',
  signals: 'research_signals',
  trades: 'research_trades',
  snapshots: 'research_snapshots',
  events: 'research_events',
  summaries: 'research_daily_summaries',
  locks: 'research_locks',
};

function matchTrade(t, q) {
  if (q.strategyId && t.strategyId !== q.strategyId) return false;
  if (q.symbol && t.symbol !== q.symbol) return false;
  if (q.direction && t.direction !== q.direction) return false;
  if (q.status && t.status !== q.status) return false;
  if (q.accountId && t.accountId !== q.accountId) return false;
  if (q.from && t.tradingDate < q.from) return false;
  if (q.to && t.tradingDate > q.to) return false;
  return true;
}

class MemoryStore {
  constructor() {
    this.experiments = [];
    this.strategies = [];
    this.accounts = [];
    this.instruments = [];
    this.candleRows = [];
    this.signals = [];
    this.trades = [];
    this.snapshotRows = [];
    this.events = [];
    this.summaries = [];
    this.locks = [];
    this.kind = 'memory';
  }

  async ready() {
    return true;
  }

  async saveExperiment(doc) {
    const i = this.experiments.findIndex((e) => e.experimentId === doc.experimentId);
    if (i >= 0) this.experiments[i] = doc;
    else this.experiments.push(doc);
    return doc;
  }

  async getExperiment() {
    return this.experiments[0] || null;
  }

  async saveStrategy(doc) {
    const i = this.strategies.findIndex((s) => s.strategyId === doc.strategyId && s.version === doc.version);
    if (i >= 0) this.strategies[i] = doc;
    else this.strategies.push(doc);
    return doc;
  }

  async listStrategies() {
    return this.strategies.slice();
  }

  async saveAccount(doc) {
    const i = this.accounts.findIndex((a) => a.accountId === doc.accountId);
    if (i >= 0) this.accounts[i] = doc;
    else this.accounts.push(doc);
    return doc;
  }

  async listAccounts(experimentId) {
    return this.accounts.filter((a) => !experimentId || a.experimentId === experimentId);
  }

  async upsertInstrument(doc) {
    const i = this.instruments.findIndex((r) => r.symbol === doc.symbol && r.universeDate === doc.universeDate);
    if (i >= 0) this.instruments[i] = { ...this.instruments[i], ...doc };
    else this.instruments.push(doc);
    return doc;
  }

  async listInstruments(universeDate) {
    return this.instruments.filter((r) => !universeDate || r.universeDate === universeDate);
  }

  async upsertCandle(candle) {
    const key = `${candle.symbol}|${candle.interval}|${candle.startTime}`;
    const i = this.candleRows.findIndex((c) => `${c.symbol}|${c.interval}|${c.startTime}` === key);
    if (i >= 0) this.candleRows[i] = candle;
    else this.candleRows.push(candle);
    return candle;
  }

  async candles({ symbol, interval = '1m', from, to } = {}) {
    return this.candleRows
      .filter((c) => (!symbol || c.symbol === symbol) && c.interval === interval)
      .filter((c) => !from || c.startTime >= from)
      .filter((c) => !to || c.startTime <= to)
      .slice()
      .sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
  }

  async insertSignal(signal) {
    if (this.signals.some((s) => s.signalId === signal.signalId)) {
      return { signal: this.signals.find((s) => s.signalId === signal.signalId), duplicate: true };
    }
    this.signals.push(signal);
    return { signal, duplicate: false };
  }

  async listSignals(q = {}) {
    return this.signals.filter((s) => {
      if (q.symbol && s.symbol !== q.symbol) return false;
      if (q.strategyId && s.strategyId !== q.strategyId) return false;
      if (q.accepted != null && s.accepted !== q.accepted) return false;
      if (q.from && s.tradingDate < q.from) return false;
      if (q.to && s.tradingDate > q.to) return false;
      return true;
    });
  }

  async insertTrade(trade) {
    const existing = this.trades.find((t) => t.idempotencyKey === trade.idempotencyKey);
    if (existing) return { trade: existing, duplicate: true };
    this.trades.push(trade);
    return { trade, duplicate: false };
  }

  async saveTrade(trade) {
    const i = this.trades.findIndex((t) => t.tradeId === trade.tradeId);
    if (i >= 0) this.trades[i] = trade;
    else this.trades.push(trade);
    return trade;
  }

  async listTrades(q = {}) {
    const rows = this.trades.filter((t) => matchTrade(t, q)).sort((a, b) => (a.entryTime < b.entryTime ? 1 : -1));
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
    const start = (page - 1) * limit;
    return { trades: rows.slice(start, start + limit), total: rows.length, page, limit };
  }

  async openTrades() {
    return this.trades.filter((t) => t.status === 'OPEN');
  }

  async addSnapshot(doc) {
    this.snapshotRows.push(doc);
    return doc;
  }

  async snapshots(accountId) {
    return this.snapshotRows.filter((s) => !accountId || s.accountId === accountId).slice().sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  }

  async addEvent(doc) {
    this.events.push(doc);
    if (this.events.length > 2000) this.events.splice(0, this.events.length - 2000);
    return doc;
  }

  async listEvents(limit = 100) {
    return this.events.slice(-limit).reverse();
  }

  async upsertSummary(doc) {
    const i = this.summaries.findIndex((s) => s.accountId === doc.accountId && s.tradingDate === doc.tradingDate);
    if (i >= 0) this.summaries[i] = doc;
    else this.summaries.push(doc);
    return doc;
  }

  async listSummaries(q = {}) {
    return this.summaries.filter((s) => {
      if (q.accountId && s.accountId !== q.accountId) return false;
      if (q.from && s.tradingDate < q.from) return false;
      if (q.to && s.tradingDate > q.to) return false;
      return true;
    });
  }

  async tryLock(name, ttlMs, owner) {
    const now = Date.now();
    const row = this.locks.find((l) => l.name === name);
    if (row && row.expiresAt > now && row.owner !== owner) return false;
    const next = { name, owner, expiresAt: now + ttlMs };
    if (row) Object.assign(row, next);
    else this.locks.push(next);
    return true;
  }

  async releaseLock(name, owner) {
    const i = this.locks.findIndex((l) => l.name === name && l.owner === owner);
    if (i >= 0) this.locks.splice(i, 1);
  }
}

class MongoStore {
  constructor(db) {
    this.db = db;
    this.kind = 'mongo';
    this.indexed = false;
  }

  col(name) {
    return this.db.collection(name);
  }

  async ready() {
    if (this.indexed) return true;
    await this.col(COL.trades).createIndex({ idempotencyKey: 1 }, { unique: true });
    await this.col(COL.trades).createIndex({ tradingDate: 1, strategyId: 1, symbol: 1 });
    await this.col(COL.trades).createIndex({ status: 1, accountId: 1 });
    await this.col(COL.signals).createIndex({ signalId: 1 }, { unique: true });
    await this.col(COL.candles).createIndex({ symbol: 1, interval: 1, startTime: 1 }, { unique: true });
    await this.col(COL.snapshots).createIndex({ accountId: 1, timestamp: 1 });
    await this.col(COL.summaries).createIndex({ accountId: 1, tradingDate: 1 }, { unique: true });
    await this.col(COL.events).createIndex({ timestamp: -1 });
    await this.col(COL.locks).createIndex({ name: 1 }, { unique: true });
    await this.col(COL.instruments).createIndex({ symbol: 1, universeDate: 1 }, { unique: true });
    this.indexed = true;
    return true;
  }

  async saveExperiment(doc) {
    await this.col(COL.experiments).updateOne({ experimentId: doc.experimentId }, { $set: doc }, { upsert: true });
    return doc;
  }

  async getExperiment() {
    return this.col(COL.experiments).findOne({}, { sort: { createdAt: 1 }, projection: { _id: 0 } });
  }

  async saveStrategy(doc) {
    await this.col(COL.strategies).updateOne(
      { strategyId: doc.strategyId, version: doc.version },
      { $set: doc },
      { upsert: true },
    );
    return doc;
  }

  async listStrategies() {
    return this.col(COL.strategies).find({}, { projection: { _id: 0 } }).toArray();
  }

  async saveAccount(doc) {
    await this.col(COL.accounts).updateOne({ accountId: doc.accountId }, { $set: doc }, { upsert: true });
    return doc;
  }

  async listAccounts(experimentId) {
    const q = experimentId ? { experimentId } : {};
    return this.col(COL.accounts).find(q, { projection: { _id: 0 } }).toArray();
  }

  async upsertInstrument(doc) {
    await this.col(COL.instruments).updateOne(
      { symbol: doc.symbol, universeDate: doc.universeDate },
      { $set: doc },
      { upsert: true },
    );
    return doc;
  }

  async listInstruments(universeDate) {
    const q = universeDate ? { universeDate } : {};
    return this.col(COL.instruments).find(q, { projection: { _id: 0 } }).toArray();
  }

  async upsertCandle(candle) {
    await this.col(COL.candles).updateOne(
      { symbol: candle.symbol, interval: candle.interval, startTime: candle.startTime },
      { $set: candle },
      { upsert: true },
    );
    return candle;
  }

  async candles({ symbol, interval = '1m', from, to } = {}) {
    const q = { interval };
    if (symbol) q.symbol = symbol;
    if (from || to) {
      q.startTime = {};
      if (from) q.startTime.$gte = from;
      if (to) q.startTime.$lte = to;
    }
    return this.col(COL.candles).find(q, { projection: { _id: 0 } }).sort({ startTime: 1 }).toArray();
  }

  async insertSignal(signal) {
    try {
      await this.col(COL.signals).insertOne(signal);
      return { signal, duplicate: false };
    } catch (err) {
      if (err.code === 11000) {
        const existing = await this.col(COL.signals).findOne({ signalId: signal.signalId }, { projection: { _id: 0 } });
        return { signal: existing, duplicate: true };
      }
      throw err;
    }
  }

  async listSignals(q = {}) {
    const query = {};
    if (q.symbol) query.symbol = q.symbol;
    if (q.strategyId) query.strategyId = q.strategyId;
    if (q.accepted != null) query.accepted = q.accepted;
    if (q.from || q.to) {
      query.tradingDate = {};
      if (q.from) query.tradingDate.$gte = q.from;
      if (q.to) query.tradingDate.$lte = q.to;
    }
    return this.col(COL.signals).find(query, { projection: { _id: 0 } }).toArray();
  }

  async insertTrade(trade) {
    try {
      await this.col(COL.trades).insertOne({ ...trade });
      return { trade, duplicate: false };
    } catch (err) {
      if (err.code === 11000) {
        const existing = await this.col(COL.trades).findOne({ idempotencyKey: trade.idempotencyKey }, { projection: { _id: 0 } });
        return { trade: existing, duplicate: true };
      }
      throw err;
    }
  }

  async saveTrade(trade) {
    await this.col(COL.trades).updateOne({ tradeId: trade.tradeId }, { $set: trade }, { upsert: true });
    return trade;
  }

  async listTrades(q = {}) {
    const query = {};
    if (q.strategyId) query.strategyId = q.strategyId;
    if (q.symbol) query.symbol = q.symbol;
    if (q.direction) query.direction = q.direction;
    if (q.status) query.status = q.status;
    if (q.accountId) query.accountId = q.accountId;
    if (q.from || q.to) {
      query.tradingDate = {};
      if (q.from) query.tradingDate.$gte = q.from;
      if (q.to) query.tradingDate.$lte = q.to;
    }
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
    const total = await this.col(COL.trades).countDocuments(query);
    const trades = await this.col(COL.trades)
      .find(query, { projection: { _id: 0 } })
      .sort({ entryTime: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();
    return { trades, total, page, limit };
  }

  async openTrades() {
    return this.col(COL.trades).find({ status: 'OPEN' }, { projection: { _id: 0 } }).toArray();
  }

  async addSnapshot(doc) {
    await this.col(COL.snapshots).insertOne(doc);
    return doc;
  }

  async snapshots(accountId) {
    const q = accountId ? { accountId } : {};
    return this.col(COL.snapshots).find(q, { projection: { _id: 0 } }).sort({ timestamp: 1 }).toArray();
  }

  async addEvent(doc) {
    await this.col(COL.events).insertOne(doc);
    return doc;
  }

  async listEvents(limit = 100) {
    return this.col(COL.events).find({}, { projection: { _id: 0 } }).sort({ timestamp: -1 }).limit(limit).toArray();
  }

  async upsertSummary(doc) {
    await this.col(COL.summaries).updateOne(
      { accountId: doc.accountId, tradingDate: doc.tradingDate },
      { $set: doc },
      { upsert: true },
    );
    return doc;
  }

  async listSummaries(q = {}) {
    const query = {};
    if (q.accountId) query.accountId = q.accountId;
    if (q.from || q.to) {
      query.tradingDate = {};
      if (q.from) query.tradingDate.$gte = q.from;
      if (q.to) query.tradingDate.$lte = q.to;
    }
    return this.col(COL.summaries).find(query, { projection: { _id: 0 } }).toArray();
  }

  async tryLock(name, ttlMs, owner) {
    const now = new Date();
    const expires = new Date(Date.now() + ttlMs);
    try {
      await this.col(COL.locks).insertOne({ name, owner, expiresAt: expires });
      return true;
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
    const res = await this.col(COL.locks).findOneAndUpdate(
      { name, $or: [{ expiresAt: { $lte: now } }, { owner }] },
      { $set: { owner, expiresAt: expires } },
      { returnDocument: 'after' },
    );
    return Boolean(res && res.owner === owner);
  }

  async releaseLock(name, owner) {
    await this.col(COL.locks).deleteOne({ name, owner });
  }
}

module.exports = { MemoryStore, MongoStore, COL };
