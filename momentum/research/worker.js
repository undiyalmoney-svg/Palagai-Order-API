'use strict';

const { parentPort, workerData } = require('worker_threads');
const { openDatabase } = require('../db/database');
const { Store } = require('../db/store');
const { buildPanel } = require('../services/market-data-service');
const { runOptimization, runWalkForward } = require('./optimizer');

/** Runs one long research job off the main thread so the API stays responsive. */
try {
  const db = openDatabase(workerData.dbPath);
  const store = new Store(db);
  const panel = buildPanel(store);
  const onProgress = (v) => parentPort.postMessage({ type: 'progress', value: v });
  const run = workerData.kind === 'WALK_FORWARD' ? runWalkForward : runOptimization;
  const result = run({ panel, ...workerData.cfg, onProgress });
  parentPort.postMessage({ type: 'done', result });
  db.close();
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err.message });
}
