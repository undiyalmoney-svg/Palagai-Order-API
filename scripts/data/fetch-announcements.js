#!/usr/bin/env node
/**
 * NSE corporate-announcements fetcher — the EVENT DATE + TIMESTAMP source.
 *
 * WHY THIS MATTERS FOR PEAD:
 *   period end  != announcement date != announcement timestamp
 *   Using period end injects ~25 days of look-ahead. Using the date without
 *   the time cannot tell you whether the filing landed intraday (price already
 *   moved by that close) or post-close (entry must be next open). The NSE
 *   `an_dt` field carries second-level precision, so both are resolvable.
 *
 * Verified before writing: the API responds for 2016/2019/2022 windows with
 * timestamps like "05-May-2016 20:49:00", and returns 77-106 results-tagged
 * filings per 5-day window during reporting season.
 *
 * Fetches in <=30-day slices (the API degrades on long ranges), with a cookie
 * handshake and polite pacing. Stores RAW rows; classification happens later
 * so the raw capture stays auditable.
 *
 * Usage: node fetch-announcements.js <FROM_YYYY-MM-DD> <TO_YYYY-MM-DD> <OUTDIR>
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BASE = 'https://www.nseindia.com';
let COOKIE = '';

function req(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = https.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        ...(COOKIE ? { Cookie: COOKIE } : {}),
        ...headers,
      },
      timeout: 60000,
    }, (res) => {
      const sc = res.headers['set-cookie'];
      if (sc) {
        const jar = sc.map((c) => c.split(';')[0]).join('; ');
        COOKIE = COOKIE ? `${COOKIE}; ${jar}` : jar;
      }
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    r.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ddmmyyyy(iso) { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; }
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

async function main() {
  const [, , FROM, TO, OUTDIR] = process.argv;
  if (!FROM || !TO || !OUTDIR) { console.error('usage: <from> <to> <outdir>'); process.exit(1); }
  fs.mkdirSync(OUTDIR, { recursive: true });

  // cookie handshake
  await req(`${BASE}/`);
  await sleep(600);
  await req(`${BASE}/companies-listing/corporate-filings-announcements`);
  await sleep(600);

  let cursor = FROM, sliceNo = 0, totalRows = 0, failures = 0;
  const seen = new Set();
  const out = fs.createWriteStream(path.join(OUTDIR, 'announcements.ndjson'), { flags: 'a' });

  while (cursor <= TO) {
    const end = addDays(cursor, 29) > TO ? TO : addDays(cursor, 29);
    const url = `${BASE}/api/corporate-announcements?index=equities&from_date=${ddmmyyyy(cursor)}&to_date=${ddmmyyyy(end)}`;
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt += 1) {
      try {
        const res = await req(url, {
          Accept: 'application/json',
          Referer: `${BASE}/companies-listing/corporate-filings-announcements`,
        });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const rows = JSON.parse(res.body);
        if (!Array.isArray(rows)) throw new Error('not an array');
        let added = 0;
        for (const r of rows) {
          // dedupe on symbol + timestamp + description
          const k = `${r.symbol}|${r.an_dt}|${(r.desc || '').slice(0, 40)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.write(JSON.stringify({
            symbol: r.symbol || null,
            an_dt: r.an_dt || null,            // EXACT TIMESTAMP, preserved verbatim
            sort_date: r.sort_date || null,
            desc: r.desc || null,
            attchmntText: r.attchmntText || null,
            attchmntFile: r.attchmntFile || null,
            smIndustry: r.smIndustry || null,
            slice: `${cursor}..${end}`,
          }) + '\n');
          added += 1;
        }
        totalRows += added;
        ok = true;
        sliceNo += 1;
        if (sliceNo % 12 === 0) console.error(`  ${cursor}  rows so far ${totalRows}`);
      } catch (e) {
        if (attempt === 3) { failures += 1; console.error(`  FAIL ${cursor}..${end}: ${e.message}`); }
        else { await sleep(2500 * attempt); await req(`${BASE}/`); }
      }
    }
    await sleep(900);
    cursor = addDays(end, 1);
  }
  out.end();
  console.error(`\ndone. unique rows=${totalRows}  failed slices=${failures}`);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
