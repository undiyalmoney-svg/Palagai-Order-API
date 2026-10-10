'use strict';

const crypto = require('crypto');
const { DEFAULTS, STRATEGY_DEFS, START_PHRASE } = require('./config');
const { STRATEGIES, byId } = require('./strategies');
const { nifty50, UNIVERSE_DATE } = require('./universe');
const { assessEntry } = require('./risk');
const { applySlippage, resolveExit, slippageRupees, closeEconomics, cashDelta, round2 } = require('./paper');
const { summarizeTrades, maxDrawdown, equityFromClosedTrades } = require('./metrics');
const { sessionDate, minutesOfDay } = require('./time');
const { rowsToCsv, rowsToXlsx } = require('./export');

class ServiceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

class ResearchService {
  constructor({ store, feed = null, log = () => {} } = {}) {
    this.store = store;
    this.feed = feed;
    this.log = log;
    this.readyOnce = null;
    this.workerOwner = `pid-${process.pid}`;
  }

  async ensure() {
    if (!this.readyOnce) this.readyOnce = this._ensure();
    return this.readyOnce;
  }

  async _ensure() {
    await this.store.ready();
    let experiment = await this.store.getExperiment();
    if (!experiment) {
      const now = new Date().toISOString();
      experiment = {
        experimentId: 'exp-intraday-10w',
        name: '10-week intraday paper experiment',
        status: 'draft',
        startedAt: null,
        plannedEndAt: null,
        completedAt: null,
        configuration: { ...DEFAULTS },
        paperOnly: true,
        createdAt: now,
        updatedAt: now,
      };
      await this.store.saveExperiment(experiment);
    }
    const existing = await this.store.listStrategies();
    for (const def of STRATEGY_DEFS) {
      if (!existing.some((s) => s.strategyId === def.strategyId && s.version === def.version)) {
        const now = new Date().toISOString();
        await this.store.saveStrategy({
          ...def,
          parameters: { ...def.parameters },
          parentVersion: null,
          optimizationNotes: null,
          createdAt: now,
        });
      }
    }
    const accounts = await this.store.listAccounts(experiment.experimentId);
    const strategies = await this.store.listStrategies();
    for (const s of strategies.filter((row) => row.version === 1)) {
      if (!accounts.some((a) => a.strategyId === s.strategyId && a.strategyVersion === 1)) {
        await this.store.saveAccount(this.freshAccount(experiment, s));
      }
    }
    const instruments = await this.store.listInstruments(UNIVERSE_DATE);
    if (!instruments.length) {
      for (const row of nifty50()) await this.store.upsertInstrument(row);
    }
    await this.reconcile();
    return experiment;
  }

  freshAccount(experiment, strategy) {
    const capital = experiment.configuration.startingCapital;
    const now = new Date().toISOString();
    return {
      accountId: `${experiment.experimentId}:${strategy.strategyId}:v${strategy.version}`,
      experimentId: experiment.experimentId,
      strategyId: strategy.strategyId,
      strategyVersion: strategy.version,
      initialCapital: capital,
      cashBalance: capital,
      realizedPnl: 0,
      currentEquity: capital,
      startOfDayEquity: capital,
      dailyRealizedPnl: 0,
      tradingDate: null,
      riskConfiguration: { ...experiment.configuration },
      createdAt: now,
      updatedAt: now,
    };
  }

  configOf(experiment) {
    return { ...DEFAULTS, ...(experiment.configuration || {}) };
  }

  async readiness() {
    const experiment = await this.ensure();
    const instruments = await this.store.listInstruments(UNIVERSE_DATE);
    const strategies = await this.store.listStrategies();
    const feed = this.feedStatus();
    const checks = [
      { id: 'database', ok: this.store.kind === 'mongo', message: this.store.kind === 'mongo' ? 'MongoDB store is attached' : 'In-memory store. Set MONGODB_URI before starting the experiment.' },
      { id: 'paper-only', ok: true, message: 'Execution path is paper-only and cannot place real orders' },
      { id: 'universe', ok: instruments.filter((i) => i.eligible).length >= 50, message: `${instruments.length} instruments dated ${UNIVERSE_DATE}` },
      { id: 'strategies', ok: strategies.filter((s) => s.version === 1).length === 5, message: 'Five baseline strategies are stored' },
      { id: 'risk', ok: experiment.configuration.riskPerTrade > 0 && experiment.configuration.maxDailyLoss > 0, message: 'Risk configuration is present' },
      { id: 'kite', ok: feed.configured, message: feed.configured ? 'Kite credentials are configured' : 'Set KITE_API_KEY and KITE_ACCESS_TOKEN. No prices are invented.' },
      { id: 'tokens', ok: instruments.some((i) => i.instrumentToken), message: instruments.some((i) => i.instrumentToken) ? 'Instrument tokens are loaded' : 'Tokens load after a Kite instrument refresh' },
    ];
    return {
      ready: checks.every((c) => c.ok),
      checks,
      paperOnly: true,
    };
  }

