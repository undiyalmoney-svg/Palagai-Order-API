#!/usr/bin/env node
/** PHASE 9.C — does OPENING-RANGE WIDTH predict ORB payoff?
 *  Mechanism-derived, not fitted: wider range = bigger moves relative to a
 *  FIXED cost, so the edge/cost ratio should rise with width.
 *  Deciles computed WITHIN each (symbol, year) so it is a relative-volatility
 *  measure, not a proxy for "expensive stock" or "volatile year".
 *  Reported separately for DEV / VALID / TEST. No costs here - gross only. */
const fs=require('fs'),path=require('path');
const DIR=process.env.EQDIR, ORB=24;
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
const EV=[];
for(const [sym,bs] of S){
  for(const [d,a] of bs){
    if(a.length<ORB+12) continue;
    let H=-1e9,L=1e9;
    for(let k=0;k<ORB;k++){H=Math.max(H,a[k].h);L=Math.min(L,a[k].l);}
    if(!(H>L)) continue;
    const W=H-L;
    let bi=null,dir=0;
    for(let j=ORB;j<a.length-2;j++){
      if(a[j].hm>='14:45')break;
      if(a[j].c>H){bi=j;dir=+1;break;}
      if(a[j].c<L){bi=j;dir=-1;break;}
    }
    if(bi==null) continue;
    const e=bi+1; if(e>=a.length-1) continue;
    const entry=a[e].o; if(!(entry>0)) continue;
    let ei=a.length-1;
    for(let j=e;j<a.length;j++){ if(a[j].hm>='15:15'){ei=j;break;} ei=j; }
    EV.push({sym,d,y:d.slice(0,4),dir,orw:100*W/entry,
             ret:100*dir*(a[ei].c-entry)/entry});
  }
}
// rank OR width WITHIN (symbol, year)
const grp=new Map();
for(const e of EV){const k=e.sym+'|'+e.y; if(!grp.has(k))grp.set(k,[]); grp.get(k).push(e);}
for(const [,arr] of grp){
  arr.sort((a,b)=>a.orw-b.orw);
  arr.forEach((e,i)=>{e.dec=Math.min(9,Math.floor(10*i/arr.length));});
}
const win=e=>e.d<='2019-12-31'?'DEV':e.d<='2022-12-31'?'VALID':'TEST';
console.log('PHASE 9.C - GROSS RETURN BY OPENING-RANGE WIDTH DECILE (within symbol-year)\n');
console.log('  decile   medORw%  |      DEV n    ret%   |    VALID n    ret%   |     TEST n    ret%');
for(let k=0;k<10;k++){
  const cells=['DEV','VALID','TEST'].map(w=>EV.filter(e=>e.dec===k&&win(e)===w));
  const orw=EV.filter(e=>e.dec===k).map(e=>e.orw).sort((a,b)=>a-b);
  let line=`  ${String(k).padStart(4)}     ${orw[Math.floor(orw.length/2)].toFixed(2).padStart(6)}  |`;
  for(const c of cells) line+=` ${String(c.length).padStart(9)}  ${mean(c.map(x=>x.ret)).toFixed(4).padStart(7)}  |`;
  console.log(line);
}
console.log('\n  TOP-3 DECILES (widest ranges) vs BOTTOM-3, with significance:');
for(const w of ['DEV','VALID','TEST']){
  const hi=EV.filter(e=>e.dec>=7&&win(e)===w).map(e=>e.ret);
  const lo=EV.filter(e=>e.dec<=2&&win(e)===w).map(e=>e.ret);
  const df=mean(hi)-mean(lo);
  const se=Math.sqrt(sd(hi)**2/hi.length+sd(lo)**2/lo.length);
  const seH=sd(hi)/Math.sqrt(hi.length);
  console.log(`  ${w.padEnd(6)} wide ${mean(hi).toFixed(4)}% (n=${hi.length}, t vs 0 = ${(mean(hi)/seH).toFixed(2)})   narrow ${mean(lo).toFixed(4)}%   diff ${df.toFixed(4)}%  t=${(df/se).toFixed(2)}`);
}
console.log('\n  cost at Rs250k notional 0.0541%  |  at Rs10k 0.1061%');
