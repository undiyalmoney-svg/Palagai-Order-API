#!/usr/bin/env node
/** PHASE 4.A — STOCK INTRADAY EVENTS. Spec a61cd63664eb8ae0. Read-only; no broker imports. */
const fs=require('fs'),path=require('path');
const EF='09:45',ET='14:45',HOLD=9,MINF=3,HURDLE=0.306;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const DIR=process.argv[2];
const SYMS=fs.readdirSync(DIR).filter(f=>f.endsWith('.json')).map(f=>f.replace('.json',''));
const S=new Map();
for(const s of SYMS){
  const rows=JSON.parse(fs.readFileSync(path.join(DIR,s+'.json'),'utf8'));
  const bySess=new Map();
  for(const r of rows){const d=r[0].slice(0,10);if(!bySess.has(d))bySess.set(d,[]);
    bySess.get(d).push({t:r[0],hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]});}
  S.set(s,bySess);
}
const allDates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
console.log(`symbols ${S.size} · sessions ${allDates.length} · ${allDates[0]} -> ${allDates[allDates.length-1]}`);
const DEV=d=>d<='2019-12-31', VAL=d=>d>='2020-01-01'&&d<='2022-12-31';
// TEST (>=2023) is never evaluated below.
function feat(arr,j){
  const b=arr[j];
  const vH=arr.slice(Math.max(0,j-20),j).map(x=>x.v), mv=med(vH);
  const rets=[];for(let k=Math.max(1,j-20);k<j;k++)rets.push((arr[k].c-arr[k-1].c)/arr[k-1].c*100);
  const vol=sd(rets); if(!(vol>0)||!(mv>0))return null;
  const r1=(b.c-arr[j-1].c)/arr[j-1].c*100;
  const rng=(b.h-b.l)/b.c*100, rH=arr.slice(Math.max(0,j-20),j).map(x=>(x.h-x.l)/x.c*100), mrng=med(rH);
  const body=b.c-b.o, clv=(b.h-b.l)>0?(b.c-b.l)/(b.h-b.l):0.5;
  const sO=arr[0].o; let sHi=-1e9,sLo=1e9;for(let k=0;k<=j;k++){sHi=Math.max(sHi,arr[k].h);sLo=Math.min(sLo,arr[k].l);}
  let orHi=null,orLo=null;
  if(j>=6){orHi=-1e9;orLo=1e9;for(let k=0;k<6;k++){orHi=Math.max(orHi,arr[k].h);orLo=Math.min(orLo,arr[k].l);}}
  const r3=j>=3?(b.c-arr[j-3].c)/arr[j-3].c*100:null;
  return {b,j,r1,r3,vol,relVol:b.v/mv,rng,mrng,body,clv,sO,sHi,sLo,orHi,orLo,
          fromOpen:(b.c-sO)/sO*100, vB:vol>0.25?2:vol>0.15?1:0};
}
function fwd(arr,j,dir){
  if(j+1>=arr.length)return null;
  const fill=arr[j+1].o; if(!(fill>0))return null;
  const end=Math.min(j+HOLD,arr.length-1); if(end-j<MINF)return null;
  return dir*((arr[end].c-fill)/fill*100);
}
const L=[];const A=(id,fam,rat,fn)=>L.push({id,fam,rat,fn});
A('A1','momentum','|5m move|>2*vol -> continue',    f=>Math.abs(f.r1)>2*f.vol?Math.sign(f.r1):0);
A('A2','momentum','|5m move|>3*vol -> continue',    f=>Math.abs(f.r1)>3*f.vol?Math.sign(f.r1):0);
A('A3','momentum','15m move>2.5*vol -> continue',   f=>f.r3!=null&&Math.abs(f.r3)>2.5*f.vol?Math.sign(f.r3):0);
A('A4','reversal','|5m move|>3*vol -> FADE',        f=>Math.abs(f.r1)>3*f.vol?-Math.sign(f.r1):0);
A('A5','reversal','15m move>2.5*vol -> FADE',       f=>f.r3!=null&&Math.abs(f.r3)>2.5*f.vol?-Math.sign(f.r3):0);
A('A6','reversal','exhaustion: big range + opposite close location',
   f=>{if(!(f.rng>2.5*f.mrng))return 0;return f.clv<0.2?1:f.clv>0.8?-1:0;});
