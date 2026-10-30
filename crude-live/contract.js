/**
 * Front-month CRUDEOILM FUT — never trade the expiring contract on expiry day.
 * Prefers expiry > today (IST). If nothing later exists, stand down rather than
 * trade the contract that expires today.
 */
'use strict';

const { sessionDate } = require('../research/time');

function splitCsvLine(line) {
  if (!String(line).includes('"')) return String(line).split(',');
  const out = [];
  let cur = '';
  let quoted = false;
  const text = String(line);
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function expiryDay(expiry) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(expiry || '').trim());
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(expiry);
  if (Number.isNaN(d.getTime())) return '';
  return sessionDate(d);
}

function parseCrudeMiniFutures(csv) {
  const rows = [];
  for (const line of String(csv || '').split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;
    const symbol = String(cols[2] || '').toUpperCase();
    const type = String(cols[9] || '').toUpperCase();
    const exchange = String(cols[11] || '').toUpperCase();
    if (exchange !== 'MCX' || type !== 'FUT' || !symbol.startsWith('CRUDEOILM')) continue;
    rows.push({
      instrumentToken: Number(cols[0]) || 0,
      tradingSymbol: String(cols[2] || '').trim(),
      name: String(cols[3] || 'CRUDEOILM').trim() || 'CRUDEOILM',
      expiry: expiryDay(cols[5]),
      tickSize: Number(cols[7]) || 1,
      lotSize: Number(cols[8]) || 1,
      exchange: 'MCX',
      instrumentType: 'FUT',
    });
  }
  rows.sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));
  return rows;
}

/**
 * Next live CRUDEOILM future as of IST today.
 * On expiry day this skips the front month and returns the following contract.
 */
function resolveNextCrudeMiniFut(csv, asOf = new Date()) {
  const today = sessionDate(asOf);
  const rows = parseCrudeMiniFutures(csv);
  const next = rows.find((row) => !row.expiry || row.expiry > today);
  if (next) {
    return { ...next, rolled: !!(next.expiry && next.expiry > today), expiryDay: rows.some((r) => r.expiry === today) };
  }
  return null;
}

module.exports = {
  expiryDay,
  parseCrudeMiniFutures,
  resolveNextCrudeMiniFut,
};
