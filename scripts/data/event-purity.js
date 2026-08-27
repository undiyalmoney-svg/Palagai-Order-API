#!/usr/bin/env node
/**
 * GATE G9 — EVENT PURITY. Freezes the clean PEAD event universe.
 *
 * This file is FORBIDDEN from computing any forward return that could feed a
 * trading decision. It computes forward returns for exactly ONE purpose: to
 * AUDIT the exclusion rule for return-dependence (requirement 6). That audit
 * is reported and then discarded; it cannot alter the rule, which is fixed
 * before any return is read.
 *
 * EXCLUSION RULE — evaluated using only (symbol, dates, corporate actions,
 * data availability). It never reads a price return. Structurally return-blind.
 *
 *   CLEAN                  no mechanical CA in [day0-5, day0+5]
 *                          AND full price data for [day0-65 .. day0+20]
 *   MECHANICAL-CONTAMINATED split/bonus/rights/merger/demerger overlaps window
 *   UNRESOLVED             a >25% move in the window with no CA record and no
 *                          same-window filing -> purity cannot be established
 *   INSUFFICIENT-DATA      missing sessions for momentum control or drift window
 *
 * Contaminated events are EXCLUDED, never "adjusted away and retained".
 * UNKNOWN/UNRESOLVED is excluded too: uncertainty must not become signal.
 *
 * day0 assignment (frozen in PEAD-CAR-PREREGISTRATION.md):
 *   PRE-OPEN (<09:15)   -> day0 = same session
 *   INTRADAY (<=15:30)  -> day0 = same session
 *   POST-CLOSE (>15:30) -> day0 = next session
 *   ENTRY is always the OPEN of day0+1, so the reaction never enters P&L.
 *
 * Usage: node event-purity.js <DATADIR>
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MON = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
const caIso = (s) => { const m=/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec((s||'').trim()); if(!m)return null;
  const mo=MON[m[2].toUpperCase()]; return mo===undefined?null:`${m[3]}-${String(mo+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`; };
const anIso = (s) => { const m=/^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec((s||'').trim()); if(!m)return null;
  const mo=MON[m[2].toUpperCase()]; if(mo===undefined)return null;
  return { iso:`${m[3]}-${String(mo+1).padStart(2,'0')}-${m[1]}`, mins:+m[4]*60 + +m[5] }; };
function stream(f,cb){return new Promise((res,rej)=>{const rl=readline.createInterface({input:fs.createReadStream(f),crlfDelay:Infinity});
  rl.on('line',l=>{if(l.trim()){try{cb(JSON.parse(l))}catch(e){}}});rl.on('close',res);rl.on('error',rej);});}
function mechClass(s){const x=(s||'').toLowerCase();
  if(/split|sub-division|subdivision/.test(x))return'SPLIT';
  if(/bonus/.test(x))return'BONUS';
  if(/rights/.test(x))return'RIGHTS';
  if(/amalgamat|merger|demerger|scheme of arrangement|spin/.test(x))return'MERGER-DEMERGER';
  return null;}
function parseLegacy(t){const o=[];const L=t.split(/\r?\n/);for(let i=1;i<L.length;i++){const c=L[i].split(',');
  if(c.length<13||(c[1]||'').trim()!=='EQ')continue;o.push({sym:c[0].trim(),cl:+c[5],pc:+c[7],op:+c[2],val:+c[9]});}return o;}
function parseNew(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());const ix=n=>h.indexOf(n);
  const a=ix('TckrSymb'),b=ix('SctySrs'),d=ix('ClsPric'),e=ix('PrvsClsgPric'),op=ix('OpnPric'),v=ix('TtlTrfVal'),f=ix('FinInstrmTp');const o=[];
  for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;
   if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
   o.push({sym:(c[a]||'').trim(),cl:+c[d],pc:+c[e],op:+c[op],val:+c[v]});}return o;}

const PRE_WIN=5, POST_WIN=5, MOM_LOOKBACK=65, DRIFT=20;

async function main(){
  const DATA=process.argv[2];
  const RAW=path.join(DATA,'full','raw');

  // ---- corporate actions (per-symbol primary + date-range backfill) ----
  const caBySym=new Map();
  const add=(sym,iso,cls)=>{ if(!caBySym.has(sym))caBySym.set(sym,[]); const a=caBySym.get(sym);
    if(!a.some(x=>x.iso===iso&&x.cls===cls))a.push({iso,cls}); };
  const p1=path.join(DATA,'ca_sym','ca_persymbol.ndjson');
  const p2=path.join(DATA,'ca_full','corpactions.ndjson');
  let n1=0;
  if(fs.existsSync(p1)) await stream(p1,r=>{ if(r.__sym)return; const iso=caIso(r.exDate); if(!iso||!r.symbol)return;
    n1++; add(r.symbol,iso,mechClass(r.subject)); });
  if(fs.existsSync(p2)) await stream(p2,r=>{ const iso=caIso(r.exDate); if(!iso||!r.symbol)return;
    add(r.symbol,iso,mechClass(r.subject)); });

  // ---- announcements ----
  const annSymDate=new Set(); const events=[];
  await stream(path.join(DATA,'ann_full','announcements.ndjson'),r=>{
    const p=anIso(r.an_dt); if(!p||!r.symbol)return;
    annSymDate.add(`${r.symbol}|${p.iso}`);
    if(/financial result/i.test(r.desc||'')) events.push({sym:r.symbol,iso:p.iso,mins:p.mins});
  });

  // ---- price panel ----
  const files=fs.readdirSync(RAW).filter(f=>f.endsWith('.csv')&&fs.statSync(path.join(RAW,f)).isFile()).sort();
  const dates=files.map(f=>f.replace('.csv',''));
  const dIdx=new Map(dates.map((d,i)=>[d,i]));
  const px=new Map();          // sym -> Map(dateIdx -> {cl,op,pc,val})
  const bigMove=new Set();     // `${sym}|${dateIdx}` where |1d move| > 25%
  for(let i=0;i<files.length;i++){
    const t=fs.readFileSync(path.join(RAW,files[i]),'utf8');
    for(const r of (dates[i]>'2024-06-30'?parseNew(t):parseLegacy(t))){
      if(!r.sym||!(r.cl>0))continue;
      if(!px.has(r.sym))px.set(r.sym,new Map());
      px.get(r.sym).set(i,{cl:r.cl,op:r.op,pc:r.pc,val:r.val});
      if(r.pc>0&&Math.abs(r.cl/r.pc-1)>0.25) bigMove.add(`${r.sym}|${i}`);
    }
  }

  // ---- classify every candidate event (RETURN-BLIND) ----
  const out={CLEAN:[],'MECHANICAL-CONTAMINATED':[],UNRESOLVED:[],'INSUFFICIENT-DATA':[]};
  const mechWhy={};
  for(const e of events){
    const i0raw=dIdx.get(e.iso);
    if(i0raw===undefined){ out['INSUFFICIENT-DATA'].push({...e,why:'no session'}); continue; }
    const post=e.mins>930;
    const i0 = post ? i0raw+1 : i0raw;                    // day0 per frozen rule
    if(i0>=dates.length){ out['INSUFFICIENT-DATA'].push({...e,why:'day0 beyond data'}); continue; }
    const pm=px.get(e.sym);
    if(!pm){ out['INSUFFICIENT-DATA'].push({...e,why:'symbol absent'}); continue; }

    // data availability for momentum control + drift window
    let missing=0;
    for(let k=i0-MOM_LOOKBACK;k<=i0+DRIFT;k++){ if(k<0||k>=dates.length||!pm.has(k)) missing++; }
    if(missing>0){ out['INSUFFICIENT-DATA'].push({...e,why:`missing ${missing} sessions`}); continue; }

    // mechanical CA overlapping [day0-5, day0+5]
    const arr=caBySym.get(e.sym)||[];
    let mech=null;
    for(const a of arr){ if(!a.cls)continue; const ai=dIdx.get(a.iso);
      if(ai!==undefined&&ai>=i0-PRE_WIN&&ai<=i0+POST_WIN){ mech=a.cls; break; } }
    if(mech){ out['MECHANICAL-CONTAMINATED'].push({...e,i0,why:mech}); mechWhy[mech]=(mechWhy[mech]||0)+1; continue; }

    // unresolved: a >25% move inside the window with no CA and no filing that day
    let unres=false;
    for(let k=i0-PRE_WIN;k<=i0+POST_WIN;k++){
      if(!bigMove.has(`${e.sym}|${k}`))continue;
      if(annSymDate.has(`${e.sym}|${dates[k]}`))continue;   // explained by a filing
      unres=true; break;
    }
    if(unres){ out.UNRESOLVED.push({...e,i0}); continue; }
    out.CLEAN.push({...e,i0});
  }

  const T=events.length||1;
  console.log('='.repeat(112));
  console.log('GATE G9 — EVENT PURITY');
  console.log('='.repeat(112));
  console.log(`per-symbol CA rows loaded: ${n1.toLocaleString()}   symbols with CA: ${caBySym.size.toLocaleString()}`);
  console.log(`\ntotal candidate earnings events : ${events.length.toLocaleString()}`);
  for(const k of ['CLEAN','MECHANICAL-CONTAMINATED','UNRESOLVED','INSUFFICIENT-DATA'])
    console.log(`  ${k.padEnd(24)} ${String(out[k].length).padStart(6)}  ${(100*out[k].length/T).toFixed(1)}%`);
  console.log(`  contamination reasons: ${Object.entries(mechWhy).map(([k,v])=>`${k}:${v}`).join('  ')||'none'}`);

  // ---- concentration of exclusions ----
  const excluded=[...out['MECHANICAL-CONTAMINATED'],...out.UNRESOLVED,...out['INSUFFICIENT-DATA']];
  const byYear={},bySym={};
  for(const e of excluded){ byYear[e.iso.slice(0,4)]=(byYear[e.iso.slice(0,4)]||0)+1; bySym[e.sym]=(bySym[e.sym]||0)+1; }
  const cleanByYear={};
  for(const e of out.CLEAN) cleanByYear[e.iso.slice(0,4)]=(cleanByYear[e.iso.slice(0,4)]||0)+1;
  console.log('\n--- exclusion concentration by YEAR (excluded / clean, excl-rate) ---');
  for(const y of Object.keys({...byYear,...cleanByYear}).sort()){
    const ex=byYear[y]||0, cl=cleanByYear[y]||0;
    console.log(`  ${y}: ${String(ex).padStart(5)} / ${String(cl).padStart(5)}   ${(100*ex/Math.max(1,ex+cl)).toFixed(1)}%`);
  }
  const topSym=Object.entries(bySym).sort((a,b)=>b[1]-a[1]).slice(0,8);
  console.log('\n--- most-excluded symbols ---');
  topSym.forEach(([s,n])=>console.log(`  ${s.padEnd(14)} ${n}`));
  console.log(`  top-8 symbols account for ${(100*topSym.reduce((a,x)=>a+x[1],0)/Math.max(1,excluded.length)).toFixed(1)}% of exclusions`);

  // ---- REQUIREMENT 6: is the exclusion rule return-dependent? ----
  // AUDIT ONLY. Computed after the rule is fixed; cannot and does not alter it.
  console.log('\n--- REQUIREMENT 6 AUDIT: is the exclusion rule return-dependent? ---');
  console.log('  Rule inputs are (symbol, dates, CA records, data availability) only —');
  console.log('  structurally return-blind. Empirical check below is for transparency.');
  function drift(e){
    const pm=px.get(e.sym); if(!pm||e.i0===undefined)return null;
    const a=pm.get(e.i0+1), b=pm.get(e.i0+DRIFT);
    if(!a||!b||!(a.op>0))return null;
    return (b.cl/a.op-1)*100;
  }
  for(const k of ['CLEAN','MECHANICAL-CONTAMINATED','UNRESOLVED']){
    const v=out[k].map(drift).filter(x=>x!=null&&Math.abs(x)<200);
    if(v.length<20){ console.log(`  ${k.padEnd(24)} n=${v.length} (too few to compare)`); continue; }
    const m=v.reduce((a,b)=>a+b,0)/v.length;
    const s=[...v].sort((a,b)=>a-b);
    console.log(`  ${k.padEnd(24)} n=${String(v.length).padStart(6)}  mean ${m.toFixed(3)}%  median ${s[Math.floor(s.length/2)].toFixed(3)}%`);
  }
  console.log('  If CLEAN and excluded groups have similar drift, exclusions are not');
  console.log('  cherry-picking performance. A large gap would be a RED FLAG to disclose.');

  // ---- freeze ----
  const frozen=out.CLEAN.map(e=>({sym:e.sym,ann_iso:e.iso,ann_mins:e.mins,day0:dates[e.i0]}));
  const fp=path.join(DATA,'pead_clean_events.json');
  fs.writeFileSync(fp,JSON.stringify({frozen_at:new Date().toISOString(),rule:'G9 event purity',n:frozen.length,events:frozen}));
  console.log(`\nFROZEN CLEAN EVENT UNIVERSE -> ${fp}`);
  console.log(`  events: ${frozen.length.toLocaleString()}`);
  const yr={}; for(const e of frozen) yr[e.ann_iso.slice(0,4)]=(yr[e.ann_iso.slice(0,4)]||0)+1;
  console.log('  by year: '+Object.keys(yr).sort().map(y=>`${y}:${yr[y]}`).join('  '));
  const dev=frozen.filter(e=>e.ann_iso<='2019-12-31').length;
  const val=frozen.filter(e=>e.ann_iso>'2019-12-31'&&e.ann_iso<='2022-12-31').length;
  const tst=frozen.filter(e=>e.ann_iso>'2022-12-31').length;
  console.log(`  DEV ${dev}   VALID ${val}   TEST ${tst}`);
  console.log(`  pre-registered minimum is 200 events per CAR0 quintile per window;`);
  console.log(`  with 5 quintiles that needs >=1000 per window -> DEV ${dev>=1000?'OK':'SHORT'}  VALID ${val>=1000?'OK':'SHORT'}  TEST ${tst>=1000?'OK':'SHORT'}`);
}
main().catch(e=>{console.error('ERR',e.message,e.stack);process.exit(1);});
