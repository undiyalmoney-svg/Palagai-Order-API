#!/usr/bin/env node
/**
 * PEAD-CAR-001 — the pre-registered test.
 * Specification frozen in PEAD-CAR-PREREGISTRATION.md (commit c02d81d),
 * event universe frozen at sha256 bf3dcb81... (48,714 events).
 * Nothing here may deviate from that spec.
 *
 * CAR0  = market-adjusted return on day0 (the REACTION). Never traded.
 * DRIFT = market-adjusted return, day0+1 OPEN -> day0+K CLOSE. The only P&L.
 * Entry strictly postdates the reaction, so the reaction cannot enter returns.
 *
 * Quintiles are formed WITHIN each calendar quarter, so ranking never uses
 * information from outside the period being ranked.
 *
 * WINDOW ROLES (per user instruction):
 *   DEV   2015-2019  discovery / calibration
 *   VALID 2020-2022  independent validation  <- the decisive window
 *   TEST  2023-2026  DIAGNOSTIC ONLY - previously inspected, NOT confirmation
 *
 * Usage: node pead-test.js <DATADIR>
 */
const fs = require('fs');
const path = require('path');

const DRIFT_HORIZONS = [5, 10, 20, 40];
const PRIMARY_K = 20;
const MOM_LOOKBACK = 65, MOM_GAP = 6;
const NIFTY_FILE_HINT = 'nifty_daily.json';

function parseLegacy(t){const o=[];const L=t.split(/\r?\n/);for(let i=1;i<L.length;i++){const c=L[i].split(',');
  if(c.length<13||(c[1]||'').trim()!=='EQ')continue;o.push({sym:c[0].trim(),op:+c[2],cl:+c[5],val:+c[9]});}return o;}
function parseNew(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());const ix=n=>h.indexOf(n);
  const a=ix('TckrSymb'),b=ix('SctySrs'),o1=ix('OpnPric'),d=ix('ClsPric'),v=ix('TtlTrfVal'),f=ix('FinInstrmTp');const o=[];
  for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;
   if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
   o.push({sym:(c[a]||'').trim(),op:+c[o1],cl:+c[d],val:+c[v]});}return o;}

const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const med=a=>{const s=[...a].sort((x,y)=>x-y);const n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):0;};
const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1));};
const tst=a=>(a.length>2&&sd(a)>0?mean(a)/(sd(a)/Math.sqrt(a.length)):0);
function boot(a,it=5000){if(a.length<10)return[NaN,NaN];const m=[];
  for(let i=0;i<it;i++){let s=0;for(let k=0;k<a.length;k++)s+=a[(Math.random()*a.length)|0];m.push(s/a.length);}
  m.sort((x,y)=>x-y);return[m[(it*0.025)|0],m[(it*0.975)|0]];}
function pFromT(t){const z=Math.abs(t);const b=[0.319381530,-0.356563782,1.781477937,-1.821255978,1.330274429];
  const c=0.39894228*Math.exp(-z*z/2),tt=1/(1+0.2316419*z);
  return 2*c*tt*(b[0]+tt*(b[1]+tt*(b[2]+tt*(b[3]+tt*b[4]))));}

