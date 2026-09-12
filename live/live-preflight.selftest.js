'use strict';
const assert = require('assert');
const { preflightLive, firstFail } = require('./live-preflight');

(async () => {
  const noTok = await preflightLive(null);
  assert.strictEqual(noTok.ok, false);
  assert.strictEqual(firstFail(noTok).id, 'token');

  const ok = await preflightLive('token k:s', {
    market: {
      fetchUserMargins: async () => ({ capitalRs: 61200, equityCash: 61200 }),
      fetchQuotes: async () => ({ 'NSE:NIFTY 50': { last_price: 25100 } }),
    },
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.checks.length, 3);

  const stale = await preflightLive('token k:s', {
    market: {
      fetchUserMargins: async () => { throw new Error('Incorrect `api_key` or `access_token`.'); },
      fetchQuotes: async () => ({ 'NSE:NIFTY 50': { last_price: 25100 } }),
    },
  });
  assert.strictEqual(stale.ok, false);
  assert.match(firstFail(stale).detail, /api_key|access_token|funds failed/i);

  console.log('live-preflight.selftest: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
