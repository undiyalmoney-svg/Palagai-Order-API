'use strict';

let holder = null;

function acquire(id, kind = 'backtest') {
  if (holder) {
    const err = new Error(
      kind === 'discover'
        ? 'A historical research job is already running. Wait for it to finish.'
        : 'A historical backtest is already running. Wait for it to finish.',
    );
    err.status = 409;
    err.jobId = holder;
    throw err;
  }
  holder = id;
  return id;
}

function release(id) {
  if (!id || holder === id) holder = null;
}

function currentLock() {
  return holder;
}

function resetLock() {
  holder = null;
}

module.exports = { acquire, release, currentLock, resetLock };
