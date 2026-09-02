#!/usr/bin/env node
/** PHASE 4.X — cross-sectional / breadth / market-state stock events. Read-only. */
const fs=require('fs');
const HOLD=5,MIN_PX=20,MIN_TV=5e7,MIN_HIST=60,HURDLE=0.658;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const J=JSON.parse(fs.readFileSync('/tmp/eq_panel.json','utf8'));
const dates=J.dates,T=dates.length;
const P=new Map(J.panel.map(([s,a])=>[s,new Map(a)]));
const NIF=new Map(JSON.parse(fs.readFileSync(process.argv[2],'utf8')).map(r=>[r.d,r.c]));
const VIXm=new Map(JSON.parse(fs.readFileSync(process.argv[3],'utf8')).map(r=>[r.d,r.c]));
const nifAt=dates.map(d=>NIF.get(d)??null), vixAt=dates.map(d=>VIXm.get(d)??null);
const DEV=[0,dates.findIndex(d=>d>'2018-12-31')],VAL=[0,0];
VAL[0]=DEV[1];VAL[1]=dates.findIndex(d=>d>'2022-12-31');
const LAST=VAL[1];
// VIX regime terciles from DEV only (causal, frozen)
const vDev=[];for(let i=DEV[0];i<DEV[1];i++)if(vixAt[i])vDev.push(vixAt[i]);
vDev.sort((a,b)=>a-b);
const VLO=vDev[Math.floor(vDev.length/3)],VHI=vDev[Math.floor(vDev.length*2/3)];
console.log(`VIX regime bounds frozen from DEV: low<${VLO.toFixed(2)} high>${VHI.toFixed(2)}`);
function feat(m,i){
  const c=m.get(i);if(!c||!(c.c>=MIN_PX))return null;
  const hist=[];for(let k=i-20;k<i;k++){const b=m.get(k);if(b)hist.push(b);}
  if(hist.length<14)return null;
  const mtv=med(hist.map(b=>b.val||0));if(!(mtv>=MIN_TV))return null;
  let n=0;for(let k=i-MIN_HIST;k<i;k++)if(m.get(k))n++;if(n<MIN_HIST*0.7)return null;
  const p1=m.get(i-1);if(!p1)return null;
  const r1=(c.c-p1.c)/p1.c*100;
  const rets=[];for(let k=i-20;k<i;k++){const a=m.get(k),b=m.get(k-1);if(a&&b)rets.push((a.c-b.c)/b.c*100);}
  const vol=sd(rets);if(!(vol>0))return null;
  const p20=m.get(i-20);const r20=p20?(c.c-p20.c)/p20.c*100:null;
  const mv=med(hist.map(b=>b.v||0));const relVol=mv>0?c.v/mv:null;
  const rng=(c.h-c.l)/c.c*100,mrng=med(hist.map(b=>(b.h-b.l)/b.c*100));
  return {c,r1,r20,vol,relVol,rng,mrng,mtv,volB:mtv>2e8?2:mtv>1e8?1:0,vB:vol>3?2:vol>1.8?1:0};
}
function fwd(m,i,dir){const e=m.get(i+1);if(!e||!(e.o>0))return null;
  const x=m.get(i+HOLD);if(!x||!(x.c>0))return null;return dir*((x.c-e.o)/e.o*100);}
// precompute per date, then add CROSS-SECTIONAL RANKS + BREADTH (all causal, same-date info)
const byDate=new Map();
for(const[sym,m]of P){for(const i of m.keys()){
  if(i<MIN_HIST||i+HOLD>=LAST)continue;
  const f=feat(m,i);if(!f)continue;
  if(!byDate.has(i))byDate.set(i,[]);byDate.get(i).push({sym,f,m});}}
