#!/usr/bin/env node
/** PHASE 9 — THE FIX: position size, not entry.
 *  Diagnosis: Zerodha intraday brokerage = min(Rs20, 0.03% x turnover) PER ORDER.
 *  At Rs10,000 notional brokerage is 57% of all charges and the rate is 0.106%.
 *  Above Rs66,667 the Rs20 cap binds and the RATE FALLS with size, while the
 *  edge per trade (a % of price) stays constant. Every prior phase was run at
 *  the single worst point on that curve.
 *  Capital Rs50,000. MIS intraday leverage lets notional exceed capital.
 *  DEV<=2019 | VALID 2020-22 | TEST>=2023. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, SLIP=+(process.env.SLIP??0.02);
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10);
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]});
  }
  S.set(f.replace('.json',''),bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
function run(ORB,STOPW,PER,MAXPOS){
  const T=[];
  for(const d of dates){
    let taken=0;
    for(const [sym,bs] of S){
      if(taken>=MAXPOS) break;
      const a=bs.get(d); if(!a||a.length<ORB+12) continue;
      let H=-1e9,L=1e9;
      for(let k=0;k<ORB;k++){H=Math.max(H,a[k].h);L=Math.min(L,a[k].l);}
      if(!(H>L)) continue;
      const W=H-L;
      let bi=null,dir=0;
      for(let j=ORB;j<a.length-2;j++){
        if(a[j].hm>='14:45') break;
        if(a[j].c>H){bi=j;dir=+1;break;}
        if(a[j].c<L){bi=j;dir=-1;break;}
      }
      if(bi==null) continue;
      const e=bi+1; if(e>=a.length-1) continue;
      const raw=a[e].o; if(!(raw>0)) continue;
      const fill=raw*(1+dir*SLIP/100);
      const qty=Math.floor(PER/fill); if(qty<1) continue;
      const stopD=STOPW!=null?STOPW*W:null;
      let px=null,why=null;
      for(let j=e;j<a.length;j++){
        if(a[j].hm>='15:15'){px=a[j].c;why='TIME';break;}
        const adv=dir*((dir>0?a[j].l:a[j].h)-fill);
        if(stopD!=null&&adv<=-stopD){px=fill-dir*stopD;why='STOP';break;}
        if(j===a.length-1){px=a[j].c;why='EOD';}
      }
      if(px==null) continue;
      const ex=px*(1-dir*SLIP/100);
      const gross=dir*(ex-fill)*qty;
      const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
      T.push({d,sym,gross,chg,net:gross-chg,notional:fill*qty,why});
      taken++;
    }
  }
  return T;
}
const seg=(T,lo,hi)=>T.filter(t=>t.d>=lo&&t.d<=hi);
const stat=X=>{ if(!X.length)return null;
  const days=new Map(); for(const t of X) days.set(t.d,(days.get(t.d)||0)+t.net);
  const dn=[...days.values()];
  return {n:sum(X.map(x=>x.net)),tr:X.length,t:mean(dn)/(sd(dn)/Math.sqrt(dn.length)),
          rate:100*sum(X.map(x=>x.chg))/sum(X.map(x=>x.notional)),
          grossR:100*sum(X.map(x=>x.gross))/sum(X.map(x=>x.notional))}; };
console.log(`PHASE 9 - POSITION SIZE AS THE FIX   (ORB 120min, NO stop, slippage ${SLIP}%/side)\n`);
console.log('  GROSS RATE BY WINDOW (this is the edge itself, independent of cost)');
console.log('  stop      DEV gross   VALID gross   TEST gross   |  costrate@Rs250k');
for(const SW of [1.0,1.5,2.0,null]){
  const T=run(24,SW,250000,1);
  const D=stat(seg(T,'2000-01-01','2019-12-31')),V=stat(seg(T,'2020-01-01','2022-12-31')),Z=stat(seg(T,'2023-01-01','2099-12-31'));
  console.log('  '+String(SW===null?'none':SW+'W').padEnd(6)+'  '+D.grossR.toFixed(4)+'%      '+V.grossR.toFixed(4)+'%      '+Z.grossR.toFixed(4)+'%   |   '+D.rate.toFixed(4)+'%');
}
console.log();
console.log('  notional  x pos   lev   costrate  grossrate |    DEV net   VALID net    TEST net   TOTAL');
for(const [PER,MP] of [[10000,5],[25000,2],[50000,1],[100000,1],[150000,1],[200000,1],[250000,1]]){
  const T=run(24,null,PER,MP);
  const D=stat(seg(T,'2000-01-01','2019-12-31')), V=stat(seg(T,'2020-01-01','2022-12-31')), Z=stat(seg(T,'2023-01-01','2099-12-31'));
  if(!D||!V||!Z) continue;
  const tot=D.n+V.n+Z.n;
  console.log(`  Rs${String(PER).padStart(7)}   x${MP}   ${(PER*MP/50000).toFixed(1)}x   ${D.rate.toFixed(4)}%   ${D.grossR.toFixed(4)}%  | ${D.n.toFixed(0).padStart(9)} ${V.n.toFixed(0).padStart(10)} ${Z.n.toFixed(0).padStart(11)} ${tot.toFixed(0).padStart(9)}`);
}
