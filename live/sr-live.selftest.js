'use strict';
const assert = require('assert');
const { decideLiveAction, signalId, hmToMin, SPEC, applyDeskLimits, engineTradeStillOpen, engineBookHasOpenTrade, mustExitHeldForNewLeg, matchHeldEngineTrade, pickOption, selectNearestFut, liveTransactionType, liveTradesFromBroker } = require('./sr-live');
const { exitOptsFor, LOT_UNITS, OPTION_SL_MAX_RS } = require('./sr-strategy-config');

assert.deepStrictEqual(SPEC.nifty.opts, exitOptsFor('nifty'), 'Live Nifty opts must match Paper shared config');
assert.deepStrictEqual(SPEC.banknifty.opts, exitOptsFor('banknifty'));
assert.deepStrictEqual(SPEC.crude.opts, exitOptsFor('crude'));
// Assert the RULES are wired, not their tuned values — the three deepStrictEqual
// checks above already guarantee Live matches Paper, so pinning a literal here
// only breaks the test whenever a level is retuned (it did, when the lock arm
// moved 12 -> 8). Check shape and coherence instead.
const n = SPEC.nifty.opts;
assert.ok(n.maxRetestBars > 0, 'Nifty must have the entry meter');
assert.strictEqual(n.lockArmPts, 0, 'index lock scratches CE/PE; do not arm a lock');
assert.strictEqual(n.giveUpBar, 4, 'stall give-up after 4 bars with no +12');
assert.strictEqual(n.giveUpMinPts, 12);
assert.strictEqual(n.targetByScore[1], 0, 'no +20 index TARGET on option books');
assert.strictEqual(n.timeStopBars, 6, 'TIME 6 cuts August CLOSE session holds');
assert.strictEqual(n.failStop, false, 'FAIL on a 1-bar wall close scratches the move');
assert.strictEqual(n.structureExit, true, 'measured-move STRUCTURE uses the same box the chart draws');
assert.strictEqual(n.minStructurePts, 40);
assert.strictEqual(n.minScore, 1);
assert.strictEqual(SPEC.banknifty.opts.structureExit, true);
assert.strictEqual(SPEC.banknifty.opts.minStructurePts, 80);
assert.strictEqual(OPTION_SL_MAX_RS.nifty, 5000);
assert.strictEqual(OPTION_SL_MAX_RS.banknifty, 2500, 'Bank TIME-6 DNA re-measured a ₹2,500 option cap');
assert.strictEqual(SPEC.banknifty.opts.lockArmPts, 0, 'Bank index lock scratches the PE');
assert.strictEqual(SPEC.banknifty.opts.sessionAlign, true, 'Bank skips CE below day-open / PE above it');
assert.ok(!SPEC.nifty.opts.sessionAlign, 'Nifty session-align costs net; leave off');
assert.strictEqual(SPEC.banknifty.opts.timeStopBars, 6);
assert.strictEqual(SPEC.banknifty.opts.failStop, false);
assert.strictEqual(SPEC.banknifty.opts.targetByScore[1], 0);
assert.ok(SPEC.nifty.opts.stopPts > 0, 'Nifty Paper/Live share the Rs5000/lot cut-off in points');
assert.ok(SPEC.banknifty.opts.stopPts > 0, 'Bank Paper/Live share the Rs2500/lot cut-off in points');
assert.strictEqual(LOT_UNITS.nifty, 65, 'Nifty lot is 65 from Jan 2026');
assert.strictEqual(LOT_UNITS.banknifty, 30, 'Bank lot is 30 from Jan 2026');
assert.strictEqual(SPEC.nifty.unitsPerLot, LOT_UNITS.nifty);
assert.strictEqual(SPEC.banknifty.unitsPerLot, LOT_UNITS.banknifty);
assert.strictEqual(SPEC.nifty.opts.stopPts, 5000 / 65);
assert.strictEqual(SPEC.banknifty.opts.stopPts, 2500 / 30);
assert.strictEqual(SPEC.nifty.vehicle, 'option', 'Nifty Live buys ATM CE/PE, not the index future');
assert.strictEqual(liveTransactionType(SPEC.nifty, { side: 'SELL', option: 'PE' }), 'BUY', 'PE signal must BUY the put, not sell futures');
assert.strictEqual(liveTransactionType(SPEC.nifty, { side: 'BUY', option: 'CE' }), 'BUY');
assert.strictEqual(liveTransactionType({ vehicle: 'fut' }, { side: 'SELL' }), 'SELL');
{
  const row = selectNearestFut([
    { name: 'NIFTY', instrumentType: 'FUT', instrumentToken: 1, expiry: '2026-09-24', tradingSymbol: 'NIFTY26SEPFUT' },
    { name: 'NIFTY', instrumentType: 'FUT', instrumentToken: 2, expiry: '2026-08-28', tradingSymbol: 'NIFTY26AUGFUT' },
    { name: 'NIFTY', instrumentType: 'CE', instrumentToken: 3, expiry: '2026-09-15', tradingSymbol: 'NIFTY2591524000CE' },
  ], 'NIFTY', '2026-09-08');
  assert.strictEqual(row.tradingSymbol, 'NIFTY26SEPFUT');
}
{
  const row = selectNearestFut([
    { name: 'NIFTY', instrumentType: 'FUT', instrumentToken: 1, expiry: '2026-09-24', tradingSymbol: 'NIFTY26SEPFUT' },
    { name: 'NIFTY', instrumentType: 'FUT', instrumentToken: 4, expiry: '2026-10-29', tradingSymbol: 'NIFTY26OCTFUT' },
  ], 'NIFTY', '2026-09-24');
  assert.strictEqual(row.tradingSymbol, 'NIFTY26OCTFUT', 'expiry day skips the dying future');
}

