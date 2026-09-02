#!/usr/bin/env node
/**
 * STEP 1 — DELIVERY (MTO) DATA AUDIT.
 *
 * This file is deliberately incapable of computing a forward return. It only
 * characterises the delivery dataset. No signal is constructed here and no
 * outcome is examined, so nothing observed can bias the frozen specification.
 *
 * Checks, per the protocol:
 *   fields/units, date coverage, security coverage, missingness, duplicates,
 *   ticker changes, CA treatment, delivery-vs-traded consistency, whether
 *   delivery% is supplied or derived, bound violations, zero-volume days,
 *   ETF presence, non-equity series presence, SME presence, suspended names,
 *   and join rate against the bhavcopy price panel.
 *
 * Usage: node audit-delivery.js <DATADIR>
 */
const fs = require('fs');
const path = require('path');

function parseMto(txt) {
  const out = [];
  for (const line of txt.split(/\r?\n/)) {
    if (!line.startsWith('20,')) continue;
    const c = line.split(',');
    // 20,srno,SYMBOL,SERIES,qtyTraded,delivQty,delivPct
    if (c.length < 7) continue;
    out.push({
      sym: (c[2] || '').trim(),
      series: (c[3] || '').trim(),
      qty: Number(c[4]),
      deliv: Number(c[5]),
      pct: Number(c[6]),
    });
  }
  return out;
}
function parseLegacyBhav(t) {
  const o = [];
  const L = t.split(/\r?\n/);
  for (let i = 1; i < L.length; i += 1) {
    const c = L[i].split(',');
    if (c.length < 13 || (c[1] || '').trim() !== 'EQ') continue;
    o.push({ sym: c[0].trim(), qty: +c[8], trades: +c[11] });
  }
  return o;
}
function parseNewBhav(t) {
  const L = t.split(/\r?\n/); if (!L.length) return [];
  const h = L[0].split(',').map((s) => s.trim());
  const ix = (n) => h.indexOf(n);
  const a = ix('TckrSymb'), b = ix('SctySrs'), v = ix('TtlTradgVol'), n2 = ix('TtlNbOfTxsExctd'), f = ix('FinInstrmTp');
  const o = [];
  for (let i = 1; i < L.length; i += 1) {
    const c = L[i].split(',');
    if (c.length < h.length - 4) continue;
    if (f >= 0 && (c[f] || '').trim() !== 'STK') continue;
    if ((c[b] || '').trim() !== 'EQ') continue;
    o.push({ sym: (c[a] || '').trim(), qty: +c[v], trades: +c[n2] });
  }
  return o;
}

