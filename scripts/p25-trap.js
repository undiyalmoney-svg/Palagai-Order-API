#!/usr/bin/env node
/** PHASE 25 — TRAPPED-TRADER REVERSAL (the user's idea, made precise).
 *  Real mechanism: late breakout traders get trapped at the prior-day extreme,
 *  then all exit at once -> snap-back. We are already positioned for the snap.
 *
 *  BULL TRAP (-> SHORT): intraday price pushes ABOVE prior-day high on a volume
 *    climax, then a bar closes back BELOW PDH with an upper rejection wick.
 *  BEAR TRAP (-> LONG):  pushes BELOW prior-day low on climax, closes back
 *    ABOVE PDL with a lower rejection wick.
 *  Entry next bar open; hold to 15:15; wide stop = STOP_ATR x ATR14.
 *  CONTROL: trade WITH the breakout (continuation) on the same triggers.
 *  Honest 1x sizing, slip param. DEV 2018-19 | VALID 2020-22 | TEST 2023-26. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, SLIP=+(process.env.SLIP??0.03);
const VOLMULT=+(process.env.VOLMULT??2.0), WICK=+(process.env.WICK??0.4), STOP_ATR=+(process.env.STOP_ATR??2.0);
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
// prior-day high/low per symbol
const PD=new Map();
for(const [sym,bs] of S){
  const days=[...bs.keys()].sort(); const m=new Map();
  for(let i=1;i<days.length;i++){
    const p=bs.get(days[i-1]);
    m.set(days[i],{pdh:Math.max(...p.map(x=>x.h)),pdl:Math.min(...p.map(x=>x.l))});
  }
  PD.set(sym,m);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
function atr14(a,i){let tr=0,n=0;for(let j=Math.max(1,i-13);j<=i;j++){tr+=Math.max(a[j].h-a[j].l,Math.abs(a[j].h-a[j-1].c),Math.abs(a[j].l-a[j-1].c));n++;}return n?tr/n:0;}
/** returns {i, fadeDir, extreme} — fadeDir is the reversal (trade) direction */
function findTrap(a,pd){
  if(!pd) return null;
  let pushedUp=false, pushedDn=false;
  for(let i=25;i<a.length-2;i++){
    if(a[i].hm<'10:00'||a[i].hm>'14:30') continue;
    const av=mean(a.slice(i-20,i).map(x=>x.v)); if(av<=0) continue;
    const climax=a[i].v>=VOLMULT*av;
    const rng=a[i].h-a[i].l; if(rng<=0) continue;
    // track whether price has traded beyond the prior-day extreme today
    if(a[i].h>pd.pdh) pushedUp=true;
    if(a[i].l<pd.pdl) pushedDn=true;
    // BULL TRAP: was above PDH, this bar closes back below PDH, upper wick, climax
    const upWick=(a[i].h-Math.max(a[i].c,a[i].o))/rng;
    const dnWick=(Math.min(a[i].c,a[i].o)-a[i].l)/rng;
    if(pushedUp && a[i].h>=pd.pdh && a[i].c<pd.pdh && upWick>=WICK && climax) return {i,fadeDir:-1};
    if(pushedDn && a[i].l<=pd.pdl && a[i].c>pd.pdl && dnWick>=WICK && climax) return {i,fadeDir:+1};
  }
  return null;
}
function run(MODE){
  let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
  let eq=50000; const D=[];
  for(const d of dates){
    const cands=[];
    for(const [sym,bs] of S){ const a=bs.get(d); if(!a||a.length<45) continue;
      const t=findTrap(a,PD.get(sym)?.get(d)); if(t){t.a=a;cands.push(t);} }
    if(!cands.length) continue;
    for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
    const c=cands[0], a=c.a, e=c.i+1; if(e>=a.length-1) continue;
    const dir = MODE==='fade' ? c.fadeDir : -c.fadeDir;
    const fill=a[e].o*(1+dir*SLIP/100); const qty=Math.floor(eq/fill); if(qty<1) continue;
    const stopD=STOP_ATR*atr14(a,c.i); let px=null;
    for(let j=e;j<a.length;j++){ const b=a[j]; const adv=dir*((dir>0?b.l:b.h)-fill);
      if(b.hm>='15:15'){px=b.c;break;} if(stopD>0&&adv<=-stopD){px=fill-dir*stopD;break;} if(j===a.length-1)px=b.c; }
    const ex=px*(1-dir*SLIP/100);
    const gross=dir*(ex-fill)*qty, net=gross-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    eq+=net; D.push({d,net,gross,notional:fill*qty});
  }
  return D;
}
const seg=(D,lo,hi)=>D.filter(x=>x.d>=lo&&x.d<=hi);
const st=D=>D.length?{net:sum(D.map(x=>x.net)),n:D.length,green:100*D.filter(x=>x.net>0).length/D.length,
  gR:100*sum(D.map(x=>x.gross))/sum(D.map(x=>x.notional)),t:mean(D.map(x=>x.net))/(sd(D.map(x=>x.net))/Math.sqrt(D.length))}:null;
console.log(`PHASE 25 - TRAPPED-TRADER REVERSAL  (vol>=${VOLMULT}x, wick>=${WICK}, stop ${STOP_ATR}xATR, slip ${SLIP}%)\n`);
for(const MODE of ['fade','continue']){
  const D=run(MODE);
  const A=st(seg(D,'2018-01-01','2019-12-31')),B=st(seg(D,'2020-01-01','2022-12-31')),Z=st(seg(D,'2023-01-01','2099-12-31')),ALL=st(D);
  if(!A||!B||!Z){console.log(`  ${MODE}: too few`);continue;}
  console.log(`  ${(MODE==='fade'?'FADE(trap)':'CONTINUE ').padEnd(10)}| DEV ${A.net.toFixed(0).padStart(7)} g${A.gR.toFixed(3)} ${A.green.toFixed(0)}% | VAL ${B.net.toFixed(0).padStart(7)} g${B.gR.toFixed(3)} ${B.green.toFixed(0)}% | TEST ${Z.net.toFixed(0).padStart(7)} g${Z.gR.toFixed(3)} ${Z.green.toFixed(0)}% | ALL n${ALL.n} t${ALL.t.toFixed(2)}`);
}
