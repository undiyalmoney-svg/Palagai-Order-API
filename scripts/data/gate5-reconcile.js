#!/usr/bin/env node
/**
 * QUALITY GATE G5 — reconcile large price moves against actual corporate actions.
 *
 * PROBLEM: the price series contains ~2,145 single-session moves >25%. A 1:5
 * split prints as -80% and is NOT a market event. For PEAD this is not cosmetic:
 * a bonus issue landing near a results filing would masquerade as a violent
 * earnings reaction and contaminate the event study.
 *
 * METHOD: join every large move to the NSE corporate-actions feed on
 * (ISIN, exDate within +/-2 sessions) and classify by the `subject` text.
 * Classes: SPLIT / BONUS / RIGHTS / MERGER-DEMERGER / DIVIDEND / OTHER-CA /
 *          UNMATCHED.
 *
 * DISCIPLINE: UNMATCHED is NOT assumed genuine. It is reported separately and,
 * for the PEAD event study, treated as SUSPECT and excluded from the primary
 * sample unless independently corroborated. Absence of a matching record is
 * evidence of nothing.
 *
 * Usage: node gate5-reconcile.js <DATADIR>
 */
const fs = require('fs');
const path = require('path');

const MON = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
function caDateToIso(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec((s || '').trim());
  if (!m) return null;
  const mo = MON[m[2].toUpperCase()];
  if (mo === undefined) return null;
  return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function parseLegacy(txt) {
  const out = []; const lines = txt.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const c = lines[i].split(',');
    if (c.length < 13) continue;
    if ((c[1] || '').trim() !== 'EQ') continue;
    out.push({ symbol: c[0].trim(), isin: (c[12] || '').trim(), close: +c[5], prevclose: +c[7], val: +c[9] });
  }
  return out;
}
function parseNew(txt) {
  const lines = txt.split(/\r?\n/); if (!lines.length) return [];
  const hdr = lines[0].split(',').map((s) => s.trim());
  const ix = (n) => hdr.indexOf(n);
  const iSym=ix('TckrSymb'),iSrs=ix('SctySrs'),iIsin=ix('ISIN'),iC=ix('ClsPric'),iP=ix('PrvsClsgPric'),iT=ix('TtlTrfVal'),iFi=ix('FinInstrmTp');
  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const c = lines[i].split(',');
    if (c.length < hdr.length - 4) continue;
    if (iFi >= 0 && (c[iFi] || '').trim() !== 'STK') continue;
    if ((c[iSrs] || '').trim() !== 'EQ') continue;
    out.push({ symbol: (c[iSym]||'').trim(), isin: (c[iIsin]||'').trim(), close: +c[iC], prevclose: +c[iP], val: +c[iT] });
  }
  return out;
}

function classify(subject) {
  const s = (subject || '').toLowerCase();
  if (/split|sub-division|subdivision|face value/.test(s)) return 'SPLIT';
  if (/bonus/.test(s)) return 'BONUS';
  if (/rights/.test(s)) return 'RIGHTS';
  if (/amalgamat|merger|demerger|scheme of arrangement|spin/.test(s)) return 'MERGER-DEMERGER';
  if (/dividend/.test(s)) return 'DIVIDEND';
  return 'OTHER-CA';
}

