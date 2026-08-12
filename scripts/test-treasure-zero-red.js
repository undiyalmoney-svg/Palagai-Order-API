/**
 * Smoke test — Professional DNA (index + crude) shape + live-path filter.
 * Not a profitability claim; validates config wiring and guards.
 */
const assert = require('assert');
const { filterTradesLivePath, DEFAULT_LIVE_PATH } = require('../live/live-path');
const { indexEntryGate, bankEntryGate } = require('../live/desk-day-policy');
const {
  LIVE_GREEN_DNA,
  liveGreenStartConfig,
  liveGreenTrapExtras,
  liveGreenBankTrapExtras,
} = require('../live/dna-live-green');
const { LIVE_CRUDE_GREEN_DNA } = require('../live/dna-live-crude-green');
const {
  APP_VERSION,
  APP_BUILD,
  DAY_PROFIT_LOCK_RS,
  STRICT_DAY_STOP_RS,
  normalizeStartConfig,
} = require('../live/daily-desk-defaults');
const { resolveCrudeStrategyProfile } = require('../live/strategy-core.cjs');

const dna = LIVE_GREEN_DNA;
const t = dna.trap;
const ops = dna.liveOps;

// ---- Professional index DNA ----
assert.strictEqual(dna.id, 'live-green-pro-v8');
assert.strictEqual(t.srMethod, 'pivot');
assert.strictEqual(t.pivotStrength, 3, 'cleaner 7-bar fractal levels');
assert.strictEqual(t.trapMode, 'trap', 'reversal only — no both-direction chase');
assert.strictEqual(t.perfectSweepSl, true);
assert.ok(t.minConfirmBody >= 5, 'requires a real confirmation body');
assert.ok(t.minRiskPts > 0 && t.maxRiskPts > t.minRiskPts, 'risk band set');
assert.strictEqual(t.maxTradesPerDay, 3);
assert.strictEqual(t.bankMaxTradesPerDay, 3);
assert.strictEqual(t.targetRMultiple, 2.5);
assert.strictEqual(dna.dayProfitLock, true);
assert.strictEqual(dna.strictDayStop, true);
assert.ok(DAY_PROFIT_LOCK_RS > 0 && STRICT_DAY_STOP_RS > 0, 'daily risk envelope on');
assert.strictEqual(ops.cooldownMin, 12);
assert.strictEqual(ops.deskDayLossStopRs, 900);

// Bank extras use wider bands than Nifty.
const nEx = liveGreenTrapExtras();
const bEx = liveGreenBankTrapExtras();
assert.ok(bEx.maxRiskPts >= nEx.maxRiskPts, 'bank wider max risk');
assert.ok(bEx.minConfirmBody >= nEx.minConfirmBody, 'bank stronger confirm');

// Start config follows DNA (no forced-on legacy locks except daily risk).
const empty = normalizeStartConfig({});
assert.strictEqual(empty.dayProfitLock, true);
assert.strictEqual(empty.strictDayStop, true);
assert.strictEqual(empty.bankOnlyAfterNifty, false);
assert.strictEqual(empty.winStreakToBand, false);
assert.strictEqual(empty.deskGreenLockRs, 0);

const started = normalizeStartConfig(liveGreenStartConfig());
assert.strictEqual(started.dnaId, dna.id);

// ---- Professional crude DNA ----
const crude = LIVE_CRUDE_GREEN_DNA;
assert.strictEqual(crude.id, 'live-crude-pro-v5');
assert.strictEqual(crude.signal.stopPts, 40, 'wider SL survives Crude noise');
assert.strictEqual(crude.signal.targetPts, 80);
assert.strictEqual(crude.signal.requireConfirm, true);
assert.strictEqual(crude.signal.maxTradesDay, 2);
assert.strictEqual(crude.dayProfitLock, true);
assert.strictEqual(crude.strictDayStop, true);
const cp = resolveCrudeStrategyProfile('live-crude-green');
// Base engine profile (worker/backtest spread overrides on top).
assert.ok(cp.entryMode === 'session-or');

// ---- Live-path filter still drops estimated + dust, one-leg ----
function tr(p) {
  return { option: { instrumentToken: 1 }, premiumEstimated: false, ...p };
}
const dusty = [
  tr({ instrumentId: 'nifty-50', entryTime: '2026-08-11T10:00:00+05:30', exitTime: '2026-08-11T10:10:00+05:30', netOptionPnlRs: -4, optionPnlRs: -4 }),
  tr({ instrumentId: 'nifty-50', entryTime: '2026-08-11T11:00:00+05:30', exitTime: '2026-08-11T11:30:00+05:30', netOptionPnlRs: 1200, optionPnlRs: 1200 }),
];
const keptDust = filterTradesLivePath(dusty, { ...DEFAULT_LIVE_PATH });
assert.strictEqual(keptDust.length, 1);
assert.strictEqual(keptDust[0].netOptionPnlRs, 1200);

console.log('OK professional DNA smoke test');
console.log(
  JSON.stringify(
    {
      version: APP_VERSION,
      build: APP_BUILD,
      index: {
        id: dna.id,
        mode: t.trapMode,
        pivotStrength: t.pivotStrength,
        targetR: t.targetRMultiple,
        maxTrades: t.maxTradesPerDay,
        dayLossStopRs: STRICT_DAY_STOP_RS,
        dayProfitLockRs: DAY_PROFIT_LOCK_RS,
      },
      crude: {
        id: crude.id,
        sl: crude.signal.stopPts,
        tp: crude.signal.targetPts,
        confirm: crude.signal.requireConfirm,
        maxTrades: crude.signal.maxTradesDay,
      },
      antiChurn: {
        cooldownMin: ops.cooldownMin,
        bookLossStop: ops.bookDayLossStopRs,
        deskLossStop: ops.deskDayLossStopRs,
      },
    },
    null,
    2,
  ),
);
