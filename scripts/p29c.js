#!/usr/bin/env node
/** PHASE 2.9c — GAPS LEFT OPEN IN 2.9:
 *  (1) VOLATILITY-REGIME-MATCHED control  [brief section 11] — the decisive test
 *  (2) placebo timing for the magnitude effects [section 12]
 *  (3) first vs subsequent occurrence [section 10]
 *  (4) extra volatility measures: range, MAE+MFE [section 8]
 *  DEV+VALID ONLY. TEST filtered at load. */
const fs=require('fs');
const EF='09:45',ET='14:45';
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const pc=(a,f)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*f))];};
const all=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const C=all.filter(r=>r.t<'2023-01-01').map(r=>({t:r.t,d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c}));
const N=C.length;const days=[];const di=new Map();
{let cur=null;for(let i=0;i<N;i++){if(C[i].d!==cur){cur=C[i].d;days.push(cur);di.set(cur,[i,i]);}else di.get(cur)[1]=i;}}
const prevC=new Map(),gaps=[];
for(let k=1;k<days.length;k++){const[,pe]=di.get(days[k-1]);const[cs]=di.get(days[k]);
 prevC.set(days[k],C[pe].c);gaps.push(Math.abs(C[cs].o-C[pe].c)/C[pe].c);}
const GP75=pc(gaps,.75);
/** trailing realised vol at bar i (20-bar), the conditioning variable for matching */
const TV=new Float64Array(N);
for(let i=0;i<N;i++){const r=[];for(let k=Math.max(1,i-19);k<=i;k++){if(C[k].d===C[i].d)r.push(C[k].c-C[k-1].c);}TV[i]=r.length>2?sd(r):NaN;}
function fwd(i,dir){
  if(i+1>=N||C[i+1].d!==C[i].d)return null;
  const fill=C[i+1].o,day=C[i].d;let last=fill,bars=0,mae=0,mfe=0,rng=0;
  for(let k=i+1;k<=Math.min(i+9,N-1);k++){if(C[k].d!==day)break;
    const up=dir>0?C[k].h-fill:fill-C[k].l,dn=dir>0?fill-C[k].l:C[k].h-fill;
    if(dn>mae)mae=dn;if(up>mfe)mfe=up;rng+=C[k].h-C[k].l;last=C[k].c;bars=k-i;}
  if(bars<3)return null;
  const ret=dir*(last-fill);
  return {d:day,hm:C[i].hm,dir,i,ret,abs:Math.abs(ret),sq:ret*ret,rng,span:mae+mfe,tv:TV[i]};
}
function sessRows(d){const[s,e]=di.get(d);const rows=[];let sHi=-1e9,sLo=1e9;const rt=[];
 for(let i=s;i<=e;i++){sHi=Math.max(sHi,C[i].h);sLo=Math.min(sLo,C[i].l);if(i>s)rt.push(C[i].c-C[i-1].c);
  rows.push({i,b:C[i],barsIn:i-s,sHi,sLo,sigma:sd(rt.slice(-20)),prevC:prevC.get(d)??null});}
 return {rows,s,e};}
const SESS=new Map();for(const d of days)SESS.set(d,sessRows(d));
const EV={
 'G gap>p75 first bar':(r,S)=>{if(r.prevC==null||r.barsIn<1)return 0;const g=C[S.s].o-r.prevC;
   return Math.abs(g)/r.b.c>GP75?Math.sign(g):0;},
 'E compression -> expansion':(r)=>{const i=r.i;if(i-20<0)return 0;let a=0;for(let k=i-20;k<i;k++)a+=C[k].h-C[k].l;a/=20;
   const rg=r.b.h-r.b.l,m=r.b.c-r.b.o;return (a>0&&rg>2*a&&m!==0)?Math.sign(m):0;},
};
/** all occurrences, tagged first vs subsequent, with optional entry shift */
function fireAll(fn,shift=0){const first=[],sub=[];
 for(const d of days){const S=SESS.get(d);if(S.e-S.s<12)continue;let seen=false;
  for(const r of S.rows){if(r.b.hm<EF||r.b.hm>ET)continue;const dir=fn(r,S);if(!dir)continue;
   const o=fwd(r.i+shift,dir);if(o){(seen?sub:first).push(o);}seen=true;}}
 return {first,sub};}
let seed=99;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
// pools bucketed by (time-of-day, trailing-vol decile) for regime-matched control
const bucket=new Map();
const tvAll=[...TV].filter(Number.isFinite).sort((a,b)=>a-b);
const decile=v=>{if(!Number.isFinite(v))return -1;let lo=0,hi=9;
  for(let d=1;d<10;d++)if(v>tvAll[Math.floor(tvAll.length*d/10)])lo=d;return lo;};
