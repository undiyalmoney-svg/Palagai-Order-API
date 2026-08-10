/**
 * Broker bridge for Server Live — calls kite.service directly (not /api/kite HTTP).
 * Mirrors Trade Desk LiveOrderExecutor entry / SL-M / exit behaviour.
 */
const { kiteService } = require('../services/kite.service');
const {
  computeProtectiveSlTrigger,
  NIFTY_50_INSTRUMENT,
  BANK_NIFTY_INSTRUMENT,
  CRUDE_OIL_MINI_INSTRUMENT,
} = require('./strategy-core.cjs');
const { fetchQuotes } = require('./kite-market');

const TICK = 0.05;
function tickStr(p) {
  const v = Math.max(TICK, Math.round((Number(p) || 0) / TICK) * TICK);
  return v.toFixed(2);
}

/**
 * Protective SELL stop for a long option. The exchange discontinued SL-M for
 * F&O, so we place a Stop-Loss LIMIT (order_type 'SL') with the limit ~10%
 * below the trigger so it still fills like a stop-market on a normal move.
 */
function slOrderFields({ exchange, tradingsymbol, quantity, product, trigger }) {
  const trig = Math.max(TICK, Math.round((Number(trigger) || 0) / TICK) * TICK);
  const limit = Math.max(TICK, Math.round((trig * 0.9) / TICK) * TICK);
  return {
    exchange,
    tradingsymbol,
    transaction_type: 'SELL',
    order_type: 'SL',
    quantity: String(quantity),
    product: product || 'MIS',
    validity: 'DAY',
    trigger_price: trig.toFixed(2),
    price: limit.toFixed(2),
    tag: 'PALAGAISL',
  };
}