  feedStatus() {
    if (!this.feed) {
      return { configured: false, connected: false, stale: true, lastTickAt: null, mode: 'waiting', message: 'Waiting for market data. No prices are being invented.' };
    }
    return this.feed.status();
  }

  async status(now = new Date()) {
    const experiment = await this.ensure();
    const accounts = await this.store.listAccounts(experiment.experimentId);
    const open = await this.store.openTrades();
    const marked = accounts.map((a) => this.markAccount(a, open));
    const combined = marked.reduce(
      (s, a) => {
        s.equity += a.currentEquity;
        s.cash += a.cashBalance;
        s.realized += a.realizedPnl;
        s.unrealized += a.unrealizedPnl;
        return s;
      },
      { equity: 0, cash: 0, realized: 0, unrealized: 0 },
    );
    combined.netPnl = round2(combined.equity - marked.reduce((s, a) => s + a.initialCapital, 0));
    combined.note = 'Sum of five independent accounts. This is not a single deployable pool of capital.';
    const tradingDays = new Set((await this.store.listSummaries()).map((d) => d.tradingDate)).size;
    return {
      experiment: { ...experiment, tradingDays, asOf: now.toISOString() },
      accounts: marked,
      combined: {
        ...combined,
        equity: round2(combined.equity),
        cash: round2(combined.cash),
        realized: round2(combined.realized),
        unrealized: round2(combined.unrealized),
      },
      feed: this.feedStatus(),
      paperOnly: true,
      dataMode: this.feedStatus().connected ? 'live' : 'waiting',
      disclaimer: 'Simulated results are not a guarantee of future real-money profitability.',
    };
  }

  markAccount(account, openTrades) {
    const mine = openTrades.filter((t) => t.accountId === account.accountId);
    let unrealized = 0;
    for (const t of mine) {
      const last = t.lastPrice || t.actualSimulatedEntryPrice;
      const gross = t.direction === 'LONG'
        ? (last - t.actualSimulatedEntryPrice) * t.quantity
        : (t.actualSimulatedEntryPrice - last) * t.quantity;
      unrealized += gross;
    }
    return {
      ...account,
      unrealizedPnl: round2(unrealized),
      openPositions: mine.length,
      currentEquity: round2(account.cashBalance + this.positionEquity(mine)),
    };
  }

  positionEquity(trades) {
    let extra = 0;
    for (const t of trades) {
      const last = t.lastPrice || t.actualSimulatedEntryPrice;
      if (t.direction === 'LONG') extra += last * t.quantity;
      else extra -= last * t.quantity;
    }
    return extra;
  }

  async configure(patch) {
    const experiment = await this.ensure();
    const next = { ...experiment.configuration };
    const allowed = ['riskPerTrade', 'maxOpenPositions', 'maxTradesPerDay', 'maxDailyLoss', 'maxNotionalPct', 'minRewardRisk', 'slippageBps', 'quoteStaleMs', 'openingRangeMinutes'];
    for (const key of allowed) {
      if (patch[key] != null) next[key] = Number(patch[key]);
    }
    if (next.riskPerTrade <= 0 || next.riskPerTrade > 0.05) throw new ServiceError('BAD_CONFIG', 'Risk per trade must be between 0 and 5%');
    if (next.maxDailyLoss <= 0 || next.maxDailyLoss > 0.2) throw new ServiceError('BAD_CONFIG', 'Daily loss limit must be between 0 and 20%');
    experiment.configuration = next;
    experiment.updatedAt = new Date().toISOString();
    await this.store.saveExperiment(experiment);
    await this.store.addEvent({ timestamp: experiment.updatedAt, severity: 'info', eventType: 'CONFIG', message: 'Configuration updated. History was kept.', metadata: patch });
    return experiment;
  }