async function main(){
  const DATA=process.argv[2];
  const RAW=path.join(DATA,'full','raw');
  const frozen=JSON.parse(fs.readFileSync(path.join(DATA,'pead_clean_events.json'),'utf8'));
  console.log('='.repeat(116));
  console.log('PEAD-CAR-001 — PRE-REGISTERED TEST');
  console.log('='.repeat(116));
  console.log(`frozen event universe: ${frozen.n.toLocaleString()} events, frozen_at ${frozen.frozen_at}`);

  // ---- price panel ----
  const files=fs.readdirSync(RAW).filter(f=>f.endsWith('.csv')&&fs.statSync(path.join(RAW,f)).isFile()).sort();
  const dates=files.map(f=>f.replace('.csv',''));
  const dIdx=new Map(dates.map((d,i)=>[d,i]));
  const px=new Map();
  for(let i=0;i<files.length;i++){
    const t=fs.readFileSync(path.join(RAW,files[i]),'utf8');
    for(const r of (dates[i]>'2024-06-30'?parseNew(t):parseLegacy(t))){
      if(!r.sym||!(r.cl>0))continue;
      if(!px.has(r.sym))px.set(r.sym,new Map());
      px.get(r.sym).set(i,r);
    }
  }
  // BENCHMARK — NIFTY 50, exactly as pre-registered.
  // CORRECTION: the first run used an equal-weight proxy of all EQ securities.
  // That was a DEVIATION from PEAD-CAR-PREREGISTRATION.md ("AR = stock return
  // minus NIFTY 50 return"). An equal-weight benchmark is dominated by small,
  // illiquid names whose measured returns are inflated by bid-ask bounce and
  // stale pricing, which biases every abnormal return downward. Corrected here.
  const niftyRows=JSON.parse(fs.readFileSync(path.join(DATA,'nifty_daily.json'),'utf8'));
  const nifByDate=new Map(niftyRows.map(r=>[r.d,r.c]));
  const mktRet=new Array(dates.length).fill(null);
  for(let i=1;i<dates.length;i++){
    const a=nifByDate.get(dates[i-1]), b=nifByDate.get(dates[i]);
    if(a>0&&b>0) mktRet[i]=b/a-1;
  }
  const mktCum=(i0,i1)=>{ let c=1; for(let k=i0;k<=i1;k++){ if(mktRet[k]==null)return null; c*=1+mktRet[k]; } return c-1; };

  // ---- build event records ----
  const evs=[];
  for(const e of frozen.events){
    const i0=dIdx.get(e.day0); if(i0===undefined)continue;
    const pm=px.get(e.sym); if(!pm)continue;
    const d0=pm.get(i0), dm1=pm.get(i0-1);
    if(!d0||!dm1||!(dm1.cl>0)||!(d0.cl>0))continue;
    const mk0=mktCum(i0,i0); if(mk0==null)continue;
    const car0=(d0.cl/dm1.cl-1-mk0)*100;                      // REACTION (not traded)
    // prior momentum, ending MOM_GAP sessions before day0 (cannot overlap reaction)
    const a=pm.get(i0-MOM_LOOKBACK), b=pm.get(i0-MOM_GAP);
    let mom=null;
    if(a&&b&&a.cl>0){ const mk=mktCum(i0-MOM_LOOKBACK+1,i0-MOM_GAP); if(mk!=null) mom=(b.cl/a.cl-1-mk)*100; }
    const drift={};
    for(const K of DRIFT_HORIZONS){
      const en=pm.get(i0+1), ex=pm.get(i0+K);
      if(en&&ex&&en.op>0&&ex.cl>0){ const mk=mktCum(i0+1,i0+K);
        drift[K]= mk==null?null:(ex.cl/en.op-1-mk)*100; }
      else drift[K]=null;
    }
    const win = e.ann_iso<='2019-12-31'?'DEV': e.ann_iso<='2022-12-31'?'VALID':'TEST';
    evs.push({sym:e.sym, iso:e.ann_iso, i0, car0, mom, drift, win,
      q:`${e.ann_iso.slice(0,4)}Q${Math.floor(+e.ann_iso.slice(5,7)/3.01)+1}`,
      adv:d0.val||0});
  }
  console.log(`events with complete price+market data: ${evs.length.toLocaleString()}`);

  // ---- quintile assignment WITHIN each calendar quarter ----
  const byQ=new Map();
  for(const e of evs){ if(!byQ.has(e.q))byQ.set(e.q,[]); byQ.get(e.q).push(e); }
  for(const [,arr] of byQ){
    arr.sort((x,y)=>x.car0-y.car0);
    const n=arr.length;
    arr.forEach((e,i)=>{ e.quint=Math.min(4,Math.floor(5*i/n)); });  // 0=most negative, 4=most positive
  }

  const WINS=['DEV','VALID','TEST'];
  const sel=(w,q,K)=>evs.filter(e=>e.win===w&&e.quint===q&&e.drift[K]!=null).map(e=>e.drift[K]);

  console.log('\n'+'='.repeat(116));
  console.log(`A/B/C — REACTION vs DRIFT by CAR0 quintile   (K=${PRIMARY_K} sessions, market-adjusted)`);
  console.log('='.repeat(116));
  console.log('Win    Quint   n       CAR0(reaction)%   DRIFT mean%   median%    t      CI95              win%');
  for(const w of WINS){
    for(let q=0;q<5;q++){
      const sub=evs.filter(e=>e.win===w&&e.quint===q&&e.drift[PRIMARY_K]!=null);
      if(sub.length<20)continue;
      const d=sub.map(e=>e.drift[PRIMARY_K]);
      const c=boot(d,3000);
      console.log(`${w.padEnd(6)} Q${q+1}   ${String(sub.length).padStart(6)}   ${mean(sub.map(e=>e.car0)).toFixed(3).padStart(13)}   ${mean(d).toFixed(3).padStart(11)}  ${med(d).toFixed(3).padStart(8)}  ${tst(d).toFixed(2).padStart(6)}  [${c[0].toFixed(2)}, ${c[1].toFixed(2)}]`.padEnd(104)+`${(100*d.filter(x=>x>0).length/d.length).toFixed(0)}`);
    }
    console.log('-'.repeat(116));
  }

  // ---- primary hypothesis: LONG top quintile (Q5) ----
  console.log('\n'+'='.repeat(116));
  console.log('PRIMARY — LONG top CAR0 quintile (Q5), all declared horizons');
  console.log('='.repeat(116));
  console.log('Win     K    n        mean%   median%     t      p         CI95               win%   uniqCos');
  const family=[];
  for(const w of WINS){
    for(const K of DRIFT_HORIZONS){
      const sub=evs.filter(e=>e.win===w&&e.quint===4&&e.drift[K]!=null);
      if(sub.length<20)continue;
      const d=sub.map(e=>e.drift[K]);
      const c=boot(d,3000); const t=tst(d); const p=pFromT(t);
      const uc=new Set(sub.map(e=>e.sym)).size;
      family.push({w,K,t,p,n:d.length,mean:mean(d)});
      console.log(`${w.padEnd(6)} ${String(K).padStart(3)}  ${String(d.length).padStart(6)}  ${mean(d).toFixed(3).padStart(9)}  ${med(d).toFixed(3).padStart(8)}  ${t.toFixed(2).padStart(6)}  ${p.toExponential(1).padStart(9)}  [${c[0].toFixed(2)}, ${c[1].toFixed(2)}]`.padEnd(92)+`${(100*d.filter(x=>x>0).length/d.length).toFixed(0)}`.padStart(5)+`${uc}`.padStart(10));
    }
    console.log('-'.repeat(116));
  }

  // ---- multiple testing (pre-declared family = 5 quintiles x 4 horizons = 20) ----
  const NTESTS=20, BONF=0.05/NTESTS;
  console.log(`\nMULTIPLE TESTING: declared family = 20 tests. Bonferroni p<${BONF.toFixed(5)}`);
  for(const f of family.filter(x=>x.w!=='TEST')){
    console.log(`  ${f.w} K=${f.K}: p=${f.p.toExponential(2)}  ${f.p<BONF?'PASSES Bonferroni':'fails'}`);
  }

  // ---- MOMENTUM CONTROL (the decisive contamination test) ----
  console.log('\n'+'='.repeat(116));
  console.log('MOMENTUM CONTROL — Q5 drift within prior-momentum terciles');
  console.log('If the effect lives only in the high-momentum tercile, it is MOMENTUM, not PEAD.');
  console.log('='.repeat(116));
  for(const w of WINS){
    const sub=evs.filter(e=>e.win===w&&e.quint===4&&e.drift[PRIMARY_K]!=null&&e.mom!=null);
    if(sub.length<60)continue;
    const sorted=[...sub].sort((a,b)=>a.mom-b.mom);
    const n=sorted.length, c1=(n/3)|0, c2=((2*n)/3)|0;
    const groups=[['LOW-mom',sorted.slice(0,c1)],['MID-mom',sorted.slice(c1,c2)],['HIGH-mom',sorted.slice(c2)]];
    console.log(`${w}:`);
    for(const [lbl,g] of groups){
      const d=g.map(e=>e.drift[PRIMARY_K]);
      console.log(`   ${lbl.padEnd(9)} n=${String(d.length).padStart(5)}  mean ${mean(d).toFixed(3).padStart(8)}%  median ${med(d).toFixed(3).padStart(8)}%  t=${tst(d).toFixed(2).padStart(6)}`);
    }
  }
  fs.writeFileSync(path.join(DATA,'pead_events_computed.json'),JSON.stringify(evs.map(e=>({s:e.sym,i:e.iso,w:e.win,c:e.car0,m:e.mom,q:e.quint,d:e.drift,v:e.adv}))));
  console.log(`\n(computed events written for attack phase)`);
}
main().catch(e=>{console.error('ERR',e.message,e.stack);process.exit(1);});
