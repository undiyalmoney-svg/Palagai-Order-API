#!/usr/bin/env node
/** PHASE 4.F — INVERSE ARMS + FLAT-DAY CONDITIONING. Read-only. TEST excluded at load.
 *  Q1: if buying the breakout loses, does selling it win?
 *  Q2: does restricting to FLAT days (defined CAUSALLY, pre-entry only) help?
 *  All "flat" definitions use information available at or before the entry bar. */
const fs=require('fs'),path=require('path');
const EF='09:45',ET='14:45',PB=0.0015;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const STAT=100*MIS({entryPrice:1000,exitPrice:1000,quantity:50}).totalRs/50000, FULL=STAT+0.20;
const DIR=process.argv[2];
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const s=f.replace('.json','');const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d>='2023-01-01')continue;
    if(!bs.has(d))bs.set(d,[]);bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});}
  S.set(s,bs);}
// NIFTY index intraday for a market-level flat measure
const IX=new Map();
for(const r of JSON.parse(fs.readFileSync(process.argv[3],'utf8'))){
  const d=r.t.slice(0,10); if(d>='2023-01-01')continue;
  if(!IX.has(d))IX.set(d,new Map()); IX.get(d).set(r.t.slice(11,16),r.c);}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort().filter(d=>IX.has(d));
