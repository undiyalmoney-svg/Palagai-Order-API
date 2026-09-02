#!/usr/bin/env node
/** PHASE 6.B — is the sweep+IFVG effect real, or just short-horizon mean reversion?
 *  Controls:
 *    (a) time-shifted placebo (as 6.A)
 *    (b) MOMENTUM-MATCHED: bars with the same recent move, same direction, no setup
 *    (c) SWEEP-ONLY: liquidity sweep without the IFVG retest  -> does IFVG add anything?
 *  Also: parameter robustness over SWING x MAXWAIT. Read-only, TEST excluded. */
const fs=require('fs'),path=require('path');
const DIR=process.env.EQDIR;
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d>='2023-01-01')continue;
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({o:r[1],h:r[2],l:r[3],c:r[4]});
  }
  S.set(f.replace('.json',''),bs);
}
/** returns {entries, sweepOnly, pool} for given params.
 *  pool = every (bar,direction) with its 5-bar prior move, for momentum matching */
function scan(SWING,MAXWAIT){
  const entries=[], sweepOnly=[], pool=[];
  for(const [sym,bs] of S){
    for(const [d,a] of bs){
      if(a.length<40) continue;
      const gaps=[];
      for(let i=2;i<a.length;i++){
        if(a[i].l>a[i-2].h) gaps.push({type:+1,lo:a[i-2].h,hi:a[i].l,i,inverted:false});
        if(a[i].h<a[i-2].l) gaps.push({type:-1,lo:a[i].h,hi:a[i-2].l,i,inverted:false});
        for(const g of gaps){
          if(g.inverted||g.i>=i) continue;
          if(g.type===+1 && a[i].c<g.lo){ g.inverted=true; g.invAt=i; g.invType=-1; }
          if(g.type===-1 && a[i].c>g.hi){ g.inverted=true; g.invAt=i; g.invType=+1; }
        }
        if(i>=6 && i<a.length-25){
          const mv=(a[i].c-a[i-5].c)/a[i-5].c*100;
          pool.push({a,i,mv});
        }
        if(i<SWING+2) continue;
        let pH=-1e9,pL=1e9;
        for(let k=i-SWING;k<i;k++){ pH=Math.max(pH,a[k].h); pL=Math.min(pL,a[k].l); }
        const ss=a[i].l<pL&&a[i].c>pL, bs2=a[i].h>pH&&a[i].c<pH;
        if(!ss&&!bs2) continue;
        const dir=ss?+1:-1;
        if(i+1<a.length-1) sweepOnly.push({a,e:i+1,dir});
        for(let j=i+1;j<Math.min(i+1+MAXWAIT,a.length-1);j++){
          const g=gaps.find(g=>g.inverted&&g.invType===dir&&g.invAt<=j&&a[j].l<=g.hi&&a[j].h>=g.lo);
          if(!g) continue;
          const e=j+1; if(e>=a.length) break;
          entries.push({a,e,dir,mv:(a[j].c-a[Math.max(0,j-5)].c)/a[Math.max(0,j-5)].c*100});
          break;
        }
      }
    }
  }
  return {entries,sweepOnly,pool};
}
const ret=(o,H)=>{const x=o.e+H; if(x>=o.a.length)return null; return o.dir*(o.a[x].c-o.a[o.e].o)/o.a[o.e].o*100;};

console.log('PHASE 6.B - CONTROLS AND ROBUSTNESS\n');
const {entries,sweepOnly,pool}=scan(10,12);
// momentum-matched control: bucket pool by 5-bar move decile, draw same-decile bars
const mvs=pool.map(p=>p.mv).sort((x,y)=>x-y);
const q=k=>mvs[Math.floor(k*(mvs.length-1))];
const edges=[0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1].map(q);
const dec=v=>{for(let k=1;k<edges.length;k++) if(v<=edges[k]) return k-1; return 9;};
const buckets=Array.from({length:10},()=>[]);
for(const p of pool) buckets[dec(p.mv)].push(p);
let seed=20260829; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);

console.log('  (b) MOMENTUM-MATCHED CONTROL - same 5-bar prior move decile, same direction');
console.log('  horizon      n    signal%   momCtl%      diff%        t');
for(const H of [3,6,12,24]){
  const sig=[],ctl=[];
  for(const ev of entries){
    const r=ret(ev,H); if(r===null) continue; sig.push(r);
    const b=buckets[dec(ev.mv)]; if(!b.length) continue;
    const p=b[Math.floor(rnd()*b.length)];
    const x=p.i+1+H; if(x>=p.a.length) continue;
    ctl.push(ev.dir*(p.a[x].c-p.a[p.i+1].o)/p.a[p.i+1].o*100);
  }
  const df=mean(sig)-mean(ctl);
  const se=Math.sqrt(sd(sig)**2/sig.length+sd(ctl)**2/ctl.length);
  console.log(`  ${String(H).padStart(5)}  ${String(sig.length).padStart(7)}  ${mean(sig).toFixed(4).padStart(8)}  ${mean(ctl).toFixed(4).padStart(8)}  ${df.toFixed(4).padStart(9)}  ${(df/se).toFixed(2).padStart(7)}`);
}
console.log('\n  (c) DOES THE INVERSE FVG ADD ANYTHING OVER THE SWEEP ALONE?');
console.log('  horizon   sweep+IFVG%   sweepOnly%      diff%        t');
for(const H of [3,6,12,24]){
  const A=entries.map(e=>ret(e,H)).filter(x=>x!==null);
  const B=sweepOnly.map(e=>ret(e,H)).filter(x=>x!==null);
  const df=mean(A)-mean(B);
  const se=Math.sqrt(sd(A)**2/A.length+sd(B)**2/B.length);
  console.log(`  ${String(H).padStart(5)}   ${mean(A).toFixed(4).padStart(10)}   ${mean(B).toFixed(4).padStart(10)}  ${df.toFixed(4).padStart(9)}  ${(df/se).toFixed(2).padStart(7)}`);
}
console.log('\n  (d) PARAMETER ROBUSTNESS - mean signal % at H=12 (cost to beat: 0.106)');
console.log('  SWING\\WAIT      6        12        24');
for(const SW of [5,10,20,30]){
  let row='  '+String(SW).padStart(5)+'    ';
  for(const MW of [6,12,24]){
    const {entries:E}=scan(SW,MW);
    const r=E.map(e=>ret(e,12)).filter(x=>x!==null);
    row+=(mean(r).toFixed(4)+'('+(r.length/1000).toFixed(0)+'k)').padStart(13);
  }
  console.log(row);
}
