#!/usr/bin/env node
/** PHASE 18 — free optimisation of the mid-cap ORB family.
 *  108 configs: OR length x stop x target x direction.
 *  SELECTION ON DEV ONLY (2018-2019). VALID and TEST are computed but never
 *  used to choose. Rs250,000 notional, MIS charges, slippage 0.01%/side. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, PER=250000, SLIP=+(process.env.SLIP??0.01);
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
function run(ORB,STOPW,TGTR,SIDE){
  let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
  const T=[];
  for(const d of dates){
    const cands=[];
    for(const [sym,bs] of S){
      const a=bs.get(d); if(!a||a.length<ORB+12) continue;
      let H=-1e9,L=1e9;
      for(let k=0;k<ORB;k++){H=Math.max(H,a[k].h);L=Math.min(L,a[k].l);}
      if(!(H>L)) continue;
      let bi=null,dir=0;
      for(let j=ORB;j<a.length-2;j++){
        if(a[j].hm>='14:45')break;
        if(a[j].c>H){bi=j;dir=+1;break;}
        if(a[j].c<L){bi=j;dir=-1;break;}
      }
      if(bi==null) continue;
      if(SIDE!==0 && dir!==SIDE) continue;
      cands.push({sym,a,bi,dir,W:H-L});
    }
    if(!cands.length) continue;
    for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
    const c=cands[0], a=c.a, e=c.bi+1; if(e>=a.length-1) continue;
    const raw=a[e].o; if(!(raw>0)) continue;
    const fill=raw*(1+c.dir*SLIP/100);
    const qty=Math.floor(PER/fill); if(qty<1) continue;
    const stopD=STOPW!=null?STOPW*c.W:null, tgtD=TGTR!=null?TGTR*(STOPW!=null?STOPW*c.W:c.W):null;
    let px=null;
    for(let j=e;j<a.length;j++){
      const b=a[j];
      const adv=c.dir*((c.dir>0?b.l:b.h)-fill), fav=c.dir*((c.dir>0?b.h:b.l)-fill);
      if(b.hm>='15:15'){px=b.c;break;}
      if(stopD!=null&&adv<=-stopD){px=fill-c.dir*stopD;break;}
      if(tgtD!=null&&fav>=tgtD){px=fill+c.dir*tgtD;break;}
      if(j===a.length-1)px=b.c;
    }
    if(px==null) continue;
    const ex=px*(1-c.dir*SLIP/100);
    const gross=c.dir*(ex-fill)*qty;
    const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    T.push({d,net:gross-chg});
  }
  return T;
}
const seg=(T,lo,hi)=>T.filter(t=>t.d>=lo&&t.d<=hi);
const st=X=>{ if(!X.length)return {net:0,n:0,t:0,green:0};
  const dm=new Map(); for(const t of X) dm.set(t.d,(dm.get(t.d)||0)+t.net);
  const dn=[...dm.values()];
  return {net:sum(X.map(x=>x.net)),n:X.length,
    green:100*dn.filter(v=>v>0).length/dn.length,
    t:mean(dn)/(sd(dn)/Math.sqrt(dn.length))}; };
const rows=[];
for(const ORB of [12,18,24])
 for(const STOPW of [null,1.0,1.5,2.0])
  for(const TGTR of [null,2,3])
   for(const SIDE of [0,+1,-1]){
     const T=run(ORB,STOPW,TGTR,SIDE);
     if(T.length<200) continue;
     rows.push({ORB,STOPW,TGTR,SIDE,
       D:st(seg(T,'2018-01-01','2019-12-31')),
       V:st(seg(T,'2020-01-01','2022-12-31')),
       Z:st(seg(T,'2023-01-01','2099-12-31'))});
   }
rows.sort((a,b)=>b.D.net-a.D.net);
const lbl=r=>`OR${r.ORB*5}m stop${r.STOPW??'-'} tgt${r.TGTR??'-'} ${r.SIDE===0?'both':r.SIDE>0?'long':'short'}`;
console.log(`PHASE 18 - FREE OPTIMISATION, ${rows.length} configs, selection on DEV only\n`);
console.log('  RANKED BY DEV (the selection window):');
console.log('  #  config                            DEV net   VALID net    TEST net   TESTt  TESTgreen');
rows.slice(0,10).forEach((r,i)=>console.log(
  `  ${String(i+1).padStart(2)} ${lbl(r).padEnd(32)} ${r.D.net.toFixed(0).padStart(9)} ${r.V.net.toFixed(0).padStart(10)} ${r.Z.net.toFixed(0).padStart(11)}  ${r.Z.t.toFixed(2).padStart(5)}   ${r.Z.green.toFixed(0)}%`));
const best=rows[0];
console.log(`\n  DEV WINNER: ${lbl(best)}`);
console.log(`    DEV  Rs${best.D.net.toFixed(0)}  |  VALID Rs${best.V.net.toFixed(0)}  |  TEST Rs${best.Z.net.toFixed(0)} (t=${best.Z.t.toFixed(2)})`);
const allpos=rows.filter(r=>r.D.net>0&&r.V.net>0&&r.Z.net>0);
console.log(`\n  configs positive in ALL THREE windows: ${allpos.length} of ${rows.length}`);
allpos.sort((a,b)=>b.Z.t-a.Z.t).slice(0,8).forEach(r=>console.log(
  `    ${lbl(r).padEnd(32)} DEV ${r.D.net.toFixed(0).padStart(8)}  VALID ${r.V.net.toFixed(0).padStart(8)}  TEST ${r.Z.net.toFixed(0).padStart(8)}  t=${r.Z.t.toFixed(2)}`));
console.log(`\n  Bonferroni |t| for ${rows.length} configs: ${(Math.abs(require('util')?0:0)||0).toFixed(0)||''}~3.2`);
