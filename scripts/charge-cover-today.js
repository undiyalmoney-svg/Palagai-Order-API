/**
 * Charge-cover gate unit checks + 13 Aug 2026 Kite book counterfactual.
 * Run: node scripts/charge-cover-today.js
 */
const {
  evaluateChargeEntryGate,
  estimateRoundTripCharges,
} = require('../live/charge-entry-gate');
const { LIVE_GREEN_DNA } = require('../live/dna-live-green');

const ops = LIVE_GREEN_DNA.liveOps;
const rr = LIVE_GREEN_DNA.trap.targetRMultiple;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Fat monthly Bank CE with only min-risk (scalp) cannot pay 4× charges.
{
  const g = evaluateChargeEntryGate({
    instrumentId: 'bank-nifty',
    entryPremium: 644.1,
    quantity: 30,
    indexEntry: 57667,
    indexStop: 57667 - 8,
    indexTarget: 57667 + 8 * rr,
    targetRMultiple: rr,
    ops,
  });
  assert('Bank CE ₹644 min-risk 8pts skips (4× charges)', g.skip === true, JSON.stringify(g));
}

// Same fat premium with a real 3.5R trap (20pts) still keeps — don't kill Bank DNA.
{
  const g = evaluateChargeEntryGate({
    instrumentId: 'bank-nifty',
    entryPremium: 644.1,
    quantity: 30,
    indexEntry: 57667,
    indexStop: 57667 - 20,
    indexTarget: 57667 + 20 * rr,
    targetRMultiple: rr,
    ops,
  });
  assert('Bank CE ₹644 trap 20pts keeps', g.skip === false, JSON.stringify(g));
}

// Weak Bank scalp: cheap premium, expected ₹ cannot pay 4× charges.
{
  const g = evaluateChargeEntryGate({
    instrumentId: 'bank-nifty',
    entryPremium: 433.4,
    quantity: 30,
    indexEntry: 57667,
    indexStop: 57667 - 8,
    indexTarget: 57667 + 8 * rr,
    targetRMultiple: rr,
    ops,
  });
  assert('Bank PE min-risk 8pts skips (4× charges)', g.skip === true, JSON.stringify(g));
}

// Real trap Bank: risk 20pts, premium under cap → keep.
{
  const g = evaluateChargeEntryGate({
    instrumentId: 'bank-nifty',
    entryPremium: 280,
    quantity: 30,
    indexEntry: 57667,
    indexStop: 57667 - 20,
    indexTarget: 57667 + 20 * rr,
    targetRMultiple: rr,
    ops,
  });
  assert('Bank trap 20pts / ₹280 premium keeps', g.skip === false, JSON.stringify(g));
}

// Today's Nifty weekly CE-style premium with a 3.5R target → keep.
{
  const g = evaluateChargeEntryGate({
    instrumentId: 'nifty-50',
    entryPremium: 162.25,
    quantity: 65,
    indexEntry: 24399,
    indexStop: 24399 - 12,
    indexTarget: 24399 + 12 * rr,
    targetRMultiple: rr,
    ops,
  });
  assert('Nifty CE weekly keeps', g.skip === false, JSON.stringify(g));
}

console.log('\n--- 13 Aug Kite book (your 4 closed positions) ---');

const bankLegs = [
  { name: 'BANKNIFTY 57600 CE', buy: 644.1, sell: 640.95, qty: 30, gross: -94.5 },
  { name: 'BANKNIFTY 57600 CE', buy: 627.8, sell: 623.45, qty: 30, gross: -130.5 },
  { name: 'BANKNIFTY 57600 PE', buy: 433.4, sell: 435.05, qty: 30, gross: 49.5 },
];
const nifty = [
  { name: 'NIFTY 24350 CE', qty: 65, gross: 269.75, entry: 162.25, exit: 166.4 },
  { name: 'NIFTY 24350 PE', qty: 65, gross: 338.0, entry: 56.3, exit: 61.5 },
];

let keptGross = 0;
let keptCharges = 0;
let skippedGross = 0;
let skippedCharges = 0;

for (const t of bankLegs) {
  const charges = estimateRoundTripCharges({
    entryPrice: t.buy,
    exitPrice: t.sell,
    quantity: t.qty,
  }).totalRs;
  const g = evaluateChargeEntryGate({
    instrumentId: 'bank-nifty',
    entryPremium: t.buy,
    quantity: t.qty,
    indexEntry: 57667,
    indexStop: 57667 - 8,
    indexTarget: 57667 + 8 * rr,
    targetRMultiple: rr,
    ops,
  });
  const net = Math.round((t.gross - charges) * 100) / 100;
  console.log(
    `${g.skip ? 'SKIP' : 'KEEP'}  ${t.name}  gross ${t.gross}  charges ${charges}  net ${net}` +
      (g.skip ? `  (${g.reason})` : ''),
  );
  if (g.skip) {
    skippedGross += t.gross;
    skippedCharges += charges;
  } else {
    keptGross += t.gross;
    keptCharges += charges;
  }
}

for (const t of nifty) {
  const charges = estimateRoundTripCharges({
    entryPrice: t.entry,
    exitPrice: t.exit,
    quantity: t.qty,
  }).totalRs;
  const g = evaluateChargeEntryGate({
    instrumentId: 'nifty-50',
    entryPremium: t.entry,
    quantity: t.qty,
    indexEntry: 24399,
    indexStop: 24399 - 12,
    indexTarget: 24399 + 12 * rr,
    targetRMultiple: rr,
    ops,
  });
  const net = Math.round((t.gross - charges) * 100) / 100;
  console.log(
    `${g.skip ? 'SKIP' : 'KEEP'}  ${t.name}  gross ${t.gross}  charges ${charges}  net ${net}` +
      (g.skip ? `  (${g.reason})` : ''),
  );
  if (g.skip) {
    skippedGross += t.gross;
    skippedCharges += charges;
  } else {
    keptGross += t.gross;
    keptCharges += charges;
  }
}

const keptNet = Math.round((keptGross - keptCharges) * 100) / 100;
const allGross = 432.25;
const allChargesNote = 454.52;
console.log('\nKept gross        ', Math.round(keptGross * 100) / 100);
console.log('Kept charges      ', Math.round(keptCharges * 100) / 100);
console.log('KEPT NET (new DNA)', keptNet);
console.log('Skipped gross     ', Math.round(skippedGross * 100) / 100);
console.log('Actual day (old)  ', `gross ${allGross} − charges ${allChargesNote} ≈ ${Math.round((allGross - allChargesNote) * 100) / 100}`);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll assertions passed.');