const trade = {
  date: '2026-09-05', side: 'BUY', option: 'CE',
  entryTime: '10:15', exitTime: '11:00', exitReason: 'CLOSE', target: 20, entryPrice: 25000,
};

assert.strictEqual(signalId('nifty', trade), 'nifty|2026-09-05|10:15');
assert.strictEqual(hmToMin('10:15'), 615);

assert.strictEqual(decideLiveAction({
  trade, nowHm: '10:20', alreadyOpen: false, squareOffHm: '15:15',
}), 'enter', 'engine still OPEN — Live enters (same as Paper)');

assert.strictEqual(decideLiveAction({
  trade, nowHm: '11:00', alreadyOpen: false, squareOffHm: '15:15',
}), 'enter', 'OPEN engine trade 45 min after fill — Live must still enter');

assert.strictEqual(decideLiveAction({
  trade, nowHm: '10:10', alreadyOpen: false, squareOffHm: '15:15',
}), 'wait');

assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'TARGET', exitTime: '10:18' },
  nowHm: '10:20', alreadyOpen: false, squareOffHm: '15:15',
}), 'skip', 'Paper already TARGET — Live stays flat, does not chase');
assert.strictEqual(decideLiveAction({
  trade: {
    ...trade, side: 'SELL', option: 'PE', entryTime: '11:50', exitTime: '11:55',
    exitReason: 'TARGET', entryPrice: 23512.6, points: 20,
  },
  nowHm: '11:56', alreadyOpen: false, squareOffHm: '15:15',
}), 'skip', 'Paper already TARGET — Live does not buy a finished trade');