  async start(body = {}) {
    if (body.live === true || String(body.mode || '').toUpperCase() === 'LIVE') {
      throw new ServiceError('PAPER_ONLY', 'This module cannot place real orders or switch into live trading.');
    }
    if (String(body.confirm || '') !== START_PHRASE) {
      throw new ServiceError('CONFIRM', `Type ${START_PHRASE} to start the paper experiment.`);
    }
    const ready = await this.readiness();
    if (!ready.ready) {
      throw new ServiceError('NOT_READY', 'Readiness checks have not passed.', 409);
    }
    const experiment = await this.ensure();
    if (experiment.status === 'running') return experiment;
    const now = new Date();
    experiment.status = 'running';
    experiment.startedAt = experiment.startedAt || now.toISOString();
    const end = new Date(now.getTime() + experiment.configuration.experimentWeeks * 7 * 24 * 3600 * 1000);
    experiment.plannedEndAt = end.toISOString();
    experiment.updatedAt = now.toISOString();
    await this.store.saveExperiment(experiment);
    await this.store.addEvent({ timestamp: now.toISOString(), severity: 'info', eventType: 'START', message: 'Paper experiment started. No real orders will be placed.', metadata: {} });
    return experiment;
  }

  async stop() {
    const experiment = await this.ensure();
    experiment.status = 'stopped';
    experiment.updatedAt = new Date().toISOString();
    await this.store.saveExperiment(experiment);
    await this.store.addEvent({ timestamp: experiment.updatedAt, severity: 'info', eventType: 'STOP', message: 'Paper experiment stopped. Open positions stay stored until reconciled.', metadata: {} });
    return experiment;
  }

  async strategies() {
    await this.ensure();
    return this.store.listStrategies();
  }

  async setEnabled(strategyId, enabled, version) {
    await this.ensure();
    const rows = (await this.store.listStrategies()).filter((s) => s.strategyId === strategyId);
    if (!rows.length) throw new ServiceError('NOT_FOUND', 'Unknown strategy', 404);
    const wanted = version == null || version === '' ? null : Number(version);
    const row = wanted == null
      ? rows.slice().sort((a, b) => b.version - a.version)[0]
      : rows.find((s) => s.version === wanted);
    if (!row) throw new ServiceError('NOT_FOUND', 'Unknown strategy version', 404);
    row.enabled = Boolean(enabled);
    await this.store.saveStrategy(row);
    if (enabled) {
      const experiment = await this.store.getExperiment();
      const accounts = await this.store.listAccounts(experiment.experimentId);
      if (!accounts.some((a) => a.strategyId === row.strategyId && a.strategyVersion === row.version)) {
        await this.store.saveAccount(this.freshAccount(experiment, row));
      }
    }
    return row;
  }

  async candidates(q = {}) {
    await this.ensure();
    const signals = await this.store.listSignals(q);
    return signals.slice(-200).reverse();
  }

  async positions() {
    await this.ensure();
    return this.store.openTrades();
  }

  async trades(q) {
    await this.ensure();
    return this.store.listTrades(q);
  }

  async summary(q = {}) {
    const experiment = await this.ensure();
    const { trades } = await this.store.listTrades({ ...q, limit: 500, page: 1 });
    const all = await this.collectTrades(q);
    const accounts = await this.store.listAccounts(experiment.experimentId);
    const byStrategy = {};
    for (const account of accounts) {
      const mine = all.filter((t) => t.accountId === account.accountId);
      const stats = summarizeTrades(mine, account.initialCapital);
      const snaps = await this.store.snapshots(account.accountId);
      const curve = snaps.length ? snaps.map((s) => s.equity) : equityFromClosedTrades(account.initialCapital, mine).curve;
      byStrategy[account.strategyId] = {
        ...stats,
        accountId: account.accountId,
        version: account.strategyVersion,
        initialCapital: account.initialCapital,
        currentEquity: account.currentEquity,
        ...maxDrawdown(curve),
        equityCurveSource: snaps.length ? 'snapshots' : 'closed-trades',
      };
    }
    const initial = accounts.reduce((s, a) => s + a.initialCapital, 0);
    return {
      range: q,
      overall: summarizeTrades(all, initial),
      byStrategy,
      formulas: {
        winRate: 'winning closed trades / closed trades',
        expectancy: 'sum of net P&L / closed trades',
        profitFactor: 'gross winning P&L / abs(gross losing P&L); null when there are no losses',
        drawdown: 'peak-to-trough on the equity curve, including unrealized P&L when snapshots exist',
      },
      disclaimer: 'These figures describe the paper experiment only.',
      ignoredPage: trades.length,
    };
  }

