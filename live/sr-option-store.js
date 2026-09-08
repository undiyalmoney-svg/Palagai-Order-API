'use strict';
/**
 * Persist S/R option 5-min bars + contract metadata so Paper can calculate
 * CE/PE ₹ after the weekly drops off Kite /instruments.
 * Lives under gitignored sr-observations/option-cache/.
 */
const fs = require('fs');
const path = require('path');

function rootDir() {
  return process.env.SR_OPTION_STORE_DIR
    || path.join(__dirname, '..', 'sr-observations', 'option-cache');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function barsPath(token, day) {
  return path.join(rootDir(), 'bars', `${Number(token)}-${day}.json`);
}

function contractsPath() {
  return path.join(rootDir(), 'contracts.json');
}

function loadBars(token, day) {
  try {
    const raw = fs.readFileSync(barsPath(token, day), 'utf8');
    const doc = JSON.parse(raw);
    return Array.isArray(doc.candles) ? doc.candles : [];
  } catch (_) {
    return [];
  }
}

function saveBars({ instrumentToken, tradingSymbol, date, candles }) {
  const token = Number(instrumentToken);
  const day = String(date || '').slice(0, 10);
  if (!(token > 0) || !day || !Array.isArray(candles) || !candles.length) return false;
  const dest = barsPath(token, day);
  ensureDir(path.dirname(dest));
  const existing = loadBars(token, day);
  const use = candles.length >= existing.length ? candles : existing;
  fs.writeFileSync(dest, JSON.stringify({
    instrumentToken: token,
    tradingSymbol: tradingSymbol || null,
    date: day,
    candles: use,
    savedAt: new Date().toISOString(),
  }));
  return true;
}

function listContracts() {
  try {
    const doc = JSON.parse(fs.readFileSync(contractsPath(), 'utf8'));
    return Array.isArray(doc.contracts) ? doc.contracts : [];
  } catch (_) {
    return [];
  }
}

function saveContract(row) {
  const token = Number(row && row.instrumentToken);
  const sym = String((row && row.tradingSymbol) || '');
  if (!(token > 0) || !sym) return false;
  const contracts = listContracts();
  const next = {
    name: String(row.name || '').toUpperCase() || null,
    tradingSymbol: sym,
    instrumentToken: token,
    expiry: row.expiry || null,
    strike: Number(row.strike) || null,
    instrumentType: row.instrumentType || null,
    exchange: row.exchange || 'NFO',
    lotSize: Number(row.lotSize) || null,
    savedAt: new Date().toISOString(),
  };
  const idx = contracts.findIndex((c) => Number(c.instrumentToken) === token || c.tradingSymbol === sym);
  if (idx >= 0) contracts[idx] = { ...contracts[idx], ...next };
  else contracts.push(next);
  const dest = contractsPath();
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, JSON.stringify({ contracts }, null, 2));
  return true;
}

function mergeNfoInstruments(live, archived, root, type) {
  const out = Array.isArray(live) ? live.slice() : [];
  const seen = new Set(out.map((r) => Number(r.instrumentToken)).filter((n) => n > 0));
  const name = String(root || '').toUpperCase();
  for (const a of archived || []) {
    if (name && String(a.name || '').toUpperCase() !== name) continue;
    if (type && a.instrumentType && a.instrumentType !== type) continue;
    const tok = Number(a.instrumentToken);
    if (!(tok > 0) || seen.has(tok)) continue;
    seen.add(tok);
    out.push({
      name: a.name || name,
      tradingSymbol: a.tradingSymbol,
      instrumentToken: tok,
      expiry: a.expiry,
      strike: Number(a.strike) || 0,
      instrumentType: a.instrumentType || type,
      exchange: a.exchange || 'NFO',
      lotSize: a.lotSize,
    });
  }
  return out;
}

module.exports = {
  rootDir, loadBars, saveBars, listContracts, saveContract, mergeNfoInstruments,
};
