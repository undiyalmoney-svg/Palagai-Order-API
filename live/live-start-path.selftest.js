'use strict';
/**
 * After a process restart, Start live must not die on empty dates.
 * Paper still requires From/To or Today.
 */
const assert = require('assert');
const ctrl = require('./live.controller');

function run(body) {
  return new Promise((resolve, reject) => {
    const req = { user: { id: 'selftest' }, headers: {}, body };
    const res = {
      status(c) {
        this.code = c;
        return this;
      },
      json(b) {
        resolve({ code: this.code || 200, body: b });
      },
    };
    Promise.resolve(ctrl.start(req, res)).catch((err) => {
      resolve({
        code: err.status || 500,
        body: { message: err.message || String(err) },
      });
    });
  });
}

(async () => {
  const live = await run({ liveMoney: true });
  assert.strictEqual(live.code, 400);
  assert.match(live.body.message, /Get Token|token missing/i);
  assert.doesNotMatch(live.body.message, /From date|To date/);
  assert.strictEqual(live.body.liveAssistant.ok, false);
  assert.strictEqual(live.body.liveAssistant.checks[0].id, 'token');

  const paper = await run({});
  assert.strictEqual(paper.code, 400);
  assert.match(paper.body.message, /From date|To date|Today/);

  console.log('live-start-path.selftest: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
