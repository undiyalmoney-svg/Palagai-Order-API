#!/usr/bin/env node
/** PHASE 2.8b — ROBUSTNESS + PLACEBO on the single survivor, BEFORE opening TEST.
 *  CANDIDATE (frozen): first bar in a session whose |close-open| > 3*sigma(20 bar
 *  returns) -> enter in the DIRECTION of that bar. One event/session. Entry = next
 *  bar OPEN. Hold 45 min. Nothing below reads the TEST window. */
const fs=require('fs');
const HOLD=9,ENTRY_FROM='09:45',ENTRY_TO='14:45',MIN_FWD=3;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const pctl=(a,f)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*f))];};
const raw=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const C=raw.map(r=>({t:r.t,d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c}));
const N=C.length;const days=[];const dayIdx=new Map();
{let cur=null;for(let i=0;i<N;i++){if(C[i].d!==cur){cur=C[i].d;days.push(cur);dayIdx.set(cur,[i,i]);}else dayIdx.get(cur)[1]=i;}}
function outcome(i,dir,slip){
  if(i+1>=N||C[i+1].d!==C[i].d)return null;
  const fill=C[i+1].o,day=C[i].d;let last=fill,bars=0,mae=0,mfe=0;
  for(let k=i+1;k<=Math.min(i+HOLD,N-1);k++){if(C[k].d!==day)break;
    const up=C[k].h-fill,dn=C[k].l-fill;
    if(dir>0){mae=Math.min(mae,dn);mfe=Math.max(mfe,up);}else{mae=Math.min(mae,-up);mfe=Math.max(mfe,-dn);}
    last=C[k].c;bars=k-i;}
  if(bars<MIN_FWD)return null;
  return {d:day,hm:C[i].hm,dir,ret:dir*(last-fill)-(slip||0),mae:-mae,mfe};
}
/** frozen event; z and shift parameterised only for robustness reporting */
function fire(z,shift,slip){
  const out=[];
  for(const d of days){
    const[s,e]=dayIdx.get(d);if(e-s<12)continue;
    const rets=[];
    for(let i=s;i<=e;i++){
      if(i>s)rets.push(C[i].c-C[i-1].c);
      if(C[i].hm<ENTRY_FROM||C[i].hm>ENTRY_TO)continue;
      const sig=sd(rets.slice(-20));if(!(sig>0))continue;
      const m=C[i].c-C[i].o;
      if(Math.abs(m)>z*sig&&m!==0){const o=outcome(i+(shift||0),Math.sign(m),slip);if(o)out.push(o);break;}
    }
  }
  return out;
}
const W={DEV:['2015','2018-12-31'],VALID:['2019','2022-12-31']};
const seg=(r,w)=>r.filter(x=>x.d>=W[w][0]&&x.d<=W[w][1]);
function st(r){if(!r.length)return null;const v=r.map(x=>x.ret),se=sd(v)/Math.sqrt(r.length);
  return{n:r.length,mean:mean(v),med:med(v),t:se>0?mean(v)/se:NaN,ci:1.96*se,
    win:100*r.filter(x=>x.ret>0).length/r.length};}
const f=(x)=>x?`${x.mean.toFixed(2).padStart(7)} ${x.t.toFixed(2).padStart(6)} n=${String(x.n).padStart(4)}`:'   n/a';

console.log('CANDIDATE: first |close-open| > 3*sigma(20) bar -> CONTINUATION. One/session. Next-bar-open fill.\n');
console.log('1. SLIPPAGE SENSITIVITY  (breakeven ~2.91-3.43 index pts)');
console.log('   slip(pts)      DEV                 VALID');
for(const s of [0,0.25,0.5,1.0]){
  const a=fire(3,0,s);
  console.log(`   ${s.toFixed(2).padStart(6)}    ${f(st(seg(a,'DEV')))}   ${f(st(seg(a,'VALID')))}`);
}
console.log('\n2. PLACEBO — same event, entry shifted LATER by k bars (effect should decay)');
console.log('   shift          DEV                 VALID');
for(const k of [0,1,3,5,9]){
  const a=fire(3,k,0);
  console.log(`   +${String(k).padStart(2)} bars   ${f(st(seg(a,'DEV')))}   ${f(st(seg(a,'VALID')))}`);
}
console.log('\n3. PARAMETER NEIGHBOURHOOD (reported, NOT re-selected)');
console.log('   z              DEV                 VALID');
for(const z of [2.0,2.5,3.0,3.5,4.0]){
  const a=fire(z,0,0);
  console.log(`   ${z.toFixed(1).padStart(4)}      ${f(st(seg(a,'DEV')))}   ${f(st(seg(a,'VALID')))}`);
}
const base=fire(3,0,0);
console.log('\n4. YEAR BY YEAR (DEV+VALID only)');
for(let y=2015;y<=2022;y++){
  const r=base.filter(x=>x.d.startsWith(String(y)));const s=st(r);
  if(s)console.log(`   ${y}  mean ${s.mean.toFixed(2).padStart(7)}  t ${s.t.toFixed(2).padStart(6)}  n ${String(s.n).padStart(4)}  win ${s.win.toFixed(0)}%`);
}
console.log('\n5. TIME-OF-DAY BUCKETS (DEV+VALID)');
const buckets=[['09:45-11:00','09:45','11:00'],['11:00-12:30','11:00','12:30'],['12:30-14:45','12:30','14:45']];
for(const[l,a,b]of buckets){
  const r=seg(base,'DEV').concat(seg(base,'VALID')).filter(x=>x.hm>=a&&x.hm<b);const s=st(r);
  if(s)console.log(`   ${l}  mean ${s.mean.toFixed(2).padStart(7)}  t ${s.t.toFixed(2).padStart(6)}  n ${String(s.n).padStart(4)}`);
}
console.log('\n6. OUTLIER DEPENDENCE (DEV)');
{const r=seg(base,'DEV').map(x=>x.ret).sort((a,b)=>b-a);
 const full=mean(r);
 console.log(`   full mean ${full.toFixed(2)}   drop top1 ${mean(r.slice(1)).toFixed(2)}   drop top5 ${mean(r.slice(5)).toFixed(2)}   drop top10 ${mean(r.slice(10)).toFixed(2)}`);
 console.log(`   median ${med(r).toFixed(2)}   -> if median ~0 the mean is carried by a few large winners`);}
console.log('\n7. MAE / MFE (DEV+VALID)');
{const r=seg(base,'DEV').concat(seg(base,'VALID'));
 const mae=r.map(x=>x.mae),mfe=r.map(x=>x.mfe);
 console.log(`   MAE  mean ${mean(mae).toFixed(1)}  med ${med(mae).toFixed(1)}  p95 ${pctl(mae,.95).toFixed(1)}`);
 console.log(`   MFE  mean ${mean(mfe).toFixed(1)}  med ${med(mfe).toFixed(1)}  p95 ${pctl(mfe,.95).toFixed(1)}`);
 console.log(`   ret>3pt ${(100*r.filter(x=>x.ret>3).length/r.length).toFixed(0)}%  >5pt ${(100*r.filter(x=>x.ret>5).length/r.length).toFixed(0)}%  >10pt ${(100*r.filter(x=>x.ret>10).length/r.length).toFixed(0)}%`);}
