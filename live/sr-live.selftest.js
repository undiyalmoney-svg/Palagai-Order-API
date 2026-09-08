'use strict';
const assert = require('assert');
const { decideLiveAction, signalId, hmToMin, SPEC, applyDeskLimits, engineTradeStillOpen, engineBookHasOpenTrade, pickOption } = require('./sr-live');
const { exitOptsFor, LOT_UNITS } = require('./sr-strategy-config');

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
assert.strictEqual(LOT_UNITS.nifty, 65, 'Nifty lot is 65 from Jan 2026');
assert.strictEqual(LOT_UNITS.banknifty, 30, 'Bank lot is 30 from Jan 2026');
assert.strictEqual(SPEC.nifty.unitsPerLot, LOT_UNITS.nifty);
assert.strictEqual(SPEC.banknifty.unitsPerLot, LOT_UNITS.banknifty);
assert.strictEqual(SPEC.nifty.opts.stopPts, 5000 / 65);

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

// Live today: only candles up to "now" exist, so an unfinished trade is CLOSE
// at the last bar. That must still ENTER (this is what blocked 7 Sep buys).
assert.strictEqual(decideLiveAction({
  trade: { ...trade, entryTime: '10:50', exitTime: '10:55', exitReason: 'CLOSE' },
  nowHm: '10:56', alreadyOpen: false, squareOffHm: '15:15',
}), 'enter', 'intraday CLOSE on last candle is still open — Live must BUY');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, entryTime: '10:50', exitTime: '10:55', exitReason: 'GIVEUP' },
  nowHm: '10:56', alreadyOpen: false, squareOffHm: '15:15',
}), 'skip', 'GIVEUP already printed — do not chase');

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

const locked = { ...trade, exitReason: 'LOCK', exitTime: '12:00' };
assert.strictEqual(engineTradeStillOpen(locked, '11:59'), true);
assert.strictEqual(engineTradeStillOpen(locked, '12:00'), false);
assert.strictEqual(engineBookHasOpenTrade([locked], '12:16'), false, 'two closed index trades must flatten leftover Kite PE');
assert.strictEqual(engineBookHasOpenTrade([{ ...trade, exitReason: 'CLOSE', exitTime: '12:15' }], '12:16'), true);

// onTick's loop variable is `key`. A typo exitOptsFor(k, lots) throws
// "k is not defined" on every Nifty/Bank/Crude tick and blocks Live.
const liveSrc = require('fs').readFileSync(require('path').join(__dirname, 'sr-live.js'), 'utf8');
assert.doesNotMatch(liveSrc, /\.\.\.exitOptsFor\(\s*k\s*,/, 'Live tick must call exitOptsFor(key, lots), not k');
assert.match(liveSrc, /\.\.\.exitOptsFor\(\s*key\s*,\s*lots\)/, 'Live tick must pass the loop key into exitOptsFor');

const limits = applyDeskLimits(
  { maxTradesPerDay: 3, dayLossStopRs: 3500, dayProfitTargetRs: 3500 },
  { maxTradesPerDay: 8, dayLossStopRs: 0, dayProfitTargetRs: 0 },
);
assert.strictEqual(limits.maxTradesPerDay, 8);
assert.strictEqual(limits.dayLossStopRs, 0);
assert.strictEqual(limits.dayProfitTargetRs, 0);

const trailCore = require('./strategy-core.cjs');
assert.strictEqual(
  typeof trailCore.optionPeakTrailSettingsFromExtras,
  'function',
  'LiveBroker imports this from the bundle — it must be exported',
);
assert.strictEqual(typeof trailCore.evaluateOptionPeakTrail, 'function');

const { LiveBroker } = require('./live-broker');
const broker = new LiveBroker({ pushEvent: () => {}, realOrders: false });
broker.recordClosedOptionPnl({ entryPremium: 553, quantity: 30 }, 553);
assert.strictEqual(broker.moneySnapshot().closedRs, 0, 'flat premium round-trip is ~₹0 option P&L, not index ₹600');
broker.recordClosedOptionPnl({ entryPremium: 127.22, quantity: 65 }, 128.15);
assert.strictEqual(broker.moneySnapshot().closedRs, Math.round((128.15 - 127.22) * 65));
broker.positions.set('nifty', {
  status: 'open', tradingSymbol: 'NIFTY25SEP23700PE', quantity: 65,
  entryPremium: 127.22, lastLtp: 128.15,
});
assert.ok(broker.moneySnapshot().openRs > 0);

assert.strictEqual(typeof pickOption, 'function');
const { optionRupees, pickBar, summarizeOptionTrades } = require('./sr-option-pnl');
assert.strictEqual(optionRupees(553, 553, 30, 1), 0);
assert.strictEqual(optionRupees(127.22, 128.15, 65, 1), Math.round((128.15 - 127.22) * 65));
assert.strictEqual(optionRupees(0, 10, 65, 1), null);
const bars = [
  { date: '2026-09-08T11:50:00+0530', close: 127.2 },
  { date: '2026-09-08T11:55:00+0530', close: 128.0 },
  { date: '2026-09-08T12:00:00+0530', close: 128.15 },
];
assert.strictEqual(pickBar(bars, '11:50').close, 127.2);
assert.strictEqual(pickBar(bars, '12:00').close, 128.15);
assert.strictEqual(pickBar(bars, '12:16').close, 128.15);
assert.strictEqual(summarizeOptionTrades([
  { rupees: 60, rupeesSource: 'option' },
  { rupees: -3, rupeesSource: 'option' },
]).netRupees, 57);

console.log('sr-live.selftest: ok');
