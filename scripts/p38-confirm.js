#!/usr/bin/env node
/** PHASE 38 — selective fade + CAUSAL confirmation (look-ahead fixed).
 *  After climax signal at bar i: WAIT for bar i+1 to CLOSE. If it closed in the
 *  fade direction (reversal confirming), ENTER at bar i+2 open. Else no trade.
 *  This is causal — we only use the close of a bar we have NOT yet traded.
 *  Costs one bar of the move but confirms the reversal (the user's dummy idea).
 *  Compare vs no-confirm. 2xATR stop, hold-to-close, honest 1x, slip 0.05%. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, SLIP=+(process.env.SLIP??0.05), RB=6, RP=2.5, VM=3.0, BR=2.3;
const CONF=+(process.env.CONF??0.0);   // required entry-confirm % (0 = any move our way)
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
function sig(a){for(let i=25;i<a.length-3;i++){if(a[i].hm<'10:15'||a[i].hm>'14:20')continue;
  const run=(a[i].c-a[i-RB].c)/a[i-RB].c*100,av=mean(a.slice(i-20,i).map(x=>x.v));if(av<=0)continue;
  const volx=a[i].v/av,rg=a[i].h-a[i].l;if(rg<=0)continue;const atr=atr14(a,i);if(atr<=0)continue;
  if(run>=RP&&volx>=VM&&(a[i].c-a[i].l)/rg<=0.34&&rg/atr>=BR)return{i,dir:-1,run:Math.abs(run),atr};
  if(run<=-RP&&volx>=VM&&(a[i].h-a[i].c)/rg<=0.34&&rg/atr>=BR)return{i,dir:1,run:Math.abs(run),atr};}return null;}
function build(useConfirm){
  let eq=50000; const D=[];
  for(const d of dates){
    let cands=[];
    for(const [sym,bs] of S){const a=bs.get(d);if(a&&a.length>=45){const s=sig(a);if(s){s.a=a;s.sym=sym;cands.push(s);}}}
    if(!cands.length)continue; cands.sort((x,y)=>y.run-x.run);
    const c=cands[0],a=c.a,i=c.i; let e;
    if(useConfirm){
      const cf=i+1; if(cf>=a.length-1) continue;
      // CAUSAL: observe confirmation bar's close; require move in fade dir >= CONF%
      const mv=c.dir*((a[cf].c-a[cf].o)/a[cf].o*100);
      if(mv < CONF) continue;
      e=cf+1;
    } else { e=i+1; }
    if(e>=a.length-1) continue;
    const dir=c.dir,fill=a[e].o*(1+dir*SLIP/100),qty=Math.floor(50000/fill);if(qty<1)continue;
    const stopD=2*c.atr;
    let px=null;for(let j=e;j<a.length;j++){const b=a[j];const adv=dir*((dir>0?b.l:b.h)-fill);
      if(b.hm>='15:15'){px=b.c;break;}if(adv<=-stopD){px=fill-dir*stopD;break;}if(j===a.length-1)px=b.c;}
    const ex=px*(1-dir*SLIP/100),net=dir*(ex-fill)*qty-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    eq+=net;D.push({d,net});}
  return D;
}
const seg=(D,lo,hi)=>D.filter(x=>x.d>=lo&&x.d<=hi);
const st=D=>{const dm=new Map();for(const t of D)dm.set(t.d,(dm.get(t.d)||0)+t.net);const dn=[...dm.values()];
  const w=D.filter(x=>x.net>0);
  return D.length?{net:sum(D.map(x=>x.net)),n:D.length,win:100*w.length/D.length,
  avgW:mean(w.map(x=>x.net)),avgL:mean(D.filter(x=>x.net<=0).map(x=>x.net)),
  worst:Math.min(...D.map(x=>x.net)),t:mean(dn)/(sd(dn)/Math.sqrt(dn.length))}:null;};
console.log(`PHASE 38 - CAUSAL CONFIRMATION (look-ahead fixed), slip ${SLIP}%\n`);
for(const [lbl,uc] of [['NO confirm (base)',false],['CONFIRM (causal)',true]]){
  const D=build(uc);
  const A=st(seg(D,'2018-01-01','2019-12-31')),B=st(seg(D,'2020-01-01','2022-12-31')),Z=st(seg(D,'2023-01-01','2099')),ALL=st(D);
  console.log(`  ${lbl}`);
  for(const [w,x] of [['DEV  ',A],['VALID',B],['TEST ',Z],['ALL  ',ALL]])
    if(x) console.log(`    ${w}  n=${String(x.n).padStart(3)}  net Rs${x.net.toFixed(0).padStart(7)}  win ${x.win.toFixed(0)}%  avgW/L ${x.avgW.toFixed(0)}/${x.avgL.toFixed(0)}  worst ${x.worst.toFixed(0)}  t${x.t.toFixed(2)}`);
  console.log();
}
