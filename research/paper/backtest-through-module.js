#!/usr/bin/env node
/** Integration test: drive the SHIPPED module over full history; must reproduce
 *  the research backtest (ALL ~+Rs52,981, t~2.71). Read-only. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../../live/equity-charges.js');
const ST=require('../strategy/exhaustion-fade-v1.js');
const DIR=process.env.EQDIR||'research-data/midintra', SLIP=+(process.env.SLIP??0.05);
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
const T=[];
for(const d of dates){
  const day=new Map();
  for(const [sym,bs] of S){ const a=bs.get(d); if(a) day.set(sym,a); }
  const sig=ST.evaluateDay(day);
  if(!sig) continue;
  const bars=day.get(sig.symbol);
  const ei=bars.findIndex(b=>b.hm===sig.entryTime && b.o===sig.entryPrice);
  const dir=sig.side==='BUY'?1:-1;
  const fill=sig.entryPrice*(1+dir*SLIP/100);
  const qty=Math.floor(50000/fill); if(qty<1) continue;
  const stopD=Math.abs(sig.entryPrice-sig.stopLoss);
  let px=null;
  for(let j=ei;j<bars.length;j++){ const b=bars[j]; const adv=dir*((dir>0?b.l:b.h)-fill);
    if(b.hm>=sig.exitTime){px=b.c;break;} if(adv<=-stopD){px=sig.stopLoss;break;} if(j===bars.length-1)px=b.c; }
  const ex=px*(1-dir*SLIP/100);
  const net=dir*(ex-fill)*qty-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
  T.push({d,net});
}
const seg=(lo,hi)=>T.filter(t=>t.d>=lo&&t.d<=hi);
const st=D=>{const dm=new Map();for(const t of D)dm.set(t.d,(dm.get(t.d)||0)+t.net);const dn=[...dm.values()];
  const w=D.filter(x=>x.net>0);return{net:sum(D.map(x=>x.net)),n:D.length,win:100*w.length/D.length,
  worst:Math.min(...D.map(x=>x.net)),t:mean(dn)/(sd(dn)/Math.sqrt(dn.length))};};
console.log('INTEGRATION TEST — backtest driven THROUGH the shipped module\n');
console.log('  window       trades   net Rs     win%   worst    t');
for(const [l,lo,hi] of [['DEV  ','2018-01-01','2019-12-31'],['VALID','2020-01-01','2022-12-31'],['TEST ','2023-01-01','2099'],['ALL  ','2000','2099']]){
  const x=st(seg(lo,hi));
  console.log(`  ${l}  ${String(x.n).padStart(5)}  ${x.net.toFixed(0).padStart(8)}   ${x.win.toFixed(0)}%   ${x.worst.toFixed(0).padStart(6)}  ${x.t.toFixed(2)}`);
}
const all=st(T);
console.log(`\n  Expected (frozen module baseline): ALL +58,946, t2.89`);
console.log(`  Module result              : ALL  ${all.net.toFixed(0)}, t${all.t.toFixed(2)}`);
console.log(`  ${Math.abs(all.net-58946)<1500?'PASS — module is the frozen baseline':'CHECK — divergence'}`);
