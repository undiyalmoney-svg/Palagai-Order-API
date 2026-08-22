#!/usr/bin/env node
/**
 * Pre-flight check — run on the droplet AFTER deploying, BEFORE starting the desk.
 *
 * Verifies every safety rail that has silently broken before (doc 51 RCA: stale
 * DNA + unlimited trades) plus the ones added in the Trap V2 rebuild. Exits
 * non-zero on any failure so it can gate a deploy script.
 *
 *   node scripts/preflight.js
 */
const path = require('path');

let pass = 0;
let fail = 0;
const failures = [];

function check(label, actual, expected, note) {
  const ok = actual === expected;
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}: ${actual}`);
  } else {
    fail += 1;
    failures.push(`${label}: got ${actual}, expected ${expected}${note ? ` — ${note}` : ''}`);
    console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`);
    if (note) console.log(`        ${note}`);
  }
}

function checkTrue(label, cond, note) {
  check(label, !!cond, true, note);
}

console.log('\n=== PALAGAI PRE-FLIGHT ===\n');

// 1) Bundle guard — throws if strategy-core.cjs is stale vs this deploy.
console.log('[1] Strategy bundle freshness');
let LIVE_GREEN_DNA;
let core;
try {
  core = require(path.join(__dirname, '../live/strategy-core.cjs'));
  ({ LIVE_GREEN_DNA } = require(path.join(__dirname, '../live/dna-live-green.js')));
  console.log(`  PASS  bundle version: ${core.STRATEGY_BUNDLE_VERSION}`);
  pass += 1;
} catch (err) {
  console.log(`  FAIL  ${err.message}`);
  console.log('\nSTALE OR INCOMPLETE DEPLOY — rebuild in palagai-main:');
  console.log('  node scripts/server-live/build-strategy-core.cjs');
  console.log('and copy live/strategy-core.cjs + live/strategy-bundle-guard.js to the droplet.\n');
  process.exit(1);
}

// 2) Strategy identity + the caps that were previously lost.
console.log('\n[2] Strategy DNA');
const v2 = core.createTrapStrategyV2().getSettings();
check('strategy id', core.createTrapStrategyV2().id, 'sr-trap-confirm-v2');
check('maxTradesPerDay', v2.maxTradesPerDay, 3, 'unlimited (0) caused the Aug-10 all-red day');
check('targetRMultiple', v2.targetRMultiple, 3.5);
check('maxOptionLossRs', Number(v2.extras.maxOptionLossRs), 300);
check('entryWindows', String(v2.extras.entryWindows), '09:45-10:30,11:00-12:00,13:30-14:45');

// 3) The UI round-trip that silently re-enabled unlimited trades.
console.log('\n[3] UI round-trip (preset -> Start) cannot loosen caps');
const {
  DAILY_3K_PRESET,
  normalizeStartConfig,
  strictStopMoneyRs,
  profitLockMoneyRs,
} = require(path.join(__dirname, '../live/daily-desk-defaults.js'));
const rt = normalizeStartConfig({ ...DAILY_3K_PRESET, capitalRs: 40000 });
check('preset niftyMaxTradesDay', DAILY_3K_PRESET.niftyMaxTradesDay, 3, 'must mirror DNA, never 0');
check('after round-trip', rt.niftyMaxTradesDay, 3, '0 here means UNLIMITED');

// OWNERSHIP CONTRACT: UI supplies LOTS only. Trade counts / instruments are
// code-owned and must survive a hostile Start payload untouched.
const hostile = normalizeStartConfig({
  niftyMaxTradesDay: 0, bankMaxTradesDay: 0, deskMaxTradesDay: 0, // "unlimited"
  enableBank: true, enableCrude: true,                            // enable everything
  niftyLots: 2, capitalRs: 80000,                                 // legitimate: lots
});
check('hostile UI: niftyMaxTradesDay', hostile.niftyMaxTradesDay, 3, 'client 0 must be ignored');
check('hostile UI: deskMaxTradesDay', hostile.deskMaxTradesDay, 3, 'client 0 must be ignored');
check('hostile UI: enableBank', hostile.enableBank, false, 'client cannot enable Bank');
check('hostile UI: enableCrude', hostile.enableCrude, false, 'client cannot enable Crude');
check('UI DOES own lots', hostile.niftyLots, 2, 'lots must pass through from UI');

const { clampMaxTradesToDna } = require(path.join(__dirname, '../live/dna-live-green.js'));
check('clamp: 0 -> DNA', clampMaxTradesToDna(0), 3);
check('clamp: 99 -> DNA', clampMaxTradesToDna(99), 3, 'cannot raise the cap');
check('lots @ Rs40,000 capital', rt.niftyLots, 1);
check('realOrders defaults off', rt.realOrders !== true, true, 'live must be opt-in');

// 4) Hard per-trade loss cap actually reaches the broker SL order.
console.log('\n[4] Hard Rs300/lot cap enforced at the SL order');
const LOT = 65;
const uncapped = core.computeProtectiveSlTrigger({
  fillPremium: 120,
  indexRiskPts: 40,
  exchange: 'NFO',
  tradingSymbol: 'NIFTY26AUG24200CE',
});
const capped = core.computeProtectiveSlTrigger({
  fillPremium: 120,
  indexRiskPts: 40,
  exchange: 'NFO',
  tradingSymbol: 'NIFTY26AUG24200CE',
  maxLossRs: 300,
  lotUnits: LOT,
});
const uncappedLoss = (120 - uncapped) * LOT;
const cappedLoss = (120 - capped) * LOT;
console.log(`        without cap: Rs${Math.round(uncappedLoss)} risked`);
console.log(`        with cap:    Rs${Math.round(cappedLoss)} risked`);
checkTrue('cap actually binds', cappedLoss < uncappedLoss, 'cap is inert — SL not receiving maxLossRs');
checkTrue('loss <= Rs300 + 1 tick', cappedLoss <= 300 + 0.05 * LOT);

// 5) Day-level money rails.
console.log('\n[5] Day risk rails (1 lot)');
check('day stop Rs', strictStopMoneyRs(1), 1500);
check('day profit lock Rs', profitLockMoneyRs(1), 2500);
check('max open legs', LIVE_GREEN_DNA.liveOps.maxOpenLegs, 1);
check('premium cap Rs', LIVE_GREEN_DNA.liveOps.maxNiftyEntryPremium, 150);
check('cooldown min', LIVE_GREEN_DNA.liveOps.cooldownMin, 12);

// 6) Instruments hard-off.
console.log('\n[6] Instrument scope');
check('Nifty enabled', LIVE_GREEN_DNA.enableNifty, true);
check('Bank disabled', LIVE_GREEN_DNA.enableBank, false, 'never validated');
check('Crude disabled', LIVE_GREEN_DNA.enableCrude, false, 'never validated');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) {
  console.log('\nDO NOT START THE DESK. Failures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('\nAll rails verified. Safe to start.\n');
