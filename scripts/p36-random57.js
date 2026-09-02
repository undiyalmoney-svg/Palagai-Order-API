#!/usr/bin/env node
/** PHASE 36 — random-day out-of-sample test of the selective fade.
 *  Pick N random trading days from 2018-2026; run the strategy only on those
 *  days. Then bootstrap M resamples for the distribution.
 *  Strategy frozen: climax bar>=2.3xATR fade, biggest-run pick, hold-to-close,
 *  2xATR stop, honest 1x sizing, slip 0.05%/side (conservative). */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR='research-data/midintra', SLIP=0.05, RB=6, RP=2.5, VM=3.0, BR=2.3;
const N=+(process.env.N||57), M=+(process.env.M||2000);
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
function atr14(a,i){let tr=0,n=0;for(let j=Math.max(1,i-13);j<=i;j++){tr+=Math.max(a[j].h-a[j].l,Math.abs(a[j].h-a[j-1].c),Math.abs(a[j].l-a[j-1].c));n++;}return n?tr/n:0;}
function sig(a){for(let i=25;i<a.length-2;i++){if(a[i].hm<'10:15'||a[i].hm>'14:30')continue;
  const run=(a[i].c-a[i-RB].c)/a[i-RB].c*100,av=mean(a.slice(i-20,i).map(x=>x.v));if(av<=0)continue;
  const volx=a[i].v/av,rg=a[i].h-a[i].l;if(rg<=0)continue;const atr=atr14(a,i);if(atr<=0)continue;
  const barR=rg/atr;
  if(run>=RP&&volx>=VM&&(a[i].c-a[i].l)/rg<=0.34&&barR>=BR)return{i,dir:-1,run:Math.abs(run),atr};
  if(run<=-RP&&volx>=VM&&(a[i].h-a[i].c)/rg<=0.34&&barR>=BR)return{i,dir:1,run:Math.abs(run),atr};}return null;}
/** result for ONE day (may be no-trade): returns net or null */
const dayCache=new Map();
function dayResult(d){
  if(dayCache.has(d)) return dayCache.get(d);
  let cands=[];
  for(const [sym,bs] of S){const a=bs.get(d);if(a&&a.length>=45){const s=sig(a);if(s){s.a=a;s.sym=sym;cands.push(s);}}}
  let res=null;
  if(cands.length){ cands.sort((x,y)=>y.run-x.run); const c=cands[0],a=c.a,e=c.i+1;
    if(e<a.length-1){ const dir=c.dir,fill=a[e].o*(1+dir*SLIP/100),qty=Math.floor(50000/fill);
      if(qty>=1){ const stopD=2*c.atr; let px=null;
        for(let j=e;j<a.length;j++){const b=a[j];const adv=dir*((dir>0?b.l:b.h)-fill);
          if(b.hm>='15:15'){px=b.c;break;}if(adv<=-stopD){px=fill-dir*stopD;break;}if(j===a.length-1)px=b.c;}
        const ex=px*(1-dir*SLIP/100);
        res={sym:c.sym,side:dir>0?'BUY':'SELL',qty,fill,ex,net:dir*(ex-fill)*qty-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs};
      } } }
  dayCache.set(d,res); return res;
}
// precompute all days once
for(const d of dates) dayResult(d);
// --- one seeded sample of N days, shown ---
let seed=57571; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
function sample(n){const pool=[...dates];const out=[];for(let k=0;k<n;k++){const j=Math.floor(rnd()*pool.length);out.push(pool.splice(j,1)[0]);}return out.sort();}
const days=sample(N);
console.log(`SELECTIVE FADE — ${N} RANDOM DAYS from ${dates[0]}..${dates[dates.length-1]} (slip ${SLIP}%)\n`);
console.log('date         result');
let tot=0,ntr=0,ntd=0,worst=0;const nets=[];
for(const d of days){ const r=dayResult(d);
  if(r){ tot+=r.net; ntr++; nets.push(r.net); worst=Math.min(worst,r.net);
    console.log(`${d}   ${r.side} ${r.sym.padEnd(11)} qty ${String(r.qty).padStart(5)}  net Rs${r.net.toFixed(0).padStart(7)}`);
  } else { ntd++; console.log(`${d}   no trade`); }
}
const w=nets.filter(x=>x>0).length;
console.log(`\n  of ${N} random days: ${ntr} traded, ${ntd} no-trade`);
console.log(`  net Rs${tot.toFixed(0)}  ·  win ${ntr?(100*w/ntr).toFixed(0):0}%  ·  worst day Rs${worst.toFixed(0)}`);
console.log(`  avg per traded day Rs${ntr?(tot/ntr).toFixed(0):0}  ·  return on Rs50,000 = ${(100*tot/50000).toFixed(1)}%`);
// --- bootstrap distribution ---
const totals=[];
for(let m=0;m<M;m++){ const dd=sample(N); let t=0; for(const d of dd){const r=dayResult(d); if(r)t+=r.net;} totals.push(t); }
totals.sort((a,b)=>a-b);
const pos=100*totals.filter(x=>x>0).length/M;
const q=p=>totals[Math.floor(p*(M-1))];
console.log(`\n  BOOTSTRAP: ${M} random ${N}-day samples`);
console.log(`  profitable samples: ${pos.toFixed(1)}%`);
console.log(`  median Rs${q(.5).toFixed(0)}  ·  5th pct Rs${q(.05).toFixed(0)}  ·  95th pct Rs${q(.95).toFixed(0)}`);
console.log(`  mean Rs${mean(totals).toFixed(0)}  worst-of-${M} Rs${totals[0].toFixed(0)}  best Rs${totals[M-1].toFixed(0)}`);
