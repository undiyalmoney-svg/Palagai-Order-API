#!/usr/bin/env node
/** PHASE 13 — attribution: why do months lose? Is it entry quality or tail risk? */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, ORB=24, PER=250000, SLIP=+(process.env.SLIP??0.01);
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
let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
function build(STOPW){
  seed=99; const T=[];
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
      cands.push({sym,a,bi,dir,W:H-L,orwPct:100*(H-L)/a[bi].c});
    }
    if(!cands.length) continue;
    for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
    const c=cands[0], a=c.a, e=c.bi+1; if(e>=a.length-1) continue;
    const raw=a[e].o; if(!(raw>0)) continue;
    const fill=raw*(1+c.dir*SLIP/100);
    const qty=Math.floor(PER/fill); if(qty<1) continue;
    const stopD=STOPW!=null?STOPW*c.W:null;
    let px=null,why=null,mae=0;
    for(let j=e;j<a.length;j++){
      const adv=c.dir*((c.dir>0?a[j].l:a[j].h)-fill);
      mae=Math.min(mae,adv);
      if(a[j].hm>='15:15'){px=a[j].c;why='TIME';break;}
      if(stopD!=null&&adv<=-stopD){px=fill-c.dir*stopD;why='STOP';break;}
      if(j===a.length-1){px=a[j].c;why='EOD';}
    }
    if(px==null) continue;
    const ex=px*(1-c.dir*SLIP/100);
    const gross=c.dir*(ex-fill)*qty;
    const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    T.push({d,m:d.slice(0,7),sym:c.sym,dir:c.dir,qty,fill,ex,gross,chg,net:gross-chg,
            why,orwPct:c.orwPct,maeRs:mae*qty,notional:fill*qty,entryHm:a[e].hm});
  }
  return T;
}
const SEG=(X,lo,hi)=>X.filter(t=>t.d>=lo&&t.d<=hi);
const NET=X=>sum(X.map(x=>x.net));
const TSTAT=X=>{const dm=new Map();for(const t of X)dm.set(t.d,(dm.get(t.d)||0)+t.net);const dn=[...dm.values()];return mean(dn)/(sd(dn)/Math.sqrt(dn.length));};
console.log('FINE STOP GRID - is the 1.5W result monotonic or noise?\n');
console.log('  stop     TOTAL      DEV        VALID       TEST      TEST t   months+');
for(const sw of [null,3.0,2.5,2.0,1.75,1.5,1.25,1.0,0.75,0.5]){
  const X=build(sw);
  const D=SEG(X,'2000-01-01','2019-12-31'),V=SEG(X,'2020-01-01','2022-12-31'),Z=SEG(X,'2023-01-01','2099-12-31');
  const bm=new Map(); for(const t of X){ if(!bm.has(t.m))bm.set(t.m,0); bm.set(t.m,bm.get(t.m)+t.net); }
  const mp=[...bm.values()].filter(v=>v>0).length;
  console.log(`  ${String(sw===null?'none':sw+'W').padEnd(6)} ${NET(X).toFixed(0).padStart(9)} ${NET(D).toFixed(0).padStart(10)} ${NET(V).toFixed(0).padStart(11)} ${NET(Z).toFixed(0).padStart(11)}  ${TSTAT(Z).toFixed(2).padStart(6)}   ${mp}/${bm.size}`);
}
console.log('\nDIRECTION SPLIT at stop 1.5W');
{ const X=build(1.5);
  for(const [lbl,f] of [['LONG only',t=>t.dir>0],['SHORT only',t=>t.dir<0],['both',()=>true]]){
    const Y=X.filter(f);
    const D=SEG(Y,'2000-01-01','2019-12-31'),V=SEG(Y,'2020-01-01','2022-12-31'),Z=SEG(Y,'2023-01-01','2099-12-31');
    console.log(`  ${lbl.padEnd(11)} n=${String(Y.length).padStart(5)}  DEV ${NET(D).toFixed(0).padStart(9)}  VALID ${NET(V).toFixed(0).padStart(9)}  TEST ${NET(Z).toFixed(0).padStart(9)}  TESTt ${TSTAT(Z).toFixed(2)}`);
  } }