A('A7','volume','relVol>4 -> continue bar dir',     f=>(f.relVol>4&&f.body!==0)?Math.sign(f.body):0);
A('A8','volume','relVol>6 -> continue bar dir',     f=>(f.relVol>6&&f.body!==0)?Math.sign(f.body):0);
A('A9','volume','relVol>4 -> FADE bar dir',         f=>(f.relVol>4&&f.body!==0)?-Math.sign(f.body):0);
A('A10','volume','relVol<0.4 quiet -> continue',    f=>(f.relVol<0.4&&f.body!==0)?Math.sign(f.body):0);
A('A11','range','range>3x median -> continue',      f=>(f.rng>3*f.mrng&&f.body!==0)?Math.sign(f.body):0);
A('A12','range','range>3x median -> FADE',          f=>(f.rng>3*f.mrng&&f.body!==0)?-Math.sign(f.body):0);
A('A13','range','compression then expansion + volume',
   f=>(f.rng>2.5*f.mrng&&f.relVol>2&&f.body!==0)?Math.sign(f.body):0);
A('A14','openrange','first close beyond OR30 -> continue',
   f=>{if(f.orHi==null)return 0;return f.b.c>f.orHi?1:f.b.c<f.orLo?-1:0;});
A('A15','openrange','first close beyond OR30 -> FADE',
   f=>{if(f.orHi==null)return 0;return f.b.c>f.orHi?-1:f.b.c<f.orLo?1:0;});
A('A16','openrange','OR30 break then reject -> fade',
   f=>{if(f.orHi==null)return 0;
       if(f.sHi>f.orHi&&f.b.c<f.orHi)return -1;if(f.sLo<f.orLo&&f.b.c>f.orLo)return 1;return 0;});
A('A17','session','first move >1.5% from session open -> continue',
   f=>Math.abs(f.fromOpen)>1.5?Math.sign(f.fromOpen):0);
A('A18','session','first move >1.5% from session open -> FADE',
   f=>Math.abs(f.fromOpen)>1.5?-Math.sign(f.fromOpen):0);
A('A19','session','new session extreme -> continue',
   f=>{if(f.j<6)return 0;if(f.b.c>=f.sHi-1e-9)return 1;if(f.b.c<=f.sLo+1e-9)return -1;return 0;});
A('A20','pricevol','big move REJECTED by low volume -> fade',
   f=>(f.rng>2.5*f.mrng&&f.relVol<0.8&&f.body!==0)?-Math.sign(f.body):0);
const TCRIT=3.02;
console.log(`conditions ${L.length}  Bonferroni ${(0.05/L.length).toFixed(5)} -> |t|>${TCRIT}  intraday hurdle ${HURDLE}%\n`);
let seed=4141;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
function run(fn){
  const sig=new Map(),ctl=new Map();
  for(const d of allDates){
    const fired=[],pool=[];
    for(const [sym,bs] of S){
      const arr=bs.get(d); if(!arr||arr.length<30)continue;
      let hit=null;
      for(let j=21;j<arr.length;j++){
        if(arr[j].hm<EF||arr[j].hm>ET)continue;
        const f=feat(arr,j); if(!f)continue;
        pool.push({sym,arr,j,f});
        if(hit)continue;
        const dir=fn(f); if(!dir)continue;
        const r=fwd(arr,j,dir); if(r==null)continue;
        hit={sym,dir,r,vB:f.vB,j};
      }
      if(hit)fired.push(hit);
    }
    if(!fired.length)continue;
    sig.set(d,fired.map(x=>x.r));
    const cr=[];
    for(const s of fired){
      const cand=pool.filter(p=>p.sym!==s.sym&&p.f.vB===s.vB&&Math.abs(p.j-s.j)<=3);
      if(!cand.length)continue;
      const p=cand[Math.floor(rnd()*cand.length)];
      const r=fwd(p.arr,p.j,s.dir); if(r!=null)cr.push(r);
    }
    if(cr.length)ctl.set(d,cr);
  }
  return {sig,ctl};
}
function clus(m,pred){const v=[];for(const[d,a]of m)if(pred(d))v.push(mean(a));
  const se=v.length>1?sd(v)/Math.sqrt(v.length):NaN;return {n:v.length,mean:mean(v),t:se>0?mean(v)/se:NaN,v};}
