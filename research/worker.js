'use strict';

/**
 * In-process supervisor. It stays idle until an operator starts the experiment
 * and Kite credentials exist. Set RESEARCH_WORKER=0 to disable the timer.
 * A database lease stops two processes from ticking the same accounts.
 */

function startResearchWorker(service, { intervalMs = 20_000 } = {}) {
  if (String(process.env.RESEARCH_WORKER || '1') === '0') {
    return { started: false, stop() {} };
  }
  let stopped = false;
  let busy = false;
  const timer = setInterval(async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const locked = await service.store.tryLock('research-worker', intervalMs * 2, service.workerOwner);
      if (!locked) return;
      await service.workerTick(new Date());
    } catch (err) {
      service.log(`[research] ${err.message}`);
      try {
        await service.store.addEvent({
          timestamp: new Date().toISOString(),
          severity: 'error',
          eventType: 'WORKER',
          message: err.message,
          metadata: {},
        });
      } catch {
        // store itself failed; do not invent prices or keep entering
      }
    } finally {
      busy = false;
    }
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    started: true,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

module.exports = { startResearchWorker };
