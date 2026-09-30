'use strict';

const { json, parse } = require('./database');

const nowIso = (d = new Date()) => d.toISOString();

/** Data-access layer. Plain SQL, no business logic. */
class Store {
  constructor(db, { clock = () => new Date() } = {}) {
    this.db = db;
    this.clock = clock;
    this.now = () => nowIso(clock());
  }

  tx(fn) {
    return this.db.transaction(fn)();
  }

  // ---------------------------------------------------------------- market data
  upsertStocks(list) {
    const st = this.db.prepare(
      `INSERT INTO stocks (symbol,name,sector,exchange,is_benchmark,active,updated_at) VALUES (@symbol,@name,@sector,'NSE',@bench,1,@ts)
       ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, sector=excluded.sector, is_benchmark=excluded.is_benchmark, updated_at=excluded.updated_at, active=1`,
    );
    this.tx(() => {
      for (const s of list) st.run({ symbol: s.symbol, name: s.name, sector: s.sector, bench: s.benchmark ? 1 : 0, ts: this.now() });
    });
  }

  listStocks() {
    return this.db.prepare('SELECT symbol,name,sector,is_benchmark AS benchmark,active FROM stocks ORDER BY symbol').all();
  }

  lastPriceDate(symbol) {
    return this.db.prepare('SELECT MAX(date) AS d FROM historical_prices WHERE symbol=?').get(symbol)?.d || null;
  }

  upsertPrices(symbol, rows, source) {
    if (!rows.length) return 0;
    const st = this.db.prepare(
      `INSERT INTO historical_prices (symbol,date,open,high,low,close,volume,source) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(symbol,date) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume, source=excluded.source`,
    );
    this.tx(() => {
      for (const r of rows) st.run(symbol, r.date, r.open, r.high, r.low, r.close, r.volume, source);
    });
    return rows.length;
  }

  priceStats() {
    return this.db.prepare('SELECT COUNT(*) AS rows, COUNT(DISTINCT symbol) AS symbols, MIN(date) AS first, MAX(date) AS last FROM historical_prices').get();
  }

  priceSources() {
    return this.db.prepare('SELECT DISTINCT source FROM historical_prices').all().map((r) => r.source);
  }

  resetMarketData() {
    this.tx(() => {
      for (const t of ['historical_prices', 'live_quotes', 'indicators', 'market_regimes']) this.db.prepare(`DELETE FROM ${t}`).run();
    });
  }

  allPriceRows(untilDate = null) {
    if (untilDate) return this.db.prepare('SELECT symbol,date,open,high,low,close,volume FROM historical_prices WHERE date<=? ORDER BY symbol,date').all(untilDate);
    return this.db.prepare('SELECT symbol,date,open,high,low,close,volume FROM historical_prices ORDER BY symbol,date').all();
  }

  upsertQuotes(quotes) {
    const st = this.db.prepare(
      `INSERT INTO live_quotes (symbol,last,open,high,low,prev_close,volume,ts,simulated) VALUES (@symbol,@last,@open,@high,@low,@prevClose,@volume,@ts,@sim)
       ON CONFLICT(symbol) DO UPDATE SET last=excluded.last, open=excluded.open, high=excluded.high, low=excluded.low, prev_close=excluded.prev_close, volume=excluded.volume, ts=excluded.ts, simulated=excluded.simulated`,
    );
    this.tx(() => {
      for (const q of Object.values(quotes)) st.run({ ...q, sim: q.simulated ? 1 : 0 });
    });
  }

  getQuote(symbol) {
    const r = this.db.prepare('SELECT * FROM live_quotes WHERE symbol=?').get(symbol);
    return r ? { symbol: r.symbol, last: r.last, open: r.open, high: r.high, low: r.low, prevClose: r.prev_close, volume: r.volume, ts: r.ts, simulated: !!r.simulated } : null;
  }