  async collectTrades(q) {
    const first = await this.store.listTrades({ ...q, page: 1, limit: 500 });
    const rows = first.trades.slice();
    const pages = Math.ceil(first.total / first.limit);
    for (let page = 2; page <= pages; page += 1) {
      const next = await this.store.listTrades({ ...q, page, limit: 500 });
      rows.push(...next.trades);
    }
    return rows;
  }

  async weekly(q = {}) {
    const summaries = await this.store.listSummaries(q);
    const weeks = new Map();
    for (const row of summaries) {
      const key = isoWeek(row.tradingDate);
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key).push(row);
    }
    const out = [];
    for (const [week, rows] of weeks) {
      const net = rows.reduce((s, r) => s + (r.netPnl || 0), 0);
      out.push({
        week,
        netPnl: round2(net),
        trades: rows.reduce((s, r) => s + (r.trades || 0), 0),
        maxDrawdown: round2(Math.max(...rows.map((r) => r.maxDrawdown || 0))),
        accounts: rows,
      });
    }
    out.sort((a, b) => (a.week < b.week ? -1 : 1));
    return out;
  }

  async exportTable(q) {
    const trades = await this.collectTrades(q);
    const header = ['tradingDate', 'strategyId', 'symbol', 'direction', 'quantity', 'entryTime', 'actualSimulatedEntryPrice', 'exitTime', 'actualSimulatedExitPrice', 'exitReason', 'grossPnl', 'fees', 'slippage', 'netPnl', 'status'];
    const records = trades.map((t) => header.map((k) => t[k] ?? ''));
    return { header, records };
  }

  async exportCsv(q) {
    const table = await this.exportTable(q);
    return rowsToCsv(table.header, table.records);
  }

  async exportXlsx(q) {
    const table = await this.exportTable(q);
    return rowsToXlsx(table.header, table.records);
  }

  async events() {
    await this.ensure();
    return this.store.listEvents(200);
  }

  async optimize(strategyId) {
    const experiment = await this.ensure();
    const rows = (await this.store.listStrategies()).filter((s) => s.strategyId === strategyId);
    if (!rows.length) throw new ServiceError('NOT_FOUND', 'Unknown strategy', 404);
    const baseline = rows.find((s) => s.version === 1) || rows[0];
    const candles = await this.store.candles({ interval: '1m' });
    const sample = new Set(candles.map((c) => sessionDate(c.startTime))).size;
    const version = Math.max(...rows.map((s) => s.version)) + 1;
    const note = sample < 5
      ? 'Sample is too small to interpret. Candidate stored, baseline left running.'
      : 'Candidate stored from a cost-aware parameter nudge. Baseline is unchanged and was not replaced.';
    const candidate = {
      strategyId,
      name: baseline.name,
      version,
      parameters: { ...baseline.parameters, atrMult: round2((baseline.parameters.atrMult || experiment.configuration.atrMult || 1.5) * 1.05) },
      enabled: false,
      parentVersion: baseline.version,
      optimizationNotes: note,
      evaluation: { sessions: sample, inSample: true, outOfSample: false, sufficient: sample >= 5 },
      createdAt: new Date().toISOString(),
    };
    await this.store.saveStrategy(candidate);
    await this.store.addEvent({ timestamp: candidate.createdAt, severity: 'info', eventType: 'OPTIMIZE', message: note, metadata: { strategyId, version } });
    return { baseline, candidate };
  }

  /**
   * Process one symbol from completed candles and a quote.
   * `source` must be 'live' or 'replay'. Replay results are stored with that label.
   */
  async onMarket(input) {
    const experiment = await this.ensure();
    if (experiment.status !== 'running') return { skipped: 'experiment is not running' };
    const now = input.now instanceof Date ? input.now : new Date(input.now);
    const config = this.configOf(experiment);
    const quoteFresh = input.quote && now - new Date(input.quote.at) <= config.quoteStaleMs;
    const feedOk = input.feedOk !== false;
    if (input.quote && !quoteFresh) {
      await this.store.addEvent({ timestamp: now.toISOString(), severity: 'warn', eventType: 'STALE', message: `Stale quote for ${input.symbol}`, metadata: {} });
    }
    await this.manageExits({ ...input, now, config });
    if (!feedOk || !quoteFresh) return { skipped: feedOk ? 'stale' : 'feed' };
    return this.considerEntries({ ...input, now, config });
  }

  async manageExits({ symbol, candles, now, config, lastPrice }) {
    const open = (await this.store.openTrades()).filter((t) => t.symbol === symbol);
    const completed = (candles || []).filter((c) => c.complete !== false);
    const bar = completed.length ? completed[completed.length - 1] : null;
    const squareOff = minutesOfDay(now) >= config.squareOffMin;
    for (const position of open) {
      if (lastPrice) position.lastPrice = lastPrice;
      let exit = null;
      if (squareOff) {
        const px = lastPrice || (bar ? bar.close : position.actualSimulatedEntryPrice);
        exit = { reason: 'EOD', price: round2(applySlippage(px, position.direction, config.slippageBps, 'exit')), ambiguous: false };
      } else if (bar && sessionDate(bar.startTime) === sessionDate(now)) {
        exit = resolveExit(position, bar);
        if (exit) exit.price = round2(applySlippage(exit.price, position.direction, config.slippageBps, 'exit'));
      }
      if (!exit) {
        await this.store.saveTrade(position);
        continue;
      }
      await this.closeTrade(position, exit, now);
    }
  }

  async closeTrade(position, exit, now) {
    const econ = closeEconomics(position, exit.price);
    position.status = 'CLOSED';
    position.exitTime = now.toISOString();
    position.actualSimulatedExitPrice = exit.price;
    position.exitReason = exit.reason;
    position.grossPnl = econ.grossPnl;
    position.fees = econ.fees;
    position.slippage = econ.slippage;
    position.netPnl = econ.netPnl;
    position.executionMetadata = { ...(position.executionMetadata || {}), ambiguous: Boolean(exit.ambiguous), gapped: Boolean(exit.gapped) };
    await this.store.saveTrade(position);
    const accounts = await this.store.listAccounts();
    const account = accounts.find((a) => a.accountId === position.accountId);
    if (account) {
      account.cashBalance = round2(account.cashBalance + cashDelta(position.direction, 'exit', exit.price, position.quantity, econ.fees));
      account.realizedPnl = round2(account.realizedPnl + econ.netPnl);
      account.dailyRealizedPnl = round2((account.dailyRealizedPnl || 0) + econ.netPnl);
      account.updatedAt = now.toISOString();
      const open = (await this.store.openTrades()).filter((t) => t.accountId === account.accountId);
      account.currentEquity = round2(account.cashBalance + this.positionEquity(open));
      await this.store.saveAccount(account);
    }
    return position;
  }

  async considerEntries({ symbol, candles, now, config, quote, sector, source }) {
    const experiment = await this.store.getExperiment();
    const strategies = (await this.store.listStrategies()).filter((s) => s.enabled);
    const accounts = await this.store.listAccounts(experiment.experimentId);
    const open = await this.store.openTrades();
    const day = sessionDate(now);
    const results = [];
    for (const strategy of strategies) {
      const impl = byId(strategy.strategyId);
      if (!impl) continue;
      const account = accounts.find((a) => a.strategyId === strategy.strategyId && a.strategyVersion === strategy.version);
      if (!account) continue;
      this.rollDay(account, day);
      await this.store.saveAccount(account);
      const signal = impl.evaluate({ symbol, candles, now, params: { ...config, ...strategy.parameters }, strategy });
      const signalId = `${strategy.strategyId}:v${strategy.version}:${symbol}:${day}:${signal ? signal.direction : 'none'}:${signal ? signal.reason : ''}`;
      if (!signal) continue;
      const { trades } = await this.store.listTrades({ accountId: account.accountId, from: day, to: day, limit: 500 });
      const decision = assessEntry({
        account: this.markAccount(account, open),
        signal: { ...signal, sector },
        positions: open,
        tradesToday: trades.filter((t) => t.tradingDate === day).length,
        config,
        now,
        quoteFresh: true,
        feedOk: true,
      });
      const row = {
        signalId,
        experimentId: experiment.experimentId,
        strategyId: strategy.strategyId,
        strategyVersion: strategy.version,
        symbol,
        instrumentToken: null,
        signalTime: now.toISOString(),
        tradingDate: day,
        direction: signal.direction,
        referencePrice: signal.referencePrice,
        stopPrice: signal.stopPrice,
        targetPrice: signal.targetPrice,
        rankingScore: round2((signal.quality || 0) * 50 + (decision.rewardRisk || 0) * 10),
        accepted: decision.ok,
        rejectionReason: decision.ok ? null : decision.reason,
        metadata: { ...(signal.metadata || {}), reason: signal.reason, source: source || 'live', ranking: 'transparent quality + reward/risk, not a probability' },
      };
      const saved = await this.store.insertSignal(row);
      if (saved.duplicate || !decision.ok) {
        results.push(row);
        continue;
      }
      const opened = await this.openTrade({ experiment, account, strategy, signal, decision, now, day, source, signalId });
      results.push({ ...row, trade: opened });
    }
    return { results };
  }

  async openTrade({ experiment, account, strategy, signal, decision, now, day, source, signalId }) {
    const fill = round2(applySlippage(signal.referencePrice, signal.direction, experiment.configuration.slippageBps, 'entry'));
    const trade = {
      tradeId: id('tr'),
      idempotencyKey: signalId,
      experimentId: experiment.experimentId,
      accountId: account.accountId,
      strategyId: strategy.strategyId,
      strategyVersion: strategy.version,
      signalId,
      symbol: signal.symbol,
      sector: signal.sector || null,
      instrumentToken: null,
      direction: signal.direction,
      quantity: decision.quantity,
      entryTime: now.toISOString(),
      tradingDate: day,
      referenceEntryPrice: signal.referencePrice,
      actualSimulatedEntryPrice: fill,
      entrySlippage: slippageRupees(signal.referencePrice, fill, decision.quantity),
      stopPrice: signal.stopPrice,
      targetPrice: signal.targetPrice,
      exitTime: null,
      actualSimulatedExitPrice: null,
      exitReason: null,
      grossPnl: null,
      fees: 0,
      slippage: slippageRupees(signal.referencePrice, fill, decision.quantity),
      netPnl: null,
      status: 'OPEN',
      lastPrice: fill,
      executionMetadata: { source: source || 'live', assumptions: 'adverse slippage, MIS equity charges, gap-through fills at the open' },
    };
    const inserted = await this.store.insertTrade(trade);
    if (inserted.duplicate) return inserted.trade;
    account.cashBalance = round2(account.cashBalance + cashDelta(trade.direction, 'entry', fill, trade.quantity, 0));
    account.updatedAt = now.toISOString();
    const open = (await this.store.openTrades()).filter((t) => t.accountId === account.accountId);
    account.currentEquity = round2(account.cashBalance + this.positionEquity(open));
    await this.store.saveAccount(account);
    return trade;
  }

  rollDay(account, day) {
    if (account.tradingDate === day) return;
    account.tradingDate = day;
    account.startOfDayEquity = account.currentEquity;
    account.dailyRealizedPnl = 0;
  }

  async reconcile() {
    const accounts = await this.store.listAccounts();
    for (const account of accounts) {
      const { trades } = await this.store.listTrades({ accountId: account.accountId, limit: 500 });
      let cash = account.initialCapital;
      const ordered = trades.slice().sort((a, b) => (a.entryTime < b.entryTime ? -1 : 1));
      for (const t of ordered) {
        cash += cashDelta(t.direction, 'entry', t.actualSimulatedEntryPrice, t.quantity, 0);
        if (t.status === 'CLOSED') cash += cashDelta(t.direction, 'exit', t.actualSimulatedExitPrice, t.quantity, t.fees || 0);
      }
      account.cashBalance = round2(cash);
      const open = ordered.filter((t) => t.status === 'OPEN');
      account.currentEquity = round2(account.cashBalance + this.positionEquity(open));
      account.realizedPnl = round2(ordered.filter((t) => t.status === 'CLOSED').reduce((s, t) => s + (t.netPnl || 0), 0));
      account.updatedAt = new Date().toISOString();
      await this.store.saveAccount(account);
    }
  }

  async snapshot(now = new Date()) {
    const experiment = await this.ensure();
    const open = await this.store.openTrades();
    const accounts = await this.store.listAccounts(experiment.experimentId);
    for (const account of accounts) {
      const marked = this.markAccount(account, open);
      const snaps = await this.store.snapshots(account.accountId);
      const peak = snaps.reduce((m, s) => Math.max(m, s.equity), marked.currentEquity);
      await this.store.addSnapshot({
        accountId: account.accountId,
        timestamp: now.toISOString(),
        cashBalance: marked.cashBalance,
        equity: marked.currentEquity,
        openPnl: marked.unrealizedPnl,
        realizedPnl: marked.realizedPnl,
        drawdown: round2(Math.max(0, peak - marked.currentEquity)),
        openPositions: marked.openPositions,
      });
    }
  }

  async endOfDay(now = new Date()) {
    const experiment = await this.ensure();
    const day = sessionDate(now);
    const config = this.configOf(experiment);
    const open = await this.store.openTrades();
    for (const position of open) {
      const px = position.lastPrice || position.actualSimulatedEntryPrice;
      await this.closeTrade(position, {
        reason: 'EOD',
        price: round2(applySlippage(px, position.direction, config.slippageBps, 'exit')),
      }, now);
    }
    const accounts = await this.store.listAccounts(experiment.experimentId);
    for (const account of accounts) {
      const { trades } = await this.store.listTrades({ accountId: account.accountId, from: day, to: day, limit: 500 });
      const stats = summarizeTrades(trades, account.initialCapital);
      const snaps = (await this.store.snapshots(account.accountId)).filter((s) => sessionDate(s.timestamp) === day);
      const curve = snaps.length ? snaps.map((s) => s.equity) : equityFromClosedTrades(account.startOfDayEquity || account.initialCapital, trades).curve;
      await this.store.upsertSummary({
        accountId: account.accountId,
        strategyId: account.strategyId,
        tradingDate: day,
        trades: stats.closed,
        wins: stats.wins,
        losses: stats.losses,
        grossPnl: round2((stats.grossProfit || 0) + (stats.grossLoss || 0)),
        fees: stats.fees,
        netPnl: stats.netPnl,
        endingEquity: account.currentEquity,
        maxDrawdown: maxDrawdown(curve).maxDrawdown,
        generatedAt: now.toISOString(),
      });
    }
    await this.store.addEvent({ timestamp: now.toISOString(), severity: 'info', eventType: 'EOD', message: `End-of-day summary stored for ${day}`, metadata: {} });
  }

  async workerTick(now = new Date()) {
    const experiment = await this.ensure();
    if (experiment.status !== 'running') return { idle: true };
    if (!this.feed || !this.feed.status().configured) {
      await this.store.addEvent({ timestamp: now.toISOString(), severity: 'warn', eventType: 'FEED', message: 'Worker is idle because Kite credentials are not configured.', metadata: {} });
      return { idle: 'no-feed' };
    }
    const pulled = await this.feed.pull(now);
    if (!pulled.ok) {
      await this.store.addEvent({ timestamp: now.toISOString(), severity: 'error', eventType: 'FEED', message: pulled.message || 'Feed unhealthy. New entries are blocked.', metadata: {} });
      return { blocked: true };
    }
    for (const row of pulled.symbols || []) {
      const candles = await this.store.candles({ symbol: row.symbol, interval: '1m' });
      await this.onMarket({
        symbol: row.symbol,
        candles: candles.concat(row.candles || []),
        now,
        quote: row.quote,
        sector: row.sector,
        feedOk: true,
        lastPrice: row.quote.price,
        source: 'live',
      });
    }
    if (minutesOfDay(now) >= experiment.configuration.squareOffMin) {
      const existing = await this.store.listSummaries({ from: sessionDate(now), to: sessionDate(now) });
      if (!existing.length) await this.endOfDay(now);
    }
    return { ok: true };
  }
}

function isoWeek(day) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const target = new Date(date);
  const dayNr = (date.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((target - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

module.exports = { ResearchService, ServiceError, START_PHRASE, STRATEGIES };
