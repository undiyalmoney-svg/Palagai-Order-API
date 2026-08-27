#!/usr/bin/env node
/**
 * PHASE 1/2 — consolidate the raw NSE downloads into a research dataset and
 * run every quality gate BEFORE any hypothesis is allowed to touch it.
 *
 * Normalises two bhavcopy formats into one schema keyed on ISIN (not symbol),
 * because symbols change over time and ISIN does not — that is what makes the
 * ticker-change gate possible at all.
 *
 * GATES (all must be inspected before PEAD is permitted):
 *   G1 duplicates            (isin,date) must be unique
 *   G2 calendar coverage     missing sessions vs the union trading calendar
 *   G3 survivorship          known-dead names must appear then stop
 *   G4 ticker changes        same ISIN, different symbol over time
 *   G5 corporate actions     large jumps flagged; CA file cross-reference
 *   G6 timestamps            announcements classified PRE/DURING/POST/UNKNOWN
 *   G7 look-ahead            entry must postdate the announcement timestamp
 *   G8 universe size by year does breadth shrink as we go back?
 *
 * Usage: node build-and-validate.js <DATADIR>
 */
const fs = require('fs');
const path = require('path');

const MARKET_OPEN = 9 * 60 + 15;   // 09:15 IST
const MARKET_CLOSE = 15 * 60 + 30; // 15:30 IST

function parseLegacy(txt) {
  // SYMBOL,SERIES,OPEN,HIGH,LOW,CLOSE,LAST,PREVCLOSE,TOTTRDQTY,TOTTRDVAL,TIMESTAMP,TOTALTRADES,ISIN,
  const out = [];
  const lines = txt.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const c = lines[i].split(',');
    if (c.length < 13) continue;
    if ((c[1] || '').trim() !== 'EQ') continue;      // cash equity only
    out.push({
      symbol: c[0].trim(), series: c[1].trim(), isin: (c[12] || '').trim(),
      open: +c[2], high: +c[3], low: +c[4], close: +c[5], prevclose: +c[7],
      vol: +c[8], val: +c[9],
    });
  }
  return out;
}
function parseNew(txt) {
  const lines = txt.split(/\r?\n/);
  if (!lines.length) return [];
  const hdr = lines[0].split(',').map((s) => s.trim());
  const ix = (n) => hdr.indexOf(n);
  const iSym = ix('TckrSymb'), iSrs = ix('SctySrs'), iIsin = ix('ISIN'),
    iO = ix('OpnPric'), iH = ix('HghPric'), iL = ix('LwPric'), iC = ix('ClsPric'),
    iP = ix('PrvsClsgPric'), iV = ix('TtlTradgVol'), iT = ix('TtlTrfVal'), iFi = ix('FinInstrmTp');
  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const c = lines[i].split(',');
    if (c.length < hdr.length - 4) continue;
    if (iFi >= 0 && (c[iFi] || '').trim() !== 'STK') continue;   // equities only
    if ((c[iSrs] || '').trim() !== 'EQ') continue;
    out.push({
      symbol: (c[iSym] || '').trim(), series: 'EQ', isin: (c[iIsin] || '').trim(),
      open: +c[iO], high: +c[iH], low: +c[iL], close: +c[iC], prevclose: +c[iP],
      vol: +c[iV], val: +c[iT],
    });
  }
  return out;
}

