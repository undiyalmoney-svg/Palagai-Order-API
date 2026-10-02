/**
 * Charts Protect entries — droplet-side SMC + ATM buy.
 *
 * Same engine as the Charts tab (bundled analyzeSmc). Same ATM path
 * (buildAtmOrderPlan → MARKET BUY PALAGAI_CHART → SL only, never TP).
 * First poll of a book is history (no chase). One fill, then stand down.
 */
'use strict';

const { kiteService } = require('../services/kite.service');
const { fetchHistoricalCandles, fetchQuoteLtp, fetchUserMargins } = require('../services/kite-market');
const { chartProtectiveLevels } = require('./levels');
const { openQty, ensureStop, kiteBody } = require('./flatten');
const store = require('./store');
const rules = require('./rules');
const instruments = require('./instruments');

const ENTRY_MS = 15_000;
const BOOK_STAGGER_MS = 350;
const MAX_BARS = 400;
const LTF_LOOKBACK_DAYS = 4;
const HTF_LOOKBACK_DAYS = 8;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const BOOKS = ['nifty', 'bank', 'crude'];

let charts = null;
let tracker = null;
try {
  charts = require('./from-charts/bundle');
} catch (err) {
  console.error('[charts-protect] SMC bundle missing — entries off until rebuild', err.message);
}

function getCharts() {
  return charts;
}

function getTracker() {
  if (!tracker && charts?.SmcAlertTracker) tracker = new charts.SmcAlertTracker();
  return tracker;
}

function resetTracker() {
  tracker = charts?.SmcAlertTracker ? new charts.SmcAlertTracker() : null;
}

function trimBars(rows) {
  return rows.length > MAX_BARS ? rows.slice(-MAX_BARS) : rows;
}

function lookbackFrom(now, days) {
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return from;
}

async function loadCandles(authorization, token, interval, now, lookbackDays) {
  const rows = await fetchHistoricalCandles(
    authorization,
    token,
    rules.formatIstDateTime(lookbackFrom(now, lookbackDays)),
    rules.formatIstDateTime(now),
    interval,
  );
  return trimBars(rows);
}

function lastPriceFromQuote(quotes, key) {
  const q = quotes && (quotes[key] || quotes[key.replace(/^[^:]+:/, '')]);
  const last = Number(q?.last_price);
  return last > 0 ? last : null;
}

async function readFillPrice(authorization, orderId, fallback) {
  if (!orderId) return fallback;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await kiteService.getOrderHistory(authorization, orderId);
      const rows = kiteBody(res).data;
      const list = Array.isArray(rows) ? rows : [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const px = Number(list[i]?.average_price);
        if (/complete/i.test(String(list[i]?.status || '')) && px > 0) return px;
      }
    } catch {
      // Stop can still rest off the quote.
    }
    await delay(350);
  }
  return fallback;
}

function kiteOk(placed) {
  const body = kiteBody(placed);
  const http = placed.status || 0;
  const orderId = body.data?.order_id || null;
  return { ok: http < 400 && (body.status === 'success' || orderId), orderId, body };
}

async function placeAtm(authorization, book, side, spot, lots, list) {
  const plan = charts.buildAtmOrderPlan({
    book,
    instruments: list,
    side,
    spot,
    asOfDateTime: new Date().toISOString(),
    lots,
  });
  if (!plan.ok) return { ok: false, message: plan.reason };
  const fields = charts.atmOrderFields(plan.ticket);
  const placed = await kiteService.placeOrder(authorization, 'regular', fields);
  const result = kiteOk(placed);
  if (!result.ok) {
    return {
      ok: false,
      message: result.body.message || 'Kite returned no order id. Check the order book.',
      ticket: plan.ticket,
    };
  }
  const premium = lastPriceFromQuote(
    await fetchQuoteLtp(authorization, [`${plan.ticket.exchange}:${plan.ticket.tradingSymbol}`]).catch(() => ({})),
    `${plan.ticket.exchange}:${plan.ticket.tradingSymbol}`,
  );
  const fill = await readFillPrice(authorization, result.orderId, premium);
  return { ok: true, orderId: result.orderId, ticket: plan.ticket, fill, message: result.body.message || `Order ${result.orderId} sent.` };
}

function openBooksFromPositions(positions, fills) {
  const books = [];
  for (const fill of fills || []) {
    if (openQty(positions, fill.instrument) > 0 && fill.book && !books.includes(fill.book)) {
      books.push(fill.book);
    }
  }
  return books;
}

