#!/usr/bin/env node
/** SEPTEMBER READINESS — FINAL FUTURES MICROSTRUCTURE SEARCH. Read-only; no broker imports.
 *  Features: NIFTY front-futures 5-min VOLUME and TRUE INTRADAY OI, bars <= i only.
 *  Target:   NIFTY INDEX forward 45-min return, entry at INDEX bar i+1 OPEN.
 *            (Returns are never computed on the futures price, so no roll artefact.)
 *  Sample:   43 sessions. DELIBERATELY NOT split into DEV/VALID/TEST — that would be
 *            theatre at ~21 sessions per arm. Single exploratory pass, matched controls,
 *            and an explicit power analysis. Result is DATA-LIMITED by construction. */
const fs=require('fs');
const EF='09:45',ET='14:45',HOLD=9,MINF=3;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
// ---- index ----
const IDX=JSON.parse(fs.readFileSync(process.argv[2],'utf8'))
  .map(r=>({t:r.t,d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c}));
const N=IDX.length;const iAt=new Map();IDX.forEach((b,i)=>iAt.set(b.t,i));
const days=[...new Set(IDX.map(b=>b.d))].sort();
const TV=new Float64Array(N);
for(let i=0;i<N;i++){const r=[];for(let k=Math.max(1,i-19);k<=i;k++){if(IDX[k].d===IDX[i].d)r.push(IDX[k].c-IDX[k-1].c);}TV[i]=r.length>2?sd(r):NaN;}
const BND=JSON.parse(fs.readFileSync('/tmp/frozen_bounds.json','utf8')).bounds;
const dec=v=>{let lo=0;for(let d=0;d<9;d++)if(v>BND[d])lo=d+1;return lo;};
// ---- futures front contract ----
const F=fs.readFileSync(process.argv[3],'utf8').split('\n').filter(x=>x.trim()).map(JSON.parse)
  .filter(o=>o._type==='candle'&&o.tradingsymbol===process.argv[4])
  .sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
