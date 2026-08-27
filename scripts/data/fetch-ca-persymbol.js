#!/usr/bin/env node
/**
 * PER-SYMBOL corporate-actions refetch — the fix for GATE G5.
 *
 * WHY THIS EXISTS: the date-range endpoint
 *   /api/corporates-corporateActions?from_date=..&to_date=..
 * silently OMITS records. Demonstrated: KAMDHENU returns 13 rows across a full
 * 2015-2026 date-range sweep but 20 rows when queried by symbol, and the
 * missing rows include the 08-Jan-2025 face-value split that exactly explains
 * an unmatched -90.7% price move. Same pattern confirmed for SIGACHI
 * (09-Oct-2023 split -> -90.3% move) and ROLEXRINGS (17-Oct-2025 -> -90.5%).
 *
 * Truncation was ruled out first: a 60-day slice returned 959 rows and four
 * 15-day slices summed to exactly 959, so the loss is not a row cap — the
 * date-range filter itself is incomplete.
 *
 * The per-symbol endpoint returns full history (KAMDHENU back to 2008), so we
 * re-fetch per symbol for every security that ever filed a financial result —
 * i.e. the entire PEAD-eligible universe.
 *
 * Usage: node fetch-ca-persymbol.js <SYMBOLS_FILE> <OUTDIR>
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BASE = 'https://www.nseindia.com';
const CONCURRENCY = 3;
let COOKIE = '';

function req(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = https.get(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(COOKIE ? { Cookie: COOKIE } : {}), ...headers },
      timeout: 45000,
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

async function main() {
  const [, , SYMFILE, OUTDIR] = process.argv;
  if (!SYMFILE || !OUTDIR) { console.error('usage: <symbols file> <outdir>'); process.exit(1); }
  fs.mkdirSync(OUTDIR, { recursive: true });
  const outPath = path.join(OUTDIR, 'ca_persymbol.ndjson');

  // resume support: skip symbols already fetched
  const done = new Set();
  if (fs.existsSync(outPath)) {
    for (const l of fs.readFileSync(outPath, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { const r = JSON.parse(l); if (r.__sym) done.add(r.__sym); } catch (e) { /* skip */ }
    }
  }
  const symbols = fs.readFileSync(SYMFILE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean).filter((s) => !done.has(s));
  console.error(`symbols to fetch: ${symbols.length} (already done: ${done.size})`);

  await req(`${BASE}/`); await sleep(700);
  await req(`${BASE}/companies-listing/corporate-filings-actions`); await sleep(700);

  const out = fs.createWriteStream(outPath, { flags: 'a' });
  let done2 = 0, rows = 0, fails = 0;

  async function worker(list) {
    for (const sym of list) {
      let ok = false;
      for (let a = 1; a <= 3 && !ok; a += 1) {
        try {
          const res = await req(`${BASE}/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(sym)}`, {
            Accept: 'application/json', Referer: `${BASE}/companies-listing/corporate-filings-actions`,
          });
          if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
          const arr = JSON.parse(res.body);
          if (!Array.isArray(arr)) throw new Error('not array');
          // marker row so resume knows this symbol completed (even if 0 actions)
          out.write(JSON.stringify({ __sym: sym, __n: arr.length }) + '\n');
          for (const r of arr) {
            out.write(JSON.stringify({
              symbol: r.symbol || sym, isin: r.isin || null, comp: r.comp || null,
              series: r.series || null, exDate: r.exDate || null, recDate: r.recDate || null,
              subject: (r.subject || '').trim(), faceVal: r.faceVal || null,
            }) + '\n');
            rows += 1;
          }
          ok = true;
        } catch (e) {
          if (a === 3) { fails += 1; }
          else { await sleep(2000 * a); }
        }
      }
      done2 += 1;
      if (done2 % 100 === 0) console.error(`  ${done2}/${symbols.length}  rows=${rows} fails=${fails}`);
      await sleep(700);
    }
  }

  const chunks = Array.from({ length: CONCURRENCY }, () => []);
  symbols.forEach((s, i) => chunks[i % CONCURRENCY].push(s));
  await Promise.all(chunks.map(worker));
  out.end();
  console.error(`\ndone. symbols=${done2} ca_rows=${rows} failures=${fails}`);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
