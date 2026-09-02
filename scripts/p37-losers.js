#!/usr/bin/env node
/** PHASE 37 — analyze the NEGATIVE trades in the selective fade set.
 *  Compare winners vs losers on features NOT yet tested, and critically test
 *  whether any separator generalizes DEV->VALID->TEST (not just fits the past). */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR='research-data/midintra', SLIP=0.05, RB=6, RP=2.5, VM=3.0, BR=2.3;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
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
  const volx=a[i].v/av,rg=a[i].h-a[i].l;if(rg<=0)continue;const atr=atr14(a,i);if(atr<=0)continue;
  if(run>=RP&&volx>=VM&&(a[i].c-a[i].l)/rg<=0.34&&rg/atr>=BR)return{i,dir:-1,run:Math.abs(run),atr};
  if(run<=-RP&&volx>=VM&&(a[i].h-a[i].c)/rg<=0.34&&rg/atr>=BR)return{i,dir:1,run:Math.abs(run),atr};}return null;}
const T=[];let eq=50000;
for(const d of dates){
  let cands=[];
  for(const [sym,bs] of S){const a=bs.get(d);if(a&&a.length>=45){const s=sig(a);if(s){s.a=a;s.sym=sym;cands.push(s);}}}
  if(!cands.length)continue; cands.sort((x,y)=>y.run-x.run);
  const c=cands[0],a=c.a,i=c.i,e=i+1;if(e>=a.length-1)continue;
  const dir=c.dir,fill=a[e].o*(1+dir*SLIP/100),qty=Math.floor(50000/fill);if(qty<1)continue;
  const stopD=2*c.atr;
  // features:
  const gap=(a[e].o-a[i].c)/a[i].c*100;                       // entry-bar gap from climax close
  const entryFollow= dir*((a[e].c-a[e].o)/a[e].o*100);        // did entry bar go our way? (>0 good)
  const dow=new Date(d+'T00:00:00Z').getUTCDay();
  const climaxClose = dir<0 ? (a[i].c-a[i].l)/(a[i].h-a[i].l) : (a[i].h-a[i].c)/(a[i].h-a[i].l); // 0=strong rejection
  let px=null;for(let j=e;j<a.length;j++){const b=a[j];const adv=dir*((dir>0?b.l:b.h)-fill);
    if(b.hm>='15:15'){px=b.c;break;}if(adv<=-stopD){px=fill-dir*stopD;break;}if(j===a.length-1)px=b.c;}
  const ex=px*(1-dir*SLIP/100),net=dir*(ex-fill)*qty-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
  eq+=net;
  T.push({d,net,dir,gap:dir*gap,entryFollow,dow,climaxClose,sym:c.sym});
}
const W=T.filter(t=>t.net>0),L=T.filter(t=>t.net<=0);
console.log(`PHASE 37 - NEGATIVE-TRADE ANALYSIS (selective fade, ${T.length} trades, ${L.length} losers)\n`);
console.log('  feature means:            WINNERS   LOSERS');
const cmp=(f,l)=>console.log(`  ${l.padEnd(24)} ${mean(W.map(f)).toFixed(3).padStart(7)}   ${mean(L.map(f)).toFixed(3).padStart(7)}`);
cmp(t=>t.gap,'entry gap our way %');
cmp(t=>t.entryFollow,'entry bar follow-through%');
cmp(t=>t.climaxClose,'climax close (0=rejection)');
cmp(t=>t.dir>0?1:0,'fraction LONG fades');
console.log('\n  by DIRECTION:');
const bd=(D,l)=>{const w=D.filter(x=>x.net>0);console.log(`  ${l.padEnd(12)} n=${String(D.length).padStart(3)} win ${(100*w.length/D.length).toFixed(0)}% net Rs${sum(D.map(x=>x.net)).toFixed(0).padStart(7)}`);};
bd(T.filter(t=>t.dir<0),'SELL fades'); bd(T.filter(t=>t.dir>0),'BUY fades');
console.log('\n  KEY TEST — entry-bar follow-through filter, out-of-sample:');
console.log('  (only enter if the entry bar already moves our way = reversal confirmed)');
const seg=(D,lo,hi)=>D.filter(x=>x.d>=lo&&x.d<=hi);
const ppt=D=>D.length?sum(D.map(x=>x.net))/D.length:0;
for(const thr of [0,0.1,0.2]){
  const keep=D=>D.filter(t=>t.entryFollow>=thr);
  const dev=seg(T,'2018-01-01','2019-12-31'),val=seg(T,'2020-01-01','2022-12-31'),tst=seg(T,'2023-01-01','2099');
  console.log(`  follow>=${thr}%: DEV ${ppt(keep(dev)).toFixed(0).padStart(4)} (base ${ppt(dev).toFixed(0)})  VAL ${ppt(keep(val)).toFixed(0).padStart(4)} (base ${ppt(val).toFixed(0)})  TEST ${ppt(keep(tst)).toFixed(0).padStart(4)} (base ${ppt(tst).toFixed(0)})  keeps ${(100*keep(T).length/T.length).toFixed(0)}%`);
}
