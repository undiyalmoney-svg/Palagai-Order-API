#!/usr/bin/env node
/**
 * PEAD-RESIDUAL-001 — factor-matched event study.
 * Spec frozen in PEAD-RESIDUAL-PREREGISTRATION.md (commit d707c7a).
 * Event universe frozen at sha256 bf3dcb81... (48,714 events).
 *
 * Matched control replaces index-relative returns. For each event the peer
 * group is: same sector, same ADTV tercile, same momentum tercile, no own
 * event within +/-5 sessions, minimum 5 peers. Terciles are computed
 * cross-sectionally on that session only.
 *
 *   abnormal = event return - mean(peer returns), identical window.
 *
 * This nets out market, size, sector and momentum at once, which is the
 * specific correction for PEAD-CAR-001's size-cycle contamination.
 *
 * Q5-Q1 spread is primary: both legs come from the same event pool on the same
 * dates, so period-wide factor moves cancel. Q5 alone is reported separately
 * because only the long leg is implementable (no overnight shorting).
 *
 * Usage: node pead-residual.js <DATADIR>
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MOM_LB = 65, MOM_GAP = 6, ADTV_LB = 20, MIN_PEERS = 5, EVENT_BLACKOUT = 5;
const HZ = { 'DRIFT-A': [2, 5], 'DRIFT-B': [2, 20], 'D0-5': [0, 5], 'D0-20': [0, 20] };
const PRIMARY = ['DRIFT-A', 'DRIFT-B'];

const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const med=a=>{const s=[...a].sort((x,y)=>x-y);const n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):0;};
const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1));};
function boot(a,it=3000){if(a.length<10)return[NaN,NaN];const m=[];
  for(let i=0;i<it;i++){let s=0;for(let k=0;k<a.length;k++)s+=a[(Math.random()*a.length)|0];m.push(s/a.length);}
  m.sort((x,y)=>x-y);return[m[(it*0.025)|0],m[(it*0.975)|0]];}
/** t-stat with standard errors CLUSTERED BY COMPANY (repeated events are not independent) */
function clusteredT(rows){                     // rows: [{sym, v}]
  const n=rows.length; if(n<10) return 0;
  const m=mean(rows.map(r=>r.v));
  const bySym=new Map();
  for(const r of rows){ if(!bySym.has(r.sym))bySym.set(r.sym,0); bySym.set(r.sym,bySym.get(r.sym)+(r.v-m)); }
  let meat=0; for(const [,s] of bySym) meat+=s*s;
  const se=Math.sqrt(meat)/n;
  return se>0? m/se : 0;
}
function pFromT(t){const z=Math.abs(t);const b=[0.319381530,-0.356563782,1.781477937,-1.821255978,1.330274429];
  const c=0.39894228*Math.exp(-z*z/2),tt=1/(1+0.2316419*z);
  return 2*c*tt*(b[0]+tt*(b[1]+tt*(b[2]+tt*(b[3]+tt*b[4]))));}

function parseLegacy(t){const o=[];const L=t.split(/\r?\n/);for(let i=1;i<L.length;i++){const c=L[i].split(',');
  if(c.length<13||(c[1]||'').trim()!=='EQ')continue;o.push({sym:c[0].trim(),op:+c[2],cl:+c[5],val:+c[9]});}return o;}
function parseNew(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());const ix=n=>h.indexOf(n);
  const a=ix('TckrSymb'),b=ix('SctySrs'),o1=ix('OpnPric'),d=ix('ClsPric'),v=ix('TtlTrfVal'),f=ix('FinInstrmTp');const o=[];
  for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;
   if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
   o.push({sym:(c[a]||'').trim(),op:+c[o1],cl:+c[d],val:+c[v]});}return o;}

