#!/usr/bin/env node
/** PHASE 32 — FIX: skip fades on stocks already in a big day-move (real trend,
 *  not exhaustion). Cap |dayMove at signal| <= DAYCAP. Test range of caps
 *  across DEV/VALID/TEST, with 2xATR stop. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, SLIP=0.03, RB=6, RP=2.5, VM=3.0;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const sum=a=>a.reduce((x,y)=>x+y,0);
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]||0});
  }
  S.set(f.replace('.json',''),bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
function atr14(a,i){let tr=0,n=0;for(let j=Math.max(1,i-13);j<=i;j++){tr+=Math.max(a[j].h-a[j].l,Math.abs(a[j].h-a[j-1].c),Math.abs(a[j].l-a[j-1].c));n++;}return n?tr/n:0;}
function sig(a){for(let i=25;i<a.length-2;i++){if(a[i].hm<'10:15'||a[i].hm>'14:30')continue;
  const run=(a[i].c-a[i-RB].c)/a[i-RB].c*100,av=mean(a.slice(i-20,i).map(x=>x.v));if(av<=0)continue;
  const volx=a[i].v/av,rg=a[i].h-a[i].l;if(rg<=0)continue;
  const dayMove=Math.abs((a[i].c-a[0].o)/a[0].o*100);
  if(run>=RP&&volx>=VM&&(a[i].c-a[i].l)/rg<=0.34)return{i,dir:-1,run:Math.abs(run),dayMove};
  if(run<=-RP&&volx>=VM&&(a[i].h-a[i].c)/rg<=0.34)return{i,dir:1,run:Math.abs(run),dayMove};}return null;}
function build(DAYCAP){
  let eq=50000; const D=[];
  for(const d of dates){
    let cands=[];
    for(const [sym,bs] of S){const a=bs.get(d);if(a&&a.length>=45){const s=sig(a);if(s&&(DAYCAP<=0||s.dayMove<=DAYCAP)){s.a=a;cands.push(s);}}}
    if(!cands.length)continue; cands.sort((x,y)=>y.run-x.run);
    const c=cands[0],a=c.a,e=c.i+1;if(e>=a.length-1)continue;
    const dir=c.dir,fill=a[e].o*(1+dir*SLIP/100),qty=Math.floor(eq/fill);if(qty<1)continue;
    const stopD=2*atr14(a,c.i);
    let px=null;for(let j=e;j<a.length;j++){const b=a[j];const adv=dir*((dir>0?b.l:b.h)-fill);
      if(b.hm>='15:15'){px=b.c;break;}if(adv<=-stopD){px=fill-dir*stopD;break;}if(j===a.length-1)px=b.c;}
    const ex=px*(1-dir*SLIP/100),net=dir*(ex-fill)*qty-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    eq+=net;D.push({d,net});}
  return D;
}
const seg=(D,lo,hi)=>D.filter(x=>x.d>=lo&&x.d<=hi);
const st=D=>{const dm=new Map();for(const t of D)dm.set(t.d,(dm.get(t.d)||0)+t.net);const dn=[...dm.values()];
  const w=D.filter(x=>x.net>0);
  return D.length?{net:sum(D.map(x=>x.net)),n:D.length,green:100*dn.filter(v=>v>0).length/dn.length,
  avgW:mean(w.map(x=>x.net)),avgL:mean(D.filter(x=>x.net<=0).map(x=>x.net)),
  worst:Math.min(...D.map(x=>x.net)),t:mean(dn)/(sd(dn)/Math.sqrt(dn.length))}:null;};
console.log('PHASE 32 - DAY-MOVE CAP (skip parabolic trends, fade only normal exhaustion), 2xATR stop\n');
console.log('  cap%    DEV     VALID     TEST    ALLnet  avgW/avgL  worst   TESTt  ALLt');
for(const cap of [0,10,8,6,5,4]){
  const D=build(cap);
  const A=st(seg(D,'2018-01-01','2019-12-31')),B=st(seg(D,'2020-01-01','2022-12-31')),Z=st(seg(D,'2023-01-01','2099-12-31')),ALL=st(D);
  console.log(`  ${String(cap===0?'none':cap).padEnd(5)} ${A.net.toFixed(0).padStart(7)} ${B.net.toFixed(0).padStart(8)} ${Z.net.toFixed(0).padStart(8)} ${ALL.net.toFixed(0).padStart(8)}  ${ALL.avgW.toFixed(0)}/${ALL.avgL.toFixed(0)}  ${ALL.worst.toFixed(0).padStart(7)}  ${Z.t.toFixed(2)}  ${ALL.t.toFixed(2)}`);
}
