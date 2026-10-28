'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createOrbBacktestRouter } = require('./routes');
const { resetJobs } = require('./jobs');
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
    assert.equal(healthBody.liveOrders, false);
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
  } finally {
    await new Promise((r) => server.close(r));
    resetJobs();
  }
});
