/**
 * LIVE DESK CONFIG (v2) — risk-managed Nifty 50 options desk (Bank/Crude off).
 *
 * Single-source fix (doc 51 RCA): everything that is a STRATEGY parameter
 * (pierce points, risk band, peak-trail, max trades/day, target R, entry/exit
 * times, the ₹/lot loss cap) is read straight from the bundled
 * createTrapStrategyV2() — the exact same values as
 * strategy-dna-caps.ts's TRAP_V2_ENTRY_DNA_EXTRAS, which the Angular Trade
 * Desk UI imports too. Nothing here re-declares those numbers, so this file
 * cannot drift from what Paper/Local-Live validated the way the old
 * hand-maintained `trap` block did (Aug 18: pierce20/60 peak₹400/200/150
 * max-unlimited here vs pierce20/40 peak₹100/50/50 max3 in the bundle).
 *
 * This file now only holds genuinely LIVE-ONLY operational config: capital
 * mapping, day-level ₹ stops, cooldown, desk halts — things with no
 * Angular-side equivalent.
 *
 * NOT a guaranteed-green promise. Validate in paper before real money.
 */

const { createTrapStrategyV2 } = require('./strategy-core.cjs');
const { assertStrategyBundleVersion } = require('./strategy-bundle-guard');

assertStrategyBundleVersion(require('./strategy-core.cjs'));

/** Single source: the exact settings Paper/Local-Live run under this id. */
const V2_SETTINGS = createTrapStrategyV2().getSettings();

const LIVE_GREEN_DNA = {
  id: 'live-green-pro-v2',
  label: 'Professional · Pivot S/R reversal · risk-managed (Trap V2)',
  version: '2026.08.22-trap-v2-hard-cap',

  /** Kept for legacy desk-policy math; band lock itself is off. */
  dailyBand: {
    minRs: 0,
    maxRs: 0,
  },

  enableNifty: true,
  enableBank: false,
  /** Crude OFF — Nifty 50 only desk. */
  enableCrude: false,
  niftyLots: 1,
  bankLots: 1,
  niftyStrategy: 'trap-v2',
  bankStrategy: 'trap-v2',

  /** Live daily risk envelope (per lot; split across Nifty+Bank). */
  dayProfitLock: true,
  dayProfitLockRs: 2500,
  strictDayStop: true,
  strictDayStopRs: 1500,

  /** No profit lock — let winners run (only loss stops + anti-churn caps apply). */
  dailyTargetRs: 0,

  /**
   * Strategy parameters — sourced from V2_SETTINGS (bundled), not
   * hand-duplicated. `entryTimeStart/End`, `exitTime`, `maxTradesPerDay`,
   * `targetRMultiple` and every `extras.*` key (piercePts, risk band,
   * peak-trail, maxOptionLossRs, ...) come from the same object Paper and
   * Local-Live use.
   */
  trap: {
    ...V2_SETTINGS.extras,
    maxTradesPerDay: V2_SETTINGS.maxTradesPerDay,
    bankMaxTradesPerDay: V2_SETTINGS.maxTradesPerDay,
    targetRMultiple: V2_SETTINGS.targetRMultiple,
    confirmNextBar: true,
    entryTimeStart: V2_SETTINGS.entryTimeStart,
    entryTimeEnd: V2_SETTINGS.entryTimeEnd,
    exitTime: V2_SETTINGS.exitTime,
  },

  liveOps: {
    maxOpenLegs: 1,
    /**
     * Real, enforced per-option hard max loss ₹/lot — sourced from the same
     * DNA the strategy declares (extras.maxOptionLossRs). live-broker.js
     * passes this (× lots) into computeProtectiveSlTrigger's maxLossRs, so
     * the BROKER-SIDE SL-M order placed at entry already caps the loss —
     * not a 60-second-later soft check that theta/IV crush can outrun.
     */
    maxOptionLossRs: Number(V2_SETTINGS.extras.maxOptionLossRs) || 0,
    /** Superseded by the hard broker-side cap above — off to avoid a redundant premature cut. */
    optionStandDownRs: 0,
    rejectEstimatedPremium: true,
    cancelSlBeforeExit: true,
    fillLedger: true,
    trailProtectiveSl: true,
    fillFrictionPremium: 0.5,
    optionRsDayRisk: false,
    bankOnlyAfterNifty: false,
    bankOnlyAfterNiftyGreen: false,
    winStreakToBand: false,
    /** No profit lock — let winners run. Loss stops + trade caps still protect. */
    deskGreenLockRs: 0,
    indexFirstWinLock: false,
    recoveryMaxExtra: 0,
    crudeOnlyBelowBand: false,
    dustTradeRs: 10,
    /** Mirrors the strategy's own maxTradesPerDay — Crude keeps its own max 4 (off). */
    deskMaxTradesDay: V2_SETTINGS.maxTradesPerDay,
    /** Anti-churn (enforced in worker): cooldown + loss stops. */
    cooldownMin: 12,
    bookDayLossStopRs: 500,
    deskDayLossStopRs: 900,
    /**
     * Protect-green (× lots): once the desk day peak reaches arm, stop new
     * entries if it gives back to floor — a green day stays green, no upside cap.
     */
    deskGreenProtectArmRs: 500,
    deskGreenProtectFloorRs: 150,
    /** 0 = off. Charge-cover (not a hard premium cap) kills fat-ATM scalps. */
    maxBankEntryPremium: 0,
    /**
     * PROBATIONARY (₹150 cap). Survived train→holdout with the time filter
     * (per-trade ₹275 → ₹300, PF 2.20 → 2.37) but had NO standalone train
     * edge — it only helps in combination, which is a mild overfit flag.
     * Unlike entryWindows, do not treat this as established; revisit once
     * paper trading has real fills. Set 0 to disable.
     */
    maxNiftyEntryPremium: 150,
    /** Expected option ₹ must cover this many round-trip charge estimates. */
    chargeCoverMultiple: 4,
  },

  research: {
    approach:
      'Pivot S/R (index) sweep + next-bar confirm · 3.5R · single-source DNA (strategy-dna-caps.ts) · enforced ₹300/lot broker-side stop.',
    note:
      'Validate new params against real Kite option-chain history via POST /backtest before treating any figure as live-representative — see plan for the walk-forward validation step.',
  },
};

