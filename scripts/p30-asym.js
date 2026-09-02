#!/usr/bin/env node
/** PHASE 30 — WHY big losses, small wins? Measure the fade's payoff asymmetry,
 *  find what the big losers have in common, and test whether a stop fixes it. */
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
  if(run>=RP&&volx>=VM&&(a[i].c-a[i].l)/rg<=0.34)return{i,dir:-1,run:Math.abs(run)};
  if(run<=-RP&&volx>=VM&&(a[i].h-a[i].c)/rg<=0.34)return{i,dir:1,run:Math.abs(run)};}return null;}
function build(STOP_ATR){
  let eq=50000; const T=[];
  for(const d of dates){
    let cands=[];
    for(const [sym,bs] of S){const a=bs.get(d);if(a&&a.length>=45){const s=sig(a);if(s){s.a=a;cands.push(s);}}}
    if(!cands.length)continue; cands.sort((x,y)=>y.run-x.run);
    const c=cands[0],a=c.a,e=c.i+1;if(e>=a.length-1)continue;
    const dir=c.dir,fill=a[e].o*(1+dir*SLIP/100),qty=Math.floor(eq/fill);if(qty<1)continue;
    const atr=atr14(a,c.i),stopD=STOP_ATR>0?STOP_ATR*atr:null;
    let px=null,why='TIME',mfe=0;
    for(let j=e;j<a.length;j++){const b=a[j];
      const adv=dir*((dir>0?b.l:b.h)-fill),fav=dir*((dir>0?b.h:b.l)-fill);mfe=Math.max(mfe,fav);
      if(b.hm>='15:15'){px=b.c;why='TIME';break;}
      if(stopD&&adv<=-stopD){px=fill-dir*stopD;why='STOP';break;}
      if(j===a.length-1)px=b.c;}
    const ex=px*(1-dir*SLIP/100),net=dir*(ex-fill)*qty-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    eq+=net;T.push({d,net,why,mfeRs:mfe*qty});}
  return T;
}
const T=build(0);
const W=T.filter(t=>t.net>0),L=T.filter(t=>t.net<=0);
console.log('PHASE 30 - PAYOFF ASYMMETRY (fade, hold-to-close, no stop)\n');
console.log(`  trades ${T.length}  win rate ${(100*W.length/T.length).toFixed(0)}%`);
console.log(`  avg WIN  +Rs${mean(W.map(x=>x.net)).toFixed(0)}   avg LOSS Rs${mean(L.map(x=>x.net)).toFixed(0)}   ratio ${(mean(W.map(x=>x.net))/-mean(L.map(x=>x.net))).toFixed(2)}`);
const ns=T.map(x=>x.net).sort((a,b)=>a-b);
console.log(`  biggest win +Rs${ns[ns.length-1].toFixed(0)}   biggest loss Rs${ns[0].toFixed(0)}`);
console.log(`  worst 10 trades sum Rs${sum(ns.slice(0,10)).toFixed(0)}   best 10 sum Rs${sum(ns.slice(-10)).toFixed(0)}`);
console.log(`  -> classic mean-reversion: high win rate, negatively skewed (few big losers when trend resumes)`);
console.log(`\n  KEY: on the big losers, did price first go our way then reverse? (MFE > 0 = we had profit)`);
const bigL=L.sort((a,b)=>a.net-b.net).slice(0,20);
const hadProfit=bigL.filter(x=>x.mfeRs>500).length;
console.log(`  of 20 biggest losers, ${hadProfit} had >Rs500 open profit first -> a target would have banked them`);
console.log('\n  DOES A STOP FIX THE ASYMMETRY? (cap the disaster losers)');
console.log('  stop(xATR)  trades  NET Rs   avgWin  avgLoss  biggestLoss  win%   ALLt');
for(const sa of [0,3,2.5,2,1.5,1]){
  const X=build(sa);
  const w=X.filter(x=>x.net>0),l=X.filter(x=>x.net<=0);
  const dm=new Map();for(const t of X)dm.set(t.d,(dm.get(t.d)||0)+t.net);const dn=[...dm.values()];
  const t=mean(dn)/(sd(dn)/Math.sqrt(dn.length));
  console.log(`  ${String(sa===0?'none':sa).padEnd(9)}  ${String(X.length).padStart(5)}  ${sum(X.map(x=>x.net)).toFixed(0).padStart(7)}  ${mean(w.map(x=>x.net)).toFixed(0).padStart(6)}  ${mean(l.map(x=>x.net)).toFixed(0).padStart(7)}  ${Math.min(...X.map(x=>x.net)).toFixed(0).padStart(10)}  ${(100*w.length/X.length).toFixed(0)}%  ${t.toFixed(2)}`);
}
