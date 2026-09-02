#!/usr/bin/env node
/** PHASE 7.B — NIFTY futures GAP CONTINUATION, tested honestly.
 *  Inverse of pre-registered H5. NON-OVERLAPPING positions (flat before re-entry),
 *  so the equity curve is something a real account could actually hold.
 *  Costs 0.0218% round trip + one extra per contract roll spanned. */
const fs=require('fs');
const S=JSON.parse(fs.readFileSync('research-data/futdaily/nifty-fut-daily.json','utf8'));
const COST=0.0218;
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
function run(TH,H,FADE,verbose){
  const T=[]; let i=21;
  while(i<S.length-1){
    const gap=(S[i].o-S[i-1].c)/S[i-1].c*100;
    if(Math.abs(gap)<TH){ i++; continue; }
    let dir=gap>0?+1:-1; if(FADE) dir=-dir;
    const e=i+1; if(e>=S.length) break;
    const x=Math.min(e+H-1,S.length-1);
    const entry=S[e].o, exit=S[x].c;
    if(!(entry>0&&exit>0)){ i++; continue; }
    let rolls=0; for(let k=e;k<=x;k++) if(k>e&&S[k].exp!==S[k-1].exp) rolls++;
    const gross=dir*(exit-entry)/entry*100;
    T.push({date:S[i].date,dir,gross,net:gross-COST*(1+rolls),gap});
    i=x+1;                                  // NON-OVERLAPPING: flat before next entry
  }
  return T;
}
console.log('PHASE 7.B - GAP CONTINUATION, NIFTY FUTURES, NON-OVERLAPPING\n');
console.log('  mode   thr%   H   trades   mean%    sum%    t      DEV%   VALID%   maxDD%   win%');
const rows=[];
for(const FADE of [false,true]){
 for(const TH of [0.3,0.5]){
  for(const H of [3,5,10]){
    const T=run(TH,H,FADE);
    if(T.length<25) continue;
    const r=T.map(x=>x.net);
    const t=mean(r)/(sd(r)/Math.sqrt(r.length));
    const dev=sum(T.filter(x=>x.date<'2020-01-01').map(x=>x.net));
    const val=sum(T.filter(x=>x.date>='2020-01-01').map(x=>x.net));
    let eq=0,pk=0,dd=0; for(const v of r){eq+=v;pk=Math.max(pk,eq);dd=Math.min(dd,eq-pk);}
    const w=100*r.filter(x=>x>0).length/r.length;
    rows.push({FADE,TH,H,T,t,dev,val,sum:sum(r)});
    console.log(`  ${(FADE?'FADE':'CONT').padEnd(5)}  ${TH.toFixed(1)}  ${String(H).padStart(2)}  ${String(T.length).padStart(6)}  ${mean(r).toFixed(3).padStart(7)}  ${sum(r).toFixed(1).padStart(7)}  ${t.toFixed(2).padStart(5)}  ${dev.toFixed(1).padStart(7)}  ${val.toFixed(1).padStart(7)}  ${dd.toFixed(1).padStart(7)}  ${w.toFixed(0).padStart(4)}%`);
  }
 }
}
const cont=rows.filter(r=>!r.FADE);
const best=cont.reduce((a,b)=>b.sum>a.sum?b:a);
console.log(`\n  BEST CONTINUATION: thr=${best.TH} H=${best.H}  sum ${best.sum.toFixed(1)}%  t=${best.t.toFixed(2)}`);
console.log(`  12 cells here + 15 in Phase 7 = 27 tests -> Bonferroni |t| threshold 3.09`);
console.log('\n  OUTLIER DEPENDENCE (best continuation cell)');
const srt=[...best.T].sort((a,b)=>b.net-a.net);
for(const k of [0,1,2,3,5]) console.log('    drop best '+k+' -> sum '+sum(srt.slice(k).map(x=>x.net)).toFixed(1)+'%');
console.log('\n  YEAR BY YEAR (best continuation cell)');
const byY=new Map();
for(const t of best.T){const y=t.date.slice(0,4);byY.set(y,(byY.get(y)||0)+t.net);}
for(const y of [...byY.keys()].sort()) console.log('    '+y+'  '+(byY.get(y)>=0?'+':'')+byY.get(y).toFixed(1)+'%');
