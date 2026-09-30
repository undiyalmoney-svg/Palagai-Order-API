'use strict';

const { createMomentumApp } = require('./index');
const { createMomentumRouter } = require('./api/routes');

let instance = null;
let router = null;

/** Process-wide Momentum Portfolio Manager (SQLite file, real clock). */
function getMomentumApp() {
  if (!instance) instance = createMomentumApp({ log: (m) => console.log(m) });
  return instance;
}

function getMomentumRouter() {
  if (!router) router = createMomentumRouter(getMomentumApp());
  return router;
}

function startMomentumScheduler() {
  if (String(process.env.MOMENTUM_SCHEDULER || '1') === '0') return null;
  const app = getMomentumApp();
  app.jobs.start();
  return app.jobs;
}

module.exports = { getMomentumApp, getMomentumRouter, startMomentumScheduler };