const fBy=new Map();for(const c of F){if(!fBy.has(c.trading_date))fBy.set(c.trading_date,[]);fBy.get(c.trading_date).push(c);}
const fSessions=[...fBy.keys()].filter(d=>iAt.has(d+'T09:45:00+0530')).sort();
console.log(`futures contract ${process.argv[4]}  sessions ${fBy.size}  overlapping index sessions ${fSessions.length}`);
console.log(`sample = ${fSessions.length} sessions. NOT split — see power analysis.\n`);
function fwd(ii,dir){
  if(ii+1>=N||IDX[ii+1].d!==IDX[ii].d)return null;
  const fill=IDX[ii+1].o,day=IDX[ii].d;let last=fill,bars=0;
  for(let k=ii+1;k<=Math.min(ii+HOLD,N-1);k++){if(IDX[k].d!==day)break;last=IDX[k].c;bars=k-ii;}
  if(bars<MINF)return null;
  return {d:day,hm:IDX[ii].hm,dir,ret:dir*(last-fill),vdec:dec(TV[ii])};
}
/** causal futures features at futures-bar index j within its session */
function feat(arr,j){
  const b=arr[j];
  const vHist=arr.slice(Math.max(0,j-20),j).map(x=>x.volume);
  const mv=med(vHist), av=mean(vHist);
  const oi=b.open_interest, oiPrev=j>0?arr[j-1].open_interest:null;
  const oi5=j>=1?oi-arr[j-1].open_interest:null;
  const oi15=j>=3?oi-arr[j-3].open_interest:null;
  const oiHist=[];for(let k=Math.max(1,j-20);k<j;k++)oiHist.push(arr[k].open_interest-arr[k-1].open_interest);
  const oiSd=sd(oiHist);
  const rng=b.high-b.low, body=b.close-b.open;
  const rHist=arr.slice(Math.max(0,j-20),j).map(x=>x.high-x.low);
  const mr=med(rHist);
  return {b,relVol:mv>0?b.volume/mv:null, volZ:av>0?(b.volume-av)/Math.max(1e-9,sd(vHist)):null,
    oi,oi5,oi15,oiZ:oiSd>0&&oi5!=null?oi5/oiSd:null,
    oiPct:oiPrev>0&&oi5!=null?oi5/oiPrev:null,
    body,rng,relRng:mr>0?rng/mr:null,
    volAcc:j>=1&&arr[j-1].volume>0?b.volume/arr[j-1].volume:null};
}
// ---------- FROZEN LIBRARY (20 conditions, each two-sided) ----------
const L=[];const A=(id,fam,rat,fn)=>L.push({id,fam,rat,fn});
A('V1','volume','relVol>2 -> continue bar direction',      f=>f.relVol>2&&f.body!==0?Math.sign(f.body):0);
A('V2','volume','relVol>3 -> continue bar direction',      f=>f.relVol>3&&f.body!==0?Math.sign(f.body):0);
A('V3','volume','relVol<0.5 (quiet) -> continue',          f=>f.relVol!=null&&f.relVol<0.5&&f.body!==0?Math.sign(f.body):0);
A('V4','volume','volume acceleration >2.5x prior bar',     f=>f.volAcc>2.5&&f.body!==0?Math.sign(f.body):0);
A('V5','volume','volume z-score >2.5',                     f=>f.volZ>2.5&&f.body!==0?Math.sign(f.body):0);
A('O1','oi','5-min dOI z-score >2.5 -> continue',          f=>f.oiZ>2.5&&f.body!==0?Math.sign(f.body):0);
A('O2','oi','5-min dOI z-score <-2.5 (unwind) -> continue',f=>f.oiZ<-2.5&&f.body!==0?Math.sign(f.body):0);
A('O3','oi','15-min OI expansion >0.5% -> continue',       f=>f.oiPct!=null&&f.oi15!=null&&f.oi>0&&(f.oi15/f.oi)>0.005&&f.body!==0?Math.sign(f.body):0);
A('O4','oi','15-min OI contraction <-0.3% -> continue',    f=>f.oi15!=null&&f.oi>0&&(f.oi15/f.oi)<-0.003&&f.body!==0?Math.sign(f.body):0);
A('PV1','price_vol','up bar CONFIRMED by relVol>2',        f=>(f.body>0&&f.relVol>2)?1:0);
A('PV2','price_vol','down bar CONFIRMED by relVol>2',      f=>(f.body<0&&f.relVol>2)?-1:0);
A('PV3','price_vol','big bar REJECTED by low volume (<0.8)',f=>(f.relRng>2&&f.relVol!=null&&f.relVol<0.8&&f.body!==0)?-Math.sign(f.body):0);
A('PV4','price_vol','range expansion + volume expansion',  f=>(f.relRng>2&&f.relVol>2&&f.body!==0)?Math.sign(f.body):0);
A('PO1','price_oi','price UP + OI UP (long buildup)',      f=>(f.body>0&&f.oi5>0)?1:0);
A('PO2','price_oi','price DOWN + OI UP (short buildup)',   f=>(f.body<0&&f.oi5>0)?-1:0);
A('PO3','price_oi','price UP + OI DOWN (short covering)',  f=>(f.body>0&&f.oi5<0)?-1:0);
A('PO4','price_oi','price DOWN + OI DOWN (long unwind)',   f=>(f.body<0&&f.oi5<0)?1:0);
A('VO1','vol_oi','volume shock + OI shock together',       f=>(f.relVol>2&&f.oiZ>2&&f.body!==0)?Math.sign(f.body):0);
A('VO2','vol_oi','volume shock WITHOUT OI expansion',      f=>(f.relVol>2&&f.oiZ!=null&&f.oiZ<0.5&&f.body!==0)?Math.sign(f.body):0);
A('VO3','vol_oi','first simultaneous vol+OI contraction',  f=>(f.relVol!=null&&f.relVol<0.6&&f.oiZ<-1&&f.body!==0)?Math.sign(f.body):0);

const cp='./live/charge-entry-gate.js';const src=fs.readFileSync(cp,'utf8');
const mm=new module.constructor();mm._compile(src+'\nmodule.exports.__c=estimateRoundTripCharges;',cp);
const hurdle=(mm.exports.__c({entryPrice:120,exitPrice:120,quantity:65}).totalRs+40)/(65*0.5);
const ALPHA=0.05/L.length, TCRIT=3.02;
console.log(`conditions ${L.length}  Bonferroni ${ALPHA.toFixed(5)} -> |t|>${TCRIT}  economic hurdle ${hurdle.toFixed(2)} index pts\n`);
function fire(fn){const out=[];
 for(const d of fSessions){const arr=fBy.get(d);
  for(let j=21;j<arr.length;j++){
   const hm=arr[j].timestamp.slice(11,16); if(hm<EF||hm>ET)continue;
   const dir=fn(feat(arr,j)); if(!dir)continue;
   const ii=iAt.get(arr[j].timestamp); if(ii==null)break;
   const o=fwd(ii,dir); if(o)out.push(o); break;}}
 return out;}