// Live today: only candles up to "now" exist, so an unfinished trade is CLOSE
// at the last bar. That must still ENTER (this is what blocked 7 Sep buys).
assert.strictEqual(decideLiveAction({
  trade: { ...trade, entryTime: '10:50', exitTime: '10:55', exitReason: 'CLOSE' },
  nowHm: '10:56', alreadyOpen: false, squareOffHm: '15:15',
}), 'enter', 'intraday CLOSE on last candle is still open — Live must BUY');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, entryTime: '10:50', exitTime: '10:55', exitReason: 'GIVEUP' },
  nowHm: '10:56', alreadyOpen: false, squareOffHm: '15:15',
}), 'skip', 'Paper already GIVEUP and we are flat — do not enter');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, entryTime: '10:15', exitTime: '10:45', exitReason: 'TIME' },
  nowHm: '11:00', alreadyOpen: false, squareOffHm: '15:15',
}), 'skip', 'TIME done and flat — do not buy a finished Paper trade');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, entryTime: '10:15', exitTime: '10:45', exitReason: 'CLOSE' },
  nowHm: '11:00', alreadyOpen: false, squareOffHm: '15:15',
}), 'enter', 'CLOSE on last bar is still OPEN — enter even 45 min later');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, entryTime: '10:50', exitTime: '10:55', exitReason: 'TARGET' },
  nowHm: '11:20', alreadyOpen: false, squareOffHm: '15:15',
}), 'skip', 'engine TARGET done and flat — do not chase');

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
assert.strictEqual(
  mustExitHeldForNewLeg({ entryTime: '11:50' }, { entryTime: '12:10' }),
  true,
  'do not hold 11:50 PE through the 12:10 LOCK',
);
assert.strictEqual(mustExitHeldForNewLeg({ entryTime: '11:50' }, { entryTime: '11:50' }), false);
assert.strictEqual(
  mustExitHeldForNewLeg({ entryTime: null }, { entryTime: '12:10' }),
  true,
  'adopted Kite PE after restart must not be glued to a later Paper leg',
);
{
  const book = [
    { entryTime: '11:50', exitReason: 'LOCK', exitTime: '12:00' },
    { entryTime: '12:10', exitReason: 'CLOSE', exitTime: '12:15' },
  ];
  assert.strictEqual(
    matchHeldEngineTrade(book, null, { entryTime: '11:50' }).entryTime,
    '11:50',
    'held fill matches its own engine row, not the next open LOCK',
  );
  assert.strictEqual(matchHeldEngineTrade(book, null, { entryTime: null }), null);
}
assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'GIVEUP', exitTime: '10:25' },
  nowHm: '10:26', alreadyOpen: true, squareOffHm: '15:15',
}), 'exit', 'Nifty give-up must flatten Live');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'STOP', exitTime: '10:25' },
  nowHm: '10:26', alreadyOpen: true, squareOffHm: '15:15',
}), 'exit', 'Nifty Rs5000 cut-off must flatten Live');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'TIME', exitTime: '10:45' },
  nowHm: '11:00', alreadyOpen: true, squareOffHm: '15:15',
}), 'exit', 'engine TIME must flatten Live');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'STRUCTURE', exitTime: '10:50' },
  nowHm: '10:51', alreadyOpen: true, squareOffHm: '15:15',
}), 'exit', 'engine STRUCTURE must flatten Live');
assert.strictEqual(decideLiveAction({
  trade, nowHm: '11:00', alreadyOpen: true, squareOffHm: '15:15',
}), 'hold', 'CLOSE last-bar still OPEN — Live holds with Paper');

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
assert.strictEqual(engineTradeStillOpen({ ...trade, exitReason: 'STRUCTURE', exitTime: '11:00' }, '10:59'), true);
assert.strictEqual(engineTradeStillOpen({ ...trade, exitReason: 'STRUCTURE', exitTime: '11:00' }, '11:00'), false);

