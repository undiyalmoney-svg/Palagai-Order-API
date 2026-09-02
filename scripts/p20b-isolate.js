#!/usr/bin/env node
/** Isolate WHY p20 N=1 (+138k TEST) beats the shipped module (-6k TEST).
 *  Same base (retest, 1.5W stop, Rs250k fixed) but toggle:
 *    SELECTION: 'firstfill' (p20: highest random-rank stock that gives a signal)
 *               vs 'onepick' (module: pick ONE random stock; skip day if it has no signal)
 *    EXIT: 'hold' (full to 15:15) vs 'partial' (half at 1R) */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, ORB=24, SLIP=0.01, PER=250000;
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});
  }
  S.set(f.replace('.json',''),bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
function trade(a,EXIT){
  let H=-1e9,L=1e9; for(let k=0;k<ORB;k++){H=Math.max(H,a[k].h);L=Math.min(L,a[k].l);}
  if(!(H>L)) return null; const W=H-L;
  let bi=null,dir=0;
  for(let i=ORB;i<a.length-2;i++){ if(a[i].hm>='14:45')break;
    if(a[i].c>H){bi=i;dir=1;break;} if(a[i].c<L){bi=i;dir=-1;break;} }
  if(bi==null) return null;
  const lvl=dir>0?H:L; let ri=null;
  for(let j=bi+1;j<Math.min(bi+13,a.length-1);j++){ if(a[j].hm>='14:45')break;
    if(dir>0?a[j].l<=lvl:a[j].h>=lvl){ri=j;break;} }
  if(ri==null) return null;
  const e=ri+1; if(e>=a.length-1) return null;
  const raw=a[e].o; if(!(raw>0)) return null;
  const fill=raw*(1+dir*SLIP/100); const qty=Math.floor(PER/fill); if(qty<1) return null;
  const stopD=1.5*W, tgtD=1.5*W; let px=null,real=0,q=qty,half=false;
  for(let j=e;j<a.length;j++){ const b=a[j];
    const adv=dir*((dir>0?b.l:b.h)-fill), fav=dir*((dir>0?b.h:b.l)-fill);
    if(b.hm>='15:15'){px=b.c;break;}
    if(adv<=-stopD){px=fill-dir*stopD;break;}
    if(EXIT==='partial'&&!half&&fav>=tgtD){const hq=Math.floor(qty/2);real+=dir*tgtD*hq;q=qty-hq;half=true;}
    if(j===a.length-1)px=b.c; }
  const ex=px*(1-dir*SLIP/100);
  return {net: real+dir*(ex-fill)*q - MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs};
}
function run(SEL,EXIT){
  let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
  const D=[];
  for(const d of dates){
    const cands=[];
    for(const [sym,bs] of S){ const a=bs.get(d); if(a&&a.length>=ORB+14) cands.push(a); }
    for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
    if(SEL==='onepick'){ if(cands.length){const t=trade(cands[0],EXIT); if(t)D.push({d,net:t.net});} }
    else { for(const a of cands){ const t=trade(a,EXIT); if(t){D.push({d,net:t.net});break;} } }
  }
  return D;
}
const seg=(D,lo,hi)=>D.filter(x=>x.d>=lo&&x.d<=hi);
const st=D=>D.length?{net:sum(D.map(x=>x.net)),days:D.length,t:mean(D.map(x=>x.net))/(sd(D.map(x=>x.net))/Math.sqrt(D.length))}:null;
console.log('ISOLATING THE +138k vs -6k DISCREPANCY (TEST 2023-2026)\n');
console.log('  selection   exit      DEV net    VALID net    TEST net   TESTt   fill-days');
for(const SEL of ['firstfill','onepick']) for(const EXIT of ['hold','partial']){
  const D=run(SEL,EXIT);
  const A=st(seg(D,'2018-01-01','2019-12-31')),B=st(seg(D,'2020-01-01','2022-12-31')),Z=st(seg(D,'2023-01-01','2099-12-31'));
  console.log(`  ${SEL.padEnd(11)} ${EXIT.padEnd(8)} ${A.net.toFixed(0).padStart(8)} ${B.net.toFixed(0).padStart(10)} ${Z.net.toFixed(0).padStart(10)}  ${Z.t.toFixed(2).padStart(5)}  ${Z.days}`);
}
