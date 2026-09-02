#!/usr/bin/env node
/** PHASE 21 — random-month test, HONEST sizing (notional = leverage x CURRENT
 *  equity, so you cannot bet more than you have). ORB-retest hold-full.
 *  Picks 12 random months, reports each. This is the reality check the
 *  fixed-notional backtest hid. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, ORB=24, SLIP=+(process.env.SLIP??0.02), LEV=+(process.env.LEV??1);
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
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
function trade(a){
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
  return {a,e,dir,W,H,L};
}
function monthNet(mo,startEq){
  let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
  let eq=startEq;
  const md=dates.filter(d=>d.slice(0,7)===mo);
  for(const d of md){
    const cands=[];
    for(const [sym,bs] of S){ const a=bs.get(d); if(a&&a.length>=ORB+14){const t=trade(a); if(t)cands.push(t);} }
    if(!cands.length) continue;
    for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
    const c=cands[0]; const fill=c.a[c.e].o*(1+c.dir*SLIP/100);
    const qty=Math.floor((eq*LEV)/fill); if(qty<1) continue;
    const stopD=1.5*c.W; let px=null;
    for(let j=c.e;j<c.a.length;j++){ const b=c.a[j]; const adv=c.dir*((c.dir>0?b.l:b.h)-fill);
      if(b.hm>='15:15'){px=b.c;break;} if(adv<=-stopD){px=fill-c.dir*stopD;break;} if(j===c.a.length-1)px=b.c; }
    const ex=px*(1-c.dir*SLIP/100);
    eq += c.dir*(ex-fill)*qty - MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
  }
  return eq-startEq;
}
// all available months, then pick 12 at random (seeded)
const months=[...new Set(dates.map(d=>d.slice(0,7)))].sort();
let s=42; const rnd=()=>((s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff);
const shuffled=[...months].sort(()=>rnd()-0.5);
const pick=shuffled.slice(0,12).sort();
console.log(`PHASE 21 - 12 RANDOM MONTHS, HONEST sizing (${LEV}x current equity, slip ${SLIP}%/side)\n`);
console.log('  month     P/L on Rs50,000    %');
let wins=0,tot=0;
for(const m of pick){ const pl=monthNet(m,50000); tot+=pl; if(pl>0)wins++;
  console.log(`  ${m}   ${pl>=0?'+':''}${pl.toFixed(0).padStart(8)}      ${(100*pl/50000).toFixed(2)}%`); }
console.log(`  ----`);
console.log(`  ${pick.length} random months: ${wins} green, ${pick.length-wins} red  (${(100*wins/pick.length).toFixed(0)}% of months green)`);
console.log(`  average month: Rs${(tot/pick.length).toFixed(0)}   sum: Rs${tot.toFixed(0)}`);
