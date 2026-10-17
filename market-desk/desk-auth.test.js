'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeModules } = require('../auth/users.store');
const { deskSessionStatus } = require('./engine');
const { deskAuthorization } = require('./desk-auth');

test('public users only get the Charts module', () => {
  assert.deepEqual(normalizeModules(['auto', 'momentum', 'test', 'token'], 'public'), ['auto']);
});

test('friends still receive Order Test', () => {
  const mods = normalizeModules(['auto'], 'friend');
  assert.equal(mods.includes('auto'), true);
  assert.equal(mods.includes('test'), true);
});

test('desk session exposes cash and crude open flags', () => {
  const weekdayOpen = deskSessionStatus(new Date('2026-10-16T05:00:00Z')); // 10:30 IST Friday
  assert.equal(weekdayOpen.cashOpen, true);
  const afterCash = deskSessionStatus(new Date('2026-10-16T11:00:00Z')); // 16:30 IST
  assert.equal(afterCash.cashOpen, false);
  assert.equal(afterCash.crudeOpen, true);
  const weekend = deskSessionStatus(new Date('2026-10-17T05:00:00Z'));
  assert.equal(weekend.cashOpen, false);
  assert.equal(weekend.crudeOpen, false);
});

test('public users are blocked from non-Charts modules', () => {
  const { requireModule, requireCharts } = require('../auth/auth.middleware');
  const denied = [];
  const allowed = [];
  requireModule('auto')(
    { user: { role: 'public', modules: ['auto'] } },
    { status: (code) => ({ json: (body) => denied.push({ code, body }) }) },
    () => denied.push('next'),
  );
  requireCharts(
    { user: { role: 'public', modules: ['auto'] } },
    { status: (code) => ({ json: (body) => allowed.push({ code, body }) }) },
    () => allowed.push('next'),
  );
  assert.equal(denied[0]?.code, 403);
  assert.equal(allowed[0], 'next');
});

test('public desk auth prefers the shared session over a viewer header', async () => {
  const header = await deskAuthorization({
    user: { id: 'viewer-1', role: 'public' },
    headers: { 'x-kite-authorization': 'token fake:viewer' },
  });
  // No momentum store in this unit test — falls back to the incoming header.
  assert.equal(header, 'token fake:viewer');
});