// onTick's loop variable is `key`. A typo exitOptsFor(k, lots) throws
// "k is not defined" on every Nifty/Bank/Crude tick and blocks Live.
const liveSrc = require('fs').readFileSync(require('path').join(__dirname, 'sr-live.js'), 'utf8');
assert.doesNotMatch(liveSrc, /\.\.\.exitOptsFor\(\s*k\s*,/, 'Live tick must call exitOptsFor(key, lots), not k');
assert.match(liveSrc, /\.\.\.exitOptsFor\(\s*key\s*,\s*lots\)/, 'Live tick must pass the loop key into exitOptsFor');
assert.doesNotMatch(liveSrc, /FRESH_MINUTES/, 'Live must not have a 20-minute freshness gate');
assert.doesNotMatch(liveSrc, /need <.*m after entry/, 'Live skip log must not mention a freshness window');
{
  const deskSrc = require('fs').readFileSync(require('path').join(__dirname, 'sr-desk.js'), 'utf8');
  assert.doesNotMatch(deskSrc, /older than 20 minutes/, 'Paper UI must not mark Live-skip on age');
}

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
broker.setOptionMaxLossRs('nifty-50', 5000);
assert.strictEqual(broker.optionMaxLossRs('nifty-50'), 5000, 'S/R must not inherit Auto Bot ₹300/lot');
assert.ok(broker.optionMaxLossRs('other') > 0 && broker.optionMaxLossRs('other') <= 300, 'unset books keep Auto Bot DNA');
broker.recordClosedOptionPnl({ entryPremium: 553, quantity: 30 }, 553);
assert.strictEqual(broker.moneySnapshot().closedRs, 0, 'flat premium round-trip is ~₹0 option P&L, not index ₹600');
broker.recordClosedOptionPnl({ entryPremium: 127.22, quantity: 65 }, 128.15);
assert.strictEqual(broker.moneySnapshot().closedRs, Math.round((128.15 - 127.22) * 65));
broker.positions.set('nifty', {
  status: 'open', tradingSymbol: 'NIFTY25SEP23700PE', quantity: 65,
  entryPremium: 127.22, lastLtp: 128.15,
});
broker.positions.set('nifty-short', {
  status: 'open', tradingSymbol: 'NIFTY26SEPFUT', quantity: 65,
  entryPremium: 23650, lastLtp: 23645, direction: 'SELL', vehicle: 'fut',
});
assert.ok(broker.moneySnapshot().legs.find((l) => l.symbol === 'NIFTY26SEPFUT').pnlRs > 0, 'short fut profits when price falls');

assert.strictEqual(typeof pickOption, 'function');
const { optionRupees, pickBar, summarizeOptionTrades, liveLikeEntryPrem, liveLikeExitPrem, slLimitFill, markOneOpenLeg } = require('./sr-option-pnl');
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
assert.strictEqual(liveLikeEntryPrem({ close: 100, high: 101 }, 0.5), 100.5);
assert.strictEqual(liveLikeExitPrem({ close: 135.7, low: 134.8 }, 0.5), 135.2);
assert.ok(liveLikeEntryPrem({ close: 127.2, high: 128 }, 0.5) > 127.2, 'Paper buy must be worse than close (Live ask)');
assert.ok(liveLikeExitPrem({ close: 128.15, low: 127 }, 0.5) < 128.15, 'Paper sell must be worse than close (Live bid)');
assert.strictEqual(slLimitFill(100, 95), 95, 'SL fills at the low when low is above the 90% limit');
assert.strictEqual(slLimitFill(100, 50), 90, 'gapped SL fills at the 90% limit, not the panic low');
assert.strictEqual(slLimitFill(100, 101), null, 'SL does not fire above the trigger');
{
  const { slWalkPx, walkOptionSl, fillBarEntryPx } = require('./sr-option-pnl');
  const fillBar = { date: '2026-09-11T10:00:00+0530', open: 100, high: 102, low: 80, close: 101 };
  const closeStop = { date: '2026-09-11T10:00:00+0530', open: 100, high: 102, low: 80, close: 90 };
  const dumpBar = { date: '2026-09-11T10:00:00+0530', open: 923.4, high: 930, low: 800, close: 850 };
  const later = { date: '2026-09-11T10:05:00+0530', open: 101, high: 102, low: 88, close: 99 };
  assert.strictEqual(fillBarEntryPx(dumpBar), 923.4, 'dump bar In is the open, not the stopped close');
  assert.strictEqual(slWalkPx(fillBar, 95, true), null, 'fill-bar wick does not fire SL');
  assert.strictEqual(slWalkPx(closeStop, 95, true), 90, 'fill-bar close through SL does fire');
  assert.strictEqual(slWalkPx(later, 95, false), 88, 'later bar low fires SL');
  const wickOnly = walkOptionSl([fillBar, later], '10:00', '10:10', '2026-09-11', 95, fillBar);
  assert.ok(wickOnly && wickOnly.fill === 88 && wickOnly.isFillBar === false);
  const closeHit = walkOptionSl([closeStop, later], '10:00', '10:10', '2026-09-11', 95, closeStop);
  assert.ok(closeHit && closeHit.isFillBar === true && closeHit.fill === 90);
}
{
  const seq = markOneOpenLeg([
    { date: '2026-09-08', entryTime: '11:50', exitTime: '12:00' },
    { date: '2026-09-08', entryTime: '12:10', exitTime: '12:20' },
    { date: '2026-09-08', entryTime: '12:12', exitTime: '12:30' },
  ]);
  assert.strictEqual(seq[0].liveSkip, undefined);
  assert.strictEqual(seq[1].liveSkip, undefined, '12:10 is after 12:00 LOCK — Live can take it');
  assert.strictEqual(seq[2].liveSkip, 'one-leg', 'overlapping 12:12 is not a second Live fill');
}
assert.strictEqual(summarizeOptionTrades([
  { rupees: 100, rupeesSource: 'option-live' },
  { rupees: 50, rupeesSource: 'option-live', liveSkip: 'one-leg' },
]).netRupees, 100);

{
  const { LiveBroker } = require('./live-broker');
  const broker = new LiveBroker({ pushEvent() {}, realOrders: false });
  broker.setLots('nifty-50', 1);
  broker.positions.set('nifty-50', {
    status: 'open',
    tradingSymbol: 'NIFTY2591525000CE',
    entryTime: '2026-09-11T10:15:00+0530',
    quantity: 65,
    entryPremium: 159.55,
    slTrigger: 121.1,
    slOrderId: 'SL1',
    direction: 'BUY',
  });
  const rows = liveTradesFromBroker({ broker });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].slTrigger, 121.1);
  assert.strictEqual(rows[0].slPrice, 121.1);
  assert.strictEqual(rows[0].slOn, true);
  assert.strictEqual(rows[0].instrumentName, 'Nifty 50');
  assert.strictEqual(rows[0].sideLabel, 'CE BUY');
  assert.strictEqual(rows[0].open, true);
}

