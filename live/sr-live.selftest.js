'use strict';
const assert = require('assert');
const { decideLiveAction, signalId, hmToMin, SPEC } = require('./sr-live');
const { exitOptsFor } = require('./sr-strategy-config');

assert.deepStrictEqual(SPEC.nifty.opts, exitOptsFor('nifty'), 'Live Nifty opts must match Paper shared config');
assert.deepStrictEqual(SPEC.banknifty.opts, exitOptsFor('banknifty'));
assert.deepStrictEqual(SPEC.crude.opts, exitOptsFor('crude'));
// Assert the RULES are wired, not their tuned values — the three deepStrictEqual
// checks above already guarantee Live matches Paper, so pinning a literal here
// only breaks the test whenever a level is retuned (it did, when the lock arm
// moved 12 -> 8). Check shape and coherence instead.
const n = SPEC.nifty.opts;
assert.ok(n.maxRetestBars > 0, 'Nifty must have the entry meter');
assert.ok(n.lockArmPts > 0 && n.lockAtPts > 0, 'Nifty must have the profit lock');
assert.ok(n.lockArmPts > n.lockAtPts, 'lock must arm above the level it exits at');
assert.ok(n.giveUpBar > 0 && n.giveUpMinPts > 0, 'Nifty must have the give-up rule');
assert.ok(SPEC.nifty.opts.stopPts > 0, 'Nifty Paper/Live share the Rs5000/lot cut-off in points');

const trade = {
  date: '2026-09-05', side: 'BUY', option: 'CE',
  entryTime: '10:15', exitTime: '11:00', exitReason: 'CLOSE', target: 20, entryPrice: 25000,
};

assert.strictEqual(signalId('nifty', trade), 'nifty|2026-09-05|10:15');
assert.strictEqual(hmToMin('10:15'), 615);

assert.strictEqual(decideLiveAction({
  trade, nowHm: '10:20', alreadyOpen: false, squareOffHm: '15:15',
}), 'enter', 'fresh signal within 20 min must enter');

assert.strictEqual(decideLiveAction({
  trade, nowHm: '11:00', alreadyOpen: false, squareOffHm: '15:15',
}), 'skip', 'stale signal must not enter');

assert.strictEqual(decideLiveAction({
  trade, nowHm: '10:10', alreadyOpen: false, squareOffHm: '15:15',
}), 'wait');

assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'TARGET', exitTime: '10:18' },
  nowHm: '10:20', alreadyOpen: false, squareOffHm: '15:15',
}), 'skip', 'already completed in engine — too late');

assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'TARGET', exitTime: '10:40' },
  nowHm: '10:20', alreadyOpen: true, squareOffHm: '15:15',
}), 'hold', 'target not yet reached');

assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'TARGET', exitTime: '10:40' },
  nowHm: '10:45', alreadyOpen: true, squareOffHm: '15:15',
}), 'exit');

assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'LOCK', exitTime: '10:25' },
  nowHm: '10:26', alreadyOpen: true, squareOffHm: '15:15',
}), 'exit', 'Nifty profit-lock must flatten Live');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'GIVEUP', exitTime: '10:25' },
  nowHm: '10:26', alreadyOpen: true, squareOffHm: '15:15',
}), 'exit', 'Nifty give-up must flatten Live');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'STOP', exitTime: '10:25' },
  nowHm: '10:26', alreadyOpen: true, squareOffHm: '15:15',
}), 'exit', 'Nifty Rs5000 cut-off must flatten Live');

assert.strictEqual(decideLiveAction({
  trade, nowHm: '15:16', alreadyOpen: false, squareOffHm: '15:15',
}), 'skip');

assert.ok(SPEC.crude, 'crude book registered');
assert.strictEqual(SPEC.crude.exchange, 'MCX');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, entryTime: '19:50', exitTime: '20:30', exitReason: 'CLOSE' },
  nowHm: '19:55', alreadyOpen: false, squareOffHm: SPEC.crude.session.squareOffHm,
}), 'enter', 'crude evening window still live');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, entryTime: '19:50', exitTime: '20:30', exitReason: 'CLOSE' },
  nowHm: '23:20', alreadyOpen: true, squareOffHm: SPEC.crude.session.squareOffHm,
}), 'exit', 'crude square-off');

// onTick's loop variable is `key`. A typo exitOptsFor(k, lots) throws
// "k is not defined" on every Nifty/Bank/Crude tick and blocks Live.
const liveSrc = require('fs').readFileSync(require('path').join(__dirname, 'sr-live.js'), 'utf8');
assert.doesNotMatch(liveSrc, /\.\.\.exitOptsFor\(\s*k\s*,/, 'Live tick must call exitOptsFor(key, lots), not k');
assert.match(liveSrc, /\.\.\.exitOptsFor\(\s*key\s*,\s*lots\)/, 'Live tick must pass the loop key into exitOptsFor');

console.log('sr-live.selftest: ok');
