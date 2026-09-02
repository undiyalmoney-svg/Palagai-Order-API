#!/usr/bin/env node
/** PHASE 23 — EXHAUSTION FADE (the user's idea).
 *  "When buyers are done and the crowd exits, SELL. When sellers are done, BUY."
 *  Detect exhaustion of an intraday move, then fade it.
 *
 *  EXHAUSTION SIGNAL (all knowable at bar close, no look-ahead):
 *    - a directional RUN: price moved >= RUNPCT% over the last RUNBARS bars
 *    - a CLIMAX bar: volume >= VOLMULT x its own 20-bar average (crowd piling in)
 *    - STALL: the climax bar closes in the BOTTOM third of its range (for an up-run)
 *      or top third (for a down-run) — the push failed / rejection
 *    -> FADE: short the exhausted up-run, long the exhausted down-run
 *
 *  Entry = next bar open. Exits tested: hold-to-close, and a stop at STOPPCT.
 *  CONTROL: same triggers, but trade WITH the move (inverse) — if fading works,
 *  continuation must lose on the same bars.
 *  Rs50,000, honest sizing (1x current equity), slip 0.02%/side.
 *  DEV 2018-19 | VALID 2020-22 | TEST 2023-26. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, SLIP=+(process.env.SLIP??0.02);
const RUNBARS=+(process.env.RUNBARS??6), RUNPCT=+(process.env.RUNPCT??1.0);
const VOLMULT=+(process.env.VOLMULT??2.0), STOPPCT=+(process.env.STOPPCT??1.0);
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
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
/** find first exhaustion signal in a day; returns {i, fadeDir} (fadeDir = trade direction to FADE) */
function findSignal(a){
  for(let i=25;i<a.length-2;i++){
    if(a[i].hm<'10:15'||a[i].hm>'14:30') continue;
    const run=(a[i].c-a[i-RUNBARS].c)/a[i-RUNBARS].c*100;
    const avgVol=mean(a.slice(i-20,i).map(x=>x.v));
    if(avgVol<=0) continue;
    const climax=a[i].v>=VOLMULT*avgVol;
    const rng=a[i].h-a[i].l; if(rng<=0) continue;
    if(run>=RUNPCT && climax){
      const closeLow=(a[i].c-a[i].l)/rng<=0.34;   // up-run stalls: closes bottom third
      if(closeLow) return {i,fadeDir:-1};          // fade = SELL
    }
    if(run<=-RUNPCT && climax){
      const closeHigh=(a[i].h-a[i].c)/rng<=0.34;   // down-run stalls: closes top third
      if(closeHigh) return {i,fadeDir:+1};         // fade = BUY
    }
  }
  return null;
}
function run(MODE,USESTOP){   // MODE: 'fade' or 'continue'(control)
  let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
  let eq=50000; const daily=[];
  for(const d of dates){
    const cands=[];
    for(const [sym,bs] of S){ const a=bs.get(d); if(a&&a.length>=45){const s=findSignal(a); if(s){s.a=a;cands.push(s);}} }
    if(!cands.length) continue;
    for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
    const c=cands[0]; const a=c.a, e=c.i+1; if(e>=a.length-1) continue;
    const dir = MODE==='fade' ? c.fadeDir : -c.fadeDir;
    const raw=a[e].o; if(!(raw>0)) continue;
    const fill=raw*(1+dir*SLIP/100);
    const qty=Math.floor(eq/fill); if(qty<1) continue;
    const stopD=STOPPCT/100*fill;
    let px=null;
    for(let j=e;j<a.length;j++){ const b=a[j]; const adv=dir*((dir>0?b.l:b.h)-fill);
      if(b.hm>='15:15'){px=b.c;break;}
      if(USESTOP&&adv<=-stopD){px=fill-dir*stopD;break;}
      if(j===a.length-1)px=b.c; }
    const ex=px*(1-dir*SLIP/100);
    const net=dir*(ex-fill)*qty - MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    eq+=net; daily.push({d,net,gross:dir*(ex-fill)*qty,notional:fill*qty});
  }
  return daily;
}
const seg=(D,lo,hi)=>D.filter(x=>x.d>=lo&&x.d<=hi);
const st=D=>D.length?{net:sum(D.map(x=>x.net)),days:D.length,green:100*D.filter(x=>x.net>0).length/D.length,t:mean(D.map(x=>x.net))/(sd(D.map(x=>x.net))/Math.sqrt(D.length)),grossR:100*sum(D.map(x=>x.gross))/sum(D.map(x=>x.notional)),n:D.length}:null;
console.log(`PHASE 23 - EXHAUSTION FADE  (run>=${RUNPCT}% in ${RUNBARS} bars + vol>=${VOLMULT}x + stall)`);
console.log(`  honest 1x sizing, slip ${SLIP}%/side, stop ${STOPPCT}%\n`);
for(const [MODE,US,lbl] of [['fade',false,'FADE hold  '],['fade',true,'FADE +stop '],['continue',false,'CONTINUE ctl']]){
  const D=run(MODE,US);
  const A=st(seg(D,'2018-01-01','2019-12-31')),B=st(seg(D,'2020-01-01','2022-12-31')),Z=st(seg(D,'2023-01-01','2099-12-31'));
  if(!A||!B||!Z){console.log('  '+lbl+' too few');continue;}
  console.log(`  ${lbl}| DEV ${A.net.toFixed(0).padStart(7)} g${A.grossR.toFixed(3)}% ${A.green.toFixed(0)}% | VAL ${B.net.toFixed(0).padStart(7)} g${B.grossR.toFixed(3)}% ${B.green.toFixed(0)}% | TEST ${Z.net.toFixed(0).padStart(7)} g${Z.grossR.toFixed(3)}% ${Z.green.toFixed(0)}% t${Z.t.toFixed(1)}`);
}
