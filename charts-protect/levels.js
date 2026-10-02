/**
 * Charts Protect — 25% stop / 0.5R target. Same math as the Charts tab.
 * Do not rest the target at Kite while the stop holds qty.
 */
'use strict';

function roundToTick(value, tick) {
  const step = tick > 0 ? tick : 0.05;
  return Math.round(Number(value) / step) * step;
}

function chartProtectiveLevels(fill, tick = 0.05) {
  if (!(fill > 0) || !Number.isFinite(fill)) return null;
  const risk = fill * 0.25;
  const stop = roundToTick(fill - risk, tick);
  const target = roundToTick(fill + 0.5 * risk, tick);
  if (!(stop > 0) || !(target > fill)) return null;
  return { stop, target };
}

/** last ≤ stop → LOSS (checked first). last ≥ target → PROFIT. */
function hitPlannedLevel(last, levels) {
  if (!levels || last == null || !Number.isFinite(last)) return null;
  if (last <= levels.stop) return 'LOSS';
  if (last >= levels.target) return 'PROFIT';
  return null;
}

function atmStopFields(fill, triggerPremium, tick = 0.05) {
  const trig = roundToTick(Number(triggerPremium), tick);
  if (!(trig > 0)) return null;
  const limit = roundToTick(Math.max(tick, trig * 0.9), tick);
  const crude = /crude/i.test(fill.instrument || '');
  return {
    exchange: fill.exchange || (crude ? 'MCX' : 'NFO'),
    tradingsymbol: fill.instrument,
    transaction_type: 'SELL',
    order_type: 'SL',
    quantity: String(fill.qty),
    product: 'MIS',
    validity: 'DAY',
    trigger_price: trig.toFixed(2),
    price: limit.toFixed(2),
    tag: 'PALAGAI_CHART_SL',
  };
}

function atmExitFields(fill) {
  const qty = Math.floor(Number(fill.qty));
  const symbol = String(fill.instrument || '').trim();
  if (!(qty > 0) || !symbol) return null;
  const crude = /crude/i.test(symbol);
  return {
    exchange: fill.exchange || (crude ? 'MCX' : 'NFO'),
    tradingsymbol: symbol,
    transaction_type: 'SELL',
    order_type: 'MARKET',
    quantity: String(qty),
    product: 'MIS',
    validity: 'DAY',
    market_protection: '-1',
    tag: 'PALAGAI_CHART_EXIT',
  };
}

const OPENISH = new Set(['OPEN', 'TRIGGER PENDING', 'VALIDATION PENDING']);

function restingSellIds(orders, instrument) {
  const symbol = String(instrument || '').trim().toUpperCase();
  if (!symbol) return [];
  const ids = [];
  for (const order of orders || []) {
    if (String(order.tradingsymbol || '').trim().toUpperCase() !== symbol) continue;
    if (String(order.transaction_type || '').toUpperCase() !== 'SELL') continue;
    if (!OPENISH.has(String(order.status || '').toUpperCase())) continue;
    if (String(order.product || 'MIS').toUpperCase() !== 'MIS') continue;
    const id = String(order.order_id || '').trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function isChartTag(tag) {
  const t = String(tag || '').toUpperCase();
  return t === 'PALAGAI_CHART' || t === 'PALAGAI_CHART_SL' || t === 'PALAGAI_CHART_TP' || t === 'PALAGAI_CHART_EXIT';
}

function bookFromInstrument(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (s.includes('BANKNIFTY') || s.includes('BANKEX')) return 'bank';
  if (s.includes('CRUDE')) return 'crude';
  if (s.startsWith('NIFTY')) return 'nifty';
  return null;
}

module.exports = {
  roundToTick,
  chartProtectiveLevels,
  hitPlannedLevel,
  atmStopFields,
  atmExitFields,
  restingSellIds,
  isChartTag,
  bookFromInstrument,
};