/**
 * The DNA's maxTradesPerDay is a CEILING, not a default.
 *
 * The UI sends `niftyMaxTradesDay` on every Start with a hardcoded fallback of
 * 0, and 0 has historically meant "unlimited" — which is precisely the setting
 * the Aug-10 RCA (doc 51) blamed for an all-red churn day. A failed
 * /live/defaults fetch was enough to silently re-arm it.
 *
 * So: 0 / null / junk → use the DNA cap. A positive number may only ever
 * LOWER the cap, never raise it. Unlimited is no longer reachable from the UI.
 */
function clampMaxTradesToDna(fromUi) {
  const dnaCap = Math.max(1, Math.floor(Number(LIVE_GREEN_DNA.trap.maxTradesPerDay)) || 1);
  const asked = Math.floor(Number(fromUi)) || 0;
  if (asked <= 0) return dnaCap;
  return Math.min(asked, dnaCap);
}

function liveGreenTrapExtras(overrides = {}) {
  const t = LIVE_GREEN_DNA.trap;
  return {
    ...t,
    optionStandDownRs: LIVE_GREEN_DNA.liveOps.optionStandDownRs,
    ...overrides,
  };
}

/** Bank uses wider risk/confirm bands (bigger point moves). Bank is hard-off. */
function liveGreenBankTrapExtras(overrides = {}) {
  return liveGreenTrapExtras(overrides);
}

function liveGreenRecoveryTrailExtras() {
  return liveGreenTrapExtras();
}

function liveGreenStartConfig() {
  const ops = LIVE_GREEN_DNA.liveOps;
  return {
    enableNifty: LIVE_GREEN_DNA.enableNifty,
    enableBank: LIVE_GREEN_DNA.enableBank,
    enableCrude: LIVE_GREEN_DNA.enableCrude,
    niftyLots: LIVE_GREEN_DNA.niftyLots,
    bankLots: LIVE_GREEN_DNA.bankLots,
    niftyStrategy: LIVE_GREEN_DNA.niftyStrategy,
    bankStrategy: LIVE_GREEN_DNA.bankStrategy,
    dayProfitLock: LIVE_GREEN_DNA.dayProfitLock,
    strictDayStop: LIVE_GREEN_DNA.strictDayStop,
    enableKutty: false,
    kuttyAlone: false,
    realOrders: true,
    dnaId: LIVE_GREEN_DNA.id,
    maxOpenLegs: ops.maxOpenLegs,
    optionStandDownRs: ops.optionStandDownRs,
    paperLivePath: true,
    fillFrictionPremium: ops.fillFrictionPremium,
    crudeAfterIndexClose: true,
    bankOnlyAfterNifty: ops.bankOnlyAfterNifty,
    bankOnlyAfterNiftyGreen: ops.bankOnlyAfterNiftyGreen,
    winStreakToBand: ops.winStreakToBand,
    indexFirstWinLock: ops.indexFirstWinLock,
    deskGreenLockRs: ops.deskGreenLockRs,
    recoveryMaxExtra: ops.recoveryMaxExtra,
    crudeOnlyBelowBand: ops.crudeOnlyBelowBand,
  };
}

module.exports = {
  LIVE_GREEN_DNA,
  clampMaxTradesToDna,
  liveGreenTrapExtras,
  liveGreenBankTrapExtras,
  liveGreenRecoveryTrailExtras,
  liveGreenStartConfig,
};