const dIdx=[...byDate.keys()].sort((a,b)=>a-b).filter(i=>byDate.get(i).length>=50);
for(const i of dIdx){
  const pool=byDate.get(i);const N=pool.length;
  const byR1=[...pool].sort((a,b)=>b.f.r1-a.f.r1);byR1.forEach((e,k)=>e.f.pR1=k/(N-1));
  const byR20=[...pool].sort((a,b)=>b.f.r20-a.f.r20);byR20.forEach((e,k)=>e.f.pR20=e.f.r20==null?null:k/(N-1));
  const byRV=[...pool].sort((a,b)=>(b.f.relVol??-1)-(a.f.relVol??-1));byRV.forEach((e,k)=>e.f.pRV=k/(N-1));
  const up=pool.filter(e=>e.f.r1>0).length;const breadth=up/N;
  const v=vixAt[i];
  for(const e of pool){e.f.breadth=breadth;e.f.vix=v;
    e.f.vixReg=v==null?null:(v<VLO?'LOW':v>VHI?'HIGH':'MID');}
}
console.log(`eligible symbol-dates ${dIdx.reduce((a,i)=>a+byDate.get(i).length,0).toLocaleString()} over ${dIdx.length} dates (>=50 names/date)\n`);
const L=[];const A=(id,fam,rat,fn)=>L.push({id,fam,rat,fn});
// Family C — cross-sectional rank
A('C1','xsect','top 5% 1d cross-sec rank -> continue', f=>f.pR1<=0.05?1:0);
A('C2','xsect','top 5% 1d cross-sec rank -> FADE',     f=>f.pR1<=0.05?-1:0);
A('C3','xsect','bottom 5% 1d rank -> continue(short)', f=>f.pR1>=0.95?-1:0);
A('C4','xsect','bottom 5% 1d rank -> FADE(long)',      f=>f.pR1>=0.95?1:0);
A('C5','xsect','top 5% 20d rank -> continue',          f=>f.pR20!=null&&f.pR20<=0.05?1:0);
A('C6','xsect','bottom 5% 20d rank -> FADE(long)',     f=>f.pR20!=null&&f.pR20>=0.95?1:0);
A('C7','xsect','top 5% relVol rank -> continue day dir',f=>(f.pRV<=0.05&&f.r1!==0)?Math.sign(f.r1):0);
A('C8','xsect','top 5% relVol rank -> FADE day dir',   f=>(f.pRV<=0.05&&f.r1!==0)?-Math.sign(f.r1):0);
// Family D — market-state conditioning
A('D1','state','HIGH VIX + top5% 1d rank -> FADE',     f=>(f.vixReg==='HIGH'&&f.pR1<=0.05)?-1:0);
A('D2','state','LOW VIX + top5% 1d rank -> continue',  f=>(f.vixReg==='LOW'&&f.pR1<=0.05)?1:0);
A('D3','state','HIGH VIX + bottom5% 1d -> FADE(long)', f=>(f.vixReg==='HIGH'&&f.pR1>=0.95)?1:0);
A('D4','state','breadth<0.25 (broad down) + bottom5% -> long', f=>(f.breadth<0.25&&f.pR1>=0.95)?1:0);
A('D5','state','breadth>0.75 (broad up) + top5% -> continue',  f=>(f.breadth>0.75&&f.pR1<=0.05)?1:0);
A('D6','state','breadth<0.25 -> long any stock',       f=>f.breadth<0.25?1:0);
A('D7','state','breadth>0.75 -> short any stock',      f=>f.breadth>0.75?-1:0);
// Family E — interactions
A('E1','interact','top5% 1d + top10% relVol -> continue', f=>(f.pR1<=0.05&&f.pRV<=0.10)?1:0);
A('E2','interact','bottom5% 1d + top10% relVol -> FADE(long)', f=>(f.pR1>=0.95&&f.pRV<=0.10)?1:0);
A('E3','interact','range compression then expansion + high relVol',
   f=>(f.mrng>0&&f.rng>2.5*f.mrng&&f.relVol>2&&f.r1!==0)?Math.sign(f.r1):0);
A('E4','interact','breadth<0.25 + HIGH VIX -> long',   f=>(f.breadth<0.25&&f.vixReg==='HIGH')?1:0);
A('E5','interact','top5% 1d + LOW VIX + breadth>0.6 -> continue',
   f=>(f.pR1<=0.05&&f.vixReg==='LOW'&&f.breadth>0.6)?1:0);
const TCRIT=3.03,ALPHA=0.05/L.length;
console.log(`conditions ${L.length}  Bonferroni ${ALPHA.toFixed(5)} -> |t|>${TCRIT}  hurdle ${HURDLE}%\n`);
let seed=4747;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
function run(fn){const sig=[],ctl=[];
 for(const i of dIdx){const pool=byDate.get(i);const fired=[];
  for(const e of pool){const d=fn(e.f);if(d){const r=fwd(e.m,i,d);if(r!=null)fired.push({sym:e.sym,dir:d,r,volB:e.f.volB,vB:e.f.vB});}}
  if(!fired.length)continue;
  sig.push({i,rows:fired});
  const cr=[];
  for(const s of fired){const cand=pool.filter(e=>e.sym!==s.sym&&e.f.volB===s.volB&&e.f.vB===s.vB);
   if(!cand.length)continue;const p=cand[Math.floor(rnd()*cand.length)];
   const r=fwd(p.m,i,s.dir);if(r!=null)cr.push({r});}
  if(cr.length)ctl.push({i,rows:cr});}
 return {sig,ctl};}
