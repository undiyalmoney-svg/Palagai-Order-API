#!/usr/bin/env node
/** PHASE 27 — exhaustion fade, EXIT study. A fade captures a snap-back; holding
 *  to close risks the original trend resuming. Test reversion-aware exits.
 *  Signal: run>=2.5% in 6 bars + vol>=3x + stall. Enter next bar (fade).
 *  EXITS: hold | vwap | retrace50 | retrace100 | trailATR
 *  Honest 1x sizing, slip 0.03%. */
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
function sig(a){
  for(let i=25;i<a.length-2;i++){
    if(a[i].hm<'10:15'||a[i].hm>'14:30') continue;
    const run=(a[i].c-a[i-RB].c)/a[i-RB].c*100, av=mean(a.slice(i-20,i).map(x=>x.v)); if(av<=0) continue;
    const cl=a[i].v>=VM*av, rg=a[i].h-a[i].l; if(rg<=0) continue;
    if(run>=RP&&cl&&(a[i].c-a[i].l)/rg<=0.34) return {i,dir:-1,runStart:a[i-RB].c,runEnd:a[i].c};
    if(run<=-RP&&cl&&(a[i].h-a[i].c)/rg<=0.34) return {i,dir:1,runStart:a[i-RB].c,runEnd:a[i].c};
  }
  return null;
}
function atr14(a,i){let tr=0,n=0;for(let j=Math.max(1,i-13);j<=i;j++){tr+=Math.max(a[j].h-a[j].l,Math.abs(a[j].h-a[j-1].c),Math.abs(a[j].l-a[j-1].c));n++;}return n?tr/n:0;}
function run(EXIT){
  let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
  let eq=50000; const D=[];
  for(const d of dates){
    const cands=[];
    for(const [sym,bs] of S){ const a=bs.get(d); if(a&&a.length>=45){const s=sig(a); if(s){s.a=a;cands.push(s);}} }
    if(!cands.length) continue;
    for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
    const c=cands[0], a=c.a, e=c.i+1; if(e>=a.length-1) continue;
    const dir=c.dir, fill=a[e].o*(1+dir*SLIP/100), qty=Math.floor(eq/fill); if(qty<1) continue;
    const atr=atr14(a,c.i), stopD=2.0*atr;
    const runLen=Math.abs(c.runEnd-c.runStart);
    const tgt50 = fill + dir*0.5*runLen;   // fade target: 50% retrace of the run
    const tgt100= fill + dir*1.0*runLen;   // full retrace to run start
    // VWAP from open
    let pv=0,vv=0;
    let px=null,peak=0;
    for(let j=e;j<a.length;j++){ const b=a[j];
      pv+=((b.h+b.l+b.c)/3)*b.v; vv+=b.v; const vwap=vv>0?pv/vv:b.c;
      const adv=dir*((dir>0?b.l:b.h)-fill), fav=dir*((dir>0?b.h:b.l)-fill);
      if(b.hm>='15:15'){px=b.c;break;}
      if(adv<=-stopD){px=fill-dir*stopD;break;}
      if(EXIT==='vwap' && (dir>0? b.h>=vwap : b.l<=vwap)){px=vwap;break;}
      if(EXIT==='retrace50' && fav>=Math.abs(tgt50-fill)){px=fill+dir*Math.abs(tgt50-fill);break;}
      if(EXIT==='retrace100'&& fav>=Math.abs(tgt100-fill)){px=fill+dir*Math.abs(tgt100-fill);break;}
      peak=Math.max(peak,fav);
      if(EXIT==='trailATR' && peak>=1.5*atr && fav<=peak-1.5*atr){px=b.c;break;}
      if(j===a.length-1)px=b.c;
    }
    const ex=px*(1-dir*SLIP/100);
    const gross=dir*(ex-fill)*qty, net=gross-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    eq+=net; D.push({d,net,gross,notional:fill*qty});
  }
  return D;
}
const seg=(D,lo,hi)=>D.filter(x=>x.d>=lo&&x.d<=hi);
const st=D=>D.length?{net:sum(D.map(x=>x.net)),n:D.length,green:100*D.filter(x=>x.net>0).length/D.length,
  gR:100*sum(D.map(x=>x.gross))/sum(D.map(x=>x.notional)),win:100*D.filter(x=>x.net>0).length/D.length,
  t:mean(D.map(x=>x.net))/(sd(D.map(x=>x.net))/Math.sqrt(D.length))}:null;
console.log('PHASE 27 - EXHAUSTION FADE, EXIT STUDY  (honest 1x, slip 0.03%)\n');
console.log('  exit         DEV net   VALID net   TEST net    ALLnet  win%   ALLt');
for(const EXIT of ['hold','vwap','retrace50','retrace100','trailATR']){
  const D=run(EXIT);
  const A=st(seg(D,'2018-01-01','2019-12-31')),B=st(seg(D,'2020-01-01','2022-12-31')),Z=st(seg(D,'2023-01-01','2099-12-31')),ALL=st(D);
  console.log(`  ${EXIT.padEnd(11)} ${A.net.toFixed(0).padStart(8)} ${B.net.toFixed(0).padStart(10)} ${Z.net.toFixed(0).padStart(10)} ${ALL.net.toFixed(0).padStart(9)}  ${ALL.win.toFixed(0)}%  ${ALL.t.toFixed(2)}`);
}
