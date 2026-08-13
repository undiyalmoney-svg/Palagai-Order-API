/**
 * Paper ≡ Live path — shared gates so Autobot Paper matches broker reality.
 *
 * Live already skips estimated premiums and enforces one open leg. Paper used
 * to book those anyway (greener fiction). Apply the same filters here for
 * backtest + ledger display.
 */

const { LIVE_GREEN_DNA } = require('./dna-live-green');
const { bookKind, isIndexBook } = require('./desk-day-policy');

const ops = LIVE_GREEN_DNA.liveOps || {};
const band = LIVE_GREEN_DNA.dailyBand || {};

const DEFAULT_LIVE_PATH = {
  rejectEstimatedPremium: true,
  noEstimatedExitPnl: true,
  fillFrictionPremium: 0.5,
  maxOpenLegs: ops.maxOpenLegs != null ? ops.maxOpenLegs : 1,
  dayProfitLockRs:
    LIVE_GREEN_DNA.dayProfitLockRs != null
      ? LIVE_GREEN_DNA.dayProfitLockRs
      : band.maxRs || 0,
  dayStopRs:
    LIVE_GREEN_DNA.strictDayStopRs != null ? LIVE_GREEN_DNA.strictDayStopRs : 0,
  bankOnlyAfterNifty: ops.bankOnlyAfterNifty === true,
  bankOnlyAfterNiftyGreen: ops.bankOnlyAfterNiftyGreen === true,
  winStreakToBand: ops.winStreakToBand === true,
  indexFirstWinLock: ops.indexFirstWinLock === true,
  deskGreenLockRs: ops.deskGreenLockRs != null ? ops.deskGreenLockRs : 0,
  recoveryMaxExtra: ops.recoveryMaxExtra != null ? ops.recoveryMaxExtra : 0,
  dustTradeRs: ops.dustTradeRs != null ? ops.dustTradeRs : 0,
};

function tradeNetRs(t) {
  if (t == null) return 0;
  if (t.netOptionPnlRs != null) return Number(t.netOptionPnlRs) || 0;
  if (t.optionPnlRs != null) return Number(t.optionPnlRs) || 0;
  return 0;
}

function isEstimatedOrSynthetic(t) {
  if (!t) return true;
  if (t.premiumEstimated) return true;
  const o = t.option || {};
  if (o.source === 'synthetic') return true;
  if (!(o.instrumentToken > 0)) return true;
  return false;
}

function applyFillFriction(premium, side, friction) {
  const p = Number(premium);
  const f = Math.max(0, Number(friction) || 0);
  if (!(p > 0) || !(f > 0)) return premium;
  if (side === 'entry') return Math.max(0.05, p + f);
  if (side === 'exit') return Math.max(0.05, p - f);
  return p;
}

/**
 * Chronological desk filter: reject estimated, one-leg, optional gates.
 */
