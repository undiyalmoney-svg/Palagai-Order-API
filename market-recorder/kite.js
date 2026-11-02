'use strict';

const axios = require('axios');
const config = require('./config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastCall = 0;

/** Kite allows ~1 request/second on quote and ~3/second on historical. Serialise and space calls. */
async function spaced(minGapMs) {
  const wait = lastCall + minGapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

class KiteError extends Error {
  constructor(message, { status, kind } = {}) {
    super(message);
    this.status = status;
    this.kind = kind;
  }
}

async function request(url, { authorization, params, text = false, timeout = 15000, retries = 2, gapMs = 1100 }) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await spaced(gapMs);
    try {
      const res = await axios.get(`${config.kiteBase}${url}`, {
        headers: { 'X-Kite-Version': '3', Authorization: authorization },
        params,
        timeout,
        responseType: text ? 'text' : 'json',
        paramsSerializer: { indexes: null },
      });
      return res.data;
    } catch (e) {
      const status = e.response?.status;
      const msg = e.response?.data?.message || e.message;
      if (status === 403 || status === 401) throw new KiteError(msg, { status, kind: 'auth' });
      last = new KiteError(msg, { status, kind: status === 429 ? 'rate' : 'http' });
      if (status && status < 500 && status !== 429) throw last;
      await sleep(Math.min(1500 * 2 ** attempt, 8000));
    }
  }
  throw last;
}

async function quote(authorization, keys) {
  const body = await request('/quote', { authorization, params: { i: keys } });
  if (body.status !== 'success') throw new KiteError(body.message || 'quote failed', { kind: 'http' });
  return body.data;
}

async function instrumentsCsv(authorization, exchange) {
  return request(`/instruments/${exchange}`, { authorization, text: true, timeout: 60000, gapMs: 1100 });
}

async function historical(authorization, token, interval, from, to, { oi = false } = {}) {
  const body = await request(`/instruments/historical/${token}/${interval}`, {
    authorization,
    params: { from, to, oi: oi ? 1 : 0 },
    timeout: 30000,
    gapMs: 400,
  });
  if (body.status !== 'success') throw new KiteError(body.message || 'historical failed', { kind: 'http' });
  return body.data.candles;
}

module.exports = { quote, instrumentsCsv, historical, KiteError, sleep };
