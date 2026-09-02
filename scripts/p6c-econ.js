#!/usr/bin/env node
/** PHASE 6.C — economics of sweep+IFVG, traded AS SPECIFIED and FADED.
 *  Rs10,000/position, max 5 concurrent per day, MIS charges, 0.05%/side slippage.
 *  Entry = next bar open after the IFVG retest. Exit = H bars later or 15:15.
 *  DEV <=2019-12-31 | VALID 2020-2022 | TEST >=2023 excluded at load. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, SLIP=+(process.env.SLIP??0.05), PER=10000, MAXPOS=5;
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d>='2023-01-01')continue;
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});
  }
  S.set(f.replace('.json',''),bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
function trades(SWING,MAXWAIT,H,FADE){
  const T=[];
  for(const d of dates){
    let taken=0;
    for(const [sym,bs] of S){
      if(taken>=MAXPOS) break;
      const a=bs.get(d); if(!a||a.length<40) continue;
      const gaps=[];
      for(let i=2;i<a.length&&taken<MAXPOS;i++){
        if(a[i].l>a[i-2].h) gaps.push({type:+1,lo:a[i-2].h,hi:a[i].l,i,inverted:false});
        if(a[i].h<a[i-2].l) gaps.push({type:-1,lo:a[i].h,hi:a[i-2].l,i,inverted:false});
        for(const g of gaps){
          if(g.inverted||g.i>=i) continue;
          if(g.type===+1&&a[i].c<g.lo){g.inverted=true;g.invAt=i;g.invType=-1;}
          if(g.type===-1&&a[i].c>g.hi){g.inverted=true;g.invAt=i;g.invType=+1;}
        }
        if(i<SWING+2) continue;
        let pH=-1e9,pL=1e9;
        for(let k=i-SWING;k<i;k++){pH=Math.max(pH,a[k].h);pL=Math.min(pL,a[k].l);}
        const ss=a[i].l<pL&&a[i].c>pL, bq=a[i].h>pH&&a[i].c<pH;
        if(!ss&&!bq) continue;
        let dir=ss?+1:-1; if(FADE) dir=-dir;
        for(let j=i+1;j<Math.min(i+1+MAXWAIT,a.length-1);j++){
          const want=FADE?-dir:dir;
          const g=gaps.find(g=>g.inverted&&g.invType===want&&g.invAt<=j&&a[j].l<=g.hi&&a[j].h>=g.lo);
          if(!g) continue;
          const e=j+1; if(e>=a.length) break;
          const raw=a[e].o; if(!(raw>0)) break;
          const fill=raw*(1+dir*SLIP/100);
          const qty=Math.floor(PER/fill); if(qty<1) break;
          let x=Math.min(e+H,a.length-1);
          for(let k=e;k<=x;k++) if(a[k].hm>='15:15'){x=k;break;}
          const ex=a[x].c*(1-dir*SLIP/100);
          const gross=dir*(ex-fill)*qty;
          const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
          T.push({d,sym,gross,chg,net:gross-chg,notional:fill*qty});
          taken++; break;
        }
      }
    }
  }
  return T;
}
console.log('PHASE 6.C - ECONOMICS  (Rs10,000/position, max 5/day, MIS charges)\n');
console.log('  mode    SWING  wait   H   trades   gross Rs  charges Rs     NET Rs    on Rs50k   DEV net  VALID net');
const rows=[];
for(const FADE of [false,true]){
  for(const SWING of [10,20]){
    for(const H of [6,12,24]){
      const T=trades(SWING,12,H,FADE);
      if(!T.length) continue;
      const g=sum(T.map(x=>x.gross)),c=sum(T.map(x=>x.chg)),n=g-c;
      const dev=sum(T.filter(x=>x.d<='2019-12-31').map(x=>x.net));
      const val=sum(T.filter(x=>x.d>='2020-01-01').map(x=>x.net));
      rows.push({FADE,SWING,H,T,n,dev,val});
      console.log(`  ${(FADE?'FADE':'AS-SPEC').padEnd(8)} ${String(SWING).padStart(4)}    12  ${String(H).padStart(2)}  ${String(T.length).padStart(7)}  ${g.toFixed(0).padStart(9)}  ${c.toFixed(0).padStart(10)}  ${n.toFixed(0).padStart(9)}  ${(100*n/50000).toFixed(1).padStart(7)}%  ${dev.toFixed(0).padStart(8)}  ${val.toFixed(0).padStart(9)}`);
    }
  }
}
const best=rows.reduce((a,b)=>b.n>a.n?b:a);
console.log(`\n  BEST CELL: ${best.FADE?'FADE':'AS-SPEC'} SWING=${best.SWING} H=${best.H}  net Rs${best.n.toFixed(0)}`);
const byDay=new Map();
for(const t of best.T) byDay.set(t.d,(byDay.get(t.d)||0)+t.net);
const dn=[...byDay.values()];
const t_=mean(dn)/(sd(dn)/Math.sqrt(dn.length));
console.log(`  session-clustered: ${dn.length} sessions, mean Rs${mean(dn).toFixed(1)}/session, t = ${t_.toFixed(2)}`);
console.log(`  12 cells tested -> Bonferroni |t| threshold 2.87`);
console.log(`  charge rate: ${(100*sum(best.T.map(x=>x.chg))/sum(best.T.map(x=>x.notional))).toFixed(4)}% of notional traded`);
