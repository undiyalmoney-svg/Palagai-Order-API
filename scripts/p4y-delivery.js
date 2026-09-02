#!/usr/bin/env node
/** PHASE 4.Y — SINGLE-STOCK DELIVERY (MTO) EVENT FAMILY. Read-only.
 *  Program 438 tested delivery only at PORTFOLIO level (quarterly rebalance).
 *  This tests it as single-stock EVENTS: delivery% shock -> 5-day forward move.
 *  Same frozen universe/controls/hurdle/split as 4.0/4.X. TEST NOT READ. */
const fs=require('fs'),path=require('path');
const HOLD=5,MIN_PX=20,MIN_TV=5e7,MIN_HIST=60,HURDLE=0.658;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const J=JSON.parse(fs.readFileSync('/tmp/eq_panel.json','utf8'));
const dates=J.dates;const dIdxOf=new Map(dates.map((d,i)=>[d,i]));
const P=new Map(J.panel.map(([s,a])=>[s,new Map(a)]));
// ---- MTO delivery ----
const MR=process.argv[2];
const DEL=new Map();  // sym -> Map(dateIdx -> pct)
for(const f of fs.readdirSync(MR).filter(x=>x.endsWith('.dat'))){
  const d=f.replace('.dat','');const i=dIdxOf.get(d);if(i==null)continue;
  for(const l of fs.readFileSync(path.join(MR,f),'utf8').split(/\r?\n/)){
    if(!l.startsWith('20,'))continue;const c=l.split(',');
    if(c.length<7||(c[3]||'').trim()!=='EQ')continue;
    const s=(c[2]||'').trim(),p=+c[6];if(!s||!Number.isFinite(p))continue;
    if(!DEL.has(s))DEL.set(s,new Map());DEL.get(s).set(i,p);}
}
console.log(`MTO delivery loaded for ${DEL.size} symbols`);
const DEV=[0,dates.findIndex(d=>d>'2018-12-31')];
const VAL=[DEV[1],dates.findIndex(d=>d>'2022-12-31')];const LAST=VAL[1];
function feat(m,i,dm){
  const c=m.get(i);if(!c||!(c.c>=MIN_PX))return null;
  const hist=[];for(let k=i-20;k<i;k++){const b=m.get(k);if(b)hist.push(b);}
  if(hist.length<14)return null;
  const mtv=med(hist.map(b=>b.val||0));if(!(mtv>=MIN_TV))return null;
  let n=0;for(let k=i-MIN_HIST;k<i;k++)if(m.get(k))n++;if(n<MIN_HIST*0.7)return null;
  const p1=m.get(i-1);if(!p1)return null;
  const r1=(c.c-p1.c)/p1.c*100;
  const rets=[];for(let k=i-20;k<i;k++){const a=m.get(k),b=m.get(k-1);if(a&&b)rets.push((a.c-b.c)/b.c*100);}
  const vol=sd(rets);if(!(vol>0))return null;
  if(!dm)return null;
  const dNow=dm.get(i);if(dNow==null)return null;
  const dh=[];for(let k=i-20;k<i;k++){const v=dm.get(k);if(v!=null)dh.push(v);}
  if(dh.length<14)return null;
  const dMed=med(dh),dSd=sd(dh);
  const mv=med(hist.map(b=>b.v||0));const relVol=mv>0?c.v/mv:null;
  return {c,r1,vol,relVol,mtv,del:dNow,delMed:dMed,
    delZ:dSd>0?(dNow-dMed)/dSd:null, delRatio:dMed>0?dNow/dMed:null,
    volB:mtv>2e8?2:mtv>1e8?1:0,vB:vol>3?2:vol>1.8?1:0};
}
function fwd(m,i,dir){const e=m.get(i+1);if(!e||!(e.o>0))return null;
  const x=m.get(i+HOLD);if(!x||!(x.c>0))return null;return dir*((x.c-e.o)/e.o*100);}
const byDate=new Map();
for(const[sym,m]of P){const dm=DEL.get(sym);if(!dm)continue;
  for(const i of m.keys()){if(i<MIN_HIST||i+HOLD>=LAST)continue;
    const f=feat(m,i,dm);if(!f)continue;
    if(!byDate.has(i))byDate.set(i,[]);byDate.get(i).push({sym,f,m});}}
const dIdx=[...byDate.keys()].sort((a,b)=>a-b).filter(i=>byDate.get(i).length>=30);
for(const i of dIdx){const pool=byDate.get(i);const N=pool.length;
  const bd=[...pool].sort((a,b)=>b.f.del-a.f.del);bd.forEach((e,k)=>e.f.pDel=k/(N-1));}