function filterTradesLivePath(trades, opts = {}) {
  const cfg = { ...DEFAULT_LIVE_PATH, ...opts };
  const maxLegs = Math.max(0, Math.floor(Number(cfg.maxOpenLegs)) || 0);
  const lockRs = Math.max(0, Number(cfg.dayProfitLockRs) || 0);
  const stopRs = Math.max(0, Number(cfg.dayStopRs) || 0);
  const bandMin = Math.max(0, Number(cfg.deskGreenLockRs) || 0);
  const dustRs = Math.max(0, Number(cfg.dustTradeRs) || 0);
  const rejectEst = cfg.rejectEstimatedPremium !== false;
  const bankAfterNifty = cfg.bankOnlyAfterNifty === true;
  const bankAfterNiftyGreen = cfg.bankOnlyAfterNiftyGreen === true;
  const winStreak = cfg.winStreakToBand === true;
  const firstWin = cfg.indexFirstWinLock === true;

  const sorted = [...(trades || [])].sort((a, b) =>
    String(a.entryTime).localeCompare(String(b.entryTime)),
  );

  /** @type {object[]} */
  const kept = [];
  let openUntil = null;
  let day = null;
  let dayNet = 0;
  let dayStopped = false;
  let indexStopped = false;
  let niftyTaken = false;
  let niftyNet = 0;
  let lostAfterGreen = false;

  for (const t of sorted) {
    const d = String(t.entryTime || '').slice(0, 10);
    if (d !== day) {
      day = d;
      dayNet = 0;
      dayStopped = false;
      indexStopped = false;
      openUntil = null;
      niftyTaken = false;
      niftyNet = 0;
      lostAfterGreen = false;
    }
    if (dayStopped) continue;
    if (rejectEst && isEstimatedOrSynthetic(t)) continue;
    if (t.optionPnlRs == null && t.netOptionPnlRs == null) continue;

    const kind = bookKind(t.instrumentId);
    const isBank = kind === 'bank';
    const isNifty = kind === 'nifty';
    const isIndex = isIndexBook(t.instrumentId);
    const isCrude = kind === 'crude';

    const net = tradeNetRs(t);
    // Charge-dust: skip microscopic nets so they don't create fake red days.
    if (dustRs > 0 && Math.abs(net) < dustRs) continue;

    if (bankAfterNifty && isBank && !niftyTaken) continue;
    if (bankAfterNiftyGreen && isBank && niftyNet <= 0) continue;

    if (isIndex && indexStopped) continue;
    if (isIndex && bandMin > 0 && dayNet >= bandMin) continue;
    if (isIndex && winStreak && lostAfterGreen) continue;
    if (isIndex && firstWin && dayNet > 0) continue;
    if (isCrude && bandMin > 0 && dayNet >= bandMin) continue;

    const entry = String(t.entryTime || '');
    const exit = String(t.exitTime || t.entryTime || '');
    if (maxLegs > 0 && openUntil && entry < openUntil) continue;

    const before = dayNet;
    kept.push(t);
    openUntil = exit;
    dayNet += net;
    if (isNifty) {
      niftyTaken = true;
      niftyNet += net;
    }
    if (isIndex && before > 0 && net < 0) {
      lostAfterGreen = true;
      if (winStreak) indexStopped = true;
    }
    if (bandMin > 0 && dayNet >= bandMin) dayStopped = true;
    if (lockRs > 0 && dayNet >= lockRs) dayStopped = true;
    if (stopRs > 0 && dayNet <= -stopRs) dayStopped = true;
    if (firstWin && isIndex && net > 0 && dayNet > 0) indexStopped = true;
  }
  return kept;
}

function createDeskGate(maxOpenLegs = 1) {
  const max = Math.max(0, Math.floor(Number(maxOpenLegs)) || 0);
  let openCount = 0;
  return {
    maxOpenLegs: max,
    openCount() {
      return openCount;
    },
    tryOpen() {
      if (max > 0 && openCount >= max) return false;
      openCount += 1;
      return true;
    },
    release() {
      openCount = Math.max(0, openCount - 1);
    },
    reset() {
      openCount = 0;
    },
  };
}

function livePathReplayOpts(config = {}) {
  const dnaOps = LIVE_GREEN_DNA.liveOps || {};
  return {
    rejectEstimatedPremium:
      config.rejectEstimatedPremium != null
        ? !!config.rejectEstimatedPremium
        : dnaOps.rejectEstimatedPremium !== false,
    noEstimatedExitPnl: true,
    fillFrictionPremium:
      config.fillFrictionPremium != null
        ? Number(config.fillFrictionPremium)
        : DEFAULT_LIVE_PATH.fillFrictionPremium,
    deskGate: config.deskGate || null,
    chargeCoverMultiple:
      config.chargeCoverMultiple != null
        ? Number(config.chargeCoverMultiple)
        : dnaOps.chargeCoverMultiple,
    maxBankEntryPremium:
      config.maxBankEntryPremium != null
        ? Number(config.maxBankEntryPremium)
        : dnaOps.maxBankEntryPremium,
    maxNiftyEntryPremium:
      config.maxNiftyEntryPremium != null
        ? Number(config.maxNiftyEntryPremium)
        : dnaOps.maxNiftyEntryPremium,
  };
}

module.exports = {
  DEFAULT_LIVE_PATH,
  tradeNetRs,
  isEstimatedOrSynthetic,
  applyFillFriction,
  filterTradesLivePath,
  createDeskGate,
  livePathReplayOpts,
};
