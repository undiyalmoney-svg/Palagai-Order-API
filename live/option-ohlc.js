'use strict';
/**
 * Option OHLC + price for Trade Bot.
 * Historical: Kite candles (default 5-minute, with OI).
 * Live: Kite /quote last_price + day's OHLC + bid/ask.
 */
const defaultMarket = require('./kite-market');
const { resolveAtmWeeklyOption } = require('./strategy-core.cjs');
const { archiveInstruments, instrumentsWithArchive } = require('./instrument-archive');

const NIFTY_SPOT_KEY = 'NSE:NIFTY 50';
const BANK_SPOT_KEY = 'NSE:NIFTY BANK';

function truthy(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function quoteKey(exchange, tradingSymbol) {
  const ex = String(exchange || 'NFO').trim().toUpperCase() || 'NFO';
  const sym = String(tradingSymbol || '').trim().toUpperCase();
  if (!sym) return null;
  if (sym.includes(':')) return sym;
  return `${ex}:${sym}`;
}

function liveFromQuote(q) {
  if (!q || typeof q !== 'object') return null;
  const ohlc = q.ohlc || {};
  const bid = q.depth?.buy?.[0]?.price ?? null;
  const ask = q.depth?.sell?.[0]?.price ?? null;
  const price = q.last_price != null ? Number(q.last_price) : Number(ohlc.close);
  return {
    price: Number.isFinite(price) ? price : null,
    ohlc: {
      open: ohlc.open != null ? Number(ohlc.open) : null,
      high: ohlc.high != null ? Number(ohlc.high) : null,
      low: ohlc.low != null ? Number(ohlc.low) : null,
      close: ohlc.close != null ? Number(ohlc.close) : null,
    },
    bid: bid != null ? Number(bid) : null,
    ask: ask != null ? Number(ask) : null,
    volume: q.volume != null ? Number(q.volume) : null,
    oi: q.oi != null ? Number(q.oi) : null,
    timestamp: q.timestamp || q.last_trade_time || null,
  };
}

function lookupQuote(map, key, token) {
  if (!map) return null;
  if (key && map[key]) return map[key];
  const upper = key ? String(key).toUpperCase() : '';
  if (upper && map[upper]) return map[upper];
  if (token) {
    const n = Number(token);
    for (const row of Object.values(map)) {
      if (Number(row?.instrument_token) === n) return row;
    }
  }
  return null;
}

async function resolveListedOption(market, authorization, { tradingSymbol, instrumentToken, exchange }) {
  const token = Number(instrumentToken) || 0;
  const sym = String(tradingSymbol || '').trim().toUpperCase().replace(/^NFO:/, '');
  if (!token && !sym) return null;
  let instruments = await market.fetchInstruments(authorization);
  await archiveInstruments(instruments).catch(() => {});
  instruments = await instrumentsWithArchive(instruments);
  const hit = instruments.find((row) => {
    if (token && Number(row.instrumentToken) === token) return true;
    if (sym && String(row.tradingSymbol || '').toUpperCase() === sym) return true;
    return false;
  });
  if (!hit) {
    return {
      instrumentToken: token || 0,
      tradingSymbol: sym || String(tradingSymbol || ''),
      exchange: String(exchange || 'NFO').toUpperCase(),
      instrumentType: '',
      strike: null,
      expiry: '',
      source: 'request',
    };
  }
  return {
    instrumentToken: hit.instrumentToken,
    tradingSymbol: hit.tradingSymbol,
    exchange: hit.exchange || 'NFO',
    instrumentType: hit.instrumentType,
    strike: hit.strike,
    expiry: hit.expiry,
    lotSize: hit.lotSize,
    source: 'chain',
  };
}

async function resolveAtmContracts(market, authorization, { kind, asOf, optionType }) {
  const k = String(kind || 'nifty').toLowerCase() === 'banknifty' ? 'banknifty' : 'nifty';
  const spotKey = k === 'banknifty' ? BANK_SPOT_KEY : NIFTY_SPOT_KEY;
  const qmap = await market.fetchQuotes(authorization, [spotKey]);
  const spot = Number(lookupQuote(qmap, spotKey)?.last_price) || 0;
  if (!spot) {
    const err = new Error(`No live spot for ${spotKey} — Get Token and retry`);
    err.status = 400;
    throw err;
  }
  let instruments = await market.fetchInstruments(authorization);
  await archiveInstruments(instruments).catch(() => {});
  instruments = await instrumentsWithArchive(instruments);
  const asOfDateTime = asOf || new Date().toISOString();
  const types = String(optionType || 'BOTH').toUpperCase();
  const dirs = types === 'CE' ? ['BUY'] : types === 'PE' ? ['SELL'] : ['BUY', 'SELL'];
  const contracts = [];
  for (const direction of dirs) {
    const resolved = resolveAtmWeeklyOption({
      instruments,
      kind: k,
      direction,
      spot,
      asOfDateTime,
    });
    const inst = resolved.instrument || {};
    contracts.push({
      instrumentToken: inst.instrumentToken || 0,
      tradingSymbol: inst.tradingSymbol,
      exchange: inst.exchange || 'NFO',
      instrumentType: inst.instrumentType,
      strike: inst.strike,
      expiry: inst.expiry,
      lotSize: inst.lotSize,
      source: resolved.source,
      direction,
    });
  }
  return { spot, spotKey, kind: k, contracts };
}

async function fetchHistoricalFor(market, authorization, token, fromDate, toDate, interval, oi) {
  if (!token) return [];
  const iv = interval || '5minute';
  if (iv === '5minute') {
    return market.fetchHistorical5m(authorization, token, fromDate, toDate, { oi: oi !== false });
  }
  return market.fetchHistoricalCandles(authorization, token, fromDate, toDate, iv, { oi: oi !== false });
}

/**
 * Historical candle OHLC and/or live option price.
 *
 * Identify one contract with tradingSymbol / instrumentToken, or set atm:true
 * for Nifty (or kind=banknifty) ATM CE/PE.
 */
async function getOptionOhlcAndPrice(opts = {}, deps = {}) {
  const market = deps.market || defaultMarket;
  const authorization = opts.authorization;
  if (!authorization) {
    const err = new Error('Kite session required');
    err.status = 400;
    throw err;
  }
  const wantHist = opts.historical !== false;
  const wantLive = opts.live !== false;
  if (!wantHist && !wantLive) {
    const err = new Error('Enable historical and/or live');
    err.status = 400;
    throw err;
  }
  const fromDate = String(opts.fromDate || '').slice(0, 10);
  const toDate = String(opts.toDate || fromDate).slice(0, 10);
  if (wantHist && (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate)) {
    const err = new Error('fromDate and toDate (YYYY-MM-DD) required for historical OHLC');
    err.status = 400;
    throw err;
  }
  const interval = opts.interval || '5minute';
  const atm = truthy(opts.atm) || (!opts.tradingSymbol && !opts.instrumentToken && !opts.symbol);
  let meta = { atm: !!atm, kind: opts.kind || 'nifty', spot: null, spotKey: null };
  let listed = [];
  if (atm) {
    const resolved = await resolveAtmContracts(market, authorization, {
      kind: opts.kind,
      asOf: opts.asOf || (toDate ? `${toDate}T15:29:00+05:30` : undefined),
      optionType: opts.optionType,
    });
    meta.spot = resolved.spot;
    meta.spotKey = resolved.spotKey;
    meta.kind = resolved.kind;
    listed = resolved.contracts;
  } else {
    const token = Number(opts.instrumentToken || opts.token) || 0;
    const rawSym = String(opts.tradingSymbol || opts.symbol || '').trim();
    const sym = rawSym.replace(/^NFO:/i, '').toUpperCase();
    const ex = String(opts.exchange || 'NFO').toUpperCase();
    if (token && (!wantLive || sym)) {
      listed = [
        {
          instrumentToken: token,
          tradingSymbol: sym,
          exchange: ex,
          instrumentType: String(opts.optionType || '').toUpperCase(),
          strike: opts.strike != null ? Number(opts.strike) : null,
          expiry: opts.expiry || '',
          source: 'request',
        },
      ];
    } else {
      const one = await resolveListedOption(market, authorization, {
        tradingSymbol: rawSym,
        instrumentToken: token,
        exchange: ex,
      });
      if (!one) {
        const err = new Error('Pass tradingSymbol, instrumentToken, or atm:true');
        err.status = 400;
        throw err;
      }
      listed = [one];
    }
  }

  const keys = listed
    .map((c) => quoteKey(c.exchange, c.tradingSymbol))
    .filter(Boolean);
  let qmap = {};
  if (wantLive && keys.length && typeof market.fetchQuotes === 'function') {
    qmap = await market.fetchQuotes(authorization, keys);
  }

  const contracts = [];
  for (const c of listed) {
    const key = quoteKey(c.exchange, c.tradingSymbol);
    let historical = [];
    if (wantHist) {
      try {
        historical = await fetchHistoricalFor(
          market,
          authorization,
          c.instrumentToken,
          fromDate,
          toDate,
          interval,
          opts.oi !== false,
        );
      } catch (err) {
        historical = [];
        c.historicalError = err.message;
      }
    }
    const live = wantLive ? liveFromQuote(lookupQuote(qmap, key, c.instrumentToken)) : null;
    const lastBar = historical.length ? historical[historical.length - 1] : null;
    contracts.push({
      ...c,
      key,
      live,
      historical,
      lastBar,
      price: live?.price ?? lastBar?.close ?? null,
    });
  }

  return {
    fromDate: wantHist ? fromDate : null,
    toDate: wantHist ? toDate : null,
    interval: wantHist ? interval : null,
    live: wantLive,
    historical: wantHist,
    ...meta,
    contracts,
  };
}

module.exports = {
  getOptionOhlcAndPrice,
  liveFromQuote,
  quoteKey,
  NIFTY_SPOT_KEY,
};
