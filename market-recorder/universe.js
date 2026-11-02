'use strict';

const config = require('./config');

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Keep only NIFTY / BANKNIFTY futures and options from the NFO dump. */
function parseInstruments(csv) {
  const lines = csv.split('\n');
  const head = parseCsvLine(lines[0].trim());
  const ix = Object.fromEntries(head.map((h, i) => [h, i]));
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    const c = parseCsvLine(lines[i]);
    const name = (c[ix.name] || '').replace(/"/g, '');
    if (name !== 'NIFTY' && name !== 'BANKNIFTY') continue;
    const type = c[ix.instrument_type];
    if (type !== 'FUT' && type !== 'CE' && type !== 'PE') continue;
    rows.push({
      token: Number(c[ix.instrument_token]),
      symbol: c[ix.tradingsymbol],
      underlying: name,
      kind: type,
      expiry: c[ix.expiry],
      strike: Number(c[ix.strike]),
      lotSize: Number(c[ix.lot_size]),
    });
  }
  return rows;
}

function sortedExpiries(rows, underlying, kind, onOrAfter) {
  return [...new Set(rows.filter((r) => r.underlying === underlying && r.kind === kind && r.expiry >= onOrAfter).map((r) => r.expiry))].sort();
}

/**
 * Contracts that matter on `date`:
 *  - futures: the two nearest expiries (front + next) so the roll is visible
 *  - option expiries: the nearest expiry, plus the next one on the nearest expiry's own day
 */
function chooseContracts(rows, date) {
  const out = {};
  for (const name of Object.keys(config.indices)) {
    const futExp = sortedExpiries(rows, name, 'FUT', date).slice(0, 2);
    const futs = futExp.map((e) => rows.find((r) => r.underlying === name && r.kind === 'FUT' && r.expiry === e)).filter(Boolean);
    const optExp = sortedExpiries(rows, name, 'CE', date);
    const expiries = optExp.length && optExp[0] === date ? optExp.slice(0, 2) : optExp.slice(0, 1);
    out[name] = { futs, optionExpiries: expiries };
  }
  return out;
}

function atmStrike(spot, step) {
  return Math.round(spot / step) * step;
}

/** ATM +/- n strikes, CE and PE, for each chosen expiry. */
function optionsAround(rows, name, expiries, spot) {
  const step = config.indices[name].step;
  const atm = atmStrike(spot, step);
  const want = [];
  for (let k = -config.strikesEachSide; k <= config.strikesEachSide; k += 1) want.push([atm + k * step, k]);
  const out = [];
  for (const expiry of expiries) {
    for (const [strike, rel] of want) {
      for (const kind of ['CE', 'PE']) {
        const r = rows.find((x) => x.underlying === name && x.kind === kind && x.expiry === expiry && x.strike === strike);
        if (r) out.push({ ...r, rel });
      }
    }
  }
  return out;
}

module.exports = { parseInstruments, chooseContracts, optionsAround, atmStrike, parseCsvLine };