for(let i=0;i<N;i++){if(C[i].hm<EF||C[i].hm>ET)continue;const k=C[i].hm+'|'+decile(TV[i]);
  if(!bucket.has(k))bucket.set(k,[]);bucket.get(k).push(i);}
const byHm=new Map();for(let i=0;i<N;i++){if(!byHm.has(C[i].hm))byHm.set(C[i].hm,[]);byHm.get(C[i].hm).push(i);}
function ctrlPlain(sg){const o=[];for(const s of sg){const p=byHm.get(s.hm)||[];if(p.length<2)continue;
 let j,t=0;do{j=p[Math.floor(rnd()*p.length)];t++;}while(C[j].d===s.d&&t<8);
 const r=fwd(j,s.dir);if(r)o.push(r);}return o;}
function ctrlVolMatched(sg){const o=[];let miss=0;
 for(const s of sg){const k=s.hm+'|'+decile(s.tv);const p=bucket.get(k)||[];
  if(p.length<3){miss++;continue;}
  let j,t=0;do{j=p[Math.floor(rnd()*p.length)];t++;}while(C[j].d===s.d&&t<10);
  const r=fwd(j,s.dir);if(r)o.push(r);}
 return {rows:o,miss};}
function W(a,b){if(a.length<10||b.length<10)return NaN;
  return (mean(a)-mean(b))/Math.sqrt(sd(a)**2/a.length+sd(b)**2/b.length);}

console.log('DECISIVE TEST — does the magnitude effect survive a VOLATILITY-REGIME-MATCHED control?');
console.log('(control matched on time-of-day AND trailing-20-bar realised-vol decile AND direction)\n');
console.log('event                     n    | plain ctrl: ratio   t   | VOL-MATCHED ctrl: ratio   t   | dropped');
for(const[n,fn]of Object.entries(EV)){
  const {first}=fireAll(fn);
  const cp=ctrlPlain(first), cv=ctrlVolMatched(first);
  const a=first.map(x=>x.abs), bp=cp.map(x=>x.abs), bv=cv.rows.map(x=>x.abs);
  console.log(`${n.padEnd(26)}${String(first.length).padStart(4)} |`+
    `${(mean(a)/mean(bp)).toFixed(2).padStart(12)} ${W(a,bp).toFixed(2).padStart(6)} |`+
    `${(mean(a)/mean(bv)).toFixed(2).padStart(18)} ${W(a,bv).toFixed(2).padStart(6)} |`+
    `${String(cv.miss).padStart(7)}`);
}
console.log('\nOTHER VOLATILITY MEASURES vs VOL-MATCHED control (ratio signal/control)');
console.log('event                     |abs ret|  sq ret  sum range  MAE+MFE');
for(const[n,fn]of Object.entries(EV)){
  const {first}=fireAll(fn);const cv=ctrlVolMatched(first).rows;
  const R=(f)=>{const a=first.map(f),b=cv.map(f);return mean(b)?(mean(a)/mean(b)).toFixed(2):'-';};
  console.log(`${n.padEnd(26)}${R(x=>x.abs).padStart(8)}${R(x=>x.sq).padStart(9)}${R(x=>x.rng).padStart(11)}${R(x=>x.span).padStart(9)}`);
}
console.log('\nPLACEBO TIMING — magnitude ratio (vol-matched) as entry is delayed');
console.log('event                      +0     +1     +2     +3     +5   bars');
for(const[n,fn]of Object.entries(EV)){
  let row=`${n.padEnd(26)}`;
  for(const s of [0,1,2,3,5]){
    const {first}=fireAll(fn,s);const cv=ctrlVolMatched(first).rows;
    const a=first.map(x=>x.abs),b=cv.map(x=>x.abs);
    row+=(mean(b)?(mean(a)/mean(b)).toFixed(2):'-').padStart(7);}
  console.log(row);
}
console.log('\nFIRST vs SUBSEQUENT OCCURRENCE (magnitude ratio vs vol-matched control)');
console.log('event                      first  n      subsequent  n');
for(const[n,fn]of Object.entries(EV)){
  const {first,sub}=fireAll(fn);
  const c1=ctrlVolMatched(first).rows, c2=ctrlVolMatched(sub).rows;
  const r=(s,c)=>{const a=s.map(x=>x.abs),b=c.map(x=>x.abs);return (s.length>30&&mean(b))?(mean(a)/mean(b)).toFixed(2):'-';};
  console.log(`${n.padEnd(26)}${r(first,c1).padStart(6)} ${String(first.length).padStart(5)}${r(sub,c2).padStart(12)} ${String(sub.length).padStart(5)}`);
}
