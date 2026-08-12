/**
 * Desk day policy — stop giving back winners; one recovery shot if already red.
 *
 * Root cause of 12 Aug red: Nifty took a green leg (~+₹387) then re-hunted into
 * −₹673 / −₹26 and Bank −₹270. Research prototype `firstWinIndex` (all3-red-kill)
 * locks index after the first green Nifty/Bank close; Crude evening still runs.
 */

function tradeNetRs(t) {
  if (t == null) return 0;
  if (t.netOptionPnlRs != null) return Number(t.netOptionPnlRs) || 0;
  if (t.optionPnlRs != null) return Number(t.optionPnlRs) || 0;
  return 0;
}

function bookKind(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  if (id.includes('crude')) return 'crude';
  if (id.includes('bank')) return 'bank';
  if (id.includes('nifty')) return 'nifty';
  return 'other';
}

function isIndexBook(instrumentId) {
  const k = bookKind(instrumentId);
  return k === 'nifty' || k === 'bank';
}

/**
 * Closed-trade day snapshot from the live ledger (broker/paper money).
 */
function summarizeIndexDay(trades, today) {
  const day = String(today || '').slice(0, 10);
  const rows = (trades || [])
    .filter((t) => String(t.entryTime || '').slice(0, 10) === day && isIndexBook(t.instrumentId))
    .sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime)));

  let dayNet = 0;
  let niftyNet = 0;
  let bankNet = 0;
  let indexTrades = 0;
  let hadIndexWin = false;
  let tradesAfterFirstWin = 0;
  let sawFirstWin = false;

  for (const t of rows) {
    const net = tradeNetRs(t);
    const kind = bookKind(t.instrumentId);
    if (sawFirstWin) tradesAfterFirstWin += 1;
    dayNet += net;
    indexTrades += 1;
    if (kind === 'nifty') niftyNet += net;
    if (kind === 'bank') bankNet += net;
    if (net > 0) {
      hadIndexWin = true;
      sawFirstWin = true;
    }
  }

  return {
    day,
    dayNet,
    niftyNet,
    bankNet,
    indexTrades,
    hadIndexWin,
    tradesAfterFirstWin,
  };
}

/**
 * Decide whether a NEW index entry is allowed right now.
 * Existing open legs are always managed/exited elsewhere.
 *
 * `recoveryShotsUsed` is session-counted (live worker) so a mid-day deploy can
 * still take one recovery trade after an old-policy giveback day.
 */
function indexEntryGate(summary, ops = {}) {
  const firstWin = ops.indexFirstWinLock !== false;
  const greenLockRs = Math.max(0, Number(ops.deskGreenLockRs) || 0);
  const recoveryMax = Math.max(0, Math.floor(Number(ops.recoveryMaxExtra) || 0));
  const net = Number(summary?.dayNet) || 0;
  const hadWin = !!summary?.hadIndexWin;
  const shotsUsed =
    summary?.recoveryShotsUsed != null
      ? Math.max(0, Math.floor(Number(summary.recoveryShotsUsed) || 0))
      : Math.max(0, Math.floor(Number(summary?.tradesAfterFirstWin) || 0));

  const greenFloor = greenLockRs > 0 ? greenLockRs : 1;

  if (!firstWin) {
    if (net >= greenFloor) {
      return { allow: false, reason: `desk green lock ₹${Math.round(net)}`, recovery: false };
    }
    return { allow: true, reason: '', recovery: false };
  }

  // Any green desk after a win → lock (do not re-hunt winners away).
  if (hadWin && net > 0) {
    return {
      allow: false,
      reason: `first-win green lock (₹${Math.round(net)})`,
      recovery: false,
    };
  }

  // Red after a prior green leg → one recovery shot aimed at greenFloor.
  if (hadWin && net <= 0) {
    if (shotsUsed >= recoveryMax) {
      return {
        allow: false,
        reason: `recovery shot used (${shotsUsed}/${recoveryMax})`,
        recovery: false,
      };
    }
    return {
      allow: true,
      reason: `recovery until ≥ ₹${greenFloor}`,
      recovery: true,
    };
  }

  // No win yet — keep hunting (subject to max trades / signals).
  return { allow: true, reason: '', recovery: false };
}

function bankEntryGate(summary, ops = {}) {
  const afterNifty = ops.bankOnlyAfterNifty !== false;
  const afterNiftyGreen = ops.bankOnlyAfterNiftyGreen === true;
  const niftyTaken = (Number(summary?.indexTrades) || 0) > 0 || (summary?.niftyTaken === true);
  // Prefer explicit niftyTaken from live worker when provided.
  const niftyReady = summary?.niftyTaken != null ? !!summary.niftyTaken : niftyTaken;
  if (afterNifty && !niftyReady) {
    return { allow: false, reason: 'wait Nifty first' };
  }
  if (afterNiftyGreen && (Number(summary?.niftyNet) || 0) <= 0) {
    return { allow: false, reason: 'wait Nifty green' };
  }
  return { allow: true, reason: '' };
}

module.exports = {
  bookKind,
  isIndexBook,
  summarizeIndexDay,
  indexEntryGate,
  bankEntryGate,
};