function main() {
  const DATA = process.argv[2];
  const RAW = path.join(DATA, 'full', 'raw');
  const caPath = path.join(DATA, 'ca_full', 'corpactions.ndjson');
  if (!fs.existsSync(caPath)) { console.log('corporate actions not downloaded yet'); process.exit(0); }

  // --- load corporate actions, index by isin -> [{iso, cls, subject}] ---
  const caByIsin = new Map();
  let caRows = 0, caBadDate = 0;
  for (const line of fs.readFileSync(caPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch (e) { continue; }
    caRows += 1;
    const iso = caDateToIso(r.exDate);
    if (!iso || !r.isin) { caBadDate += 1; continue; }
    if (!caByIsin.has(r.isin)) caByIsin.set(r.isin, []);
    caByIsin.get(r.isin).push({ iso, cls: classify(r.subject), subject: r.subject, symbol: r.symbol });
  }
  console.log('='.repeat(112));
  console.log('GATE G5 — LARGE-MOVE / CORPORATE-ACTION RECONCILIATION');
  console.log('='.repeat(112));
  console.log(`corporate-action rows: ${caRows.toLocaleString()}  (unparseable exDate: ${caBadDate})`);
  console.log(`securities with >=1 CA: ${caByIsin.size.toLocaleString()}`);
  const clsTotals = {};
  for (const [, arr] of caByIsin) for (const a of arr) clsTotals[a.cls] = (clsTotals[a.cls] || 0) + 1;
  console.log('CA type mix: ' + Object.entries(clsTotals).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join('  '));

  // --- scan price series for large moves ---
  const files = fs.readdirSync(RAW).filter((f) => f.endsWith('.csv') && fs.statSync(path.join(RAW, f)).isFile()).sort();
  const dates = files.map((f) => f.replace('.csv', ''));
  const dateIdx = new Map(dates.map((d, i) => [d, i]));

  const moves = [];
  for (const f of files) {
    const date = f.replace('.csv', '');
    const txt = fs.readFileSync(path.join(RAW, f), 'utf8');
    const recs = date > '2024-06-30' ? parseNew(txt) : parseLegacy(txt);
    for (const r of recs) {
      if (!r.isin || !(r.prevclose > 0) || !(r.close > 0)) continue;
      const ch = r.close / r.prevclose - 1;
      if (Math.abs(ch) > 0.25) moves.push({ date, isin: r.isin, symbol: r.symbol, ch: ch * 100, ratio: r.close / r.prevclose, val: r.val });
    }
  }
  console.log(`\nlarge moves (|1-day change| > 25%): ${moves.length.toLocaleString()}`);

  // --- match: CA exDate within +/-2 SESSIONS of the move ---
  const tally = {}; const unmatched = [];
  for (const m of moves) {
    const arr = caByIsin.get(m.isin) || [];
    const mi = dateIdx.get(m.date);
    let best = null;
    for (const a of arr) {
      const ai = dateIdx.get(a.iso);
      if (ai === undefined) continue;
      if (Math.abs(ai - mi) <= 2) { best = a; break; }
    }
    const key = best ? best.cls : 'UNMATCHED';
    tally[key] = (tally[key] || 0) + 1;
    if (!best) unmatched.push(m);
  }
  console.log('\nCLASSIFICATION OF LARGE MOVES');
  const totalMoves = moves.length || 1;
  for (const [k, v] of Object.entries(tally).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${k.padEnd(18)} ${String(v).padStart(6)}  ${(100*v/totalMoves).toFixed(1)}%`);
  }
  const mechanical = (tally.SPLIT||0)+(tally.BONUS||0)+(tally.RIGHTS||0)+(tally['MERGER-DEMERGER']||0);
  console.log(`\n  MECHANICAL (split/bonus/rights/merger): ${mechanical}  (${(100*mechanical/totalMoves).toFixed(1)}%)`);
  console.log(`  UNMATCHED: ${tally.UNMATCHED||0}  (${(100*(tally.UNMATCHED||0)/totalMoves).toFixed(1)}%)`);
  console.log('  → UNMATCHED is NOT assumed genuine. Treated as SUSPECT and excluded from');
  console.log('    the PEAD primary sample. Absence of a record is evidence of nothing.');

  // --- how many unmatched are split-ratio-like (i.e. probably a missing CA record)? ---
  let ratioLike = 0;
  for (const m of unmatched) {
    if ([0.5, 1/3, 0.25, 0.2, 0.1, 2/3, 0.75].some((x) => Math.abs(m.ratio - x) < 0.02)) ratioLike += 1;
  }
  console.log(`\n  of UNMATCHED, ratio-like (suspect missing CA record): ${ratioLike}`);
  console.log('  sample unmatched extreme moves:');
  unmatched.sort((a,b)=>a.ch-b.ch).slice(0,8).forEach((m)=>console.log(`    ${m.date} ${String(m.symbol).padEnd(12)} ${m.ch.toFixed(1)}%  ratio ${m.ratio.toFixed(3)}`));

  // --- G5 verdict ---
  const unmatchedPct = 100*(tally.UNMATCHED||0)/totalMoves;
  console.log('\nG5 VERDICT:');
  if (mechanical > 0 && unmatchedPct < 60) {
    console.log('  PASS (conditional) — mechanical adjustments are identifiable and will be');
    console.log('  excluded by exDate join. UNMATCHED moves are quarantined, not assumed real.');
  } else {
    console.log('  FAIL — corporate actions cannot reliably separate mechanical from genuine moves.');
  }
}
main();
