'use strict';
/**
 * RESEARCH VERSION LOG — append-only. NON-DESTRUCTIVE.
 *
 * Records every research run (version, timestamp, data range, parameters, entry
 * & exit rules, instrument, results) so no result is ever overwritten. Baseline
 * runs and experiments both land here, side by side, and stay accessible.
 * Purely additive: touches no existing engine, endpoint, or data.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'sr-observations');
const LOG = path.join(DIR, 'research-versions.jsonl');

/** Append one research run. Never mutates or deletes prior entries. */
function logResearchRun(entry) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const row = { loggedAt: new Date().toISOString(), ...entry };
    fs.appendFileSync(LOG, JSON.stringify(row) + '\n');
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

/** Read every stored research version (baselines + experiments), newest first. */
function readResearchVersions() {
  try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).reverse(); }
  catch { return []; }
}

module.exports = { logResearchRun, readResearchVersions };