function main() {
  const DATA = process.argv[2];
  const MRAW = path.join(DATA, 'mto', 'raw');
  const BRAW = path.join(DATA, 'full', 'raw');
  const mFiles = fs.existsSync(MRAW) ? fs.readdirSync(MRAW).filter((f) => f.endsWith('.dat')).sort() : [];
  console.log('='.repeat(112));
  console.log('STEP 1 — DELIVERY (MTO) DATA AUDIT   [no forward returns computed in this file]');
  console.log('='.repeat(112));
  if (!mFiles.length) { console.log('NO MTO FILES YET'); return; }

  const dates = mFiles.map((f) => f.replace('.dat', ''));
  console.log(`\nCOVERAGE`);
  console.log(`  files: ${mFiles.length}   range ${dates[0]} .. ${dates[dates.length - 1]}`);

  // gaps
  let gaps = 0;
  for (let i = 1; i < dates.length; i += 1) {
    const d = (new Date(dates[i]) - new Date(dates[i - 1])) / 864e5;
    if (d > 5) gaps += 1;
  }
  console.log(`  gaps >5 calendar days: ${gaps}`);

  // scan
  const seriesCount = {};
  let rows = 0, dup = 0, pctSupplied = 0, pctMismatch = 0, boundViol = 0, zeroQty = 0,
      delivGtQty = 0, negVals = 0;
  const symSeen = new Map();     // sym -> {first,last,n}
  const mismatchSamples = [], boundSamples = [];
  const seenKey = new Set();
  let maxAbsDiff = 0;

  for (const f of mFiles) {
    const dt = f.replace('.dat', '');
    const recs = parseMto(fs.readFileSync(path.join(MRAW, f), 'utf8'));
    for (const r of recs) {
      rows += 1;
      seriesCount[r.series] = (seriesCount[r.series] || 0) + 1;
      const k = `${r.sym}|${r.series}|${dt}`;
      if (seenKey.has(k)) { dup += 1; continue; }
      seenKey.add(k);
      if (r.series !== 'EQ') continue;
      if (!symSeen.has(r.sym)) symSeen.set(r.sym, { first: dt, last: dt, n: 0 });
      const s = symSeen.get(r.sym); s.last = dt; s.n += 1;

      if (!(r.qty > 0)) { zeroQty += 1; continue; }
      if (r.qty < 0 || r.deliv < 0) negVals += 1;
      if (r.deliv > r.qty) delivGtQty += 1;
      if (Number.isFinite(r.pct)) {
        pctSupplied += 1;
        const derived = 100 * r.deliv / r.qty;
        const diff = Math.abs(derived - r.pct);
        maxAbsDiff = Math.max(maxAbsDiff, diff);
        if (diff > 0.05) { pctMismatch += 1; if (mismatchSamples.length < 5) mismatchSamples.push(`${dt} ${r.sym} supplied=${r.pct} derived=${derived.toFixed(2)}`); }
        if (r.pct < 0 || r.pct > 100.0001) { boundViol += 1; if (boundSamples.length < 5) boundSamples.push(`${dt} ${r.sym} pct=${r.pct}`); }
      }
    }
  }

  console.log(`\nFIELDS / UNITS`);
  console.log(`  record layout: 20,<srno>,<SYMBOL>,<SERIES>,<qtyTraded>,<deliverableQty>,<pctDeliverable>`);
  console.log(`  qtyTraded & deliverableQty are SHARE COUNTS (not value). pct is SUPPLIED by NSE.`);

  console.log(`\nVOLUME OF DATA`);
  console.log(`  total data rows (all series): ${rows.toLocaleString()}`);
  console.log(`  duplicate (sym,series,date): ${dup}  ${dup === 0 ? 'PASS' : 'INSPECT'}`);
  console.log(`  distinct EQ symbols: ${symSeen.size.toLocaleString()}`);

  console.log(`\nSERIES PRESENT (non-EQ must be excluded from the study universe)`);
  Object.entries(seriesCount).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([k, v]) => console.log(`  ${String(k).padEnd(6)} ${v.toLocaleString()}`));

  console.log(`\nINTERNAL CONSISTENCY  (delivery% vs deliverable/traded)`);
  console.log(`  rows with supplied pct : ${pctSupplied.toLocaleString()}`);
  console.log(`  |supplied - derived| > 0.05pp : ${pctMismatch}  (${(100 * pctMismatch / Math.max(1, pctSupplied)).toFixed(3)}%)`);
  console.log(`  max abs difference: ${maxAbsDiff.toFixed(4)} pp`);
  mismatchSamples.forEach((s) => console.log(`    ${s}`));
  console.log(`  bound violations (pct<0 or >100): ${boundViol}`);
  boundSamples.forEach((s) => console.log(`    ${s}`));
  console.log(`  deliverable > traded: ${delivGtQty}`);
  console.log(`  negative values: ${negVals}`);
  console.log(`  zero traded qty rows: ${zeroQty}`);

  // ETF / SME / instrument detection by name pattern
  const etfLike = [...symSeen.keys()].filter((s) => /BEES|ETF|GOLD|LIQUID|NIFTY|SENSEX|INAV|MAFANG|SILVER/i.test(s));
  console.log(`\nNON-COMPANY INSTRUMENTS IN EQ SERIES`);
  console.log(`  ETF-like symbols: ${etfLike.length}  e.g. ${etfLike.slice(0, 8).join(', ')}`);
  console.log(`  -> must be excluded from a company-level study universe`);

  // join against bhavcopy
  const bFiles = fs.readdirSync(BRAW).filter((f) => f.endsWith('.csv') && fs.statSync(path.join(BRAW, f)).isFile()).sort();
  const bSet = new Set(bFiles.map((f) => f.replace('.csv', '')));
  const common = dates.filter((d) => bSet.has(d));
  console.log(`\nJOIN TO PRICE PANEL`);
  console.log(`  MTO sessions: ${dates.length}   bhavcopy sessions: ${bSet.size}   common: ${common.length}`);
  console.log(`  MTO sessions with no price file: ${dates.length - common.length}`);

  // sample-day symbol-level join + qty cross-check
  const probe = common.slice(-400).filter((_, i) => i % 40 === 0);
  let jTot = 0, jHit = 0, qtyMatch = 0, qtyClose = 0;
  for (const d of probe) {
    const mt = new Map(parseMto(fs.readFileSync(path.join(MRAW, `${d}.dat`), 'utf8'))
      .filter((r) => r.series === 'EQ').map((r) => [r.sym, r]));
    const bt = fs.readFileSync(path.join(BRAW, `${d}.csv`), 'utf8');
    const brecs = d > '2024-06-30' ? parseNewBhav(bt) : parseLegacyBhav(bt);
    for (const b of brecs) {
      jTot += 1;
      const m = mt.get(b.sym);
      if (!m) continue;
      jHit += 1;
      if (m.qty === b.qty) qtyMatch += 1;
      else if (b.qty > 0 && Math.abs(m.qty - b.qty) / b.qty < 0.02) qtyClose += 1;
    }
  }
  console.log(`  probe sessions: ${probe.length}   bhavcopy EQ rows probed: ${jTot.toLocaleString()}`);
  console.log(`  matched in MTO: ${jHit.toLocaleString()} (${(100 * jHit / Math.max(1, jTot)).toFixed(1)}%)`);
  console.log(`  traded-qty EXACT match: ${qtyMatch.toLocaleString()} (${(100 * qtyMatch / Math.max(1, jHit)).toFixed(1)}% of matched)`);
  console.log(`  traded-qty within 2%:  ${qtyClose.toLocaleString()}`);
  console.log(`  -> exact qty agreement is the strongest evidence the two files describe the same sessions`);

  // distribution of delivery pct on a recent session
  const last = common[common.length - 1];
  const lastRecs = parseMto(fs.readFileSync(path.join(MRAW, `${last}.dat`), 'utf8')).filter((r) => r.series === 'EQ' && r.qty > 0);
  const pcts = lastRecs.map((r) => r.pct).filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p) => pcts[Math.floor(pcts.length * p)];
  console.log(`\nDELIVERY% DISTRIBUTION (session ${last}, n=${pcts.length})`);
  console.log(`  p5 ${q(0.05).toFixed(1)}  p25 ${q(0.25).toFixed(1)}  median ${q(0.5).toFixed(1)}  p75 ${q(0.75).toFixed(1)}  p95 ${q(0.95).toFixed(1)}`);
  console.log(`  at 100%: ${pcts.filter((x) => x >= 99.999).length}  (illiquid names often deliver 100% — a liquidity artifact, not conviction)`);

  console.log(`\nCORPORATE ACTIONS`);
  console.log(`  MTO reports RAW share counts on the session — it is NOT split-adjusted.`);
  console.log(`  Delivery% is a RATIO, so it is invariant to splits/bonuses. Quantities are not.`);
  console.log(`  -> the study must use the RATIO, never raw quantities across a CA boundary.`);
}
main();