/** Map a broker option symbol back to the desk instrument id. */
function instrumentIdForSymbol(sym) {
  const s = String(sym || '').toUpperCase();
  if (s.startsWith('BANKNIFTY')) return BANK_NIFTY_INSTRUMENT.id;
  if (s.startsWith('CRUDEOIL')) return CRUDE_OIL_MINI_INSTRUMENT.id;
  if (s.startsWith('NIFTY')) return NIFTY_50_INSTRUMENT.id;
  return null;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isFilledOrWorking(status) {
  const s = String(status || '').toUpperCase();
  return (
    s === 'COMPLETE' ||
    s === 'OPEN' ||
    s === 'TRIGGER PENDING' ||
    s === 'AMO REQ RECEIVED' ||
    s === 'PUT ORDER REQ RECEIVED'
  );
}

function isPendingSl(status) {
  const s = String(status || '').toUpperCase();
  return s === 'TRIGGER PENDING' || s === 'OPEN' || s === 'AMO REQ RECEIVED';
}

function isTerminalOrderStatus(status) {
  const s = String(status || '').toUpperCase();
  return (
    s === 'COMPLETE' ||
    s === 'CANCELLED' ||
    s === 'CANCELED' ||
    s === 'REJECTED' ||
    s === 'EXPIRED'
  );
}

function orderStatusOf(order) {
  return String(order?.status || '').toUpperCase();
}

class LiveBroker {
  constructor({ pushEvent, realOrders, onFill }) {
    this.pushEvent = pushEvent;
    this.realOrders = !!realOrders;
    /** @type {null|((fill:object)=>void)} */
    this.onFill = typeof onFill === 'function' ? onFill : null;
    /** Live Green: 1 = never overlap Nifty+Bank (margin / EXIT safety). 0 = off. */
    this.maxOpenLegs = 1;
    /** @type {Map<string, object>} */
    this.positions = new Map();
    /** @type {Map<string, number>} */
    this.lotsByInstrument = new Map();
  }

  setMaxOpenLegs(n) {
    const v = Math.floor(Number(n));
    this.maxOpenLegs = Number.isFinite(v) && v >= 0 ? v : 1;
  }

  openLegCount() {
    let n = 0;
    for (const p of this.positions.values()) {
      if (p?.status === 'open' || p?.status === 'exiting') n += 1;
    }
    return n;
  }

  setOnFill(fn) {
    this.onFill = typeof fn === 'function' ? fn : null;
  }

  emitFill(fill) {
    if (!this.onFill) return;
    try {
      this.onFill(fill);
    } catch (err) {
      this.pushEvent('ERROR', `onFill failed: ${err.message}`);
    }
  }

  setRealOrders(v) {
    this.realOrders = !!v;
  }

  setLots(instrumentId, lots) {
    this.lotsByInstrument.set(instrumentId, Math.max(1, Math.floor(lots) || 1));
  }

  lotsFor(instrumentId) {
    return this.lotsByInstrument.get(instrumentId) || 1;
  }

  clear() {
    this.positions.clear();
  }

  /**
   * Restart safety: adopt any PALAGAI positions already open at the broker so a
   * restart mid-trade does NOT place a duplicate entry. Matches each held long
   * option to its resting SL-M order. Best-effort; never throws.
   */
  async reconcileFromBroker(authorization) {
    if (!this.realOrders) return;
    try {
      const posRes = await kiteService.getPositions(authorization);
      const rows = [
        ...(posRes.data?.data?.net || []),
        ...(posRes.data?.data?.day || []),
      ];
      const orders = await this.getOrders(authorization);
      let adopted = 0;
      for (const row of rows) {
        const qty = Number(row.quantity || 0);
        if (qty <= 0) continue; // only long option positions we hold
        const sym = row.tradingsymbol || '';
        const instrumentId = instrumentIdForSymbol(sym);
        if (!instrumentId) continue;
        if (this.positions.get(instrumentId)?.status === 'open') continue;
        const sl = orders.find((o) => {
          const ot = String(o.order_type || '').toUpperCase();
          return (
            (o.tradingsymbol || '').toUpperCase() === sym.toUpperCase() &&
            (ot === 'SL' || ot === 'SL-M') &&
            isPendingSl(o.status)
          );
        });
        const exchange =
          row.exchange || (sym.toUpperCase().startsWith('CRUDEOIL') ? 'MCX' : 'NFO');
        this.positions.set(instrumentId, {
          status: 'open',
          instrumentId,
          tradingSymbol: sym,
          instrumentToken: Number(row.instrument_token || 0) || null,
          quantity: Math.abs(qty),
          direction: 'BUY',
          entryOrderId: null,
          slOrderId: sl?.order_id || null,
          exitOrderId: null,
          entryPremium: Number(row.average_price || row.buy_price || 0) || null,
          slTrigger: sl?.trigger_price != null ? Number(sl.trigger_price) : null,
          entryTime: null,
          exchange,
          product: row.product || 'MIS',
          indexEntry: null,
          indexStop: null,
          lastError: null,
        });
        adopted += 1;
        this.pushEvent(
          'RECONCILE',
          `Adopted open ${sym} qty ${Math.abs(qty)}${sl ? ` · SL ${sl.order_id}` : ' · NO resting SL'}`,
        );
      }
      if (adopted === 0) {
        this.pushEvent('RECONCILE', 'No open PALAGAI positions at broker — clean start');
      }
    } catch (err) {
      this.pushEvent('ERROR', `reconcile failed: ${err.message}`);
    }
  }

  /** Ensure an open position has a resting protective SL-M; (re)place if missing. */
  async ensureProtectiveSl(authorization, pos, open) {
    if (pos.slOrderId || !(pos.entryPremium > 0)) return;
    const indexRisk = open
      ? Math.abs(open.indexEntry - open.indexStop)
      : Math.abs(Number(pos.indexEntry || 0) - Number(pos.indexStop || 0));
    const ltp = await this.resolveOptionLtp(authorization, pos.tradingSymbol, pos.exchange);
    const trigger = computeProtectiveSlTrigger({
      fillPremium: pos.entryPremium,
      indexRiskPts: indexRisk,
      exchange: pos.exchange,
      tradingSymbol: pos.tradingSymbol,
      ltp,
    });
    if (!(trigger > 0)) return;
    const res = await kiteService.placeOrder(
      authorization,
      'regular',
      slOrderFields({
        exchange: pos.exchange,
        tradingsymbol: pos.tradingSymbol,
        quantity: pos.quantity,
        product: pos.product,
        trigger,
      }),
    );
    const id = res.data?.data?.order_id || null;
    if (res.status < 400 && id) {
      pos.slOrderId = id;
      pos.slTrigger = trigger;
      this.pushEvent('SL', `${pos.tradingSymbol}: SL (ensured) @ ${tickStr(trigger)} id ${id}`);
    } else {
      this.pushEvent(
        'ERROR',
        `${pos.tradingSymbol}: SL ensure failed — ${res.data?.message || res.status}`,
      );
    }
  }

  async syncInstrument({ authorization, instrumentId, instrumentName, open, lots }) {
    if (lots != null) this.setLots(instrumentId, lots);
    if (!this.realOrders) {
      if (open?.option) {
        this.pushEvent(
          'PAPER',
          `${instrumentName}: paper ${open.direction} ${open.option.tradingSymbol} @ ${open.indexEntry}`,
        );
      }
      return;
    }

    let current = this.positions.get(instrumentId) || null;

    // Detect SL fill → flat (and capture fill price for money ledger).
    if (current?.status === 'open' && current.slOrderId) {
      const orders = await this.getOrders(authorization);
      const sl = orders.find((o) => o.order_id === current.slOrderId);
      if (sl && String(sl.status || '').toUpperCase() === 'COMPLETE') {
        const fillPx =
          Number(sl.average_price || 0) ||
          (await this.resolveOrderFillPremium(authorization, current.slOrderId));
        this.pushEvent(
          'SL',
          `${instrumentName}: SL filled ${current.tradingSymbol}` +
            (fillPx ? ` @ ${tickStr(fillPx)}` : ''),
        );
        current.status = 'flat';
        current.closedBy = 'sl';
        current.closedEntryTime = current.entryTime;
        current.exitPremium = fillPx || null;
        current.slOrderId = null;
        this.positions.set(instrumentId, current);
        if (fillPx > 0) {
          this.emitFill({
            side: 'sl',
            instrumentId,
            instrumentName,
            tradingSymbol: current.tradingSymbol,
            entryTime: current.entryTime,
            premium: fillPx,
            quantity: current.quantity,
            lotSize: current.quantity,
            reason: 'Protective SL filled',
            at: new Date().toISOString(),
          });
        }
        // Paper may still show this leg open — do NOT fall through to re-entry.
        const sameLeg =
          open &&
          (open.option?.tradingSymbol || '').toUpperCase() ===
            (current.tradingSymbol || '').toUpperCase() &&
          (!current.entryTime || current.entryTime === open.entryTime);
        if (sameLeg || !open) return;
      }
    }

    current = this.positions.get(instrumentId) || null;

    // Broker already flattened this paper leg (SL/exit) — wait for strategy
    // to drop `open` before allowing a new entry (prevents duplicate BUY).
    if (
      open &&
      current?.status === 'flat' &&
      current.closedBy &&
      (current.closedEntryTime === open.entryTime ||
        (!current.closedEntryTime &&
          (current.tradingSymbol || '').toUpperCase() ===
            (open.option?.tradingSymbol || '').toUpperCase()))
    ) {
      return;
    }

    if (open && current?.status === 'open') {
      const same =
        (current.tradingSymbol || '').toUpperCase() ===
          (open.option?.tradingSymbol || '').toUpperCase() &&
        // A reconciled/adopted position has no entryTime — match on symbol only.
        (!current.entryTime || current.entryTime === open.entryTime);
      if (same) {
        // Restart/failed-SL safety: (re)place a stop if this open leg has none.
        if (!current.slOrderId) {
          await this.ensureProtectiveSl(authorization, current, open);
        }
        await this.syncProtectiveSl(authorization, current, open);
        return;
      }
      this.pushEvent(
        'EXIT',
        `${instrumentName}: handoff ${current.tradingSymbol} → ${open.option?.tradingSymbol || '?'}`,
      );
      await this.placeExit(authorization, current, instrumentName);
      // Only enter the new leg if the prior exit actually flattened.
      if (current.status === 'flat') {
        await this.placeEntry(authorization, instrumentId, instrumentName, open);
      }
      return;
    }

    if (open && (!current || current.status === 'flat' || current.status === 'error')) {
      await this.placeEntry(authorization, instrumentId, instrumentName, open);
      return;
    }

    if (!open && current?.status === 'open') {
      await this.placeExit(authorization, current, instrumentName);
    }
  }

  async placeEntry(authorization, instrumentId, instrumentName, open) {
    const option = open.option;
    if (!option || option.source === 'synthetic' || !(option.instrumentToken > 0)) {
      this.pushEvent(
        'SKIP',
        `${instrumentName}: no tradeable option (synthetic/missing) — refresh instruments`,
      );
      return;
    }
    // Live Green: never enter on estimated/synthetic premium marks (paper≠live leak).
    if (open.premiumEstimated) {
      this.pushEvent(
        'SKIP',
        `${instrumentName}: estimated premium — skip live entry (paper mark only)`,
      );
      return;
    }
    // Live Green: one open leg at a time — overlapping books caused today's EXIT margin death.
    if (this.maxOpenLegs > 0 && this.openLegCount() >= this.maxOpenLegs) {
      const existing = [...this.positions.values()].find(
        (p) => p?.status === 'open' || p?.status === 'exiting',
      );
      if (existing && existing.instrumentId !== instrumentId) {
        this.pushEvent(
          'SKIP',
          `${instrumentName}: maxOpenLegs ${this.maxOpenLegs} — wait for ${existing.tradingSymbol} flat`,
        );
        return;
      }
    }
    const lotSize = Math.max(1, option.lotSize || 1);
    const lotsMult = this.lotsFor(instrumentId);
    const quantity = lotSize * lotsMult;
    const sym = option.tradingSymbol;
    const exchange =
      option.exchange ||
      (String(sym).toUpperCase().startsWith('CRUDEOIL') ? 'MCX' : 'NFO');
    const product = 'MIS';

    const response = await kiteService.placeOrder(authorization, 'regular', {
      exchange,
      tradingsymbol: sym,
      transaction_type: 'BUY',
      order_type: 'MARKET',
      quantity: String(quantity),
      product,
      validity: 'DAY',
      market_protection: '-1',
      tag: 'PALAGAI',
    });
    const entryOrderId = response.data?.data?.order_id;
    if (response.status >= 400 || !entryOrderId) {
      const msg = response.data?.message || `entry HTTP ${response.status}`;
      this.pushEvent('ERROR', `${instrumentName}: ENTRY failed — ${msg}`);
      this.positions.set(instrumentId, {
        status: 'error',
        tradingSymbol: sym,
        lastError: msg,
      });
      return;
    }

    this.pushEvent(
      'ENTRY',
      `${instrumentName}: BUY ${quantity} ${sym} MIS (${lotsMult}×${lotSize})`,
    );

    await delay(900);
    const fillPremium = await this.resolveEntryPremium(
      authorization,
      entryOrderId,
      sym,
      open.optionEntryPremium,
      exchange,
    );
    const indexRisk = Math.abs(open.indexEntry - open.indexStop);
    const ltp = await this.resolveOptionLtp(authorization, sym, exchange);
    const slTrigger = computeProtectiveSlTrigger({
      fillPremium,
      indexRiskPts: indexRisk,
      exchange,
      tradingSymbol: sym,
      ltp,
    });

    const slRes = await kiteService.placeOrder(
      authorization,
      'regular',
      slOrderFields({ exchange, tradingsymbol: sym, quantity, product, trigger: slTrigger }),
    );
    const slOrderId = slRes.data?.data?.order_id || null;
    if (slRes.status >= 400 || !slOrderId) {
      this.pushEvent(
        'ERROR',
        `${instrumentName}: SL failed — ${slRes.data?.message || slRes.status} (entry live!)`,
      );
    } else {
      this.pushEvent('SL', `${instrumentName}: SL @ ${tickStr(slTrigger)} id ${slOrderId}`);
    }

    this.positions.set(instrumentId, {
      status: 'open',
      instrumentId,
      tradingSymbol: sym,
      instrumentToken: option.instrumentToken,
      quantity,
      direction: 'BUY',
      entryOrderId,
      slOrderId,
      exitOrderId: null,
      entryPremium: fillPremium,
      exitPremium: null,
      slTrigger,
      entryTime: open.entryTime,
      exchange,
      product,
      indexEntry: open.indexEntry,
      indexStop: open.indexStop,
      closedBy: null,
      closedEntryTime: null,
      lastError: null,
    });

    this.emitFill({
      side: 'entry',
      instrumentId,
      instrumentName,
      tradingSymbol: sym,
      entryTime: open.entryTime,
      premium: fillPremium,
      quantity,
      lotSize,
      lots: lotsMult,
      at: new Date().toISOString(),
    });

    // If the protective SL-M failed to place, retry once now so the position
    // is never left without a resting stop.
    if (!slOrderId) {
      await this.ensureProtectiveSl(authorization, this.positions.get(instrumentId), open);
    }
  }

  async syncProtectiveSl(authorization, pos, open) {
    if (!pos.slOrderId || !(pos.entryPremium > 0)) return;
    const indexRisk = Math.abs(open.indexEntry - open.indexStop);
    const ltp = await this.resolveOptionLtp(authorization, pos.tradingSymbol, pos.exchange);
    const next = computeProtectiveSlTrigger({
      fillPremium: pos.entryPremium,
      indexRiskPts: indexRisk,
      exchange: pos.exchange,
      tradingSymbol: pos.tradingSymbol,
      ltp,
    });
    if (!(next > 0) || (pos.slTrigger != null && Math.abs(next - pos.slTrigger) < 0.049)) {
      return;
    }
    // Only tighten (lower trigger for long option)
    if (pos.slTrigger != null && next >= pos.slTrigger - 0.001) return;

    const res = await kiteService.modifyOrder(authorization, 'regular', pos.slOrderId, {
      order_type: 'SL',
      quantity: String(pos.quantity),
      trigger_price: tickStr(next),
      price: tickStr(Math.max(TICK, next * 0.9)),
      validity: 'DAY',
    });
    if (res.status >= 400) {
      this.pushEvent(
        'ERROR',
        `MODIFY_SL ${pos.tradingSymbol}: ${res.data?.message || res.status}`,
      );
      return;
    }
    pos.slTrigger = next;
    pos.indexStop = open.indexStop;
    this.pushEvent('MODIFY_SL', `${pos.tradingSymbol}: SL → ${tickStr(next)}`);
  }

  /**
   * Cancel resting protective SL before EXIT SELL.
   *
   * Critical: a pending SL SELL locks the long qty. Placing another MARKET SELL
   * while locked is treated as a naked short by Zerodha → "Insufficient funds"
   * with ~full short-option margin (e.g. ₹2L on BankNifty). Never place EXIT
   * until every pending SL on this symbol is gone (or already filled).
   *
   * @returns {{ cleared: boolean, slFilled: boolean }}
   */
  async cancelProtectiveSl(authorization, pos, instrumentName) {
    const label = instrumentName || pos.instrumentId || pos.tradingSymbol;
    const sym = (pos.tradingSymbol || '').toUpperCase();
    let slFilled = false;

    const cancelOne = async (orderId) => {
      if (!orderId) return null;
      const cancel = await kiteService.cancelOrder(authorization, 'regular', orderId);
      const msg = cancel.data?.message || cancel.data?.error_type || '';
      this.pushEvent(
        'CANCEL_SL',
        `${label}: cancel SL ${orderId} (${cancel.status}${msg ? ` · ${msg}` : ''})`,
      );
      return cancel;
    };

    // 1) Cancel known SL id (400 is OK if already terminal — check book next).
    if (pos.slOrderId) {
      await cancelOne(pos.slOrderId);
      await delay(500);
      const hist = await kiteService.getOrderHistory(authorization, pos.slOrderId);
      const rows = hist.data?.data || [];
      const latest = rows[rows.length - 1] || rows[0] || null;
      const st = orderStatusOf(latest);
      if (st === 'COMPLETE') {
        slFilled = true;
        pos.slOrderId = null;
        return { cleared: true, slFilled: true };
      }
      if (isTerminalOrderStatus(st)) {
        pos.slOrderId = null;
      }
    }

    // 2) Sweep any other pending SL / SL-M on this symbol (stale id / restart).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const orders = await this.getOrders(authorization);
      const pending = orders.filter((o) => {
        const ot = String(o.order_type || '').toUpperCase();
        return (
          (o.tradingsymbol || '').toUpperCase() === sym &&
          (ot === 'SL' || ot === 'SL-M') &&
          String(o.transaction_type || '').toUpperCase() === 'SELL' &&
          isPendingSl(o.status)
        );
      });

      if (pending.length === 0) {
        // Confirm known id is not still pending under a laggy book.
        if (pos.slOrderId) {
          const still = orders.find((o) => o.order_id === pos.slOrderId);
          if (!still || isTerminalOrderStatus(still.status)) {
            if (orderStatusOf(still) === 'COMPLETE') slFilled = true;
            pos.slOrderId = null;
            return { cleared: true, slFilled };
          }
          // Known id still live but missed the SL filter — cancel it directly.
          await cancelOne(pos.slOrderId);
          await delay(600 + attempt * 400);
          continue;
        }
        return { cleared: true, slFilled };
      }

      for (const o of pending) {
        await cancelOne(o.order_id);
      }
      await delay(600 + attempt * 400);
    }

    const orders = await this.getOrders(authorization);
    const stillPending = orders.some((o) => {
      const ot = String(o.order_type || '').toUpperCase();
      return (
        (o.tradingsymbol || '').toUpperCase() === sym &&
        (ot === 'SL' || ot === 'SL-M') &&
        String(o.transaction_type || '').toUpperCase() === 'SELL' &&
        isPendingSl(o.status)
      );
    });
    if (!stillPending) {
      pos.slOrderId = null;
      return { cleared: true, slFilled };
    }

    this.pushEvent(
      'ERROR',
      `${label}: SL still pending — skip EXIT SELL (avoids naked-short margin)`,
    );
    return { cleared: false, slFilled: false };
  }

  async placeExit(authorization, pos, instrumentName) {
    if (pos.status !== 'open') return;
    pos.status = 'exiting';

    const { cleared, slFilled } = await this.cancelProtectiveSl(
      authorization,
      pos,
      instrumentName,
    );

    if (slFilled) {
      this.pushEvent('EXIT', `${pos.tradingSymbol}: SL already filled — flat`);
      pos.status = 'flat';
      pos.slOrderId = null;
      return;
    }

    if (!cleared) {
      // Keep open so the next tick retries cancel → exit. Do NOT place SELL
      // while qty is locked by a resting SL (causes Insufficient funds / short margin).
      pos.status = 'open';
      return;
    }

    // Still long?
    const qty = await this.resolveExitQty(authorization, pos);
    if (!(qty > 0)) {
      this.pushEvent('EXIT', `${pos.tradingSymbol}: already flat at broker`);
      pos.status = 'flat';
      pos.closedBy = pos.closedBy || 'flat';
      pos.closedEntryTime = pos.closedEntryTime || pos.entryTime;
      // If SL already filled earlier but fill callback missed, try once more.
      if (!(pos.exitPremium > 0) && pos.slOrderId) {
        const px = await this.resolveOrderFillPremium(authorization, pos.slOrderId);
        if (px > 0) {
          pos.exitPremium = px;
          this.emitFill({
            side: 'sl',
            instrumentId: pos.instrumentId,
            instrumentName,
            tradingSymbol: pos.tradingSymbol,
            entryTime: pos.entryTime,
            premium: px,
            quantity: pos.quantity,
            reason: 'Already flat (SL fill)',
            at: new Date().toISOString(),
          });
        }
      }
      pos.slOrderId = null;
      return;
    }

    const product = pos.product || 'MIS';
    const res = await kiteService.placeOrder(authorization, 'regular', {
      exchange: pos.exchange,
      tradingsymbol: pos.tradingSymbol,
      transaction_type: 'SELL',
      order_type: 'MARKET',
      quantity: String(qty),
      product,
      validity: 'DAY',
      market_protection: '-1',
      tag: 'PALAGAI',
    });
    const exitId = res.data?.data?.order_id;
    if (res.status >= 400 || !exitId) {
      const msg = res.data?.message || String(res.status);
      this.pushEvent('ERROR', `EXIT failed ${pos.tradingSymbol}: ${msg}`);
      // If broker still sees a lock / short-margin demand, re-check SL sweep next tick.
      pos.status = 'open';
      return;
    }
    pos.exitOrderId = exitId;
    const fillPx = await this.resolveOrderFillPremium(authorization, exitId);
    pos.exitPremium = fillPx || null;
    pos.status = 'flat';
    pos.slOrderId = null;
    pos.closedBy = 'exit';
    pos.closedEntryTime = pos.entryTime;
    this.pushEvent(
      'EXIT',
      `${instrumentName || ''}: SELL ${qty} ${pos.tradingSymbol} ${product} MARKET`.trim() +
        (fillPx ? ` @ ${tickStr(fillPx)}` : ''),
    );
    if (fillPx > 0) {
      this.emitFill({
        side: 'exit',
        instrumentId: pos.instrumentId,
        instrumentName,
        tradingSymbol: pos.tradingSymbol,
        entryTime: pos.entryTime,
        premium: fillPx,
        quantity: qty,
        lotSize: qty,
        reason: 'EXIT MARKET',
        at: new Date().toISOString(),
      });
    }
  }

  async getOrders(authorization) {
    const res = await kiteService.getOrders(authorization);
    if (res.status >= 400) return [];
    return res.data?.data || [];
  }

  async resolveExitQty(authorization, pos) {
    const res = await kiteService.getPositions(authorization);
    const net = res.data?.data?.net || [];
    const day = res.data?.data?.day || [];
    const sym = (pos.tradingSymbol || '').toUpperCase();
    const product = String(pos.product || '').toUpperCase();

    const pickLong = (rows) => {
      for (const row of rows) {
        if ((row.tradingsymbol || '').toUpperCase() !== sym) continue;
        if (product && row.product && String(row.product).toUpperCase() !== product) {
          continue;
        }
        const q = Number(row.quantity || 0);
        // Long options only — never abs(short) or we would sell into a larger short.
        if (q > 0) return q;
      }
      return 0;
    };

    return pickLong(net) || pickLong(day) || 0;
  }

  async resolveOrderFillPremium(authorization, orderId) {
    if (!orderId) return null;
    for (let i = 0; i < 6; i += 1) {
      const hist = await kiteService.getOrderHistory(authorization, orderId);
      const rows = hist.data?.data || [];
      const done = rows.find((r) => String(r.status || '').toUpperCase() === 'COMPLETE');
      const avg = Number(done?.average_price || 0);
      if (avg > 0) return avg;
      await delay(400);
    }
    return null;
  }

  async resolveEntryPremium(authorization, orderId, symbol, fallback, exchange) {
    const avg = await this.resolveOrderFillPremium(authorization, orderId);
    if (avg > 0) return avg;
    if (fallback != null && fallback > 0) return fallback;
    const ltp = await this.resolveOptionLtp(authorization, symbol, exchange);
    return ltp || 1;
  }

  async resolveOptionLtp(authorization, symbol, exchange) {
    try {
      const key = `${exchange}:${symbol}`;
      const book = await fetchQuotes(authorization, [key]);
      const row = book[key];
      return Number(row?.last_price || 0) || null;
    } catch {
      return null;
    }
  }
}

module.exports = {
  LiveBroker,
  isFilledOrWorking,
  isPendingSl,
  isTerminalOrderStatus,
};