  saveRegime(date, r) {
    this.db
      .prepare(`INSERT INTO market_regimes (date,regime,score,metrics_json,reasons_json) VALUES (?,?,?,?,?)
        ON CONFLICT(date) DO UPDATE SET regime=excluded.regime, score=excluded.score, metrics_json=excluded.metrics_json, reasons_json=excluded.reasons_json`)
      .run(date, r.regime, r.score, json({ ...r.metrics, components: r.components }), json(r.reasons));
  }

  listRegimes(limit = 260) {
    return this.db
      .prepare('SELECT date,regime,score,metrics_json,reasons_json FROM market_regimes ORDER BY date DESC LIMIT ?')
      .all(limit)
      .map((r) => ({ date: r.date, regime: r.regime, score: r.score, metrics: parse(r.metrics_json, {}), reasons: parse(r.reasons_json, []) }))
      .reverse();
  }

  saveIndicatorRows(date, paramsKey, rows) {
    const st = this.db.prepare(
      `INSERT INTO indicators (symbol,date,params_key,score,rank,data_json) VALUES (?,?,?,?,?,?)
       ON CONFLICT(symbol,date,params_key) DO UPDATE SET score=excluded.score, rank=excluded.rank, data_json=excluded.data_json`,
    );
    this.tx(() => {
      for (const r of rows) st.run(r.symbol, date, paramsKey, r.score, r.rank, json(r.data));
    });
  }

  latestIndicatorDate(paramsKey) {
    return this.db.prepare('SELECT MAX(date) AS d FROM indicators WHERE params_key=?').get(paramsKey)?.d || null;
  }

  // ------------------------------------------------------------------- settings
  getSettings(userId) {
    const r = this.db.prepare('SELECT json FROM user_settings WHERE user_id=?').get(String(userId));
    return r ? parse(r.json, {}) : null;
  }

  saveSettings(userId, value) {
    this.db
      .prepare(`INSERT INTO user_settings (user_id,json,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`)
      .run(String(userId), json(value), this.now());
  }

  getRisk(userId) {
    const r = this.db.prepare('SELECT json FROM risk_settings WHERE user_id=?').get(String(userId));
    return r ? parse(r.json, null) : null;
  }

  saveRisk(userId, value) {
    this.db
      .prepare(`INSERT INTO risk_settings (user_id,json,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`)
      .run(String(userId), json(value), this.now());
  }

  // ----------------------------------------------------------------- strategies
  listStrategies(userId) {
    return this.db
      .prepare('SELECT id,name,description,params_json,params_hash,is_preset,created_at FROM strategies WHERE user_id=? ORDER BY is_preset DESC, created_at')
      .all(String(userId))
      .map((r) => ({ id: r.id, name: r.name, description: r.description, params: parse(r.params_json, {}), paramsHash: r.params_hash, preset: !!r.is_preset, createdAt: r.created_at }));
  }

  getStrategy(userId, id) {
    return this.listStrategies(userId).find((s) => s.id === id) || null;
  }

  saveStrategy(userId, s) {
    this.db
      .prepare(`INSERT INTO strategies (user_id,id,name,description,params_json,params_hash,is_preset,created_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id,id) DO UPDATE SET name=excluded.name, description=excluded.description, params_json=excluded.params_json, params_hash=excluded.params_hash`)
      .run(String(userId), s.id, s.name, s.description || '', json(s.params), s.paramsHash, s.preset ? 1 : 0, this.now());
  }

  deleteStrategy(userId, id) {
    return this.db.prepare('DELETE FROM strategies WHERE user_id=? AND id=? AND is_preset=0').run(String(userId), id).changes;
  }

