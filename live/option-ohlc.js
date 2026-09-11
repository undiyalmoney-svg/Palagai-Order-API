'use strict';
/**
 * Option OHLC + price for Trade Bot.
 * Historical listed: Kite candles (default 5-minute, with OI).
 * Historical expired: NSE foCPV daily OHLC (Kite has no expired option series).
 * Live: Kite /quote last_price + day's OHLC + bid/ask.
 */
const defaultMarket = require('./kite-market');
const { findInstrumentInCsv, inferInstrumentExchanges } = defaultMarket;
const { resolveAtmWeeklyOption } = require('./strategy-core.cjs');
const { archiveInstruments, instrumentsWithArchive } = require('./instrument-archive');
const defaultNseHistory = require('./nse-option-history');
const { parseOptionContract, isExpiredIso } = defaultNseHistory;

const NIFTY_SPOT_KEY = 'NSE:NIFTY 50';
const BANK_SPOT_KEY = 'NSE:NIFTY BANK';

function truthy(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function splitExchangeSymbol(raw, fallback = 'NFO') {
  const s = String(raw || '').trim().toUpperCase();
  const m = /^(NFO|MCX|CDS|BCD|NSE|BSE):(.+)$/.exec(s);
  if (m) return { exchange: m[1], tradingSymbol: m[2] };
  return { exchange: String(fallback || 'NFO').toUpperCase(), tradingSymbol: s };
}

function collectSymbols(opts = {}) {
  const out = [];
  const push = (raw, exchange, token) => {
    const parsed = splitExchangeSymbol(raw, exchange || 'NFO');
    const hasEx = /^(NFO|MCX|CDS|BCD|NSE|BSE):/i.test(String(raw || '').trim());
    if (!parsed.tradingSymbol && !token) return;
    out.push({
      tradingSymbol: parsed.tradingSymbol,
      exchange: hasEx || exchange ? parsed.exchange : '',
      instrumentToken: Number(token) || 0,
    });
  };
  if (Array.isArray(opts.symbols)) {
    for (const row of opts.symbols) {
      if (row && typeof row === 'object') {
        push(row.tradingSymbol || row.symbol, row.exchange, row.instrumentToken || row.token);
      } else {
        push(row, opts.exchange, null);
      }
    }
  }
  const blob = [opts.tradingSymbol, opts.symbol].filter(Boolean).join(' ');
  for (const part of String(blob).split(/[,;\n]+/)) {
    const bit = part.trim();
    if (bit) push(bit, opts.exchange, opts.instrumentToken || opts.token);
  }
  if (!out.length && (opts.instrumentToken || opts.token)) {
    push('', opts.exchange, opts.instrumentToken || opts.token);
  }
  const seen = new Set();
  return out.filter((row) => {
    const k = `${row.exchange}:${row.tradingSymbol}:${row.instrumentToken}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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

async function resolveAnyOption(market, authorization, spec, csvCache) {
  const token = Number(spec.instrumentToken) || 0;
  const parsed = splitExchangeSymbol(spec.tradingSymbol, spec.exchange);
  const want = parsed.tradingSymbol;
  if (!token && !want) return null;

  if (typeof market.lookupInstrument === 'function') {
    const hit = await market.lookupInstrument(authorization, {
      tradingSymbol: want,
      instrumentToken: token,
      exchange: spec.exchange || undefined,
    });
    if (hit?.instrumentToken) {
      return {
        instrumentToken: hit.instrumentToken,
        tradingSymbol: hit.tradingSymbol,
        exchange: hit.exchange || parsed.exchange,
        instrumentType: hit.instrumentType,
        strike: hit.strike,
        expiry: hit.expiry,
        lotSize: hit.lotSize,
        name: hit.name,
        source: 'chain',
      };
    }
  }

  const exchanges = inferInstrumentExchanges(
    spec.exchange || (parsed.exchange !== 'NFO' ? parsed.exchange : ''),
    want,
  );
  if (typeof market.fetchInstrumentsCsv === 'function') {
    for (const ex of exchanges) {
      if (!csvCache.has(ex)) {
        csvCache.set(ex, await market.fetchInstrumentsCsv(authorization, ex));
      }
      const hit = findInstrumentInCsv(csvCache.get(ex), {
        tradingSymbol: want,
        instrumentToken: token,
      });
      if (hit?.instrumentToken) {
        return {
          instrumentToken: hit.instrumentToken,
          tradingSymbol: hit.tradingSymbol,
          exchange: hit.exchange || ex,
          instrumentType: hit.instrumentType,
          strike: hit.strike,
          expiry: hit.expiry,
          lotSize: hit.lotSize,
          name: hit.name,
          source: 'chain',
        };
      }
    }
  }

  if (token) {
    return {
      instrumentToken: token,
      tradingSymbol: want,
      exchange: parsed.exchange,
      instrumentType: '',
      strike: null,
      expiry: '',
      source: 'token',
    };
  }
  return null;
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
  const opts = { oi: oi !== false };
  if (typeof market.fetchHistoricalInterval === 'function') {
    return market.fetchHistoricalInterval(authorization, token, fromDate, toDate, iv, opts);
  }
  if (iv === '5minute' && typeof market.fetchHistorical5m === 'function') {
    return market.fetchHistorical5m(authorization, token, fromDate, toDate, opts);
  }
  return market.fetchHistoricalCandles(authorization, token, fromDate, toDate, iv, opts);
}

/**
 * Historical candle OHLC and/or live option price.
 *
 * Identify one contract with tradingSymbol / instrumentToken, or set atm:true
 * for Nifty (or kind=banknifty) ATM CE/PE.
 */
function contractFromParsed(spec, parsed, extra = {}) {
  return {
    instrumentToken: 0,
    tradingSymbol: parsed.tradingSymbol || spec.tradingSymbol,
    exchange: spec.exchange || 'NFO',
    instrumentType: parsed.optionType,
    strike: parsed.strike,
    expiry: parsed.expiryIso,
    lotSize: null,
    name: parsed.underlying,
    source: extra.source || 'nse',
    nse: parsed,
  };
}

function shouldUseNseHistory(c, historical, interval) {
  if (String(c.exchange || '').toUpperCase() === 'MCX') return false;
  const parsed = c.nse || parseOptionContract(c.tradingSymbol);
  if (!parsed) return false;
  if (String(interval || '') === 'day' && (!historical || !historical.length)) return true;
  if (!c.instrumentToken) return true;
  if (isExpiredIso(c.expiry || parsed.expiryIso)) return true;
  return !historical || !historical.length;
}

async function loadNseHistory(nseHistory, c, opts, fromDate, toDate, interval) {
  const out = await nseHistory.fetchExpiredOptionDayCandles({
    tradingSymbol: c.tradingSymbol,
    parsed: c.nse || parseOptionContract(c.tradingSymbol),
    fromDate,
    toDate,
    expiryDate: opts.expiryDate || opts.expiry,
  });
  const note =
    String(interval || '') !== 'day'
      ? `${out.note} Requested ${interval}; returning daily bars.`
      : out.note;
  if (out.parsed) {
    c.nse = out.parsed;
    c.expiry = out.parsed.expiryIso || c.expiry;
    c.strike = c.strike ?? out.parsed.strike;
    c.instrumentType = c.instrumentType || out.parsed.optionType;
    c.name = c.name || out.parsed.underlying;
  }
  return { historical: out.historical || [], dataSource: 'nse', intervalUsed: 'day', note };
}

async function getOptionOhlcAndPrice(opts = {}, deps = {}) {
  const market = deps.market || defaultMarket;
  const nseHistory = deps.nseHistory || defaultNseHistory;
  const authorization = opts.authorization;
  const wantHist = opts.historical === undefined ? true : truthy(opts.historical);
  const wantLive = opts.live === undefined ? !!authorization : truthy(opts.live);
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
  const requested = collectSymbols(opts);
  const atm = truthy(opts.atm) && !requested.length;
  if ((atm || wantLive) && !authorization) {
    const err = new Error('Kite session required for live price or ATM lookup — Get Token, then retry.');
    err.status = 400;
    throw err;
  }
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
  } else if (requested.length) {
    const csvCache = new Map();
    for (const spec of requested) {
      let one = null;
      if (authorization) {
        one = await resolveAnyOption(market, authorization, spec, csvCache);
      }
      if (!one?.instrumentToken) {
        const parsed = parseOptionContract(spec.tradingSymbol);
        if (parsed && wantHist) {
          listed.push(contractFromParsed(spec, parsed));
          continue;
        }
        const err = new Error(
          `Unknown option ${spec.tradingSymbol || spec.instrumentToken}. Use a Kite tradingsymbol (listed) or an NSE-style expired symbol such as NIFTY21JUN15600CE.`,
        );
        err.status = 400;
        throw err;
      }
      const parsed = parseOptionContract(one.tradingSymbol || spec.tradingSymbol);
      listed.push(parsed ? { ...one, nse: parsed } : one);
    }
  } else {
    const err = new Error('Pass tradingSymbol (listed or expired option), instrumentToken, or atm:true');
    err.status = 400;
    throw err;
  }

  const keys = listed
    .map((c) => quoteKey(c.exchange, c.tradingSymbol))
    .filter(Boolean);
  let qmap = {};
  if (wantLive && keys.length && authorization && typeof market.fetchQuotes === 'function') {
    qmap = await market.fetchQuotes(authorization, keys);
  }

  const contracts = [];
  for (const c of listed) {
    const key = quoteKey(c.exchange, c.tradingSymbol);
    let historical = [];
    let dataSource = null;
    let intervalUsed = wantHist ? interval : null;
    let note = null;
    if (wantHist) {
      const preferNse =
        String(opts.source || '').toLowerCase() === 'nse' ||
        isExpiredIso(c.expiry || c.nse?.expiryIso);
      if (!preferNse && c.instrumentToken && authorization) {
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
          if (historical.length) {
            dataSource = 'kite';
            intervalUsed = interval;
          }
        } catch (err) {
          historical = [];
          c.historicalError = err.message;
        }
      }
      if (shouldUseNseHistory(c, historical, interval) || preferNse) {
        try {
          const nse = await loadNseHistory(nseHistory, c, opts, fromDate, toDate, interval);
          if (nse.historical.length || !historical.length) {
            historical = nse.historical;
            dataSource = nse.dataSource;
            intervalUsed = nse.intervalUsed;
            note = nse.note;
            delete c.historicalError;
            if (!historical.length) {
              c.historicalError =
                'NSE foCPV returned no daily bars for this expiry/strike. For monthlies, pass expiryDate (DD-MMM-YYYY).';
            }
          }
        } catch (err) {
          if (!historical.length) {
            c.historicalError = err.message;
          }
        }
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
      dataSource,
      intervalUsed,
      note,
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
  splitExchangeSymbol,
  collectSymbols,
  parseOptionContract,
  NIFTY_SPOT_KEY,
};