{
  const { LiveBroker } = require('./live-broker');
  const broker = new LiveBroker({ pushEvent() {}, realOrders: false });
  broker.setLots('nifty-50', 1);
  broker.closedLegs = [{
    instrumentId: 'nifty-50',
    status: 'flat',
    tradingSymbol: 'NIFTY2591525000CE',
    entryTime: '2026-09-11T10:15:00+0530',
    quantity: 65,
    entryPremium: 159.55,
    exitPremium: 121.1,
    slTrigger: 121.1,
    closedBy: 'sl',
    direction: 'BUY',
  }];
  broker.positions.set('nifty-50', {
    status: 'open',
    tradingSymbol: 'NIFTY2591525050PE',
    entryTime: '2026-09-11T11:20:00+0530',
    quantity: 65,
    entryPremium: 140,
    slTrigger: 110,
    slOrderId: 'SL2',
    direction: 'BUY',
  });
  const rows = liveTradesFromBroker({ broker });
  assert.strictEqual(rows.length, 2, 'closed SL must stay on the board after the next fill');
  assert.strictEqual(rows[0].exitReason, 'sl');
  assert.ok(rows[0].netOptionPnlRs < 0, 'stopped leg must show a live loss');
  assert.strictEqual(rows[1].open, true);
}

{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const persist = require('./desk-live-persist');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-live-'));
  process.env.DESK_LIVE_DIR = dir;
  persist.save('sr', 'tab-reopen', {
    status: 'running',
    message: 'S/R Live on',
    events: [{ at: 't', action: 'SL', detail: 'Safety stop hit' }],
    broker: {
      closedOptionRs: -1950,
      closedLegs: [{ instrumentId: 'nifty-50', status: 'flat', closedBy: 'sl' }],
      positions: [['nifty-50', { status: 'flat', closedBy: 'sl', entryPremium: 150 }]],
      lotsByInstrument: [],
    },
  });
  const loaded = persist.load('sr', 'tab-reopen');
  assert.strictEqual(loaded.status, 'running');
  assert.strictEqual(loaded.events[0].action, 'SL');
  assert.strictEqual(loaded.broker.closedLegs[0].closedBy, 'sl');
}

console.log('sr-live.selftest: ok');
