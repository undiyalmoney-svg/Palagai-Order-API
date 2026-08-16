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
  dayProfitLockRs: LIVE_GREEN_DNA.dayProfitLockRs || 1000,
  dayStopRs: LIVE_GREEN_DNA.strictDayStop ? LIVE_GREEN_DNA.strictDayStopRs || 0 : 0,
  /** Bank trades on its own bar — do not wait for Nifty. */
  bankOnlyAfterNifty: LIVE_GREEN_DNA.liveOps.bankOnlyAfterNifty === true,
  bankOnlyAfterNiftyGreen: LIVE_GREEN_DNA.liveOps.bankOnlyAfterNiftyGreen === true,
  deskMaxTradesDay: LIVE_GREEN_DNA.liveOps.deskMaxTradesDay || 3,
  /** 0 = both books may trade after a green fill. */
  deskGreenProtectRs:
    LIVE_GREEN_DNA.liveOps.deskGreenProtectRs != null
      ? Number(LIVE_GREEN_DNA.liveOps.deskGreenProtectRs) || 0
      : 0,
  peSessionOnlyIfNotGreen: LIVE_GREEN_DNA.liveOps.peSessionOnlyIfNotGreen === true,
  peSessionOnlyIfBelowRs: Number(LIVE_GREEN_DNA.liveOps.peSessionOnlyIfBelowRs) || 0,
  deskHaltAfterRed: LIVE_GREEN_DNA.liveOps.deskHaltAfterRed === true,
  /** BUY = CE, SELL = PE. Empty = both (morning). */
  allowDirection: LIVE_GREEN_DNA.trap.allowDirection || '',
  entryTimeStart: LIVE_GREEN_DNA.trap.entryTimeStart || '',
  entryTimeEnd: LIVE_GREEN_DNA.trap.entryTimeEnd || '',
  sessionCutTime: LIVE_GREEN_DNA.trap.sessionCutTime || '',
  peSession: LIVE_GREEN_DNA.trap.peSession || null,
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
  const bankAfterNifty = cfg.bankOnlyAfterNifty === true;
  const bankAfterNiftyGreen = cfg.bankOnlyAfterNiftyGreen === true;
  const peOnlyIfNotGreen = cfg.peSessionOnlyIfNotGreen === true;
  const peOnlyIfBelowRs = Math.max(0, Number(cfg.peSessionOnlyIfBelowRs) || 0);
  const maxTradesDay = Math.max(0, Math.floor(Number(cfg.deskMaxTradesDay)) || 0);
  const protectRs = Math.max(0, Number(cfg.deskGreenProtectRs) || 0);
  const haltAfterRed = cfg.deskHaltAfterRed === true;
  const allowDir = String(cfg.allowDirection || '').toUpperCase();
  const fillStart = String(cfg.entryTimeStart || '');
  const fillEnd = String(cfg.entryTimeEnd || '');
  const sessionCut = String(cfg.sessionCutTime || '');
  const pe = cfg.peSession && cfg.peSession.enabled !== false ? cfg.peSession : null;
  const peStart = String(pe?.entryFillStart || pe?.entryTimeStart || '');
  const peEnd = String(pe?.entryTimeEnd || '');
  const peDir = String(pe?.allowDirection || '').toUpperCase();
  const peMax = Math.max(0, Math.floor(Number(pe?.maxTrades)) || 0);

  const sorted = [...(trades || [])].sort((a, b) =>
    String(a.entryTime).localeCompare(String(b.entryTime)),
  );

  /** @type {object[]} */
  const kept = [];
  /** overlapping open exits — allow up to maxLegs at once */
  let openExits = [];
  let day = null;
  let dayNet = 0;
  let dayStopped = false;
  let niftyTaken = false;
  let niftyNet = 0;
  let dayTrades = 0;
  let peTaken = 0;

  for (const t of sorted) {
    const d = String(t.entryTime || '').slice(0, 10);
    if (d !== day) {
      day = d;
      dayNet = 0;
      dayStopped = false;
      openExits = [];
      niftyTaken = false;
      niftyNet = 0;
      dayTrades = 0;
      peTaken = 0;
    }
    const tm = String(t.entryTime || '').match(/T(\d{2}:\d{2})/)?.[1] || '';
    const idEarly = String(t.instrumentId || '').toLowerCase();
    const isBankEarly = idEarly.includes('bank');
    const isNiftyEarly = idEarly.includes('nifty') && !isBankEarly;
    const isPeSlot =
      !!pe &&
      isNiftyEarly &&
      (!peDir || t.direction === peDir) &&
      peStart &&
      peEnd &&
      tm >= peStart &&
      tm <= peEnd;
    if (dayStopped && !isPeSlot) continue;
    if (rejectEst && isEstimatedOrSynthetic(t)) continue;
    // Missing real option money — cannot credit live-path P&L
    if (t.optionPnlRs == null && t.netOptionPnlRs == null) continue;

    const id = String(t.instrumentId || '').toLowerCase();
    const isBank = id.includes('bank');
    const isNifty = id.includes('nifty') && !isBank;
    if (isPeSlot) {
      if (peOnlyIfBelowRs > 0) {
        if (dayNet >= peOnlyIfBelowRs) continue;
      } else if (peOnlyIfNotGreen && dayNet > 0) {
        continue;
      }
      if (peMax > 0 && peTaken >= peMax) continue;
    } else {
      if (allowDir === 'SELL' && t.direction === 'BUY') continue;
      if (allowDir === 'BUY' && t.direction === 'SELL') continue;
      if (fillStart && tm && tm < fillStart) continue;
      if (sessionCut && tm && tm >= sessionCut) continue;
      if (!sessionCut && fillEnd && tm && tm > fillEnd) continue;
      if (isBankEarly && sessionCut && tm && tm >= sessionCut) continue;
    }
    if (bankAfterNifty && isBank && !niftyTaken) continue;
    if (bankAfterNiftyGreen && isBank && !(niftyNet > 0)) continue;

    const entry = String(t.entryTime || '');
    const exit = String(t.exitTime || t.entryTime || '');
    openExits = openExits.filter((x) => x > entry);
    if (maxLegs > 0 && openExits.length >= maxLegs) continue;
    if (!isPeSlot && maxTradesDay > 0 && dayTrades >= maxTradesDay) continue;

    const net = tradeNetRs(t);
    kept.push(t);
    openExits.push(exit);
    dayNet += net;
    dayTrades += 1;
    if (isPeSlot) peTaken += 1;
    if (isNifty) {
      niftyTaken = true;
      niftyNet += net;
    }
    if (lockRs > 0 && dayNet >= lockRs) dayStopped = true;
    if (protectRs > 0 && dayNet >= protectRs) dayStopped = true;
    if (stopRs > 0 && dayNet <= -stopRs) dayStopped = true;
    if (haltAfterRed && !isPeSlot && net < 0) dayStopped = true;
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
    maxBankEntryPremium:
      config.maxBankEntryPremium != null
        ? Number(config.maxBankEntryPremium)
        : Number(ops.maxBankEntryPremium) || 0,
    maxNiftyEntryPremium:
      config.maxNiftyEntryPremium != null
        ? Number(config.maxNiftyEntryPremium)
        : Number(ops.maxNiftyEntryPremium) || 0,
    chargeCoverMultiple:
      config.chargeCoverMultiple != null
        ? Number(config.chargeCoverMultiple)
        : Number(ops.chargeCoverMultiple) || 0,
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