function main() {
  const DATA = process.argv[2];
  if (!DATA) { console.error('usage: build-and-validate.js <datadir>'); process.exit(1); }
  const RAW = path.join(DATA, 'full', 'raw');
  const files = fs.existsSync(RAW) ? fs.readdirSync(RAW).filter((f) => f.endsWith('.csv')).sort() : [];
  console.log('='.repeat(112));
  console.log('PHASE 1/2 — DATASET BUILD + QUALITY GATES');
  console.log('='.repeat(112));
  console.log(`bhavcopy files found: ${files.length}`);
  if (!files.length) { console.log('NO DATA — download incomplete.'); process.exit(0); }

  // ---- consolidate ----
  const bySym = new Map();     // isin -> Set(symbol)
  const rowsByIsin = new Map();// isin -> [{date,...}]
  const dates = [];
  let totalRows = 0, dupCount = 0;
  const seenKey = new Set();
  for (const f of files) {
    const date = f.replace('.csv', '');
    const txt = fs.readFileSync(path.join(RAW, f), 'utf8');
    const isNew = date > '2024-06-30';
    const recs = isNew ? parseNew(txt) : parseLegacy(txt);
    if (!recs.length) continue;
    dates.push(date);
    for (const r of recs) {
      if (!r.isin || !(r.close > 0)) continue;
      const k = `${r.isin}|${date}`;
      if (seenKey.has(k)) { dupCount += 1; continue; }
      seenKey.add(k);
      if (!rowsByIsin.has(r.isin)) rowsByIsin.set(r.isin, []);
      rowsByIsin.get(r.isin).push({ date, ...r });
      if (!bySym.has(r.isin)) bySym.set(r.isin, new Set());
      bySym.get(r.isin).add(r.symbol);
      totalRows += 1;
    }
  }
  dates.sort();
  console.log(`trading sessions: ${dates.length}  range ${dates[0]} .. ${dates[dates.length - 1]}`);
  console.log(`unique securities (ISIN): ${rowsByIsin.size}`);
  console.log(`total daily records: ${totalRows.toLocaleString()}`);

  // ---- G1 duplicates ----
  console.log(`\nG1 DUPLICATES  (isin,date): ${dupCount}  (${(100 * dupCount / Math.max(1, totalRows)).toFixed(4)}%)  ${dupCount === 0 ? 'PASS' : 'INSPECT'}`);

  // ---- G8 universe size by year (survivorship shape) ----
  console.log('\nG8 UNIVERSE SIZE BY YEAR (if this shrinks going back, survivorship is present)');
  const byYear = {};
  for (const [isin, rows] of rowsByIsin) {
    for (const r of rows) { const y = r.date.slice(0, 4); (byYear[y] ||= new Set()).add(isin); }
  }
  for (const y of Object.keys(byYear).sort()) {
    console.log(`  ${y}: ${byYear[y].size} securities`);
  }

  // ---- G3 survivorship: known dead names ----
  console.log('\nG3 SURVIVORSHIP — known delisted/failed companies (must appear, then STOP)');
  const deadNames = ['DHFL', 'JETAIRWAYS', 'RCOM', 'VIDEOIND', 'RELCAPITAL', 'ALOKTEXT', 'SINTEX', 'PMCFIN'];
  const symIndex = new Map(); // symbol -> isin
  for (const [isin, syms] of bySym) for (const s of syms) if (!symIndex.has(s)) symIndex.set(s, isin);
  let deadFound = 0;
  for (const nm of deadNames) {
    const isin = symIndex.get(nm);
    if (!isin) { console.log(`  ${nm.padEnd(12)} not in dataset`); continue; }
    const rows = rowsByIsin.get(isin);
    const first = rows[0].date, last = rows[rows.length - 1].date;
    const stopped = last < dates[dates.length - 1];
    if (stopped) deadFound += 1;
    console.log(`  ${nm.padEnd(12)} ${first} → ${last}  (${rows.length} sessions)  ${stopped ? 'STOPPED ✓' : 'still trading'}`);
  }
  console.log(`  → ${deadFound} of ${deadNames.length} confirmed to stop trading: ${deadFound > 0 ? 'SURVIVORSHIP-AWARE ✓' : 'FAIL'}`);

  // ---- G4 ticker changes ----
  console.log('\nG4 TICKER CHANGES (same ISIN, multiple symbols — continuity preserved via ISIN)');
  let changed = 0; const samples = [];
  for (const [isin, syms] of bySym) {
    if (syms.size > 1) { changed += 1; if (samples.length < 6) samples.push(`${[...syms].join(' → ')}`); }
  }
  console.log(`  securities with symbol changes: ${changed}`);
  samples.forEach((s) => console.log(`    ${s}`));

  // ---- G2 calendar coverage ----
  console.log('\nG2 CALENDAR COVERAGE');
  const gaps = [];
  for (let i = 1; i < dates.length; i += 1) {
    const d0 = new Date(dates[i - 1]), d1 = new Date(dates[i]);
    const days = (d1 - d0) / 86400000;
    if (days > 5) gaps.push(`${dates[i - 1]} → ${dates[i]} (${days}d)`);
  }
  console.log(`  sessions: ${dates.length}   gaps >5 calendar days: ${gaps.length}`);
  gaps.slice(0, 6).forEach((g) => console.log(`    ${g}`));

  // ---- G5 corporate-action candidates ----
  console.log('\nG5 CORPORATE-ACTION SCREEN (|close/prevclose-1| > 25% — likely split/bonus if extreme)');
  let bigJumps = 0, splitLike = 0;
  for (const [, rows] of rowsByIsin) {
    for (const r of rows) {
      if (!(r.prevclose > 0)) continue;
      const ch = r.close / r.prevclose - 1;
      if (Math.abs(ch) > 0.25) {
        bigJumps += 1;
        const ratio = r.close / r.prevclose;
        if ([0.5, 1 / 3, 0.25, 0.2, 0.1, 2 / 3].some((x) => Math.abs(ratio - x) < 0.02)) splitLike += 1;
      }
    }
  }
  console.log(`  moves >25%: ${bigJumps}   of which split-ratio-like: ${splitLike}`);
  console.log('  NOTE: bhavcopy PREVCLOSE is adjustment-aware on ex-dates for most actions,');
  console.log('        but an explicit CA file is still required to classify definitively.');

  // ---- announcements ----
  const annPath = path.join(DATA, 'ann_full', 'announcements.ndjson');
  if (!fs.existsSync(annPath)) { console.log('\nANNOUNCEMENTS: not yet downloaded.'); return; }
  const ann = fs.readFileSync(annPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  console.log(`\nANNOUNCEMENTS: ${ann.length.toLocaleString()} rows`);
  const results = ann.filter((r) => /financial result/i.test(r.desc || ''));
  console.log(`  results-tagged: ${results.length.toLocaleString()}`);

  // ---- G6 timestamp classification ----
  console.log('\nG6 TIMESTAMP CLASSIFICATION (IST)');
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  function parseAnDt(s) {
    // "05-Aug-2025 23:55:29"
    const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec((s || '').trim());
    if (!m) return null;
    const iso = `${m[3]}-${String(MON[m[2]] + 1).padStart(2, '0')}-${m[1]}`;
    return { iso, mins: +m[4] * 60 + +m[5] };
  }
  const cls = { PRE: 0, DURING: 0, POST: 0, UNKNOWN: 0 };
  const yearCount = {};
  for (const r of results) {
    const p = parseAnDt(r.an_dt);
    if (!p) { cls.UNKNOWN += 1; continue; }
    yearCount[p.iso.slice(0, 4)] = (yearCount[p.iso.slice(0, 4)] || 0) + 1;
    if (p.mins < MARKET_OPEN) cls.PRE += 1;
    else if (p.mins <= MARKET_CLOSE) cls.DURING += 1;
    else cls.POST += 1;
  }
  const tot = results.length || 1;
  for (const k of ['PRE', 'DURING', 'POST', 'UNKNOWN']) {
    console.log(`  ${k.padEnd(8)} ${String(cls[k]).padStart(7)}  ${(100 * cls[k] / tot).toFixed(1)}%`);
  }
  console.log('\n  results announcements by year:');
  for (const y of Object.keys(yearCount).sort()) console.log(`    ${y}: ${yearCount[y]}`);

  // ---- G7 look-ahead rule statement ----
  console.log('\nG7 LOOK-AHEAD RULE (enforced at event-construction time, not here)');
  console.log('  POST-close  filing → earliest executable entry = NEXT session open');
  console.log('  DURING-hours filing → price already moved; entry = NEXT session open (conservative)');
  console.log('  PRE-open    filing → entry = SAME session open');
  console.log('  UNKNOWN timestamp   → EXCLUDE from primary test (do not guess)');
}
main();