  // ----------------------------------------------------------------- portfolios
  mapPortfolio(r) {
    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id,
      mode: r.mode,
      name: r.name,
      initialCapital: r.initial_capital,
      cash: r.cash,
      peakEquity: r.peak_equity,
      autoExecute: !!r.auto_execute,
      strategyId: r.strategy_id,
      params: parse(r.params_json, null),
      lastReviewDate: r.last_review_date,
      prevRegime: r.prev_regime,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  getPortfolio(userId, mode) {
    return this.mapPortfolio(this.db.prepare('SELECT * FROM portfolios WHERE user_id=? AND mode=?').get(String(userId), mode));
  }

  getPortfolioById(id) {
    return this.mapPortfolio(this.db.prepare('SELECT * FROM portfolios WHERE id=?').get(id));
  }

  listPortfolios(status = 'ACTIVE') {
    return this.db.prepare('SELECT * FROM portfolios WHERE status=? ORDER BY id').all(status).map((r) => this.mapPortfolio(r));
  }

  createPortfolio({ userId, mode, name, capital, strategyId, autoExecute }) {
    const ts = this.now();
    const info = this.db
      .prepare(`INSERT INTO portfolios (user_id,mode,name,initial_capital,cash,peak_equity,auto_execute,strategy_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(String(userId), mode, name, capital, capital, capital, autoExecute ? 1 : 0, strategyId, ts, ts);
    return this.getPortfolioById(Number(info.lastInsertRowid));
  }

  updatePortfolio(id, patch) {
    const map = {
      cash: 'cash',
      peakEquity: 'peak_equity',
      autoExecute: 'auto_execute',
      strategyId: 'strategy_id',
      lastReviewDate: 'last_review_date',
      prevRegime: 'prev_regime',
      status: 'status',
      initialCapital: 'initial_capital',
      name: 'name',
    };
    const sets = [];
    const vals = [];
    for (const [k, col] of Object.entries(map)) {
      if (patch[k] === undefined) continue;
      sets.push(`${col}=?`);
      vals.push(k === 'autoExecute' ? (patch[k] ? 1 : 0) : patch[k]);
    }
    if (patch.params !== undefined) {
      sets.push('params_json=?');
      vals.push(json(patch.params));
    }
    if (!sets.length) return;
    sets.push('updated_at=?');
    vals.push(this.now(), id);
    this.db.prepare(`UPDATE portfolios SET ${sets.join(',')} WHERE id=?`).run(...vals);
  }

  deletePortfolio(id) {
    this.tx(() => {
      for (const t of ['positions', 'signals', 'decision_runs', 'trades', 'capital_events', 'equity_snapshots']) {
        this.db.prepare(`DELETE FROM ${t} WHERE portfolio_id=?`).run(id);
      }
      this.db.prepare('DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE portfolio_id=?)').run(id);
      this.db.prepare('DELETE FROM orders WHERE portfolio_id=?').run(id);
      this.db.prepare('DELETE FROM portfolios WHERE id=?').run(id);
    });
  }

  mapPosition(r) {
    return {
      id: r.id,
      portfolioId: r.portfolio_id,
      symbol: r.symbol,
      qty: r.qty,
      avgPrice: r.avg_price,
      entryDate: r.entry_date,
      initialStop: r.initial_stop,
      stopPrice: r.stop_price,
      peakClose: r.peak_close,
      partials: parse(r.partials_json, {}),
      realizedPnl: r.realized_pnl,
      entrySignalId: r.entry_signal_id,
      buyCosts: r.buy_costs || 0,
      investedTotal: r.invested_total || r.avg_price * r.qty,
    };
  }

  listPositions(portfolioId) {
    return this.db.prepare('SELECT * FROM positions WHERE portfolio_id=? AND qty>0 ORDER BY symbol').all(portfolioId).map((r) => this.mapPosition(r));
  }

  getPosition(portfolioId, symbol) {
    const r = this.db.prepare('SELECT * FROM positions WHERE portfolio_id=? AND symbol=?').get(portfolioId, symbol);
    return r ? this.mapPosition(r) : null;
  }

  savePosition(portfolioId, p) {
    this.db
      .prepare(`INSERT INTO positions (portfolio_id,symbol,qty,avg_price,entry_date,initial_stop,stop_price,peak_close,partials_json,realized_pnl,buy_costs,invested_total,entry_signal_id,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(portfolio_id,symbol) DO UPDATE SET qty=excluded.qty, avg_price=excluded.avg_price, entry_date=excluded.entry_date, initial_stop=excluded.initial_stop,
          stop_price=excluded.stop_price, peak_close=excluded.peak_close, partials_json=excluded.partials_json, realized_pnl=excluded.realized_pnl,
          buy_costs=excluded.buy_costs, invested_total=excluded.invested_total, updated_at=excluded.updated_at`)
      .run(portfolioId, p.symbol, p.qty, p.avgPrice, p.entryDate, p.initialStop ?? null, p.stopPrice ?? null, p.peakClose ?? null, json(p.partials || {}), p.realizedPnl || 0, p.buyCosts || 0, p.investedTotal || p.avgPrice * p.qty, p.entrySignalId ?? null, this.now());
  }

  deletePosition(portfolioId, symbol) {
    this.db.prepare('DELETE FROM positions WHERE portfolio_id=? AND symbol=?').run(portfolioId, symbol);
  }

  addCapitalEvent({ userId, portfolioId, kind, amount, note }) {
    const info = this.db
      .prepare('INSERT INTO capital_events (user_id,portfolio_id,kind,amount,note,ts,processed) VALUES (?,?,?,?,?,?,0)')
      .run(String(userId), portfolioId, kind, amount, note || '', this.now());
    return Number(info.lastInsertRowid);
  }

  listCapitalEvents(portfolioId, onlyPending = false) {
    return this.db
      .prepare(`SELECT id,kind,amount,note,ts,processed FROM capital_events WHERE portfolio_id=? ${onlyPending ? 'AND processed=0' : ''} ORDER BY id`)
      .all(portfolioId)
      .map((r) => ({ ...r, processed: !!r.processed }));
  }

  markCapitalEventsProcessed(portfolioId) {
    this.db.prepare('UPDATE capital_events SET processed=1 WHERE portfolio_id=?').run(portfolioId);
  }

  saveEquitySnapshot(portfolioId, date, equity, cash, invested) {
    this.db
      .prepare(`INSERT INTO equity_snapshots (portfolio_id,date,equity,cash,invested) VALUES (?,?,?,?,?)
        ON CONFLICT(portfolio_id,date) DO UPDATE SET equity=excluded.equity, cash=excluded.cash, invested=excluded.invested`)
      .run(portfolioId, date, equity, cash, invested);
  }

  listEquitySnapshots(portfolioId) {
    return this.db.prepare('SELECT date,equity,cash,invested FROM equity_snapshots WHERE portfolio_id=? ORDER BY date').all(portfolioId);
  }

  // -------------------------------------------------------------- decision runs
  getDecisionRun(portfolioId, asOf, kind) {
    const r = this.db.prepare('SELECT * FROM decision_runs WHERE portfolio_id=? AND as_of=? AND kind=?').get(portfolioId, asOf, kind);
    return r ? this.mapRun(r, true) : null;
  }

  mapRun(r, full = false) {
    return {
      id: r.id,
      portfolioId: r.portfolio_id,
      asOf: r.as_of,
      kind: r.kind,
      paramsHash: r.params_hash,
      regime: r.regime,
      answer: r.answer,
      summary: parse(r.summary_json, {}),
      createdAt: r.created_at,
      ...(full ? { result: parse(r.result_json, null) } : {}),
    };
  }

  getDecisionRunById(id) {
    const r = this.db.prepare('SELECT * FROM decision_runs WHERE id=?').get(id);
    return r ? this.mapRun(r, true) : null;
  }

  listDecisionRuns(portfolioId, limit = 60) {
    return this.db.prepare('SELECT * FROM decision_runs WHERE portfolio_id=? ORDER BY id DESC LIMIT ?').all(portfolioId, limit).map((r) => this.mapRun(r));
  }

  saveDecisionRun({ userId, portfolioId, asOf, kind, paramsHash, result }) {
    const stored = { ...result, ranking: (result.ranking || []).slice(0, 40) };
    const info = this.db
      .prepare(`INSERT INTO decision_runs (user_id,portfolio_id,as_of,kind,params_hash,regime,answer,summary_json,result_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(portfolio_id,as_of,kind) DO UPDATE SET params_hash=excluded.params_hash, regime=excluded.regime, answer=excluded.answer, summary_json=excluded.summary_json, result_json=excluded.result_json, created_at=excluded.created_at`)
      .run(String(userId), portfolioId, asOf, kind, paramsHash, result.regime.regime, result.summary.answer, json(result.summary), json(stored), this.now());
    return this.db.prepare('SELECT id FROM decision_runs WHERE portfolio_id=? AND as_of=? AND kind=?').get(portfolioId, asOf, kind).id ?? Number(info.lastInsertRowid);
  }

  mapSignal(r) {
    return {
      id: r.id,
      userId: r.user_id,
      portfolioId: r.portfolio_id,
      runId: r.run_id,
      asOf: r.as_of,
      symbol: r.symbol,
      action: r.action,
      timing: r.timing,
      quantity: r.quantity,
      priceRef: r.price_ref,
      allocationValue: r.allocation_value,
      reason: r.reason,
      trigger: r.trigger_name,
      strategy: r.strategy,
      score: r.score,
      confidence: r.confidence,
      status: r.status,
      decisionKey: r.decision_key,
      orderId: r.order_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      detail: parse(r.detail_json, {}),
    };
  }

  insertSignalIfNew({ userId, portfolioId, runId, decision }) {
    const ts = this.now();
    const info = this.db
      .prepare(`INSERT OR IGNORE INTO signals (user_id,portfolio_id,run_id,as_of,symbol,action,timing,quantity,price_ref,allocation_value,reason,trigger_name,strategy,score,confidence,status,decision_key,detail_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(String(userId), portfolioId, runId, decision.asOf, decision.symbol, decision.action, decision.timing, decision.quantity, decision.priceRef, decision.allocationValue, decision.reason, decision.trigger, decision.strategy, decision.score, decision.confidence,
        ['WAIT', 'HOLD'].includes(decision.action) ? 'INFO' : 'PENDING', decision.decisionKey, json(decision), ts, ts);
    if (info.changes) return { id: Number(info.lastInsertRowid), created: true };
    const row = this.db.prepare('SELECT id FROM signals WHERE portfolio_id=? AND decision_key=?').get(portfolioId, decision.decisionKey);
    return { id: row.id, created: false };
  }

  getSignal(id) {
    const r = this.db.prepare('SELECT * FROM signals WHERE id=?').get(id);
    return r ? this.mapSignal(r) : null;
  }

  listSignals({ userId, portfolioId = null, status = null, limit = 200, symbol = null, actionable = false }) {
    const where = ['user_id=?'];
    const args = [String(userId)];
    if (portfolioId) {
      where.push('portfolio_id=?');
      args.push(portfolioId);
    }
    if (status) {
      where.push('status=?');
      args.push(status);
    }
    if (symbol) {
      where.push('symbol=?');
      args.push(symbol);
    }
    if (actionable) where.push("action IN ('BUY','SELL','EXIT','REDUCE')");
    args.push(limit);
    return this.db.prepare(`SELECT * FROM signals WHERE ${where.join(' AND ')} ORDER BY as_of DESC, id DESC LIMIT ?`).all(...args).map((r) => this.mapSignal(r));
  }

  updateSignal(id, patch) {
    const sets = [];
    const vals = [];
    if (patch.status) {
      sets.push('status=?');
      vals.push(patch.status);
    }
    if (patch.orderId !== undefined) {
      sets.push('order_id=?');
      vals.push(patch.orderId);
    }
    if (!sets.length) return;
    sets.push('updated_at=?');
    vals.push(this.now(), id);
    this.db.prepare(`UPDATE signals SET ${sets.join(',')} WHERE id=?`).run(...vals);
  }

  // --------------------------------------------------------------------- orders
  mapOrder(r) {
    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id,
      portfolioId: r.portfolio_id,
      signalId: r.signal_id,
      idempotencyKey: r.idempotency_key,
      symbol: r.symbol,
      side: r.side,
      qty: r.qty,
      orderType: r.order_type,
      limitPrice: r.limit_price,
      priceRef: r.price_ref,
      status: r.status,
      filledQty: r.filled_qty,
      appliedQty: r.applied_qty,
      avgFillPrice: r.avg_fill_price,
      broker: r.broker,
      brokerOrderId: r.broker_order_id,
      variety: r.variety,
      reason: r.reason,
      error: r.error,
      validation: parse(r.validation_json, []),
      meta: parse(r.meta_json, {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  getOrder(id) {
    return this.mapOrder(this.db.prepare('SELECT * FROM orders WHERE id=?').get(id));
  }

  getOrderByKey(key) {
    return this.mapOrder(this.db.prepare('SELECT * FROM orders WHERE idempotency_key=?').get(key));
  }

  insertOrder(o) {
    const ts = this.now();
    const info = this.db
      .prepare(`INSERT OR IGNORE INTO orders (user_id,portfolio_id,signal_id,idempotency_key,symbol,side,qty,order_type,limit_price,price_ref,status,broker,variety,reason,validation_json,meta_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(String(o.userId), o.portfolioId, o.signalId ?? null, o.idempotencyKey, o.symbol, o.side, o.qty, o.orderType || 'LIMIT', o.limitPrice ?? null, o.priceRef ?? null, o.status, o.broker, o.variety || 'regular', o.reason || '', json(o.validation || []), json(o.meta || {}), ts, ts);
    if (!info.changes) return { order: this.getOrderByKey(o.idempotencyKey), created: false };
    const order = this.getOrder(Number(info.lastInsertRowid));
    this.addOrderEvent(order.id, o.status, 0, 'created');
    return { order, created: true };
  }

  updateOrder(id, patch) {
    const map = { status: 'status', filledQty: 'filled_qty', appliedQty: 'applied_qty', avgFillPrice: 'avg_fill_price', brokerOrderId: 'broker_order_id', error: 'error', qty: 'qty', variety: 'variety', limitPrice: 'limit_price' };
    const sets = [];
    const vals = [];
    for (const [k, col] of Object.entries(map)) {
      if (patch[k] === undefined) continue;
      sets.push(`${col}=?`);
      vals.push(patch[k]);
    }
    if (patch.validation !== undefined) {
      sets.push('validation_json=?');
      vals.push(json(patch.validation));
    }
    if (patch.meta !== undefined) {
      sets.push('meta_json=?');
      vals.push(json(patch.meta));
    }
    if (!sets.length) return;
    sets.push('updated_at=?');
    vals.push(this.now(), id);
    this.db.prepare(`UPDATE orders SET ${sets.join(',')} WHERE id=?`).run(...vals);
  }

  addOrderEvent(orderId, status, filledQty, detail) {
    this.db.prepare('INSERT INTO order_events (order_id,ts,status,filled_qty,detail) VALUES (?,?,?,?,?)').run(orderId, this.now(), status, filledQty ?? null, detail || '');
  }

  listOrderEvents(orderId) {
    return this.db.prepare('SELECT ts,status,filled_qty AS filledQty,detail FROM order_events WHERE order_id=? ORDER BY id').all(orderId);
  }

  listOrders({ userId, portfolioId = null, statuses = null, limit = 200 }) {
    const where = ['user_id=?'];
    const args = [String(userId)];
    if (portfolioId) {
      where.push('portfolio_id=?');
      args.push(portfolioId);
    }
    if (statuses && statuses.length) {
      where.push(`status IN (${statuses.map(() => '?').join(',')})`);
      args.push(...statuses);
    }
    args.push(limit);
    return this.db.prepare(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...args).map((r) => this.mapOrder(r));
  }

  listOpenOrders(portfolioId = null) {
    const statuses = ['QUEUED', 'SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'UNKNOWN'];
    const sql = `SELECT * FROM orders WHERE status IN (${statuses.map(() => '?').join(',')}) ${portfolioId ? 'AND portfolio_id=?' : ''} ORDER BY id`;
    return this.db.prepare(sql).all(...statuses, ...(portfolioId ? [portfolioId] : [])).map((r) => this.mapOrder(r));
  }

  insertTrade(t) {
    const info = this.db
      .prepare(`INSERT OR IGNORE INTO trades (user_id,portfolio_id,order_id,signal_id,fill_key,date,ts,symbol,side,qty,price,value,cost,pnl,pnl_pct,holding_days,reason)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(String(t.userId), t.portfolioId, t.orderId ?? null, t.signalId ?? null, t.fillKey, t.date, this.now(), t.symbol, t.side, t.qty, t.price, t.value, t.cost, t.pnl ?? null, t.pnlPct ?? null, t.holdingDays ?? null, t.reason || '');
    return info.changes > 0;
  }

  listTrades(portfolioId, limit = 500) {
    return this.db
      .prepare('SELECT id,order_id AS orderId,signal_id AS signalId,date,ts,symbol,side,qty,price,value,cost,pnl,pnl_pct AS pnlPct,holding_days AS holdingDays,reason FROM trades WHERE portfolio_id=? ORDER BY id DESC LIMIT ?')
      .all(portfolioId, limit);
  }

  // ----------------------------------------------------------- backtests / runs
  insertBacktest(b) {
    const info = this.db
      .prepare(`INSERT INTO backtests (user_id,name,strategy_id,params_json,params_hash,config_json,start_date,end_date,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(String(b.userId), b.name || '', b.strategyId || '', json(b.params), b.paramsHash, json(b.config), b.from, b.to, 'RUNNING', this.now());
    return Number(info.lastInsertRowid);
  }

  finishBacktest(id, { status, metrics, equity, extra, error, trades }) {
    this.tx(() => {
      this.db.prepare('UPDATE backtests SET status=?, metrics_json=?, equity_json=?, extra_json=?, error=?, start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date) WHERE id=?')
        .run(status, json(metrics), json(equity), json(extra), error || null, extra?.actualFrom || null, extra?.actualTo || null, id);
      if (trades) {
        const st = this.db.prepare(`INSERT INTO backtest_trades (backtest_id,seq,date,symbol,side,action,qty,price,value,cost,pnl,pnl_pct,holding_days,trigger_name,reason,regime) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        for (const t of trades) st.run(id, t.seq, t.date, t.symbol, t.side, t.action, t.qty, t.price, t.value, t.cost, t.pnl, t.pnlPct, t.holdingDays, t.trigger || null, t.reason || null, t.regime || null);
      }
    });
  }

  mapBacktest(r, full) {
    return {
      id: r.id,
      name: r.name,
      strategyId: r.strategy_id,
      paramsHash: r.params_hash,
      from: r.start_date,
      to: r.end_date,
      status: r.status,
      error: r.error,
      createdAt: r.created_at,
      config: parse(r.config_json, {}),
      metrics: parse(r.metrics_json, null),
      ...(full ? { params: parse(r.params_json, {}), equity: parse(r.equity_json, []), extra: parse(r.extra_json, {}) } : {}),
    };
  }

  getBacktest(userId, id) {
    const r = this.db.prepare('SELECT * FROM backtests WHERE id=? AND user_id=?').get(id, String(userId));
    return r ? this.mapBacktest(r, true) : null;
  }

  listBacktests(userId, limit = 50) {
    return this.db.prepare('SELECT * FROM backtests WHERE user_id=? ORDER BY id DESC LIMIT ?').all(String(userId), limit).map((r) => this.mapBacktest(r, false));
  }

  listBacktestTrades(id) {
    return this.db
      .prepare('SELECT seq,date,symbol,side,action,qty,price,value,cost,pnl,pnl_pct AS pnlPct,holding_days AS holdingDays,trigger_name AS trigger,reason,regime FROM backtest_trades WHERE backtest_id=? ORDER BY seq')
      .all(id);
  }

  insertRun(userId, kind, config) {
    const info = this.db.prepare('INSERT INTO strategy_runs (user_id,kind,status,config_json,created_at) VALUES (?,?,?,?,?)').run(String(userId), kind, 'RUNNING', json(config), this.now());
    return Number(info.lastInsertRowid);
  }

  updateRun(id, patch) {
    const sets = [];
    const vals = [];
    if (patch.status) {
      sets.push('status=?');
      vals.push(patch.status);
    }
    if (patch.progress !== undefined) {
      sets.push('progress=?');
      vals.push(patch.progress);
    }
    if (patch.result !== undefined) {
      sets.push('result_json=?');
      vals.push(json(patch.result));
    }
    if (patch.error !== undefined) {
      sets.push('error=?');
      vals.push(patch.error);
    }
    if (patch.status && patch.status !== 'RUNNING') {
      sets.push('finished_at=?');
      vals.push(this.now());
    }
    if (!sets.length) return;
    vals.push(id);
    this.db.prepare(`UPDATE strategy_runs SET ${sets.join(',')} WHERE id=?`).run(...vals);
  }

  mapRunRow(r, full) {
    return { id: r.id, kind: r.kind, status: r.status, progress: r.progress, config: parse(r.config_json, {}), error: r.error, createdAt: r.created_at, finishedAt: r.finished_at, ...(full ? { result: parse(r.result_json, null) } : {}) };
  }

  getRun(userId, id) {
    const r = this.db.prepare('SELECT * FROM strategy_runs WHERE id=? AND user_id=?').get(id, String(userId));
    return r ? this.mapRunRow(r, true) : null;
  }

  listRuns(userId, limit = 30) {
    return this.db.prepare('SELECT * FROM strategy_runs WHERE user_id=? ORDER BY id DESC LIMIT ?').all(String(userId), limit).map((r) => this.mapRunRow(r, false));
  }

  failStaleRuns() {
    this.db.prepare("UPDATE strategy_runs SET status='FAILED', error='Interrupted by server restart', finished_at=? WHERE status='RUNNING'").run(this.now());
    this.db.prepare("UPDATE backtests SET status='FAILED', error='Interrupted by server restart' WHERE status='RUNNING'").run();
  }

  // ------------------------------------------------------------------------ jobs
  /** Atomically claim a job period. Returns null when it is already done or actively running. */
  claimJob(job, periodKey, { staleMs = 30 * 60_000 } = {}) {
    const ts = this.now();
    const inserted = this.db.prepare('INSERT OR IGNORE INTO job_runs (job,period_key,status,started_at) VALUES (?,?,?,?)').run(job, periodKey, 'RUNNING', ts);
    if (inserted.changes) return Number(inserted.lastInsertRowid);
    const row = this.db.prepare('SELECT * FROM job_runs WHERE job=? AND period_key=?').get(job, periodKey);
    const stale = row.status === 'RUNNING' && this.clock().getTime() - new Date(row.started_at).getTime() > staleMs;
    if (row.status === 'FAILED' || stale) {
      const upd = this.db.prepare("UPDATE job_runs SET status='RUNNING', started_at=?, error=NULL WHERE id=? AND status=?").run(ts, row.id, row.status);
      if (upd.changes) return row.id;
    }
    return null;
  }

  finishJob(id, { status, result, error }) {
    this.db.prepare('UPDATE job_runs SET status=?, finished_at=?, result_json=?, error=? WHERE id=?').run(status, this.now(), json(result), error || null, id);
  }

  listJobs(limit = 60) {
    return this.db
      .prepare('SELECT id,job,period_key AS periodKey,status,started_at AS startedAt,finished_at AS finishedAt,result_json,error FROM job_runs ORDER BY id DESC LIMIT ?')
      .all(limit)
      .map((r) => ({ id: r.id, job: r.job, periodKey: r.periodKey, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, error: r.error, result: parse(r.result_json, null) }));
  }

  // ------------------------------------------------------------ broker sessions
  saveBrokerSession(userId, apiKey, tokenEnc) {
    this.db
      .prepare(`INSERT INTO broker_sessions (user_id,api_key,token_enc,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET api_key=excluded.api_key, token_enc=excluded.token_enc, updated_at=excluded.updated_at`)
      .run(String(userId), apiKey, tokenEnc, this.now());
  }

  getBrokerSession(userId) {
    return this.db.prepare('SELECT api_key AS apiKey, token_enc AS tokenEnc, updated_at AS updatedAt FROM broker_sessions WHERE user_id=?').get(String(userId)) || null;
  }

  deleteBrokerSession(userId) {
    this.db.prepare('DELETE FROM broker_sessions WHERE user_id=?').run(String(userId));
  }
}

module.exports = { Store };