async function main(){
  const DATA=process.argv[2];
  const RAW=path.join(DATA,'full','raw');
  const frozen=JSON.parse(fs.readFileSync(path.join(DATA,'pead_clean_events.json'),'utf8'));

  // ---- sector map from announcements ----
  const sector=new Map();
  await new Promise((res,rej)=>{
    const rl=readline.createInterface({input:fs.createReadStream(path.join(DATA,'ann_full','announcements.ndjson')),crlfDelay:Infinity});
    rl.on('line',l=>{if(!l.trim())return;let o;try{o=JSON.parse(l)}catch(e){return}
      const s=(o.smIndustry||'').trim();
      if(o.symbol&&s&&s!=='-'&&!sector.has(o.symbol)) sector.set(o.symbol,s);});
    rl.on('close',res);rl.on('error',rej);
  });

  // ---- price panel ----
  const files=fs.readdirSync(RAW).filter(f=>f.endsWith('.csv')&&fs.statSync(path.join(RAW,f)).isFile()).sort();
  const dates=files.map(f=>f.replace('.csv',''));
  const dIdx=new Map(dates.map((d,i)=>[d,i]));
  const T=dates.length;
  const px=new Map();
  for(let i=0;i<T;i++){
    const t=fs.readFileSync(path.join(RAW,files[i]),'utf8');
    for(const r of (dates[i]>'2024-06-30'?parseNew(t):parseLegacy(t))){
      if(!r.sym||!(r.cl>0))continue;
      if(!px.has(r.sym))px.set(r.sym,new Map());
      px.get(r.sym).set(i,r);
    }
  }
  console.log('='.repeat(118));
  console.log('PEAD-RESIDUAL-001 — FACTOR-MATCHED EVENT STUDY');
  console.log('='.repeat(118));
  console.log(`sessions ${T}  securities ${px.size}  sector map ${sector.size}  frozen events ${frozen.n}`);

  // ---- event blackout index: symbol -> Set(dateIdx of its own events) ----
  const evDates=new Map();
  for(const e of frozen.events){ const i=dIdx.get(e.day0); if(i===undefined)continue;
    if(!evDates.has(e.sym))evDates.set(e.sym,new Set()); evDates.get(e.sym).add(i); }
  const hasNearbyEvent=(sym,i)=>{ const s=evDates.get(sym); if(!s)return false;
    for(let k=i-EVENT_BLACKOUT;k<=i+EVENT_BLACKOUT;k++) if(s.has(k))return true; return false; };

  // ---- helpers computed at a given session ----
  const adtv=(sym,i)=>{ const m=px.get(sym); if(!m)return null; let s=0,n=0;
    for(let k=i-ADTV_LB;k<i;k++){ const r=m.get(k); if(r){s+=r.val||0;n++;} } return n>=ADTV_LB*0.6? s/n : null; };
  const momentum=(sym,i)=>{ const m=px.get(sym); if(!m)return null;
    const a=m.get(i-MOM_LB), b=m.get(i-MOM_GAP); return (a&&b&&a.cl>0)? b.cl/a.cl-1 : null; };
  const ret=(sym,i0,i1,useOpen)=>{ const m=px.get(sym); if(!m)return null;
    const a=m.get(i0), b=m.get(i1); if(!a||!b)return null;
    const entry=useOpen? a.op : a.cl; return (entry>0&&b.cl>0)? b.cl/entry-1 : null; };

  // ---- group events by day0 so peer stats are computed once per session ----
  const byDay=new Map();
  for(const e of frozen.events){ const i=dIdx.get(e.day0); if(i===undefined)continue;
    if(i-MOM_LB<0||i+21>=T)continue;
    if(!byDay.has(i))byDay.set(i,[]); byDay.get(i).push(e); }

  const out=[];
  let noSector=0, noPeers=0, ok=0;
  const sessions=[...byDay.keys()].sort((a,b)=>a-b);
  for(const i of sessions){
    // characteristics for every stock trading this session
    const chars=[];
    for(const [sym,m] of px){
      if(!m.get(i))continue;
      const sec=sector.get(sym); if(!sec)continue;
      const a=adtv(sym,i), mo=momentum(sym,i);
      if(a==null||mo==null)continue;
      chars.push({sym,sec,a,mo});
    }
    if(chars.length<30)continue;
    // cross-sectional terciles on THIS session only
    const byA=[...chars].sort((x,y)=>x.a-y.a); byA.forEach((c,k)=>{c.aT=Math.min(2,Math.floor(3*k/byA.length));});
    const byM=[...chars].sort((x,y)=>x.mo-y.mo); byM.forEach((c,k)=>{c.mT=Math.min(2,Math.floor(3*k/byM.length));});
    const buckets=new Map();
    for(const c of chars){ const k=`${c.sec}|${c.aT}|${c.mT}`; if(!buckets.has(k))buckets.set(k,[]); buckets.get(k).push(c); }
    const charBySym=new Map(chars.map(c=>[c.sym,c]));

    for(const e of byDay.get(i)){
      const c=charBySym.get(e.sym);
      if(!c){ noSector++; continue; }
      const key=`${c.sec}|${c.aT}|${c.mT}`;
      const pool=(buckets.get(key)||[]).filter(p=>p.sym!==e.sym && !hasNearbyEvent(p.sym,i));
      if(pool.length<MIN_PEERS){ noPeers++; continue; }

      // REACTION: day0 -> day0+1 close (ranking variable, never traded)
      const rEv=ret(e.sym,i,i+1,false);
      if(rEv==null){ noPeers++; continue; }
      const rPeers=pool.map(p=>ret(p.sym,i,i+1,false)).filter(x=>x!=null);
      if(rPeers.length<MIN_PEERS){ noPeers++; continue; }
      const reaction=(rEv-mean(rPeers))*100;

      const ab={};
      let bad=false;
      for(const [name,[s,en]] of Object.entries(HZ)){
        const useOpen = s>0;                        // drift windows enter at OPEN
        const ev=ret(e.sym,i+s,i+en,useOpen);
        if(ev==null){ ab[name]=null; continue; }
        const pr=pool.map(p=>ret(p.sym,i+s,i+en,useOpen)).filter(x=>x!=null);
        if(pr.length<MIN_PEERS){ ab[name]=null; continue; }
        ab[name]=(ev-mean(pr))*100;
      }
      if(ab['DRIFT-A']==null&&ab['DRIFT-B']==null){ noPeers++; continue; }
      const win = e.ann_iso<='2018-12-31'?'DEV': e.ann_iso<='2022-12-31'?'VALID':'TEST';
      out.push({sym:e.sym, iso:e.ann_iso, sec:c.sec, aT:c.aT, win, reaction, ab, peers:pool.length,
        q:`${e.ann_iso.slice(0,4)}Q${Math.floor(+e.ann_iso.slice(5,7)/3.01)+1}`});
      ok++;
    }
  }
  console.log(`matched events: ${ok}   excluded no-sector: ${noSector}   excluded insufficient-peers: ${noPeers}`);
  const matchRate=100*ok/(ok+noSector+noPeers);
  console.log(`match rate: ${matchRate.toFixed(1)}%  ${matchRate<50?'<-- BELOW 50% PRE-REGISTERED FLOOR':''}`);

  // ---- quintiles on residual reaction, within calendar quarter ----
  const byQ=new Map();
  for(const e of out){ if(!byQ.has(e.q))byQ.set(e.q,[]); byQ.get(e.q).push(e); }
  for(const [,arr] of byQ){ arr.sort((x,y)=>x.reaction-y.reaction);
    arr.forEach((e,k)=>{ e.quint=Math.min(4,Math.floor(5*k/arr.length)); }); }

  const WINS=['DEV','VALID','TEST'];
  console.log('\n'+'='.repeat(118));
  console.log('PRIMARY — Q5 minus Q1 spread on matched-abnormal drift');
  console.log('='.repeat(118));
  console.log('Horizon   Win     nQ5    nQ1    Q5 mean%   Q1 mean%   SPREAD%   clustT   p        Q5 med%  Q5 win%  uniqCos');
  const fam=[];
  for(const H of PRIMARY){
    for(const w of WINS){
      const q5=out.filter(e=>e.win===w&&e.quint===4&&e.ab[H]!=null);
      const q1=out.filter(e=>e.win===w&&e.quint===0&&e.ab[H]!=null);
      if(q5.length<50||q1.length<50)continue;
      const v5=q5.map(e=>e.ab[H]), v1=q1.map(e=>e.ab[H]);
      const spread=mean(v5)-mean(v1);
      // cluster t on the spread: treat as difference of two clustered means
      const t5=clusteredT(q5.map(e=>({sym:e.sym,v:e.ab[H]})));
      const t1=clusteredT(q1.map(e=>({sym:e.sym,v:e.ab[H]})));
      const tSpread=(mean(v5)-mean(v1))/Math.sqrt((mean(v5)/Math.max(1e-9,Math.abs(t5)))**2+(mean(v1)/Math.max(1e-9,Math.abs(t1)))**2);
      const p=pFromT(tSpread);
      fam.push({H,w,spread,t:tSpread,p});
      console.log(`${H.padEnd(9)} ${w.padEnd(6)} ${String(q5.length).padStart(6)} ${String(q1.length).padStart(6)} `+
        `${mean(v5).toFixed(3).padStart(10)} ${mean(v1).toFixed(3).padStart(10)} ${spread.toFixed(3).padStart(9)} `+
        `${tSpread.toFixed(2).padStart(8)} ${p.toExponential(1).padStart(9)} ${med(v5).toFixed(3).padStart(8)} `+
        `${(100*v5.filter(x=>x>0).length/v5.length).toFixed(0).padStart(7)} ${String(new Set(q5.map(e=>e.sym)).size).padStart(8)}`);
    }
    console.log('-'.repeat(118));
  }

  console.log('\nALL QUINTILES (DRIFT-B, matched-abnormal %) — monotonicity check');
  console.log('Win     Q1       Q2       Q3       Q4       Q5     |  Q5-Q1');
  for(const w of WINS){
    const row=[];
    for(let q=0;q<5;q++){ const v=out.filter(e=>e.win===w&&e.quint===q&&e.ab['DRIFT-B']!=null).map(e=>e.ab['DRIFT-B']);
      row.push(v.length>20?mean(v):NaN); }
    console.log(w.padEnd(7)+row.map(x=>isNaN(x)?'   n/a ':x.toFixed(3).padStart(8)).join(' ')+'  |  '+(row[4]-row[0]).toFixed(3));
  }

  // ---- Q5 long-only (the only implementable leg) ----
  console.log('\nQ5 LONG-ONLY (implementable leg — no overnight shorting available)');
  console.log('Horizon   Win      n     mean%   median%  clustT    p        win%');
  for(const H of PRIMARY){
    for(const w of WINS){
      const q5=out.filter(e=>e.win===w&&e.quint===4&&e.ab[H]!=null);
      if(q5.length<50)continue;
      const v=q5.map(e=>e.ab[H]);
      const t=clusteredT(q5.map(e=>({sym:e.sym,v:e.ab[H]})));
      console.log(`${H.padEnd(9)} ${w.padEnd(6)} ${String(v.length).padStart(6)} ${mean(v).toFixed(3).padStart(9)} ${med(v).toFixed(3).padStart(9)} ${t.toFixed(2).padStart(7)} ${pFromT(t).toExponential(1).padStart(9)} ${(100*v.filter(x=>x>0).length/v.length).toFixed(0).padStart(6)}`);
    }
    console.log('-'.repeat(80));
  }

  const BONF=0.05/6;
  console.log(`\nMULTIPLE TESTING: family = 6 primary tests, Bonferroni p<${BONF.toFixed(4)}`);
  for(const f of fam.filter(x=>x.w!=='TEST'))
    console.log(`  ${f.H} ${f.w}: spread ${f.spread.toFixed(3)}%  p=${f.p.toExponential(2)}  ${f.p<BONF?'PASSES':'fails'}`);

  // ---- DEV/VALID sign consistency = the stop condition ----
  const dA=fam.find(f=>f.H==='DRIFT-A'&&f.w==='DEV'), vA=fam.find(f=>f.H==='DRIFT-A'&&f.w==='VALID');
  const dB=fam.find(f=>f.H==='DRIFT-B'&&f.w==='DEV'), vB=fam.find(f=>f.H==='DRIFT-B'&&f.w==='VALID');
  console.log('\nSIGN CONSISTENCY (primary confirmation requirement):');
  for(const [n,d,v] of [['DRIFT-A',dA,vA],['DRIFT-B',dB,vB]]){
    if(!d||!v){console.log(`  ${n}: insufficient data`);continue;}
    const agree=Math.sign(d.spread)===Math.sign(v.spread)&&d.spread>0;
    console.log(`  ${n}: DEV ${d.spread.toFixed(3)}%  VALID ${v.spread.toFixed(3)}%  -> ${agree?'CONSISTENT & POSITIVE':'FAILS'}`);
  }
  fs.writeFileSync(path.join(DATA,'pead_residual_events.json'),JSON.stringify(out));
  console.log('\n(matched events written for attack phase)');
}
main().catch(e=>{console.error('ERR',e.message,e.stack);process.exit(1);});