async function considerBook(authorization, book, now, state, positions, slPlacedAt) {
  const ist = rules.istClockParts(now);
  const list = await instruments.loadChartInstruments(authorization);
  const under = instruments.resolveBookUnderlying(book, list, now);
  if (!under?.token) return { state, placed: false, message: `No ${book} underlying` };

  const [ltf, htf] = await Promise.all([
    loadCandles(authorization, under.token, 'minute', now, LTF_LOOKBACK_DAYS),
    loadCandles(authorization, under.token, '5minute', now, HTF_LOOKBACK_DAYS),
  ]);
  if (ltf.length < 30) return { state, placed: false, message: `${book} not enough 1m bars` };

  const analysis = charts.analyzeSmc({
    market: book,
    candles: ltf,
    intervalMinutes: 1,
    htf: { candles: htf, minutes: 5 },
    htfMinutes: 5,
    now,
    live: true,
    config: {},
  });

  const alerts = getTracker().ingest(`${book}|1m|5m|${ist.date}`, analysis.alerts || []);
  const htfTrend = analysis.snapshot?.htfTrend ?? analysis.snapshot?.trend ?? null;
  const day = rules.dayFromState(state);
  const openBooks = openBooksFromPositions(positions, state.fills);

  for (const event of alerts) {
    const decision = rules.decideProtectAuto({
      book,
      type: event.type,
      liveDay: true,
      marketOpen: rules.marketIsOpen(book, now),
      busy: false,
      htfTrend,
      istTime: ist.time,
      day,
      openBooks,
    });
    if (!decision.allow) continue;

    const funds = await fetchUserMargins(authorization).catch(() => null);
    const lots = rules.lotsForChartBook(book, funds?.equityCash || funds?.capitalRs || 0);
    const quotes = await fetchQuoteLtp(authorization, [under.quoteKey]).catch(() => ({}));
    const spot = lastPriceFromQuote(quotes, under.quoteKey) || ltf[ltf.length - 1]?.close;
    const side = rules.optionSideForAlert(event.type);
    if (!side || !(spot > 0)) continue;

    state = store.markPlaced(state, book);
    store.save(state);

    const result = await placeAtm(authorization, book, side, spot, lots, list);
    if (!result.ok) {
      state = store.unmarkPlaced(state, book);
      state.lastError = result.message;
      state.lastMessage = `Protect ${book} ${event.type} refused: ${result.message}`;
      store.save(state);
      return { state, placed: false, message: state.lastMessage };
    }

    const levels = result.fill ? chartProtectiveLevels(result.fill) : null;
    state = store.upsertFill(state, {
      instrument: result.ticket.tradingSymbol,
      exchange: result.ticket.exchange,
      book,
      qty: result.ticket.quantity,
      entry: result.fill,
      stop: levels?.stop || null,
      target: levels?.target || null,
    });
    state.lastError = null;
    state.lastMessage = `Protect ${rules.labelOf(book)} ${event.type} → ${result.ticket.tradingSymbol} ${result.message}`;
    store.save(state);

    if (levels) {
      const sl = await ensureStop(
        kiteService,
        authorization,
        {
          instrument: result.ticket.tradingSymbol,
          exchange: result.ticket.exchange,
          qty: result.ticket.quantity,
        },
        levels.stop,
        slPlacedAt,
      );
      if (!sl.ok && !sl.skipped) state.lastError = sl.message;
      else state.lastMessage = `${state.lastMessage} · ${sl.message}`;
      store.save(state);
    }
    return { state, placed: true, message: state.lastMessage };
  }
  return { state, placed: false };
}

/**
 * Scan books in Protect windows for a fresh SMC BUY/SELL and send one ATM.
 * Returns the (possibly updated) state. Caller owns persistence of lastTick.
 */
async function scanEntries(authorization, state, positions, slPlacedAt, now = new Date()) {
  if (!charts?.analyzeSmc || !charts?.buildAtmOrderPlan) {
    state.lastError = state.lastError || 'SMC bundle missing on droplet — tab still places';
    return state;
  }
  if (!state.enabled) return state;
  if ((state.fills || []).some((fill) => openQty(positions, fill.instrument) > 0)) return state;

  const ist = rules.istClockParts(now);
  const watching = BOOKS.filter((book) => rules.inProtectWindow(book, ist.time) && rules.marketIsOpen(book, now));
  for (let i = 0; i < watching.length; i += 1) {
    if (i) await delay(BOOK_STAGGER_MS);
    const result = await considerBook(authorization, watching[i], now, state, positions, slPlacedAt);
    state = result.state;
    if (result.placed) return state;
  }
  return state;
}

module.exports = {
  ENTRY_MS,
  scanEntries,
  getCharts,
  getTracker,
  resetTracker,
  lastPriceFromQuote,
  openBooksFromPositions,
};
