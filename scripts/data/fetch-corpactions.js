#!/usr/bin/env node
/**
 * NSE corporate-actions fetcher — required to close QUALITY GATE G5.
 *
 * WHY: the price series contains 2,145 single-day moves >25%. Some are genuine
 * crashes; some are MECHANICAL (a 1:5 split prints as -80%). A ratio heuristic
 * cannot tell them apart reliably, and for PEAD it matters directly — a bonus
 * issue landing near an announcement would masquerade as a violent earnings
 * reaction and contaminate the event study.
 *
 * The API returns exDate + isin + subject, which is exactly the join key and
 * classification text needed. Verified live before writing this file.
 *
 * Usage: node fetch-corpactions.js <FROM_YYYY-MM-DD> <TO_YYYY-MM-DD> <OUTDIR>
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
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(COOKIE ? { Cookie: COOKIE } : {}), ...headers },
      timeout: 60000,
    }, (res) => {
      const sc = res.headers['set-cookie'];
      if (sc) { const jar = sc.map((c) => c.split(';')[0]).join('; '); COOKIE = COOKIE ? `${COOKIE}; ${jar}` : jar; }
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    r.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ddmmyyyy = (iso) => { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; };
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

async function main() {
  const [, , FROM, TO, OUTDIR] = process.argv;
  if (!FROM || !TO || !OUTDIR) { console.error('usage: <from> <to> <outdir>'); process.exit(1); }
  fs.mkdirSync(OUTDIR, { recursive: true });
  await req(`${BASE}/`); await sleep(600);
  await req(`${BASE}/companies-listing/corporate-filings-actions`); await sleep(600);

  const out = fs.createWriteStream(path.join(OUTDIR, 'corpactions.ndjson'), { flags: 'a' });
  const seen = new Set();
  let cursor = FROM, total = 0, fails = 0, slice = 0;

  while (cursor <= TO) {
    const end = addDays(cursor, 59) > TO ? TO : addDays(cursor, 59);
    const url = `${BASE}/api/corporates-corporateActions?index=equities&from_date=${ddmmyyyy(cursor)}&to_date=${ddmmyyyy(end)}`;
    let ok = false;
    for (let a = 1; a <= 3 && !ok; a += 1) {
      try {
        const res = await req(url, { Accept: 'application/json', Referer: `${BASE}/companies-listing/corporate-filings-actions` });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const rows = JSON.parse(res.body);
        if (!Array.isArray(rows)) throw new Error('not array');
        for (const r of rows) {
          const k = `${r.isin}|${r.exDate}|${(r.subject || '').slice(0, 50)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.write(JSON.stringify({
            symbol: r.symbol || null, isin: r.isin || null, comp: r.comp || null,
            series: r.series || null, exDate: r.exDate || null, recDate: r.recDate || null,
            subject: (r.subject || '').trim(), faceVal: r.faceVal || null,
          }) + '\n');
          total += 1;
        }
        ok = true; slice += 1;
        if (slice % 10 === 0) console.error(`  ${cursor}  rows ${total}`);
      } catch (e) {
        if (a === 3) { fails += 1; console.error(`  FAIL ${cursor}..${end}: ${e.message}`); }
        else { await sleep(2500 * a); await req(`${BASE}/`); }
      }
    }
    await sleep(900);
    cursor = addDays(end, 1);
  }
  out.end();
  console.error(`\ndone. unique CA rows=${total} failed=${fails}`);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