let seed=380038;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const bk=new Map();
for(let i=0;i<N;i++){const hm=IDX[i].hm;if(hm<EF||hm>ET)continue;if(!Number.isFinite(TV[i]))continue;
 const k=hm+'|'+dec(TV[i]);if(!bk.has(k))bk.set(k,[]);bk.get(k).push(i);}
function ctrl(sg){const o=[];for(const s of sg){const p=bk.get(s.hm+'|'+s.vdec)||[];if(p.length<2)continue;
 let j,t=0;do{j=p[Math.floor(rnd()*p.length)];t++;}while(IDX[j].d===s.d&&t<10);
 const r=fwd(j,s.dir);if(r)o.push(r);}return o;}
const W=(a,b)=>(a.length<8||b.length<8)?NaN:(mean(a)-mean(b))/Math.sqrt(sd(a)**2/a.length+sd(b)**2/b.length);
console.log('ID   fam         n  long% | signal   ctrl    DIFF     t     | econ? | power: n needed @80%');
console.log('='.repeat(104));
const LED=[];
for(const h of L){
  const sg=fire(h.fn); const ct=ctrl(sg);
  if(sg.length<8){console.log(`${h.id.padEnd(5)}${h.fam.padEnd(12)}${String(sg.length).padStart(3)}  too few`);
   LED.push({id:h.id,fam:h.fam,rat:h.rat,n:sg.length,status:'INSUFFICIENT'});continue;}
  const a=sg.map(x=>x.ret), b=ct.map(x=>x.ret);
  const diff=mean(a)-mean(b), t=W(a,b);
  const lp=100*sg.filter(x=>x.dir>0).length/sg.length;
  const pooled=Math.sqrt((sd(a)**2+sd(b)**2)/2);
  const d=pooled>0?diff/pooled:0;
  const need=Math.abs(d)>0.01?Math.ceil(2*Math.pow((1.96+0.84)/Math.abs(d),2)):999999;
  const econ=Math.abs(diff)>hurdle;
  console.log(`${h.id.padEnd(5)}${h.fam.padEnd(12)}${String(sg.length).padStart(3)} ${lp.toFixed(0).padStart(4)}% |`+
   `${mean(a).toFixed(2).padStart(7)}${mean(b).toFixed(2).padStart(8)}${diff.toFixed(2).padStart(8)}${(Number.isFinite(t)?t.toFixed(2):'  -').padStart(7)}   |`+
   `${econ?' YES':'  no'}  |${String(need>99999?'>99999':need).padStart(12)}`);
  LED.push({id:h.id,fam:h.fam,rat:h.rat,n:sg.length,lp,sig:mean(a),ctl:mean(b),diff,t,d,need,econ,
    status:(Number.isFinite(t)&&Math.abs(t)>TCRIT&&econ)?'PASSES_SINGLE_SAMPLE':'REJECTED'});
}
console.log('='.repeat(104));
const P=LED.filter(x=>x.status==='PASSES_SINGLE_SAMPLE');
console.log(`\nconditions clearing Bonferroni AND the economic hurdle on this single 43-session sample: ${P.length}`);
for(const p of P)console.log(`  ${p.id} ${p.rat}\n     diff ${p.diff.toFixed(2)} pts  t=${p.t.toFixed(2)}  n=${p.n}  Cohen d=${p.d.toFixed(3)}  n needed @80% = ${p.need}`);
if(!P.length)console.log('  NONE.');
const withT=LED.filter(x=>Number.isFinite(x.t));
const best=withT.sort((a,b)=>Math.abs(b.t)-Math.abs(a.t))[0];
if(best)console.log(`\nstrongest |t| observed: ${best.id} = ${Math.abs(best.t).toFixed(2)} (threshold ${TCRIT}), diff ${best.diff.toFixed(2)} pts, n=${best.n}`);
const medNeed=med(withT.map(x=>x.need).filter(x=>x<99999));
console.log(`median sample required for 80% power across measurable conditions: ${Number.isFinite(medNeed)?Math.round(medNeed):'n/a'} events`);
console.log(`current sample: ${fSessions.length} sessions (<=1 event/session)`);
fs.writeFileSync('/tmp/p38_ledger.json',JSON.stringify(LED,null,1));
