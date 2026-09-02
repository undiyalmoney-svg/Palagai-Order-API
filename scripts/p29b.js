#!/usr/bin/env node
/** PHASE 2.9b — bias-corrected threshold crossing + timing signature + regime + outliers.
 *  DEV+VALID ONLY. Same-bar ambiguity now resolved ADVERSELY (conservative). */
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
/** CONSERVATIVE first-hit: if a bar touches BOTH +x and -x, record '-' (adverse first). */
function path(i,dir){
  if(i+1>=N||C[i+1].d!==C[i].d)return null;
  const fill=C[i+1].o,day=C[i].d;const thr=[1,2,3,5,10];const hit={};for(const x of thr)hit[x]=null;
  const cum=[];let last=fill,bars=0;
  for(let k=i+1;k<=Math.min(i+24,N-1);k++){
    if(C[k].d!==day)break;
    const up=dir>0?C[k].h-fill:fill-C[k].l, dn=dir>0?fill-C[k].l:C[k].h-fill;
    for(const x of thr) if(hit[x]===null){ if(dn>=x)hit[x]='-'; else if(up>=x)hit[x]='+'; }
    last=C[k].c;bars=k-i;cum.push(dir*(last-fill));
  }
  if(bars<1)return null;
  return {d:day,hm:C[i].hm,dir,hit,cum,bars,ret45:cum[Math.min(8,cum.length-1)],
    absAt:(n)=>Math.abs(cum[Math.min(n-1,cum.length-1)])};
}
const EV={
 'A extreme bar 3sig (C2-3, FAILED TEST)':(r)=>{if(!(r.sigma>0))return 0;const m=r.b.c-r.b.o;return Math.abs(m)>3*r.sigma?Math.sign(m):0;},
 'E compression -> expansion':(r)=>{const i=r.i;if(i-20<0)return 0;let a=0;for(let k=i-20;k<i;k++)a+=C[k].h-C[k].l;a/=20;
   const rg=r.b.h-r.b.l,m=r.b.c-r.b.o;return (a>0&&rg>2*a&&m!==0)?Math.sign(m):0;},
 'G gap>p75 first bar':(r,S)=>{if(r.prevC==null||r.barsIn<1)return 0;const g=C[S.s].o-r.prevC;
   return Math.abs(g)/r.b.c>GP75?Math.sign(g):0;},
 'D sweep/reject extreme':(r)=>{const i=r.i;if(r.barsIn<3)return 0;
   if(r.b.h>=r.sHi-1e-9&&r.b.c<C[i-1].l)return -1;if(r.b.l<=r.sLo+1e-9&&r.b.c>C[i-1].h)return 1;return 0;},
};
function sessRows(d){const[s,e]=di.get(d);const rows=[];let sHi=-1e9,sLo=1e9;const rets=[];
 for(let i=s;i<=e;i++){sHi=Math.max(sHi,C[i].h);sLo=Math.min(sLo,C[i].l);if(i>s)rets.push(C[i].c-C[i-1].c);
  rows.push({i,b:C[i],barsIn:i-s,sHi,sLo,sigma:sd(rets.slice(-20)),prevC:prevC.get(d)??null});}
 return {rows,s,e};}
const SESS=new Map();for(const d of days)SESS.set(d,sessRows(d));
function fire(fn){const o=[];for(const d of days){const S=SESS.get(d);if(S.e-S.s<26)continue;
 for(const r of S.rows){if(r.b.hm<EF||r.b.hm>ET)continue;const dir=fn(r,S);if(!dir)continue;
  const p=path(r.i,dir);if(p)o.push(p);break;}}return o;}
let seed=31;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const byHm=new Map();for(let i=0;i<N;i++){if(!byHm.has(C[i].hm))byHm.set(C[i].hm,[]);byHm.get(C[i].hm).push(i);}
function ctrl(sg){const o=[];for(const s of sg){const p=byHm.get(s.hm)||[];if(p.length<2)continue;
 let j,t=0;do{j=p[Math.floor(rnd()*p.length)];t++;}while(C[j].d===s.d&&t<8);
 const r=path(j,s.dir);if(r)o.push(r);}return o;}

console.log('1. THRESHOLD CROSSING — BIAS CORRECTED (same-bar tie resolved ADVERSELY)');
console.log('event                                    n  | +1/-1 ctrl | +3/-3 ctrl | +5/-5 ctrl');
const F={},K={};
for(const[n,fn]of Object.entries(EV)){
  const sg=fire(fn);F[n]=sg;const ct=ctrl(sg);K[n]=ct;
  let row=`${n.padEnd(40)}${String(sg.length).padStart(4)} |`;
  for(const x of [1,3,5]){
    const f=rs=>{const h=rs.map(r=>r.hit[x]).filter(v=>v);return h.length?100*h.filter(v=>v==='+').length/h.length:NaN;};
    row+=`${f(sg).toFixed(1).padStart(6)}${f(ct).toFixed(1).padStart(6)} |`;}
  console.log(row);
}
console.log('\n2. TIMING SIGNATURE — cumulative signal-minus-control (index pts) by bar');
console.log('event                                bar: 1    2    3    4    6    9   12   18   24');
for(const[n,sg]of Object.entries(F)){
  const ct=K[n];let row=`${n.padEnd(38)}`;
  for(const b of [1,2,3,4,6,9,12,18,24]){
    const a=sg.map(r=>r.cum[Math.min(b-1,r.cum.length-1)]).filter(Number.isFinite);
    const c=ct.map(r=>r.cum[Math.min(b-1,r.cum.length-1)]).filter(Number.isFinite);
    row+=`${(mean(a)-mean(c)).toFixed(1).padStart(5)}`;}
  console.log(row);
}
console.log('\n3. MAGNITUDE RATIO by FIXED CHRONOLOGICAL BLOCK  (E[|ret45|] signal / control)');
console.log('event                              2015-2017  2018-2020  2021-2022');
const BLK=[['2015-2017','2015','2017-12-31'],['2018-2020','2018','2020-12-31'],['2021-2022','2021','2022-12-31']];
for(const[n,sg]of Object.entries(F)){
  const ct=K[n];let row=`${n.padEnd(36)}`;
  for(const[l,a,b]of BLK){
    const s=sg.filter(r=>r.d>=a&&r.d<=b).map(r=>Math.abs(r.ret45));
    const c=ct.filter(r=>r.d>=a&&r.d<=b).map(r=>Math.abs(r.ret45));
    row+=(s.length>30&&mean(c)?`${(mean(s)/mean(c)).toFixed(2)}(n=${s.length})`:'   -').padStart(11);}
  console.log(row);
}
console.log('\n4. OUTLIER ROBUSTNESS of the MAGNITUDE effect (E[|ret45|] ratio)');
console.log('event                              full  trim1%  trim5%   median-ratio');
for(const[n,sg]of Object.entries(F)){
  const ct=K[n];
  const s=sg.map(r=>Math.abs(r.ret45)).sort((a,b)=>a-b), c=ct.map(r=>Math.abs(r.ret45)).sort((a,b)=>a-b);
  if(!s.length||!c.length)continue;
  const tr=(a,f)=>a.slice(0,Math.max(1,Math.floor(a.length*(1-f))));
  console.log(`${n.padEnd(36)}${(mean(s)/mean(c)).toFixed(2).padStart(5)}`+
    `${(mean(tr(s,.01))/mean(tr(c,.01))).toFixed(2).padStart(8)}`+
    `${(mean(tr(s,.05))/mean(tr(c,.05))).toFixed(2).padStart(8)}`+
    `${(med(s)/med(c)).toFixed(2).padStart(13)}`);
}
