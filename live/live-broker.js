/**
 * Broker bridge for Server Live — calls kite.service directly (not /api/kite HTTP).
 * Mirrors Trade Desk LiveOrderExecutor entry / SL-M / exit behaviour.
 */
const { kiteService } = require('../services/kite.service');
const { computeProtectiveSlTrigger } = require('./strategy-core.cjs');
const { fetchQuotes } = require('./kite-market');

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

class LiveBroker {
  constructor({ pushEvent, realOrders }) {
    this.pushEvent = pushEvent;
    this.realOrders = !!realOrders;
    /** @type {Map<string, object>} */
    this.positions = new Map();
    /** @type {Map<string, number>} */
    this.lotsByInstrument = new Map();
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

    // Detect SL fill → flat
    if (current?.status === 'open' && current.slOrderId) {
      const orders = await this.getOrders(authorization);
      const sl = orders.find((o) => o.order_id === current.slOrderId);
      if (sl && String(sl.status || '').toUpperCase() === 'COMPLETE') {
        this.pushEvent(
          'SL',
          `${instrumentName}: SL-M filled ${current.tradingSymbol}`,
        );
        current.status = 'flat';
        this.positions.set(instrumentId, current);
        current = current;
        const sameLeg =
          open &&
          (open.option?.tradingSymbol || '').toUpperCase() ===
            (current.tradingSymbol || '').toUpperCase() &&
          (!current.entryTime || current.entryTime === open.entryTime);
        if (sameLeg || !open) return;
      }
    }

    current = this.positions.get(instrumentId) || null;

    if (open && current?.status === 'open') {
      const same =
        (current.tradingSymbol || '').toUpperCase() ===
          (open.option?.tradingSymbol || '').toUpperCase() &&
        current.entryTime === open.entryTime;
      if (same) {
        await this.syncProtectiveSl(authorization, current, open);
        return;
      }
      this.pushEvent(
        'EXIT',
        `${instrumentName}: handoff ${current.tradingSymbol} → ${open.option?.tradingSymbol || '?'}`,
      );
      await this.placeExit(authorization, current, instrumentName);
      await this.placeEntry(authorization, instrumentId, instrumentName, open);
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

    const slRes = await kiteService.placeOrder(authorization, 'regular', {
      exchange,
      tradingsymbol: sym,
      transaction_type: 'SELL',
      order_type: 'SL-M',
      quantity: String(quantity),
      product,
      validity: 'DAY',
      trigger_price: String(slTrigger),
      tag: 'PALAGAISL',
    });
    const slOrderId = slRes.data?.data?.order_id || null;
    if (slRes.status >= 400 || !slOrderId) {
      this.pushEvent(
        'ERROR',
        `${instrumentName}: SL-M failed — ${slRes.data?.message || slRes.status} (entry live!)`,
      );
    } else {
      this.pushEvent('SL', `${instrumentName}: SL-M @ ${slTrigger} id ${slOrderId}`);
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
      slTrigger,
      entryTime: open.entryTime,
      exchange,
      product,
      indexEntry: open.indexEntry,
      indexStop: open.indexStop,
      lastError: null,
    });
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
      order_type: 'SL-M',
      quantity: String(pos.quantity),
      trigger_price: String(next),
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
    this.pushEvent('MODIFY_SL', `${pos.tradingSymbol}: SL-M → ${next}`);
  }

  async placeExit(authorization, pos, instrumentName) {
    if (pos.status !== 'open') return;
    pos.status = 'exiting';

    if (pos.slOrderId) {
      const cancel = await kiteService.cancelOrder(authorization, 'regular', pos.slOrderId);
      this.pushEvent(
        'CANCEL_SL',
        `${instrumentName || pos.instrumentId}: cancel SL ${pos.slOrderId} (${cancel.status})`,
      );
      await delay(400);
    }

    // Still long?
    const qty = await this.resolveExitQty(authorization, pos);
    if (!(qty > 0)) {
      this.pushEvent('EXIT', `${pos.tradingSymbol}: already flat at broker`);
      pos.status = 'flat';
      return;
    }

    const res = await kiteService.placeOrder(authorization, 'regular', {
      exchange: pos.exchange,
      tradingsymbol: pos.tradingSymbol,
      transaction_type: 'SELL',
      order_type: 'MARKET',
      quantity: String(qty),
      product: pos.product || 'MIS',
      validity: 'DAY',
      market_protection: '-1',
      tag: 'PALAGAI',
    });
    const exitId = res.data?.data?.order_id;
    if (res.status >= 400 || !exitId) {
      this.pushEvent(
        'ERROR',
        `EXIT failed ${pos.tradingSymbol}: ${res.data?.message || res.status}`,
      );
      pos.status = 'open';
      return;
    }
    pos.exitOrderId = exitId;
    pos.status = 'flat';
    this.pushEvent('EXIT', `${instrumentName || ''}: SELL ${qty} ${pos.tradingSymbol} MARKET`.trim());
  }

  async getOrders(authorization) {
    const res = await kiteService.getOrders(authorization);
    if (res.status >= 400) return [];
    return res.data?.data || [];
  }

  async resolveExitQty(authorization, pos) {
    const res = await kiteService.getPositions(authorization);
    const rows = [
      ...(res.data?.data?.net || []),
      ...(res.data?.data?.day || []),
    ];
    const sym = (pos.tradingSymbol || '').toUpperCase();
    for (const row of rows) {
      if ((row.tradingsymbol || '').toUpperCase() !== sym) continue;
      const q = Number(row.quantity || 0);
      if (q) return Math.abs(q);
    }
    return 0;
  }

  async resolveEntryPremium(authorization, orderId, symbol, fallback, exchange) {
    for (let i = 0; i < 4; i += 1) {
      const hist = await kiteService.getOrderHistory(authorization, orderId);
      const rows = hist.data?.data || [];
      const done = rows.find((r) => String(r.status || '').toUpperCase() === 'COMPLETE');
      const avg = Number(done?.average_price || 0);
      if (avg > 0) return avg;
      await delay(500);
    }
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

module.exports = { LiveBroker, isFilledOrWorking, isPendingSl };
