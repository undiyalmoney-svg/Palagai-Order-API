'use strict';

const { checkBuy } = require('../engine/risk');
const { drawdownState } = require('../engine/rebalance');
const { roundTick, round, inr } = require('../utils/math');
const { istDate, marketStatus, tradingDaysBetween } = require('../utils/dates');

const OPEN_STATUSES = ['QUEUED', 'SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'UNKNOWN'];
const RECONCILE_MAX_ATTEMPTS = 5;

class OrderError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Order lifecycle: idempotent creation -> validation pipeline -> broker
 * submission -> reconciliation of real fills into the portfolio.
 *
 * Invariants:
 *  - one order per (portfolio, decision) - repeated API calls return the
 *    existing order instead of submitting another;
 *  - a submitted order is never treated as filled; the portfolio only changes
 *    from fill quantities the broker reports (partials booked incrementally);
 *  - an ambiguous placement outcome is resolved by tag lookup, never by retry.
 */
class OrderManager {
  constructor({ store, portfolios, marketData, brokerFor, getConfig, clock = () => new Date() }) {
    this.store = store;
    this.portfolios = portfolios;
    this.marketData = marketData;
    this.brokerFor = brokerFor;
    this.getConfig = getConfig;
    this.clock = clock;
  }

  today() {
    return istDate(this.clock());
  }

  priceOf = (symbol) => this.marketData.priceFor(symbol)?.price;

  async executeSignal({ signalId, userId }) {
    const signal = this.store.getSignal(signalId);
    if (!signal || String(signal.userId) !== String(userId)) throw new OrderError('NOT_FOUND', 'Signal not found');
    if (!['BUY', 'SELL', 'EXIT', 'REDUCE'].includes(signal.action)) throw new OrderError('NOT_ACTIONABLE', `A ${signal.action} signal does not create an order`);
    if (!(signal.quantity > 0)) throw new OrderError('NOT_ACTIONABLE', 'Signal has no quantity');
    const portfolio = this.store.getPortfolioById(signal.portfolioId);
    const side = signal.action === 'BUY' ? 'BUY' : 'SELL';
    const key = `pf${portfolio.id}:${signal.decisionKey}`;

    const existing = this.store.getOrderByKey(key);
    if (existing) return { order: existing, duplicate: true, message: 'An order for this signal already exists; nothing new was submitted.' };

    const cfg = this.getConfig(userId);
    const broker = this.brokerFor(portfolio, userId);
    const created = this.store.insertOrder({
      userId,
      portfolioId: portfolio.id,
      signalId: signal.id,
      idempotencyKey: key,
      symbol: signal.symbol,
      side,
      qty: signal.quantity,
      orderType: 'LIMIT',
      priceRef: signal.priceRef,
      status: 'CREATED',
      broker: broker.id,
      reason: signal.reason,
      meta: { stopPrice: signal.detail?.risk?.stopPrice ?? null, action: signal.action, trigger: signal.trigger },
    });
    if (!created.created) return { order: created.order, duplicate: true, message: 'Concurrent request already created this order.' };
    let order = created.order;

    const v = await this.validate({ order, signal, portfolio, cfg, broker });
    this.store.updateOrder(order.id, { validation: v.steps });
    if (!v.ok) {
      this.store.updateOrder(order.id, { status: 'REJECTED', error: v.error });
      this.store.addOrderEvent(order.id, 'REJECTED', 0, v.error);
      const expired = this.store.getSignal(signal.id)?.status === 'EXPIRED';
      this.store.updateSignal(signal.id, { status: expired ? 'EXPIRED' : 'REJECTED', orderId: order.id });
      return { order: this.store.getOrder(order.id), rejected: true, validation: v.steps, message: v.error };
    }
    this.store.updateOrder(order.id, { qty: v.qty, limitPrice: v.limitPrice, variety: v.variety });
    this.store.updateSignal(signal.id, { orderId: order.id });
    order = this.store.getOrder(order.id);

    if (v.queue) {
      this.store.updateOrder(order.id, { status: 'QUEUED' });
      this.store.addOrderEvent(order.id, 'QUEUED', 0, v.queueReason);
      this.store.updateSignal(signal.id, { status: 'QUEUED' });
      return { order: this.store.getOrder(order.id), queued: true, validation: v.steps, message: v.queueReason };
    }
    await this.submit(order, portfolio, broker, cfg);
    return { order: this.store.getOrder(order.id), validation: v.steps };
  }

  async validate({ order, signal, portfolio, cfg, broker }) {
    const steps = [];
    const add = (id, pass, detail) => steps.push({ id, pass, detail });
    const fail = (error) => ({ ok: false, steps, error });
    const { risk, params, settings } = cfg;
    const now = this.clock();
    const today = this.today();
    const side = order.side;
    let qty = order.qty;

    add('portfolio_active', portfolio.status === 'ACTIVE', portfolio.status === 'ACTIVE' ? 'Portfolio is active' : `Portfolio is ${portfolio.status}`);
    if (portfolio.status !== 'ACTIVE') return fail('Portfolio is not active');

    if (broker.isLive) {
      const enabled = !!settings.live?.enabled;
      add('live_enabled', enabled, enabled ? 'Live trading explicitly enabled by the user' : 'Live trading is not enabled');
      if (!enabled) return fail('Live trading is not enabled for this account');
    } else {
      add('live_enabled', true, 'Paper order - no real money');
    }

    const age = Math.max(0, tradingDaysBetween(signal.asOf, today).length - 1);
    const fresh = age <= (risk.maxSignalAgeDays ?? 4);
    add('signal_fresh', fresh, fresh ? `Signal is ${age} trading day(s) old (max ${risk.maxSignalAgeDays})` : `Signal is ${age} trading days old (max ${risk.maxSignalAgeDays}); re-run the decision`);
    if (!fresh) {
      this.store.updateSignal(signal.id, { status: 'EXPIRED' });
      return fail('Signal expired - run the decision again for current data');
    }

    const open = this.store.listOpenOrders(portfolio.id).filter((o) => o.id !== order.id && o.symbol === order.symbol && o.side === side);
    add('no_duplicate_open_order', open.length === 0, open.length ? `Order #${open[0].id} for ${order.symbol} ${side} is still open` : 'No open order for this symbol and side');
    if (open.length) return fail(`A ${side} order for ${order.symbol} is already open (#${open[0].id})`);

    const market = marketStatus(now);
    let queue = false;
    let queueReason = null;
    let variety = 'regular';
    if (market.open) add('market_open', true, 'Market is open');
    else if (!broker.isLive) {
      const ok = settings.paper?.fillWhenClosed !== false;
      add('market_open', ok, ok ? `${market.reason}: paper order fills at the last available price` : `${market.reason}: paper order queued until the market opens`);
      if (!ok) {
        queue = true;
        queueReason = `${market.reason}; queued for the next open`;
      }
    } else if (settings.live?.allowAmo !== false) {
      add('market_open', true, `${market.reason}: sending as an After-Market Order (AMO)`);
      variety = 'amo';
    } else {
      add('market_open', false, `${market.reason} and AMO is disabled`);
      return fail(`${market.reason}; AMO orders are disabled`);
    }

    const pq = this.marketData.priceFor(order.symbol);
    add('price_available', !!pq, pq ? `Latest price ${inr(pq.price, 2)} (${pq.source})` : 'No price available');
    if (!pq) return fail(`No price available for ${order.symbol}`);
    const price = pq.price;
    const dev = signal.priceRef ? price / signal.priceRef - 1 : 0;
    const devLimit = risk.maxPriceDeviationPct ?? 0.04;
    if (side === 'BUY') {
      const ok = dev <= devLimit;
      add('price_deviation', ok, `Price ${inr(price, 2)} is ${round(dev * 100, 2)}% vs signal reference ${inr(signal.priceRef, 2)} (max +${round(devLimit * 100, 1)}%)`);
      if (!ok) return fail(`Price moved ${round(dev * 100, 1)}% above the signal reference; the entry is no longer valid`);
    } else {
      add('price_deviation', true, `Price ${inr(price, 2)} vs reference ${inr(signal.priceRef, 2)} (${round(dev * 100, 2)}%); exits are not price-gated`);
    }

    const positions = this.store.listPositions(portfolio.id);
    const val = this.portfolios.value(portfolio, this.priceOf);
    const equity = val.equity;

    if (side === 'SELL') {
      const pos = positions.find((p) => p.symbol === order.symbol);
      add('position_exists', !!pos, pos ? `Holding ${pos.qty} share(s)` : `No ${order.symbol} position`);
      if (!pos) return fail(`No ${order.symbol} position to sell`);
      qty = Math.min(qty, pos.qty);
      add('sell_quantity', qty > 0, `Selling ${qty} of ${pos.qty} share(s)`);
      return this.finalize({ steps, qty, side, price, signal, risk, queue, queueReason, variety });
    }

    const dd = drawdownState({ equity, peakEquity: Math.max(portfolio.peakEquity, equity), params });
    add('drawdown_halt', !dd.halted, dd.halted ? `Drawdown ${round(dd.drawdown * 100, 1)}% reached the halt level` : `Drawdown ${round(dd.drawdown * 100, 1)}% (halt at ${round(params.maxDrawdownHaltPct * 100, 0)}%)`);
    if (dd.halted) return fail('Drawdown halt is active - new purchases are paused');

    const prevSnap = this.store.listEquitySnapshots(portfolio.id).filter((s) => s.date < today).pop();
    if (prevSnap) {
      const dayPnl = equity / prevSnap.equity - 1;
      const ok = dayPnl > -(risk.maxDailyLossPct ?? 0.03);
      add('daily_loss_limit', ok, `Portfolio ${round(dayPnl * 100, 2)}% since ${prevSnap.date} (limit -${round((risk.maxDailyLossPct ?? 0.03) * 100, 1)}%)`);
      if (!ok) return fail('Daily loss limit reached - new purchases are blocked');
    }

    const chk = checkBuy({
      symbol: order.symbol,
      sector: this.marketData.loadPanel().sectorOf(order.symbol),
      price,
      qty,
      riskPerShare: signal.detail?.risk?.riskPerShare,
      equity,
      cash: portfolio.cash,
      positions,
      priceOf: this.priceOf,
      sectorOf: (s) => this.marketData.loadPanel().sectorOf(s),
      params,
      policy: params.regimePolicy[this.store.listRegimes(1).pop()?.regime] || params.regimePolicy.NEUTRAL,
      costs: cfg.costs,
      slippageBps: cfg.slippageBps,
      advValue: signal.detail?.snapshot?.advValueCr ? signal.detail.snapshot.advValueCr * 1e7 : undefined,
      pendingBuyValue: this.store
        .listOpenOrders(portfolio.id)
        .filter((o) => o.side === 'BUY' && o.id !== order.id)
        .reduce((a, o) => a + (o.qty - o.filledQty) * (o.limitPrice || o.priceRef || 0), 0),
    });
    add('risk_limits', chk.ok, chk.ok ? (chk.reasons.length ? chk.reasons.join('; ') : 'Within position, sector, open-risk and cash limits') : chk.reasons.join('; ') || 'Blocked by risk limits');
    if (!chk.ok) {
      const insufficient = chk.reasons.some((r) => /spendable|cash/i.test(r));
      return fail(insufficient ? `Insufficient funds: ${chk.reasons.join('; ')}` : `Risk check failed: ${chk.reasons.join('; ')}`);
    }
    qty = chk.qty;
    const maxValue = risk.maxOrderValue ?? Infinity;
    if (qty * price > maxValue) {
      const clipped = Math.floor(maxValue / price);
      add('max_order_value', clipped > 0, `Order value ${inr(qty * price)} exceeds the ${inr(maxValue)} limit; clipped to ${clipped} share(s)`);
      if (clipped <= 0) return fail('Order exceeds the maximum order value');
      qty = clipped;
    } else add('max_order_value', true, `Order value ${inr(qty * price)} within ${inr(maxValue)}`);
    return this.finalize({ steps, qty, side, price, signal, risk, queue, queueReason, variety });
  }

  finalize({ steps, qty, side, price, signal, risk, queue, queueReason, variety }) {
    const dev = risk.maxPriceDeviationPct ?? 0.04;
    const limit = side === 'BUY' ? Math.min(price * 1.005, (signal.priceRef || price) * (1 + dev)) : price * 0.995;
    const limitPrice = roundTick(side === 'BUY' ? Math.max(limit, price) : limit);
    steps.push({ id: 'order_built', pass: true, detail: `${side} ${qty} ${signal.symbol} LIMIT ${inr(limitPrice, 2)} (${variety})` });
    return { ok: true, steps, qty, limitPrice, queue, queueReason, variety };
  }

  async submit(order, portfolio, broker, cfg) {
    const fresh = this.store.getOrder(order.id);
    this.store.updateOrder(order.id, { status: 'SUBMITTED' });
    this.store.addOrderEvent(order.id, 'SUBMITTED', 0, `Sending to ${broker.id}`);
    let res;
    try {
      res = await broker.place({ ...fresh, id: fresh.id });
    } catch (err) {
      res = { status: 'UNKNOWN', message: `Broker call failed: ${err.message}` };
    }
    await this.applyResult(this.store.getOrder(order.id), res, portfolio, cfg);
  }

  async applyResult(order, res, portfolio, cfg) {
    const events = (status, detail) => this.store.addOrderEvent(order.id, status, res.filledQty ?? order.filledQty, detail);
    if (res.brokerOrderId && res.brokerOrderId !== order.brokerOrderId) this.store.updateOrder(order.id, { brokerOrderId: res.brokerOrderId });
    const filled = Number(res.filledQty) || 0;
    let status = res.status;
    if (status === 'FILLED' && filled <= 0) status = 'OPEN';
    if (status === 'PARTIALLY_FILLED' && filled <= 0) status = 'OPEN';

    if (filled > order.appliedQty && res.avgPrice) {
      const meta = order.meta || {};
      this.portfolios.applyFill({
        portfolio,
        order,
        cumulativeQty: Math.min(filled, order.qty),
        avgPrice: res.avgPrice,
        costsModel: cfg.costs,
        date: this.today(),
        stopPrice: meta.stopPrice,
        reason: order.reason,
      });
      this.store.updateOrder(order.id, { filledQty: Math.min(filled, order.qty), avgFillPrice: res.avgPrice });
    }

    const map = {
      FILLED: ['FILLED', 'EXECUTED'],
      PARTIALLY_FILLED: ['PARTIALLY_FILLED', 'PARTIAL'],
      PARTIALLY_FILLED_CANCELLED: ['PARTIAL_CANCELLED', 'PARTIAL'],
      OPEN: ['OPEN', 'SUBMITTED'],
      SUBMITTED: ['SUBMITTED', 'SUBMITTED'],
      CANCELLED: ['CANCELLED', 'CANCELLED'],
      REJECTED: ['REJECTED', 'REJECTED'],
      UNKNOWN: ['UNKNOWN', 'SUBMITTED'],
      FAILED: ['FAILED', 'FAILED'],
    };
    const [orderStatus, signalStatus] = map[status] || map.UNKNOWN;
    const error = ['REJECTED', 'FAILED'].includes(orderStatus) ? res.message || 'Rejected by broker' : undefined;
    this.store.updateOrder(order.id, { status: orderStatus, ...(error ? { error } : {}) });
    events(orderStatus, res.message || '');
    if (order.signalId) this.store.updateSignal(order.signalId, { status: signalStatus });
    return orderStatus;
  }

  /** Reconcile every open order with its broker. Safe to call repeatedly. */
  async processOpenOrders({ portfolioId = null } = {}) {
    const results = [];
    for (const order of this.store.listOpenOrders(portfolioId)) {
      try {
        results.push(await this.reconcileOne(order));
      } catch (err) {
        this.store.addOrderEvent(order.id, order.status, order.filledQty, `Reconcile error: ${err.message}`);
        results.push({ id: order.id, status: order.status, error: err.message });
      }
    }
    return results;
  }

  async reconcileOne(order) {
    const portfolio = this.store.getPortfolioById(order.portfolioId);
    const cfg = this.getConfig(order.userId);
    const broker = this.brokerFor(portfolio, order.userId);
    if (order.status === 'QUEUED') {
      const market = marketStatus(this.clock());
      if (!market.open) return { id: order.id, status: 'QUEUED' };
      await this.submit(order, portfolio, broker, cfg);
      return { id: order.id, status: this.store.getOrder(order.id).status };
    }
    let res;
    if (!order.brokerOrderId) {
      res = await broker.findByTag(order.idempotencyKey);
      const attempts = (order.meta?.reconcileAttempts || 0) + 1;
      if (!res) {
        if (attempts >= RECONCILE_MAX_ATTEMPTS) {
          this.store.updateOrder(order.id, { status: 'FAILED', error: 'Could not confirm this order at the broker. Position was NOT updated - check the broker terminal manually.', meta: { ...order.meta, reconcileAttempts: attempts } });
          this.store.addOrderEvent(order.id, 'FAILED', 0, 'No matching broker order after repeated checks');
          if (order.signalId) this.store.updateSignal(order.signalId, { status: 'FAILED' });
          return { id: order.id, status: 'FAILED' };
        }
        this.store.updateOrder(order.id, { meta: { ...order.meta, reconcileAttempts: attempts } });
        return { id: order.id, status: order.status, note: 'Not visible at broker yet' };
      }
    } else {
      res = await broker.getOrder(order);
    }
    if (res.status === 'UNKNOWN') return { id: order.id, status: order.status };
    await this.applyResult(this.store.getOrder(order.id), res, portfolio, cfg);
    return { id: order.id, status: this.store.getOrder(order.id).status };
  }

  async cancel({ orderId, userId }) {
    const order = this.store.getOrder(orderId);
    if (!order || String(order.userId) !== String(userId)) throw new OrderError('NOT_FOUND', 'Order not found');
    if (!OPEN_STATUSES.includes(order.status)) throw new OrderError('NOT_CANCELLABLE', `Order is ${order.status}`);
    const portfolio = this.store.getPortfolioById(order.portfolioId);
    const cfg = this.getConfig(userId);
    if (order.status === 'QUEUED' || !order.brokerOrderId) {
      this.store.updateOrder(order.id, { status: 'CANCELLED' });
      this.store.addOrderEvent(order.id, 'CANCELLED', order.filledQty, 'Cancelled before submission');
      if (order.signalId) this.store.updateSignal(order.signalId, { status: 'CANCELLED' });
      return this.store.getOrder(order.id);
    }
    const broker = this.brokerFor(portfolio, userId);
    const res = await broker.cancel(order);
    if (res.status === 'CANCELLED') {
      const after = order.filledQty > 0 ? { ...res, status: 'PARTIALLY_FILLED_CANCELLED', filledQty: order.filledQty, avgPrice: order.avgFillPrice } : res;
      await this.applyResult(order, after, portfolio, cfg);
    } else {
      await this.reconcileOne(order);
    }
    return this.store.getOrder(order.id);
  }
}

module.exports = { OrderManager, OrderError, OPEN_STATUSES };
