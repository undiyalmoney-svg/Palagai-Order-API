#!/usr/bin/env node
/** PHASE 34 — search for a real TRADE/NO-TRADE filter. Compute causal features
 *  per trade, find the best separator on DEV, validate the SAME threshold on
 *  VALID and TEST. A filter that only helps DEV is overfit; one that helps all
 *  three is real. Base: fade, biggest-run, hold, 2xATR stop. */
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
  if(run>=RP&&volx>=VM&&(a[i].c-a[i].l)/rg<=0.34)return{i,dir:-1,run:Math.abs(run),volx};
  if(run<=-RP&&volx>=VM&&(a[i].h-a[i].c)/rg<=0.34)return{i,dir:1,run:Math.abs(run),volx};}return null;}
// build all trades with a feature vector
const T=[];
let eq=50000;
for(const d of dates){
  let cands=[];
  for(const [sym,bs] of S){const a=bs.get(d);if(a&&a.length>=45){const s=sig(a);if(s){s.a=a;cands.push(s);}}}
  if(!cands.length)continue; cands.sort((x,y)=>y.run-x.run);
  const c=cands[0],a=c.a,i=c.i,e=i+1;if(e>=a.length-1)continue;
  const dir=c.dir,fill=a[e].o*(1+dir*SLIP/100),qty=Math.floor(eq/fill);if(qty<1)continue;
  const atr=atr14(a,i),stopD=2*atr;
  let pv=0,vv=0;for(let j=0;j<=i;j++){pv+=((a[j].h+a[j].l+a[j].c)/3)*a[j].v;vv+=a[j].v;}
  const vwap=vv>0?pv/vv:a[i].c, rg=a[i].h-a[i].l;
  const F={
    run:c.run, volx:c.volx,
    vsVwap:Math.abs((a[i].c-vwap)/vwap*100),
    dayMove:Math.abs((a[i].c-a[0].o)/a[0].o*100),
    wick: dir<0?(a[i].h-Math.max(a[i].o,a[i].c))/rg:(Math.min(a[i].o,a[i].c)-a[i].l)/rg,
    hour:+a[i].hm.slice(0,2)+ +a[i].hm.slice(3)/60,
    atrPct:100*atr/a[i].c,
    barsRange:rg/atr,            // how big the stall bar is vs ATR
    runSpeed:c.run/RB,
  };
  let px=null;for(let j=e;j<a.length;j++){const b=a[j];const adv=dir*((dir>0?b.l:b.h)-fill);
    if(b.hm>='15:15'){px=b.c;break;}if(adv<=-stopD){px=fill-dir*stopD;break;}if(j===a.length-1)px=b.c;}
  const ex=px*(1-dir*SLIP/100),net=dir*(ex-fill)*qty-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
  eq+=net; T.push({d,net,F});
}
const DEV=T.filter(t=>t.d<='2019-12-31'),VAL=T.filter(t=>t.d>='2020-01-01'&&t.d<='2022-12-31'),TST=T.filter(t=>t.d>='2023-01-01');
const feats=Object.keys(T[0].F);
console.log('PHASE 34 - TRADE/NO-TRADE FILTER SEARCH (DEV-train, VALID/TEST-validate)\n');
console.log('  For each feature: keep trades on the BETTER side of its DEV-optimal split.');
console.log('  A real filter improves net-per-trade in DEV *and* VALID *and* TEST.\n');
console.log('  feature     DEV-thr side  | DEVppt  VALppt  TESTppt | base DEV/VAL/TEST per-trade');
const bpt=D=>mean(D.map(x=>x.net));
console.log(`  (baseline per-trade: DEV ${bpt(DEV).toFixed(0)}  VAL ${bpt(VAL).toFixed(0)}  TEST ${bpt(TST).toFixed(0)})\n`);
for(const f of feats){
  // find DEV-optimal threshold (median-based grid) and side
  const vals=DEV.map(t=>t.F[f]).sort((a,b)=>a-b);
  let best=null;
  for(let q=0.2;q<=0.8;q+=0.1){
    const thr=vals[Math.floor(q*vals.length)];
    for(const side of ['above','below']){
      const kept=DEV.filter(t=>side==='above'?t.F[f]>=thr:t.F[f]<thr);
      if(kept.length<DEV.length*0.3) continue;
      const ppt=bpt(kept);
      if(!best||ppt>best.ppt) best={thr,side,ppt};
    }
  }
  if(!best) continue;
  const keep=(D)=>D.filter(t=>best.side==='above'?t.F[f]>=best.thr:t.F[f]<best.thr);
  const dK=keep(DEV),vK=keep(VAL),tK=keep(TST);
  console.log(`  ${f.padEnd(10)} ${best.thr.toFixed(2).padStart(6)} ${best.side.padEnd(5)} | ${bpt(dK).toFixed(0).padStart(5)}  ${bpt(vK).toFixed(0).padStart(5)}  ${bpt(tK).toFixed(0).padStart(5)}  | keeps ${(100*tK.length/TST.length).toFixed(0)}% of TEST`);
}
console.log('\n  READING: a feature helps only if VALppt AND TESTppt both BEAT the baseline.');
