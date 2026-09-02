#!/usr/bin/env node
/** PHASE 7.C — is gap continuation alpha, or just long beta in a rising market?
 *  Plus a genuine OUT-OF-SAMPLE test on 2023-2026 NIFTY index daily bars
 *  reconstructed from 5-min data (F&O bhavcopy stops at 2022-12-30). */
const fs=require('fs');
const S=JSON.parse(fs.readFileSync('research-data/futdaily/nifty-fut-daily.json','utf8'));
const COST=0.0218;
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
function run(bars,TH,H,FADE){
  const T=[]; let i=21;
  while(i<bars.length-1){
    const gap=(bars[i].o-bars[i-1].c)/bars[i-1].c*100;
    if(Math.abs(gap)<TH){i++;continue;}
    let dir=gap>0?+1:-1; if(FADE)dir=-dir;
    const e=i+1; if(e>=bars.length)break;
    const x=Math.min(e+H-1,bars.length-1);
    const entry=bars[e].o, exit=bars[x].c;
    if(!(entry>0&&exit>0)){i++;continue;}
    let rolls=0; for(let k=e;k<=x;k++) if(k>e&&bars[k].exp&&bars[k].exp!==bars[k-1].exp) rolls++;
    T.push({date:bars[i].date,dir,net:dir*(exit-entry)/entry*100-COST*(1+rolls)});
    i=x+1;
  }
  return T;
}
const T=run(S,0.3,3,false);
const L=T.filter(t=>t.dir>0), Sh=T.filter(t=>t.dir<0);
console.log('PHASE 7.C - IS IT ALPHA OR BETA?\n');
console.log('  best cell: thr 0.3%, hold 3, continuation');
console.log(`  LONG  trades ${L.length}  sum ${sum(L.map(x=>x.net)).toFixed(1)}%  mean ${mean(L.map(x=>x.net)).toFixed(3)}%`);
console.log(`  SHORT trades ${Sh.length}  sum ${sum(Sh.map(x=>x.net)).toFixed(1)}%  mean ${mean(Sh.map(x=>x.net)).toFixed(3)}%`);
console.log('  -> if profit is ONLY in the longs, it is market beta, not a gap effect.\n');
// time-in-market comparison: what does simply being long for the same days give?
let bhSame=0;
{ let i=21;
  while(i<S.length-1){
    const gap=(S[i].o-S[i-1].c)/S[i-1].c*100;
    if(Math.abs(gap)<0.3){i++;continue;}
    const e=i+1,x=Math.min(e+2,S.length-1);
    bhSame += (S[x].c-S[e].o)/S[e].o*100;      // ALWAYS LONG, same days, no cost
    i=x+1;
  } }
console.log(`  always-long on the exact same days (no cost): ${bhSame.toFixed(1)}%`);
console.log(`  gap continuation (after cost):                ${sum(T.map(x=>x.net)).toFixed(1)}%`);
console.log(`  -> the strategy must beat "just be long those days" to be worth anything.\n`);

// ---------- OUT OF SAMPLE 2023-2026 from NIFTY 5-min index bars ----------
const raw=JSON.parse(fs.readFileSync('research-data/intraday/nifty5m.json','utf8'));
const byD=new Map();
for(const r of raw){
  const d=(r.t||r[0]||'').slice(0,10); if(!d)continue;
  const o=r.o??r[1],h=r.h??r[2],l=r.l??r[3],c=r.c??r[4];
  if(!byD.has(d)) byD.set(d,{date:d,o,h,l,c});
  const b=byD.get(d); b.h=Math.max(b.h,h); b.l=Math.min(b.l,l); b.c=c;
}
const daily=[...byD.values()].sort((a,b)=>a.date<b.date?-1:1);
const oos=daily.filter(d=>d.date>='2023-01-01');
const ins=daily.filter(d=>d.date<'2023-01-01');
console.log(`  NIFTY index daily bars rebuilt: ${daily.length}  (${daily[0].date} -> ${daily[daily.length-1].date})`);
console.log(`  in-sample <2023: ${ins.length}   OUT OF SAMPLE >=2023: ${oos.length}\n`);
console.log('  OUT-OF-SAMPLE TEST (2023-2026, never touched)');
console.log('  thr   H   trades   mean%    sum%      t     win%');
for(const TH of [0.3,0.5]){
  for(const H of [3,5]){
    const O=run(oos,TH,H,false);
    if(O.length<10){console.log(`  ${TH}  ${H}   too few`);continue;}
    const r=O.map(x=>x.net);
    console.log(`  ${TH}  ${String(H).padStart(2)}   ${String(O.length).padStart(6)}  ${mean(r).toFixed(3).padStart(7)}  ${sum(r).toFixed(1).padStart(7)}  ${(mean(r)/(sd(r)/Math.sqrt(r.length))).toFixed(2).padStart(6)}  ${(100*r.filter(x=>x>0).length/r.length).toFixed(0).padStart(4)}%`);
  }
}
console.log('\n  (index bars, so no roll cost and no futures basis - an optimistic proxy)');