console.log();
const T=build(null);
const byM=new Map();
for(const t of T){ if(!byM.has(t.m))byM.set(t.m,[]); byM.get(t.m).push(t); }
const ms=[...byM.keys()].sort();
const mNet=ms.map(m=>({m,net:sum(byM.get(m).map(x=>x.net)),n:byM.get(m).length}));
const win=mNet.filter(x=>x.net>0), los=mNet.filter(x=>x.net<=0);
console.log('PHASE 13 - WHY DO MONTHS LOSE?   (no stop, Rs250k, slip '+SLIP+'%/side)\n');
console.log(`  months ${ms.length}   profitable ${win.length} (${(100*win.length/ms.length).toFixed(0)}%)   losing ${los.length}`);
console.log(`  mean winning month +Rs${mean(win.map(x=>x.net)).toFixed(0)}   mean losing month Rs${mean(los.map(x=>x.net)).toFixed(0)}`);
console.log(`  TOTAL Rs${sum(mNet.map(x=>x.net)).toFixed(0)} over ${T.length} trades\n`);

console.log('  (1) IS IT TAIL-DRIVEN? distribution of single-trade P&L');
const nets=T.map(x=>x.net).sort((a,b)=>a-b);
const q=p=>nets[Math.floor(p*(nets.length-1))];
console.log(`    p1 ${q(.01).toFixed(0)}   p5 ${q(.05).toFixed(0)}   p25 ${q(.25).toFixed(0)}   median ${q(.5).toFixed(0)}   p75 ${q(.75).toFixed(0)}   p95 ${q(.95).toFixed(0)}   p99 ${q(.99).toFixed(0)}`);
console.log(`    worst 1% of trades (${Math.round(nets.length*0.01)} trades) contribute Rs${sum(nets.slice(0,Math.round(nets.length*0.01))).toFixed(0)}`);
console.log(`    worst 5% of trades contribute Rs${sum(nets.slice(0,Math.round(nets.length*0.05))).toFixed(0)}`);
console.log(`    best  5% of trades contribute Rs${sum(nets.slice(-Math.round(nets.length*0.05))).toFixed(0)}`);
console.log(`    -> total without worst 5%: Rs${sum(nets.slice(Math.round(nets.length*0.05))).toFixed(0)}`);

console.log('\n  (2) WHAT DISTINGUISHES WINNING FROM LOSING TRADES? (all knowable AFTER, not before)');
const W=T.filter(x=>x.net>0), L=T.filter(x=>x.net<=0);
const cmp=(f,lbl)=>console.log(`    ${lbl.padEnd(22)} winners ${mean(W.map(f)).toFixed(3).padStart(9)}   losers ${mean(L.map(f)).toFixed(3).padStart(9)}`);
cmp(x=>x.orwPct,'OR width %');
cmp(x=>x.dir>0?1:0,'fraction LONG');
cmp(x=>+x.entryHm.slice(0,2)+ +x.entryHm.slice(3)/60,'entry hour');

console.log('\n  (3) DOES A STOP FIX THE TAIL?  (stop in units of OR width)');
console.log('    stop     trades    NET Rs    worst trade   p1 trade    stopped%   months+');
for(const sw of [null,2.0,1.5,1.0,0.75,0.5]){
  const X=build(sw);
  const bm=new Map(); for(const t of X){ if(!bm.has(t.m))bm.set(t.m,0); bm.set(t.m,bm.get(t.m)+t.net); }
  const mp=[...bm.values()].filter(v=>v>0).length;
  const ns=X.map(x=>x.net).sort((a,b)=>a-b);
  const stopped=100*X.filter(x=>x.why==='STOP').length/X.length;
  console.log(`    ${String(sw===null?'none':sw+'W').padEnd(6)}  ${String(X.length).padStart(6)}  ${sum(X.map(x=>x.net)).toFixed(0).padStart(9)}  ${Math.min(...X.map(x=>x.net)).toFixed(0).padStart(11)}  ${ns[Math.floor(0.01*ns.length)].toFixed(0).padStart(9)}   ${stopped.toFixed(0).padStart(7)}%   ${mp}/${bm.size}`);
}
