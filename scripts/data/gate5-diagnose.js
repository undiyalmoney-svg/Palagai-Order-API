#!/usr/bin/env node
/**
 * G5 DIAGNOSIS — is the 79% unmatched rate real contamination, or an artifact
 * of ETFs sitting inside the "EQ" series?
 *
 * The unmatched extremes were all gold ETFs (GOLDBEES, AXISGOLD, QGOLDHALF...)
 * printing -99% on 1:100 unit subdivisions. ETFs are not operating companies,
 * never file financial results, and therefore can never be PEAD events — but
 * they do pollute the large-move population.
 *
 * This splits large moves into:
 *   (a) securities that have EVER filed a financial result  = real companies
 *   (b) everything else (ETFs, trusts, instruments)
 * and reports the unmatched rate separately. If (a) reconciles well, G5 passes
 * for the PEAD universe even though it fails across the raw instrument set.
 *
 * Streams both NDJSON files — they exceed Node's 512MB max string length.
 *
 * Usage: node gate5-diagnose.js <DATADIR>
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MON = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
const caIso = (s) => {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec((s || '').trim());
  if (!m) return null;
  const mo = MON[m[2].toUpperCase()];
  return mo === undefined ? null : `${m[3]}-${String(mo+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
};
function streamNdjson(file, onRow) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    rl.on('line', (l) => { if (l.trim()) { try { onRow(JSON.parse(l)); } catch (e) { /* skip */ } } });
    rl.on('close', resolve); rl.on('error', reject);
  });
}
function parseLegacy(t){const o=[];const L=t.split(/\r?\n/);for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<13)continue;if((c[1]||'').trim()!=='EQ')continue;o.push({sym:c[0].trim(),isin:(c[12]||'').trim(),cl:+c[5],pc:+c[7]});}return o;}
function parseNew(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());const ix=n=>h.indexOf(n);
 const a=ix('TckrSymb'),b=ix('SctySrs'),c2=ix('ISIN'),d=ix('ClsPric'),e=ix('PrvsClsgPric'),f=ix('FinInstrmTp');const o=[];
 for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
  o.push({sym:(c[a]||'').trim(),isin:(c[c2]||'').trim(),cl:+c[d],pc:+c[e]});}return o;}

async function main() {
  const DATA = process.argv[2];
  const RAW = path.join(DATA, 'full', 'raw');

  const caByIsin = new Map();
  await streamNdjson(path.join(DATA,'ca_full','corpactions.ndjson'), (r) => {
    const iso = caIso(r.exDate); if (!iso || !r.isin) return;
    if (!caByIsin.has(r.isin)) caByIsin.set(r.isin, []);
    caByIsin.get(r.isin).push(iso);
  });

  const resultFilers = new Set();
  let annRows = 0, resultRows = 0;
  await streamNdjson(path.join(DATA,'ann_full','announcements.ndjson'), (r) => {
    annRows += 1;
    if (/financial result/i.test(r.desc || '') && r.symbol) { resultFilers.add(r.symbol); resultRows += 1; }
  });

  console.log('='.repeat(112));
  console.log('G5 DIAGNOSIS — ETF contamination vs genuine company moves');
  console.log('='.repeat(112));
  console.log(`announcement rows streamed: ${annRows.toLocaleString()}  results-tagged: ${resultRows.toLocaleString()}`);
  console.log(`distinct symbols that ever filed a financial result: ${resultFilers.size.toLocaleString()}`);

  const files = fs.readdirSync(RAW).filter((f)=>f.endsWith('.csv')&&fs.statSync(path.join(RAW,f)).isFile()).sort();
  const dates = files.map((f)=>f.replace('.csv',''));
  const dIdx = new Map(dates.map((d,i)=>[d,i]));

  const moves = [];
  for (const fl of files) {
    const dt = fl.replace('.csv','');
    const t = fs.readFileSync(path.join(RAW, fl), 'utf8');
    for (const r of (dt > '2024-06-30' ? parseNew(t) : parseLegacy(t))) {
      if (!r.isin || !(r.pc>0) || !(r.cl>0)) continue;
      const ch = r.cl/r.pc - 1;
      if (Math.abs(ch) > 0.25) moves.push({ dt, isin:r.isin, sym:r.sym, ch: ch*100, ratio: r.cl/r.pc });
    }
  }

  let inCo=0,notCo=0,inCoUn=0,notCoUn=0;
  const unmatchedCo=[];
  for (const m of moves) {
    const isCo = resultFilers.has(m.sym);
    const arr = caByIsin.get(m.isin) || [];
    const mi = dIdx.get(m.dt);
    let hit=false;
    for (const iso of arr) { const ai=dIdx.get(iso); if (ai!==undefined && Math.abs(ai-mi)<=2) { hit=true; break; } }
    if (isCo) { inCo++; if(!hit){inCoUn++;unmatchedCo.push(m);} } else { notCo++; if(!hit)notCoUn++; }
  }
  console.log(`\nlarge moves (>25%): ${moves.length.toLocaleString()}`);
  console.log(`  RESULT-FILING companies : ${String(inCo).padStart(5)}   unmatched ${String(inCoUn).padStart(5)}  (${(100*inCoUn/Math.max(1,inCo)).toFixed(1)}%)`);
  console.log(`  non-filers (ETF/trust)  : ${String(notCo).padStart(5)}   unmatched ${String(notCoUn).padStart(5)}  (${(100*notCoUn/Math.max(1,notCo)).toFixed(1)}%)`);

  let rl2=0;
  for (const m of unmatchedCo) if ([0.5,1/3,0.25,0.2,0.1,2/3,0.75].some(x=>Math.abs(m.ratio-x)<0.02)) rl2++;
  console.log(`\n  of company-unmatched, split-ratio-like: ${rl2} (${(100*rl2/Math.max(1,inCoUn)).toFixed(1)}%)`);
  console.log('  worst company unmatched:');
  unmatchedCo.sort((a,b)=>a.ch-b.ch).slice(0,10).forEach((m)=>console.log(`    ${m.dt} ${String(m.sym).padEnd(12)} ${m.ch.toFixed(1)}%  ratio ${m.ratio.toFixed(3)}`));

  console.log('\nINTERPRETATION');
  console.log('  PEAD events can only occur in RESULT-FILING companies. The non-filer row');
  console.log('  (ETFs/trusts) is irrelevant to the event study but must be excluded from');
  console.log('  the universe so it cannot pollute market-wide statistics.');
}
main().catch((e)=>{console.error('ERR',e.message);process.exit(1);});
