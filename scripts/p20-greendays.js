#!/usr/bin/env node
/** PHASE 20 — the all-day-green lever, measured. Spreading capital across N
 *  positions/day raises green-day % (diversification) but pays N tolls.
 *  Base: 120-min ORB retest, 1.5W stop, hold to 15:15. Total notional fixed at
 *  5x equity split across N names, so leverage/risk is held constant.
 *  Rs50,000 capital. DEV/VALID/TEST honest. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, ORB=24, SLIP=+(process.env.SLIP??0.01);
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10);
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});
  }
  S.set(f.replace('.json',''),bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
function tradeOne(a,per){
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
  const raw=a[e].o; if(!(raw>0)) return null;
  const fill=raw*(1+dir*SLIP/100); const qty=Math.floor(per/fill); if(qty<1) return null;
  const stopD=1.5*W; let px=null;
  for(let j=e;j<a.length;j++){ const b=a[j];
    const adv=dir*((dir>0?b.l:b.h)-fill);
    if(b.hm>='15:15'){px=b.c;break;}
    if(adv<=-stopD){px=fill-dir*stopD;break;}
    if(j===a.length-1)px=b.c; }
  const ex=px*(1-dir*SLIP/100);
  return {gross:dir*(ex-fill)*qty, chg:MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs};
}
function run(N){
  let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
  const per=250000/N;                      // fixed total notional, split N ways
  const daily=[];
  for(const d of dates){
    const cands=[];
    for(const [sym,bs] of S){ const a=bs.get(d); if(a&&a.length>=ORB+14) cands.push(a); }
    for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
    let net=0,taken=0;
    for(const a of cands){ if(taken>=N)break; const t=tradeOne(a,per); if(t){net+=t.gross-t.chg;taken++;} }
    if(taken>0) daily.push({d,net});
  }
  return daily;
}
const seg=(D,lo,hi)=>D.filter(x=>x.d>=lo&&x.d<=hi);
const st=D=>{ if(!D.length)return null;
  return {net:sum(D.map(x=>x.net)),days:D.length,
    green:100*D.filter(x=>x.net>0).length/D.length,
    t:mean(D.map(x=>x.net))/(sd(D.map(x=>x.net))/Math.sqrt(D.length))}; };
console.log('PHASE 20 - GREEN-DAY LEVER: N positions/day, total notional fixed at Rs250k\n');
console.log('  N   |        DEV            |        VALID          |        TEST');
console.log('      |  net    green   t    |  net    green   t     |  net    green   t');
for(const N of [1,2,3,5,8]){
  const D=run(N);
  const A=st(seg(D,'2018-01-01','2019-12-31')),B=st(seg(D,'2020-01-01','2022-12-31')),Z=st(seg(D,'2023-01-01','2099-12-31'));
  console.log(`  ${N}   | ${A.net.toFixed(0).padStart(7)} ${A.green.toFixed(0).padStart(3)}% ${A.t.toFixed(2).padStart(5)} | ${B.net.toFixed(0).padStart(7)} ${B.green.toFixed(0).padStart(3)}% ${B.t.toFixed(2).padStart(5)} | ${Z.net.toFixed(0).padStart(7)} ${Z.green.toFixed(0).padStart(3)}% ${Z.t.toFixed(2).padStart(5)}`);
}
console.log('\n  reading: more positions -> higher green% (smoother) but net should NOT improve');
console.log('  if turnover cost is the binding constraint. Watch whether green% and net move together.');
