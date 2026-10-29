'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const http = require('node:http');

process.env.PDH_LIVE_STATE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdh-live-routes-')), 'state.json');

const { createOrbBacktestRouter } = require('./routes');
const { resetJobs } = require('./jobs');
const { resetDiscoverJobs } = require('./discover/jobs');
const { NIFTY_500 } = require('./universe');

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

test('orb-backtest health is public; run/universe/jobs need a site user', async () => {
  resetJobs();
  const app = express();
  app.use(express.json());
  app.use(
    '/orb-backtest',
    createOrbBacktestRouter({
      auth: {
        requireSiteUser: (req, res, next) => {
          req.user = { id: 'owner-1', username: 'Devil', role: 'owner' };
          next();
        },
      },
    }),
  );
  const { server, base } = await listen(app);
  try {
    const health = await fetch(`${base}/orb-backtest/health`);
    const healthBody = await health.json();
    assert.equal(health.status, 200);
    assert.equal(typeof healthBody.liveMoney, 'boolean');
    assert.ok(healthBody.universe >= 490);

    const universe = await fetch(`${base}/orb-backtest/universe`);
    const universeBody = await universe.json();
    assert.equal(universe.status, 200);
    assert.equal(universeBody.count, NIFTY_500.length);
    assert.ok(universeBody.symbols.includes('RELIANCE'));

    const bad = await fetch(`${base}/orb-backtest/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(bad.status, 400);

    const missing = await fetch(`${base}/orb-backtest/jobs/not-a-job`);
    const missingBody = await missing.json();
    assert.equal(missing.status, 404);
    assert.match(missingBody.message, /not found/i);

    const space = await fetch(`${base}/orb-backtest/discover/space`);
    const spaceBody = await space.json();
    assert.equal(space.status, 200);
    assert.equal(spaceBody.liveOrders, false);
    assert.ok(spaceBody.count >= 8);
    assert.match(spaceBody.baselineId, /baseline/);
    assert.ok(spaceBody.candidates[0].rules.entry);

    const missingDisc = await fetch(`${base}/orb-backtest/discover/not-a-job`);
    assert.equal(missingDisc.status, 404);

    const badDiscover = await fetch(`${base}/orb-backtest/discover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(badDiscover.status, 400);
    const badDiscoverBody = await badDiscover.json();
    assert.equal(badDiscoverBody.status, 'error');

    const live = await fetch(`${base}/orb-backtest/live-today`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capital: 100000 }),
    });
    assert.equal(live.status, 202);
    const liveBody = await live.json();
    assert.equal(liveBody.liveOrders, false);
    assert.equal(liveBody.input.liveToday, true);
    assert.equal(liveBody.input.maxStocksPerDay, 2);
    assert.equal(liveBody.input.targetR, 1);
    assert.equal(liveBody.input.capital, 0);
  } finally {
    await new Promise((r) => server.close(r));
    resetJobs();
    resetDiscoverJobs();
  }
});
