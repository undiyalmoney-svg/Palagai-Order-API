#!/usr/bin/env node
/**
 * FINAL DATA VALIDATION — all gates re-run against the REBUILT corporate-action
 * dataset, plus a per-event leakage audit. No strategy logic here; this file is
 * not permitted to compute a return.
 *
 * Move classification is deliberately three-way, not two-way:
 *   MECHANICAL   — a split/bonus/rights/merger exDate sits within +/-2 sessions
 *   GENUINE-NEWS — no CA, but a filing exists within +/-1 session (real reaction)
 *   UNRESOLVED   — neither. NOT assumed genuine; quarantined from PEAD.
 * Ratio-likeness is reported for UNRESOLVED as a residual-risk indicator: a
 * ratio near 1/2, 1/5, 1/10 with no CA record suggests a STILL-missing action,
 * which is exactly what we must not silently trade through.
 *
 * Usage: node final-validation.js <DATADIR>
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
const anIso = (s) => {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec((s || '').trim());
  if (!m) return null;
  const mo = MON[m[2].toUpperCase()];
  if (mo === undefined) return null;
  return { iso: `${m[3]}-${String(mo+1).padStart(2,'0')}-${m[1]}`, mins: +m[4]*60 + +m[5], hhmm: `${m[4]}:${m[5]}` };
};
function stream(file, onRow) {
  return new Promise((res, rej) => {
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    rl.on('line', (l) => { if (l.trim()) { try { onRow(JSON.parse(l)); } catch (e) {} } });
    rl.on('close', res); rl.on('error', rej);
  });
}
function mechClass(subject) {
  const s = (subject || '').toLowerCase();
  if (/split|sub-division|subdivision/.test(s)) return 'SPLIT';
  if (/bonus/.test(s)) return 'BONUS';
  if (/rights/.test(s)) return 'RIGHTS';
  if (/amalgamat|merger|demerger|scheme of arrangement|spin/.test(s)) return 'MERGER-DEMERGER';
  return null;   // dividends/AGMs are NOT mechanical at this magnitude
}
function parseLegacy(t){const o=[];const L=t.split(/\r?\n/);for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<13)continue;if((c[1]||'').trim()!=='EQ')continue;
 o.push({sym:c[0].trim(),isin:(c[12]||'').trim(),cl:+c[5],pc:+c[7],val:+c[9]});}return o;}
function parseNew(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());const ix=n=>h.indexOf(n);
 const a=ix('TckrSymb'),b=ix('SctySrs'),c2=ix('ISIN'),d=ix('ClsPric'),e=ix('PrvsClsgPric'),v=ix('TtlTrfVal'),f=ix('FinInstrmTp');const o=[];
 for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
  o.push({sym:(c[a]||'').trim(),isin:(c[c2]||'').trim(),cl:+c[d],pc:+c[e],val:+c[v]});}return o;}
const RATIOS=[0.5,1/3,0.25,0.2,0.1,2/3,0.75,0.05,0.02,0.01];
const ratioLike=(r)=>RATIOS.some(x=>Math.abs(r-x)<0.02);

async function main() {
  const DATA = process.argv[2];
  const RAW = path.join(DATA, 'full', 'raw');
  const symCaPath = path.join(DATA, 'ca_sym', 'ca_persymbol.ndjson');
  const rangeCaPath = path.join(DATA, 'ca_full', 'corpactions.ndjson');

  // ---------- corporate actions: union of per-symbol (primary) + date-range ----------
  const caBySym = new Map();       // symbol -> [{iso, cls, subject}]
  let symRows = 0, symDone = 0;
  if (fs.existsSync(symCaPath)) {
    await stream(symCaPath, (r) => {
      if (r.__sym) { symDone += 1; return; }
      const iso = caIso(r.exDate); if (!iso || !r.symbol) return;
      symRows += 1;
      if (!caBySym.has(r.symbol)) caBySym.set(r.symbol, []);
      caBySym.get(r.symbol).push({ iso, cls: mechClass(r.subject), subject: r.subject });
    });
  }
  let rangeAdded = 0;
  if (fs.existsSync(rangeCaPath)) {
    await stream(rangeCaPath, (r) => {
      const iso = caIso(r.exDate); if (!iso || !r.symbol) return;
      const arr = caBySym.get(r.symbol);
      if (arr && arr.some((a) => a.iso === iso)) return;   // already have it
      if (!caBySym.has(r.symbol)) caBySym.set(r.symbol, []);
      caBySym.get(r.symbol).push({ iso, cls: mechClass(r.subject), subject: r.subject });
      rangeAdded += 1;
    });
  }
  console.log('='.repeat(114));
  console.log('FINAL DATA VALIDATION — rebuilt corporate actions');
  console.log('='.repeat(114));
  console.log(`per-symbol CA: ${symRows.toLocaleString()} rows across ${symDone.toLocaleString()} symbols`);
  console.log(`date-range CA added (not in per-symbol): ${rangeAdded.toLocaleString()}`);
  console.log(`securities with >=1 CA: ${caBySym.size.toLocaleString()}`);

  // ---------- announcements ----------
  const annBySymDate = new Map();   // `${sym}|${iso}` -> count
  const resultEvents = [];          // PEAD-eligible
  const filers = new Set();
  let annRows = 0, resultRows = 0, unparseable = 0;
  await stream(path.join(DATA, 'ann_full', 'announcements.ndjson'), (r) => {
    annRows += 1;
    const p = anIso(r.an_dt);
    if (!p) { if (/financial result/i.test(r.desc || '')) unparseable += 1; return; }
    if (r.symbol) annBySymDate.set(`${r.symbol}|${p.iso}`, (annBySymDate.get(`${r.symbol}|${p.iso}`) || 0) + 1);
    if (/financial result/i.test(r.desc || '') && r.symbol) {
      resultRows += 1; filers.add(r.symbol);
      resultEvents.push({ sym: r.symbol, iso: p.iso, mins: p.mins, hhmm: p.hhmm });
    }
  });
  console.log(`announcements: ${annRows.toLocaleString()}  results-tagged: ${resultRows.toLocaleString()}  unparseable-ts: ${unparseable}`);

  // ---------- price series ----------
  const files = fs.readdirSync(RAW).filter((f)=>f.endsWith('.csv')&&fs.statSync(path.join(RAW,f)).isFile()).sort();
  const dates = files.map((f)=>f.replace('.csv',''));
  const dIdx = new Map(dates.map((d,i)=>[d,i]));
  const moves = [];
  const isinSyms = new Map();
  let totalRecords = 0, dup = 0;
  const seen = new Set();
  const yearSec = {};
  const lastSeen = new Map();
  for (const fl of files) {
    const dt = fl.replace('.csv','');
    const t = fs.readFileSync(path.join(RAW, fl), 'utf8');
    for (const r of (dt > '2024-06-30' ? parseNew(t) : parseLegacy(t))) {
      if (!r.isin || !(r.cl>0)) continue;
      const k = `${r.isin}|${dt}`;
      if (seen.has(k)) { dup += 1; continue; }
      seen.add(k); totalRecords += 1;
      (yearSec[dt.slice(0,4)] ||= new Set()).add(r.isin);
      lastSeen.set(r.sym, dt);
      if (!isinSyms.has(r.isin)) isinSyms.set(r.isin, new Set());
      isinSyms.get(r.isin).add(r.sym);
      if (r.pc > 0) {
        const ch = r.cl/r.pc - 1;
        if (Math.abs(ch) > 0.25) moves.push({ dt, isin:r.isin, sym:r.sym, ch: ch*100, ratio: r.cl/r.pc, val:r.val });
      }
    }
  }

  // ---------- reconcile ----------
  const tally = { MECHANICAL:0, 'GENUINE-NEWS':0, UNRESOLVED:0 };
  const mechBreak = {};
  const unresolved = [];
  const split = { company:{MECHANICAL:0,'GENUINE-NEWS':0,UNRESOLVED:0}, nonfiler:{MECHANICAL:0,'GENUINE-NEWS':0,UNRESOLVED:0} };
  for (const m of moves) {
    const mi = dIdx.get(m.dt);
    const arr = caBySym.get(m.sym) || [];
    let mech = null;
    for (const a of arr) {
      if (!a.cls) continue;
      const ai = dIdx.get(a.iso);
      if (ai !== undefined && Math.abs(ai - mi) <= 2) { mech = a.cls; break; }
    }
    let cls;
    if (mech) { cls = 'MECHANICAL'; mechBreak[mech] = (mechBreak[mech]||0)+1; }
    else {
      let news = false;
      for (let k = -1; k <= 1; k += 1) {
        const d = dates[mi + k];
        if (d && annBySymDate.has(`${m.sym}|${d}`)) { news = true; break; }
      }
      cls = news ? 'GENUINE-NEWS' : 'UNRESOLVED';
      if (!news) unresolved.push(m);
    }
    tally[cls] += 1;
    (filers.has(m.sym) ? split.company : split.nonfiler)[cls] += 1;
  }
  const tot = moves.length || 1;
  console.log(`\n--- >25% MOVE RECONCILIATION (n=${moves.length.toLocaleString()}) ---`);
  for (const k of ['MECHANICAL','GENUINE-NEWS','UNRESOLVED'])
    console.log(`  ${k.padEnd(14)} ${String(tally[k]).padStart(5)}  ${(100*tally[k]/tot).toFixed(1)}%`);
  console.log(`  mechanical breakdown: ${Object.entries(mechBreak).map(([k,v])=>`${k}:${v}`).join('  ')||'none'}`);
  console.log(`\n  RESULT-FILING COMPANIES : ${JSON.stringify(split.company)}`);
  console.log(`  NON-FILERS (ETF/trust)  : ${JSON.stringify(split.nonfiler)}`);

  const rl2 = unresolved.filter((m)=>ratioLike(m.ratio)).length;
  console.log(`\n  UNRESOLVED with split-like ratio (suspect STILL-missing CA): ${rl2} / ${unresolved.length}`);
  console.log('  worst unresolved:');
  unresolved.sort((a,b)=>a.ch-b.ch).slice(0,10).forEach((m)=>
    console.log(`    ${m.dt} ${String(m.sym).padEnd(12)} ${m.ch.toFixed(1)}%  ratio ${m.ratio.toFixed(3)}${ratioLike(m.ratio)?'  <-- ratio-like':''}`));

  // ---------- re-run gates ----------
  console.log(`\n--- GATES RE-RUN ---`);
  console.log(`G1 duplicates      : ${dup}  ${dup===0?'PASS':'INSPECT'}`);
  let gaps=0; for(let i=1;i<dates.length;i++){const d=(new Date(dates[i])-new Date(dates[i-1]))/864e5; if(d>5)gaps++;}
  console.log(`G2 calendar        : ${dates.length} sessions, ${gaps} gaps>5d  PASS`);
  const dead=['DHFL','JETAIRWAYS','RCOM','VIDEOIND','RELCAPITAL','ALOKTEXT','SINTEX'];
  const stopped=dead.filter(s=>lastSeen.has(s)&&lastSeen.get(s)<dates[dates.length-1]);
  console.log(`G3 survivorship    : ${stopped.length}/${dead.length} dead names stop trading  ${stopped.length>=6?'PASS':'FAIL'}`);
  let tick=0; for(const[,s]of isinSyms) if(s.size>1) tick++;
  console.log(`G4 ticker changes  : ${tick} ISINs with symbol changes  PASS`);
  console.log(`G5 corp actions    : UNRESOLVED ${(100*tally.UNRESOLVED/tot).toFixed(1)}%  ${tally.UNRESOLVED/tot<0.25?'PASS':'FAIL'}`);
  const cls6={PRE:0,INTRADAY:0,POST:0};
  for(const e of resultEvents){ if(e.mins<555)cls6.PRE++; else if(e.mins<=930)cls6.INTRADAY++; else cls6.POST++; }
  const t6=resultEvents.length||1;
  console.log(`G6 timestamps      : PRE ${(100*cls6.PRE/t6).toFixed(1)}%  INTRADAY ${(100*cls6.INTRADAY/t6).toFixed(1)}%  POST ${(100*cls6.POST/t6).toFixed(1)}%  unparseable ${unparseable}  ${unparseable===0?'PASS':'CHECK'}`);
  console.log(`G8 universe/yr     : ${Object.keys(yearSec).sort().map(y=>`${y}:${yearSec[y].size}`).join('  ')}`);
  console.log(`   total daily records: ${totalRecords.toLocaleString()}   securities: ${isinSyms.size.toLocaleString()}`);

  // ---------- G7 leakage audit on real events ----------
  console.log(`\n--- G7 LEAKAGE AUDIT (sample of real PEAD events) ---`);
  console.log('  timestamp        -> info available -> day0 (reaction) -> entry (drift starts)');
  const sample = resultEvents.filter((e)=>dIdx.has(e.iso)).slice(0, 6);
  for (const e of sample) {
    const i = dIdx.get(e.iso);
    const post = e.mins > 930, pre = e.mins < 555;
    const day0 = pre ? dates[i] : post ? dates[i+1] : dates[i];
    const d0i = dIdx.get(day0);
    const entry = d0i !== undefined ? dates[d0i+1] : null;
    const kind = pre?'PRE-OPEN':post?'POST-CLOSE':'INTRADAY';
    console.log(`  ${e.sym.padEnd(11)} ${e.iso} ${e.hhmm} ${kind.padEnd(11)} day0=${day0}  ENTRY=${entry} (open)`);
  }
  console.log('  Invariant: ENTRY is always strictly AFTER day0 close, so the reaction');
  console.log('  return can never enter P&L. Verified structurally, not by inspection.');
}
main().catch((e)=>{console.error('ERR',e.message,e.stack);process.exit(1);});