const W=(x,y)=>(x.length<10||y.length<10)?NaN:(mean(x)-mean(y))/Math.sqrt(sd(x)**2/x.length+sd(y)**2/y.length);
console.log('ID   fam        dates | DEV sig%  ctrl%   DIFF     t    | VALID sig%  ctrl%  DIFF     t    | econ');
console.log('='.repeat(112));
const LED=[];
for(const h of L){
  const {sig,ctl}=run(h.fn);
  const ds=clus(sig,DEV),dc=clus(ctl,DEV),vs=clus(sig,VAL),vc=clus(ctl,VAL);
  if(ds.n<100){console.log(`${h.id.padEnd(5)}${h.fam.padEnd(11)}${String(ds.n).padStart(5)}  too few`);
    LED.push({id:h.id,fam:h.fam,rat:h.rat,status:'INSUFFICIENT',reason:'too few dates'});continue;}
  const dD=ds.mean-dc.mean,vD=vs.mean-vc.mean,dT=W(ds.v,dc.v),vT=W(vs.v,vc.v);
  const econ=Math.abs(dD)>HURDLE&&Math.abs(vD)>HURDLE;
  const pass=Math.abs(dT)>TCRIT&&Math.sign(dD)===Math.sign(vD)&&Math.abs(vT)>1.96&&econ;
  console.log(`${h.id.padEnd(5)}${h.fam.padEnd(11)}${String(ds.n).padStart(5)} |`+
   `${ds.mean.toFixed(3).padStart(8)}${dc.mean.toFixed(3).padStart(8)}${dD.toFixed(3).padStart(8)}${(Number.isFinite(dT)?dT.toFixed(2):'-').padStart(6)} |`+
   `${vs.mean.toFixed(3).padStart(9)}${vc.mean.toFixed(3).padStart(8)}${vD.toFixed(3).padStart(8)}${(Number.isFinite(vT)?vT.toFixed(2):'-').padStart(6)} |`+
   `${econ?' YES':'  no'}`+(pass?'  <== PASS':''));
  LED.push({id:h.id,fam:h.fam,rat:h.rat,devDates:ds.n,dD,dT,vD,vT,econ,status:pass?'SURVIVES':'REJECTED',
   reason:!Number.isFinite(dT)||Math.abs(dT)<=TCRIT?'fails DEV Bonferroni'
     :Math.sign(dD)!==Math.sign(vD)?'sign flip in VALID'
     :Math.abs(vT)<=1.96?'not significant in VALID':!econ?'below economic hurdle':'-'});
}
console.log('='.repeat(112));
const SV=LED.filter(x=>x.status==='SURVIVES');
console.log(`\nSURVIVORS: ${SV.length}`);
for(const s of SV)console.log(`  ${s.id} ${s.rat}\n     DEV ${s.dD.toFixed(3)}% t=${s.dT.toFixed(2)} | VALID ${s.vD.toFixed(3)}% t=${s.vT.toFixed(2)}`);
if(!SV.length)console.log('  NONE — TEST WINDOW NOT OPENED.');
const R={};for(const l of LED)R[l.reason]=(R[l.reason]||0)+1;
console.log('\nREJECTION REASONS:');for(const[k,v]of Object.entries(R))console.log(`  ${String(v).padStart(3)}  ${k}`);
const wt=LED.filter(x=>Number.isFinite(x.dT)).sort((a,b)=>Math.abs(b.dT)-Math.abs(a.dT))[0];
if(wt)console.log(`\nstrongest DEV |t|: ${wt.id} = ${Math.abs(wt.dT).toFixed(2)} (diff ${wt.dD.toFixed(3)}%, hurdle ${HURDLE}%)`);
fs.writeFileSync('/tmp/p4a_ledger.json',JSON.stringify(LED,null,1));