console.log(`eligible symbol-dates ${dIdx.reduce((a,i)=>a+byDate.get(i).length,0).toLocaleString()} over ${dIdx.length} dates\n`);
const L=[];const A=(id,rat,fn)=>L.push({id,rat,fn});
A('Y1','delivery z>2 (spike) + price up -> continue',   f=>(f.delZ>2&&f.r1>0)?1:0);
A('Y2','delivery z>2 (spike) + price down -> continue', f=>(f.delZ>2&&f.r1<0)?-1:0);
A('Y3','delivery z>2 + price up -> FADE',               f=>(f.delZ>2&&f.r1>0)?-1:0);
A('Y4','delivery z>2 + price down -> FADE(long)',       f=>(f.delZ>2&&f.r1<0)?1:0);
A('Y5','delivery z<-2 (speculative) -> FADE day dir',   f=>(f.delZ<-2&&f.r1!==0)?-Math.sign(f.r1):0);
A('Y6','delivery z<-2 -> continue day dir',             f=>(f.delZ<-2&&f.r1!==0)?Math.sign(f.r1):0);
A('Y7','delivery ratio>1.5 + relVol>2 -> continue',     f=>(f.delRatio>1.5&&f.relVol>2&&f.r1!==0)?Math.sign(f.r1):0);
A('Y8','delivery ratio>1.5 + relVol>2 -> FADE',         f=>(f.delRatio>1.5&&f.relVol>2&&f.r1!==0)?-Math.sign(f.r1):0);
A('Y9','top 5% cross-sec delivery rank -> continue',    f=>(f.pDel<=0.05&&f.r1!==0)?Math.sign(f.r1):0);
A('Y10','bottom 5% cross-sec delivery rank -> FADE',    f=>(f.pDel>=0.95&&f.r1!==0)?-Math.sign(f.r1):0);
const TCRIT=2.81,ALPHA=0.05/L.length;
console.log(`conditions ${L.length}  Bonferroni ${ALPHA.toFixed(4)} -> |t|>${TCRIT}  hurdle ${HURDLE}%\n`);
let seed=4949;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
function run(fn){const sig=[],ctl=[];
 for(const i of dIdx){const pool=byDate.get(i);const fired=[];
  for(const e of pool){const d=fn(e.f);if(d){const r=fwd(e.m,i,d);if(r!=null)fired.push({sym:e.sym,dir:d,r,volB:e.f.volB,vB:e.f.vB});}}
  if(!fired.length)continue;sig.push({i,rows:fired});
  const cr=[];for(const s of fired){const cand=pool.filter(e=>e.sym!==s.sym&&e.f.volB===s.volB&&e.f.vB===s.vB);
   if(!cand.length)continue;const p=cand[Math.floor(rnd()*cand.length)];
   const r=fwd(p.m,i,s.dir);if(r!=null)cr.push({r});}
  if(cr.length)ctl.push({i,rows:cr});}
 return {sig,ctl};}
function clus(days,a,b){const v=days.filter(x=>x.i>=a&&x.i<b).map(x=>mean(x.rows.map(r=>r.r)));
 const se=v.length>1?sd(v)/Math.sqrt(v.length):NaN;return {n:v.length,mean:mean(v),t:se>0?mean(v)/se:NaN,v};}
const W=(x,y)=>(x.length<10||y.length<10)?NaN:(mean(x)-mean(y))/Math.sqrt(sd(x)**2/x.length+sd(y)**2/y.length);
console.log('ID   dates | DEV sig%  ctrl%   DIFF     t    | VALID sig%  ctrl%  DIFF     t    | econ');
console.log('='.repeat(102));
const LED=[];
for(const h of L){
  const {sig,ctl}=run(h.fn);
  const ds=clus(sig,DEV[0],DEV[1]),dc=clus(ctl,DEV[0],DEV[1]);
  const vs=clus(sig,VAL[0],VAL[1]),vc=clus(ctl,VAL[0],VAL[1]);
  if(ds.n<100){console.log(`${h.id.padEnd(5)}${String(ds.n).padStart(5)}  too few dates`);
   LED.push({id:h.id,rat:h.rat,status:'INSUFFICIENT',reason:'too few dates'});continue;}
  const dD=ds.mean-dc.mean,vD=vs.mean-vc.mean;
  const dT=W(ds.v,dc.v),vT=W(vs.v,vc.v);
  const econ=Math.abs(dD)>HURDLE&&Math.abs(vD)>HURDLE;
  const pass=Math.abs(dT)>TCRIT&&Math.sign(dD)===Math.sign(vD)&&Math.abs(vT)>1.96&&econ;
  console.log(`${h.id.padEnd(5)}${String(ds.n).padStart(5)} |`+
   `${ds.mean.toFixed(3).padStart(8)}${dc.mean.toFixed(3).padStart(8)}${dD.toFixed(3).padStart(8)}${(Number.isFinite(dT)?dT.toFixed(2):'-').padStart(6)} |`+
   `${vs.mean.toFixed(3).padStart(9)}${vc.mean.toFixed(3).padStart(8)}${vD.toFixed(3).padStart(8)}${(Number.isFinite(vT)?vT.toFixed(2):'-').padStart(6)} |`+
   `${econ?' YES':'  no'}`+(pass?'  <== PASS':''));
  LED.push({id:h.id,rat:h.rat,devDates:ds.n,dD,dT,vD,vT,econ,status:pass?'SURVIVES':'REJECTED',
   reason:!Number.isFinite(dT)||Math.abs(dT)<=TCRIT?'fails DEV Bonferroni'
     :Math.sign(dD)!==Math.sign(vD)?'sign flip in VALID'
     :Math.abs(vT)<=1.96?'not significant in VALID':!econ?'below economic hurdle':'-'});
}
console.log('='.repeat(102));
const S=LED.filter(x=>x.status==='SURVIVES');
console.log(`\nSURVIVORS: ${S.length}`);
if(!S.length)console.log('  NONE — TEST WINDOW NOT OPENED.');
else for(const s of S)console.log(`  ${s.id} ${s.rat}\n     DEV ${s.dD.toFixed(3)}% t=${s.dT.toFixed(2)} | VALID ${s.vD.toFixed(3)}% t=${s.vT.toFixed(2)}`);
const wt=LED.filter(x=>Number.isFinite(x.dT)).sort((a,b)=>Math.abs(b.dT)-Math.abs(a.dT))[0];
if(wt)console.log(`\nstrongest DEV |t|: ${wt.id} = ${Math.abs(wt.dT).toFixed(2)} (diff ${wt.dD.toFixed(3)}%, hurdle ${HURDLE}%)`);
fs.writeFileSync('/tmp/p4y_ledger.json',JSON.stringify(LED,null,1));
