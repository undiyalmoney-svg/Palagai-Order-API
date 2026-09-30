'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp } = require('./helpers');

const USER = 'u1';

test('daily job runs once per period even when triggered concurrently', async () => {
  const app = await makeApp();
  app.momentum.initPaper(USER, 500_000);
  const [a, b] = await Promise.all([app.jobs.runDaily(), app.jobs.runDaily()]);
  assert.equal([a, b].filter((r) => r.skipped).length, 1, 'exactly one call is skipped');
  const done = [a, b].find((r) => !r.skipped);
  assert.equal(done.status, 'DONE');
  const again = await app.jobs.runDaily();
  assert.equal(again.skipped, true);
  const runs = app.store.listRuns ? app.store.listJobs(20).filter((j) => j.job === 'daily') : [];
  assert.equal(runs.length, 1);
  app.close();
});

test('daily job stores one decision run per portfolio and day, and never duplicates signals or orders', async () => {
  const app = await makeApp();
  const p = app.momentum.initPaper(USER, 500_000);
  await app.jobs.runDaily();
  const before = app.store.listDecisionRuns(p.id, 20);
  assert.equal(before.length, 1);
  const signals = app.store.listSignals({ userId: USER, portfolioId: p.id }).length;
  const orders = app.store.listOrders({ userId: USER }).length;
  await app.jobs.runDaily({ force: true });
  assert.equal(app.store.listDecisionRuns(p.id, 20).length, 1, 'forced re-run reuses the stored decision');
  assert.equal(app.store.listSignals({ userId: USER, portfolioId: p.id }).length, signals);
  assert.equal(app.store.listOrders({ userId: USER }).length, orders);
  app.close();
});

test('weekly and monthly jobs are deduplicated per ISO week / month', async () => {
  const app = await makeApp();
  app.momentum.initPaper(USER, 500_000);
  const [w1, w2] = await Promise.all([app.jobs.runWeekly(), app.jobs.runWeekly()]);
  assert.equal([w1, w2].filter((r) => r.skipped).length, 1);
  const [m1, m2] = await Promise.all([app.jobs.runMonthly(), app.jobs.runMonthly()]);
  assert.equal([m1, m2].filter((r) => r.skipped).length, 1);
  const done = [m1, m2].find((r) => !r.skipped);
  assert.equal(done.status, 'DONE');
  assert.equal(done.result.portfolios.length, 1);
  app.close();
});

test('scheduled decisions only place orders when execution is enabled', async () => {
  const app = await makeApp();
  const p = app.momentum.initPaper(USER, 1_000_000);
  app.store.updatePortfolio(p.id, { autoExecute: false });
  await app.jobs.runDaily();
  assert.equal(app.store.listOrders({ userId: USER }).length, 0, 'signal mode never trades');
  app.close();
});