const dPos=new Map(dates.map((d,i)=>[d,i]));
const E=[];
for(const d of dates){
  const ixm=IX.get(d); const ixOpen=ixm.get('09:15');
  for(const [sym,bs] of S){
    const arr=bs.get(d); if(!arr||arr.length<30)continue;
    let orH=-1e9,orL=1e9;for(let k=0;k<3;k++){orH=Math.max(orH,arr[k].h);orL=Math.min(orL,arr[k].l);}
    if(!(orH>orL))continue;
    const orW=(orH-orL)/arr[0].o*100;
    const i=dPos.get(d); const prev=i>0?bs.get(dates[i-1]):null;
    let pRng=null;
    if(prev&&prev.length){let h=-1e9,l=1e9;for(const b of prev){h=Math.max(h,b.h);l=Math.min(l,b.l);}
      pRng=(h-l)/prev[prev.length-1].c*100;}
    let brk=null,ev=null;
    for(let j=3;j<arr.length;j++){
      if(!brk){if(arr[j].c>orH)brk={dir:1,level:orH};else if(arr[j].c<orL)brk={dir:-1,level:orL};continue;}
      if(!brk.pulled){if((brk.dir>0&&arr[j].l<=brk.level*(1+PB))||(brk.dir<0&&arr[j].h>=brk.level*(1-PB)))brk.pulled=true;continue;}
      const ok=brk.dir>0?arr[j].c>brk.level:arr[j].c<brk.level;
      if(!ok)continue;
      if(arr[j].hm<EF||arr[j].hm>ET)break;
      ev={j,dir:brk.dir};break;}
    if(!ev||ev.j+1>=arr.length)continue;
    const fill=arr[ev.j+1].o;if(!(fill>0))continue;
    const e=Math.min(ev.j+1+12,arr.length-1);if(e-(ev.j+1)<3)continue;
    const raw=(arr[e].c-fill)/fill*100;                 // signed price move, direction applied later
    const rets=[];for(let k=Math.max(1,ev.j-20);k<ev.j;k++)rets.push((arr[k].c-arr[k-1].c)/arr[k-1].c*100);
    const vol=sd(rets);if(!(vol>0))continue;
    // CAUSAL flat measures — all known at or before the entry bar
    const ixNow=ixm.get(arr[ev.j].hm);
    const ixMove=(ixNow&&ixOpen)?Math.abs((ixNow-ixOpen)/ixOpen*100):null;
    E.push({d,sym,raw,dir:ev.dir,vol,orW,pRng,ixMove});
  }
}
console.log(`entries ${E.length.toLocaleString()} over ${new Set(E.map(x=>x.d)).size} sessions`);
console.log(`statutory floor ${STAT.toFixed(3)}% · full hurdle ${FULL.toFixed(3)}%\n`);
const DEVf=x=>x.d<='2019-12-31', VALf=x=>x.d>='2020-01-01';
function clus(rows,sign){
  if(!rows.length)return null;
  const by=new Map();
  for(const r of rows){const v=sign*r.dir*r.raw; if(!by.has(r.d))by.set(r.d,[]);by.get(r.d).push(v);}
  const v=[...by.values()].map(mean);const se=v.length>1?sd(v)/Math.sqrt(v.length):NaN;
  return {n:rows.length,days:v.length,mean:mean(v),t:se>0?mean(v)/se:NaN};
}
console.log('=== Q1. IF BUYING LOSES, DOES SELLING WIN? (exact mirror of the same entries) ===');
console.log('arm                          DEV n   DEV%      t   | VALID%      t   | vs statutory 0.106%');
console.log('-'.repeat(96));
const arms=[
 ['LONG breakouts, BUY  (as tested)', x=>x.dir>0, +1],
 ['LONG breakouts, SELL (inverse)  ', x=>x.dir>0, -1],
 ['SHORT breakouts, SELL (as tested)',x=>x.dir<0, +1],
 ['SHORT breakouts, BUY  (inverse) ', x=>x.dir<0, -1],
 ['ALL breakouts, with-trend       ', ()=>true,  +1],
 ['ALL breakouts, AGAINST-trend    ', ()=>true,  -1],
];
for(const [lbl,f,sg] of arms){
  const a=clus(E.filter(x=>DEVf(x)&&f(x)),sg), b=clus(E.filter(x=>VALf(x)&&f(x)),sg);
  if(!a||!b)continue;
  const worst=Math.min(a.mean,b.mean);
  console.log(`${lbl} ${String(a.n).padStart(6)}${a.mean.toFixed(3).padStart(9)}${a.t.toFixed(2).padStart(7)} |`+
    `${b.mean.toFixed(3).padStart(9)}${b.t.toFixed(2).padStart(7)} |  ${worst>STAT?'CLEARS':'FAILS ('+(100*worst/STAT).toFixed(0)+'% of floor)'}`);
}
console.log('-'.repeat(96));
console.log('\n=== Q2. FLAT DAYS (all definitions CAUSAL — known at/before the entry bar) ===');
const flats=[
 ['index moved <0.3% from open by entry', x=>x.ixMove!=null&&x.ixMove<0.3],
 ['index moved <0.5% from open by entry', x=>x.ixMove!=null&&x.ixMove<0.5],
 ['narrow opening range (<0.6%)',         x=>x.orW<0.6],
 ['low pre-entry stock volatility',       x=>x.vol<0.15],
 ['quiet prior session (range <1.5%)',    x=>x.pRng!=null&&x.pRng<1.5],
 ['index quiet AND narrow OR',            x=>x.ixMove!=null&&x.ixMove<0.3&&x.orW<0.6],
];
console.log('flat definition                        arm        DEV n   DEV%      t   | VALID%      t   | verdict');
console.log('-'.repeat(104));
let best=null;
for(const [lbl,ff] of flats){
  for(const [an,sg] of [['with-trend',+1],['against  ',-1]]){
    const a=clus(E.filter(x=>DEVf(x)&&ff(x)),sg), b=clus(E.filter(x=>VALf(x)&&ff(x)),sg);
    if(!a||!b||a.days<60||b.days<60){console.log(`${lbl.padEnd(38)}${an}  too few`);continue;}
    const worst=Math.min(a.mean,b.mean);
    const v=worst>FULL?'CLEARS FULL':worst>STAT?'clears statutory only':`fails (${(100*worst/STAT).toFixed(0)}% of floor)`;
    console.log(`${lbl.padEnd(38)}${an} ${String(a.n).padStart(6)}${a.mean.toFixed(3).padStart(9)}${a.t.toFixed(2).padStart(7)} |`+
      `${b.mean.toFixed(3).padStart(9)}${b.t.toFixed(2).padStart(7)} |  ${v}`);
    if(!best||worst>best.worst)best={lbl,an,worst,a,b};
  }
}
console.log('-'.repeat(104));
if(best)console.log(`\nbest flat-day cell: "${best.lbl}" ${best.an}  worst-window ${best.worst.toFixed(3)}%  (needs ${STAT.toFixed(3)}% statutory / ${FULL.toFixed(3)}% full)`);
console.log('\n=== THE ARITHMETIC OF INVERTING A LOSING EDGE ===');
const L=clus(E.filter(x=>DEVf(x)&&x.dir>0),+1), LV=clus(E.filter(x=>VALf(x)&&x.dir>0),+1);
console.log(`  long-buy  DEV ${L.mean.toFixed(3)}%  VALID ${LV.mean.toFixed(3)}%`);
console.log(`  inverse   DEV ${(-L.mean).toFixed(3)}%  VALID ${(-LV.mean).toFixed(3)}%`);
console.log(`  cost is paid EITHER WAY: ${STAT.toFixed(3)}% statutory, ${FULL.toFixed(3)}% realistic`);
console.log(`  inverting only helps if |edge| > cost. Here |edge| = ${Math.abs(LV.mean).toFixed(3)}% < ${STAT.toFixed(3)}%.`);
