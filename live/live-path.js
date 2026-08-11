/**
 * Paper ≡ Live path — shared gates so Autobot Paper matches broker reality.
 *
 * Live already skips estimated premiums and enforces one open leg. Paper used
 * to book those anyway (greener fiction). Apply the same filters here for
 * backtest + ledger display.
 */

const { LIVE_GREEN_DNA } = require('./dna-live-green');

const DEFAULT_LIVE_PATH = {
  /** Skip synthetic / missing-premium entries (mirror live-broker placeEntry). */
  rejectEstimatedPremium: true,
  /** Do not invent delta-based ₹ on SL/target when option exit mark missing. */
  noEstimatedExitPnl: true,
  /** Worsen option marks: entry +ticks, exit −friction (rupees of premium). */
  fillFrictionPremium: 0.5,
  /** Desk-wide concurrent opens (Nifty+Bank+Crude). */
  maxOpenLegs: LIVE_GREEN_DNA.liveOps.maxOpenLegs || 1,
  /** Desk option-₹ day lock / stop (0 = off; prefer over index-point lock). */
  dayProfitLockRs: 3000,
  dayStopRs: 2950,
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
 * Chronological desk filter: reject estimated, one-leg, option-₹ day lock/stop.
 * Used by Paper backtest so totals match what live would have taken.
 */
function filterTradesLivePath(trades, opts = {}) {
  const cfg = { ...DEFAULT_LIVE_PATH, ...opts };
  const maxLegs = Math.max(0, Math.floor(Number(cfg.maxOpenLegs)) || 0);
  const lockRs = Math.max(0, Number(cfg.dayProfitLockRs) || 0);
  const stopRs = Math.max(0, Number(cfg.dayStopRs) || 0);
  const rejectEst = cfg.rejectEstimatedPremium !== false;

  const sorted = [...(trades || [])].sort((a, b) =>
    String(a.entryTime).localeCompare(String(b.entryTime)),
  );

  /** @type {object[]} */
  const kept = [];
  /** open legs: { exitTime } */
  let openUntil = null;
  let day = null;
  let dayNet = 0;
  let dayStopped = false;

  for (const t of sorted) {
    const d = String(t.entryTime || '').slice(0, 10);
    if (d !== day) {
      day = d;
      dayNet = 0;
      dayStopped = false;
      openUntil = null;
    }
    if (dayStopped) continue;
    if (rejectEst && isEstimatedOrSynthetic(t)) continue;
    // Missing real option money — cannot credit live-path P&L
    if (t.optionPnlRs == null && t.netOptionPnlRs == null) continue;

    const entry = String(t.entryTime || '');
    const exit = String(t.exitTime || t.entryTime || '');
    if (maxLegs > 0 && openUntil && entry < openUntil) continue;

    const net = tradeNetRs(t);
    kept.push(t);
    openUntil = exit;
    dayNet += net;
    if (lockRs > 0 && dayNet >= lockRs) dayStopped = true;
    if (stopRs > 0 && dayNet <= -stopRs) dayStopped = true;
  }
  return kept;
}

/**
 * Shared gate for in-replay one-leg (same tick / same book). Cross-book
 * chronology still needs filterTradesLivePath after multi-book merge.
 */
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
  const ops = LIVE_GREEN_DNA.liveOps || {};
  return {
    rejectEstimatedPremium:
      config.rejectEstimatedPremium != null
        ? !!config.rejectEstimatedPremium
        : ops.rejectEstimatedPremium !== false,
    noEstimatedExitPnl: true,
    fillFrictionPremium:
      config.fillFrictionPremium != null
        ? Number(config.fillFrictionPremium)
        : DEFAULT_LIVE_PATH.fillFrictionPremium,
    deskGate: config.deskGate || null,
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
