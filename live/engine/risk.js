'use strict';
/**
 * Independent gates in front of execution. Strategy may still say ENTER;
 * this module can reject. Does not place orders.
 */
function approveLiveStart({ autoBotRunning }) {
  if (autoBotRunning) {
    return { ok: false, reason: 'Auto Bot Live is already running. Stop it before S/R Live.' };
  }
  return { ok: true };
}

function approveLiveEntry({
  sessionRunning,
  autoBotRunning,
  enteredCount,
  maxTradesPerDay,
  emergencyStop,
  bookName,
}) {
  if (emergencyStop) return { ok: false, reason: 'emergency-stop' };
  if (!sessionRunning) return { ok: false, reason: 'S/R Live idle' };
  if (autoBotRunning) return { ok: false, reason: 'Auto Bot Live is running' };
  const cap = Math.max(1, Number(maxTradesPerDay) || 3);
  if ((enteredCount || 0) >= cap) {
    const who = bookName ? `${bookName} ` : '';
    return { ok: false, reason: `max ${cap} ${who}live entries today`.replace(/  +/g, ' ') };
  }
  return { ok: true };
}

module.exports = { approveLiveStart, approveLiveEntry };
