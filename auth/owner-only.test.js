'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { siteLogin } = require('./auth.controller');
const { isSiteOwner, signUserToken, requireSiteUser } = require('./auth.middleware');
const { OWNER_SEED } = require('./credentials');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('isSiteOwner accepts Devil and rejects Public/friends', () => {
  assert.equal(isSiteOwner({ username: OWNER_SEED.username, role: 'owner' }), true);
  assert.equal(isSiteOwner({ username: 'devil', role: 'friend' }), true);
  assert.equal(isSiteOwner({ username: 'Public', role: 'public' }), false);
  assert.equal(isSiteOwner({ username: 'Friend', role: 'friend' }), false);
  assert.equal(isSiteOwner(null), false);
});

test('site login rejects any username that is not Devil with a generic 401', async () => {
  const res = mockRes();
  await siteLogin({ body: { username: 'Public', password: 'PublicView1789' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.message, 'Invalid username or password');
  assert.equal(String(res.body.message).toLowerCase().includes('devil'), false);

  const other = mockRes();
  await siteLogin({ body: { username: 'admin', password: 'x' } }, other);
  assert.equal(other.statusCode, 401);
  assert.equal(other.body.message, 'Invalid username or password');
});

test('requireSiteUser returns 403 for a non-owner JWT', async () => {
  const token = signUserToken({
    _id: 'public-1',
    username: 'Public',
    role: 'public',
    modules: ['auto'],
  });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockRes();
  let nextCalled = false;
  await requireSiteUser(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.ok(res.statusCode === 403 || res.statusCode === 401);
  if (res.statusCode === 403) {
    assert.match(res.body.message, /owner/i);
  }
});
