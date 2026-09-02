#!/usr/bin/env node
/** PHASE 26 — EXHAUSTION + CONFIRMATION. Improve the winning exhaustion fade
 *  by requiring one confirming bar before entry (the user's dummy-confirm idea).
 *  Signal: run>=RP% in 6 bars + vol climax>=VM x + stall (close rejects third).
 *  Then instead of entering next bar blindly:
 *    CONFIRM: enter only if the NEXT bar also moves in the fade direction
 *             (closes beyond that bar's open toward the fade). Else no trade.
 *  Compare: immediate entry vs confirmed entry vs confirmed+control.
 *  Hold to close, honest 1x sizing. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, SLIP=+(process.env.SLIP??0.03);
const RB=6, RP=+(process.env.RP??2.5), VM=+(process.env.VM??3.0);
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
  for(let i=25;i<a.length-3;i++){
    if(a[i].hm<'10:15'||a[i].hm>'14:20') continue;
    const run=(a[i].c-a[i-RB].c)/a[i-RB].c*100, av=mean(a.slice(i-20,i).map(x=>x.v)); if(av<=0) continue;
    const cl=a[i].v>=VM*av, rg=a[i].h-a[i].l; if(rg<=0) continue;
    if(run>=RP&&cl&&(a[i].c-a[i].l)/rg<=0.34) return {i,dir:-1};
    if(run<=-RP&&cl&&(a[i].h-a[i].c)/rg<=0.34) return {i,dir:1};
  }
  return null;
}
function run(MODE){  // 'immediate' | 'confirm' | 'confirmctl'
  let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
  let eq=50000; const D=[];
  for(const d of dates){
    const cands=[];
    for(const [sym,bs] of S){ const a=bs.get(d); if(a&&a.length>=45){const s=sig(a); if(s){s.a=a;cands.push(s);}} }
    if(!cands.length) continue;
    for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
    const c=cands[0], a=c.a; let e, dir=c.dir;
    if(MODE==='immediate'){ e=c.i+1; }
    else {
      const cf=c.i+1; if(cf>=a.length-1) continue;
      // confirmation bar must move in fade direction
      const moved = dir>0 ? a[cf].c>a[cf].o : a[cf].c<a[cf].o;
      if(!moved) continue;
      e=cf+1;
      if(MODE==='confirmctl') dir=-dir;   // control: fade the confirmation (continuation)
    }
    if(e>=a.length-1) continue;
    const fill=a[e].o*(1+dir*SLIP/100), qty=Math.floor(eq/fill); if(qty<1) continue;
    let px=null; for(let j=e;j<a.length;j++){ if(a[j].hm>='15:15'){px=a[j].c;break;} if(j===a.length-1)px=a[j].c; }
    const ex=px*(1-dir*SLIP/100);
    const gross=dir*(ex-fill)*qty, net=gross-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    eq+=net; D.push({d,net,gross,notional:fill*qty});
  }
  return D;
}
const seg=(D,lo,hi)=>D.filter(x=>x.d>=lo&&x.d<=hi);
const st=D=>D.length?{net:sum(D.map(x=>x.net)),n:D.length,green:100*D.filter(x=>x.net>0).length/D.length,
  gR:100*sum(D.map(x=>x.gross))/sum(D.map(x=>x.notional)),t:mean(D.map(x=>x.net))/(sd(D.map(x=>x.net))/Math.sqrt(D.length))}:null;
console.log(`PHASE 26 - EXHAUSTION + CONFIRMATION  (run>=${RP}% vol>=${VM}x, slip ${SLIP}%)\n`);
for(const MODE of ['immediate','confirm','confirmctl']){
  const D=run(MODE);
  const A=st(seg(D,'2018-01-01','2019-12-31')),B=st(seg(D,'2020-01-01','2022-12-31')),Z=st(seg(D,'2023-01-01','2099-12-31')),ALL=st(D);
  if(!A||!B||!Z){console.log(`  ${MODE}: too few`);continue;}
  console.log(`  ${MODE.padEnd(11)}| DEV ${A.net.toFixed(0).padStart(7)} g${A.gR.toFixed(3)} ${A.green.toFixed(0)}% | VAL ${B.net.toFixed(0).padStart(7)} g${B.gR.toFixed(3)} ${B.green.toFixed(0)}% | TEST ${Z.net.toFixed(0).padStart(7)} g${Z.gR.toFixed(3)} ${Z.green.toFixed(0)}% | n${ALL.n} t${ALL.t.toFixed(2)}`);
}
