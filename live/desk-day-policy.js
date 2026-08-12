/**
 * Daily Band Loop — desk day policy.
 *
 * When followed (research): day nets cluster in ₹750–₹2000 @ 1 lot.
 * When broken (re-hunt after green / Bank on red Nifty / live ops miss): red.
 *
 * Index gate:
 *   - LOCK when dayNet ≥ bandMin (default ₹750)
 *   - LOCK after a losing close that happened while dayNet was already green
 *     (no dig / no giveback spiral)
 * Crude may still run after NSE while dayNet < bandMin.
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
  let lostAfterGreen = false;
  let tradesAfterFirstWin = 0;
  let sawFirstWin = false;

  for (const t of rows) {
    const net = tradeNetRs(t);
    const kind = bookKind(t.instrumentId);
    const before = dayNet;
    if (sawFirstWin) tradesAfterFirstWin += 1;
    if (before > 0 && net < 0) lostAfterGreen = true;
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
    lostAfterGreen,
    tradesAfterFirstWin,
  };
}

/**
 * Decide whether a NEW index entry is allowed right now.
 * Existing open legs are always managed/exited elsewhere.
 */
function indexEntryGate(summary, ops = {}) {
  const bandMin = Math.max(
    0,
    Number(ops.deskGreenLockRs != null ? ops.deskGreenLockRs : ops.bandMinRs) || 0,
  );
  const winStreak = ops.winStreakToBand !== false;
  const firstWin = ops.indexFirstWinLock === true;
  const net = Number(summary?.dayNet) || 0;
  const hadWin = !!summary?.hadIndexWin;
  const lostAfterGreen = !!summary?.lostAfterGreen;

  // In-band → hard lock (the ₹750 floor of the daily band).
  if (bandMin > 0 && net >= bandMin) {
    return {
      allow: false,
      reason: `daily band lock ₹${Math.round(net)} (≥₹${bandMin})`,
      recovery: false,
    };
  }

  // Legacy first-win (off by default in daily-band DNA).
  if (firstWin && hadWin && net > 0) {
    return {
      allow: false,
      reason: `first-win green lock (₹${Math.round(net)})`,
      recovery: false,
    };
  }

  // No dig: a loss after the desk was green ends the index session.
  if (winStreak && lostAfterGreen) {
    return {
      allow: false,
      reason: 'no dig — loss after green',
      recovery: false,
    };
  }

  return { allow: true, reason: '', recovery: false };
}

function bankEntryGate(summary, ops = {}) {
  const afterNifty = ops.bankOnlyAfterNifty !== false;
  const afterNiftyGreen = ops.bankOnlyAfterNiftyGreen === true;
  const niftyTaken =
    (Number(summary?.indexTrades) || 0) > 0 || summary?.niftyTaken === true;
  const niftyReady = summary?.niftyTaken != null ? !!summary.niftyTaken : niftyTaken;
  if (afterNifty && !niftyReady) {
    return { allow: false, reason: 'wait Nifty first' };
  }
  if (afterNiftyGreen && (Number(summary?.niftyNet) || 0) <= 0) {
    return { allow: false, reason: 'wait Nifty green' };
  }
  return { allow: true, reason: '' };
}

/** Desk-wide day net (index + crude) for Crude-below-band gate. */
function summarizeDeskDay(trades, today) {
  const day = String(today || '').slice(0, 10);
  let dayNet = 0;
  let n = 0;
  for (const t of trades || []) {
    if (String(t.entryTime || '').slice(0, 10) !== day) continue;
    dayNet += tradeNetRs(t);
    n += 1;
  }
  return { day, dayNet, trades: n };
}

module.exports = {
  bookKind,
  isIndexBook,
  summarizeIndexDay,
  summarizeDeskDay,
  indexEntryGate,
  bankEntryGate,
};