function clus(days,a,b){const v=days.filter(x=>x.i>=a&&x.i<b).map(x=>mean(x.rows.map(r=>r.r)));
 const se=v.length>1?sd(v)/Math.sqrt(v.length):NaN;
 return {n:v.length,mean:mean(v),t:se>0?mean(v)/se:NaN,v};}
const W=(x,y)=>(x.length<10||y.length<10)?NaN:(mean(x)-mean(y))/Math.sqrt(sd(x)**2/x.length+sd(y)**2/y.length);
console.log('ID  fam        dates | DEV sig%  ctrl%   DIFF     t    | VALID sig%  ctrl%  DIFF     t    | econ');
console.log('='.repeat(112));
const LED=[];
for(const h of L){
  const {sig,ctl}=run(h.fn);
  const ds=clus(sig,DEV[0],DEV[1]),dc=clus(ctl,DEV[0],DEV[1]);
  const vs=clus(sig,VAL[0],VAL[1]),vc=clus(ctl,VAL[0],VAL[1]);
  if(ds.n<100){console.log(`${h.id.padEnd(4)}${h.fam.padEnd(11)}${String(ds.n).padStart(5)}  too few dates`);
   LED.push({id:h.id,fam:h.fam,rat:h.rat,status:'INSUFFICIENT',reason:'too few dates'});continue;}
  const dD=ds.mean-dc.mean,vD=vs.mean-vc.mean;
  const dT=W(ds.v,dc.v),vT=W(vs.v,vc.v);
  const econ=Math.abs(dD)>HURDLE&&Math.abs(vD)>HURDLE;
  const pass=Math.abs(dT)>TCRIT&&Math.sign(dD)===Math.sign(vD)&&Math.abs(vT)>1.96&&econ;
  console.log(`${h.id.padEnd(4)}${h.fam.padEnd(11)}${String(ds.n).padStart(5)} |`+
   `${ds.mean.toFixed(3).padStart(8)}${dc.mean.toFixed(3).padStart(8)}${dD.toFixed(3).padStart(8)}${(Number.isFinite(dT)?dT.toFixed(2):'-').padStart(6)} |`+
   `${vs.mean.toFixed(3).padStart(9)}${vc.mean.toFixed(3).padStart(8)}${vD.toFixed(3).padStart(8)}${(Number.isFinite(vT)?vT.toFixed(2):'-').padStart(6)} |`+
   `${econ?' YES':'  no'}`+(pass?'  <== PASS':''));
  LED.push({id:h.id,fam:h.fam,rat:h.rat,devDates:ds.n,dD,dT,vD,vT,econ,status:pass?'SURVIVES':'REJECTED',
   reason:!Number.isFinite(dT)||Math.abs(dT)<=TCRIT?'fails DEV Bonferroni'
     :Math.sign(dD)!==Math.sign(vD)?'sign flip in VALID'
     :Math.abs(vT)<=1.96?'not significant in VALID':!econ?'below economic hurdle':'-'});
}
console.log('='.repeat(112));
const S=LED.filter(x=>x.status==='SURVIVES');
console.log(`\nSURVIVORS: ${S.length}`);
for(const s of S)console.log(`  ${s.id} ${s.rat}\n     DEV ${s.dD.toFixed(3)}% t=${s.dT.toFixed(2)} | VALID ${s.vD.toFixed(3)}% t=${s.vT.toFixed(2)}`);
if(!S.length)console.log('  NONE — TEST WINDOW NOT OPENED.');
const R={};for(const l of LED)R[l.reason]=(R[l.reason]||0)+1;
console.log('\nREJECTION REASONS:');for(const[k,v]of Object.entries(R))console.log(`  ${String(v).padStart(3)}  ${k}`);
const wt=LED.filter(x=>Number.isFinite(x.dT)).sort((a,b)=>Math.abs(b.dT)-Math.abs(a.dT))[0];
if(wt)console.log(`\nstrongest DEV |t|: ${wt.id} = ${Math.abs(wt.dT).toFixed(2)} (diff ${wt.dD.toFixed(3)}%, hurdle ${HURDLE}%)`);
fs.writeFileSync('/tmp/p4x_ledger.json',JSON.stringify(LED,null,1));
