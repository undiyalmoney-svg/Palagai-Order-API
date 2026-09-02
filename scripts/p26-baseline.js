#!/usr/bin/env node
/**
 * PHASE 2.6 — BASELINE INDEX-LEVEL BACKTEST (first genuine historical test)
 *
 * WHAT THIS MEASURES: whether the real Trap V2 entry has DIRECTIONAL EDGE on
 * the NIFTY index over the intended ~45-minute holding period, using 11 years
 * of REAL 5-minute index candles. 100% real data, no option modelling, no
 * look-ahead: bars are replayed sequentially and the engine only ever sees
 * bars <= t. MAE/MFE are measured on the real forward path AFTER the entry
 * decision is already fixed — measurement, not decision.
 *
 * WHY INDEX-LEVEL FIRST: intraday option-contract candles do not exist for
 * expired contracts. But if the entry has no directional edge on the index,
 * no option overlay can rescue it. This is the cheapest decisive filter.
 *
 * CONTROL: time-of-day-matched random entries. Without it, a nonzero mean
 * move is uninterpretable (the index drifts, and signals cluster in time).
 *
 * Frozen split: DEV 2015-2018 | VALID 2019-2022 | TEST 2023-2026.
 */
const fs=require('fs');
const { createTrapStrategyV2 } = require('../live/strategy-core.cjs');
const CTX=400, HOLD_BARS=9;            // 9 x 5min = 45 minutes
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const q=(a,f)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*f))];};

function buildContext(c,i,id){
  return {candle60m:{...c[i]},candle30m:{...c[i]},candle15m:{...c[i]},candle5m:c[i],
    previous60m:[],previous30m:[],previous15m:[],previous5m:c.slice(Math.max(0,i-CTX),i),
    candleIndex5m:i,replayStepIndex:i,replayFrom:c[Math.max(0,i-CTX)]?.date??c[i].date,
    replayTo:c[i].date,instrumentId:'NIFTY 50'};
}
/** Forward path stats over the holding window — measured after entry is fixed. */
function pathStats(c,i,dir,entry){
  let mae=0,mfe=0; const day=c[i].date.slice(0,10);
  let last=entry,bars=0;
  for(let k=i+1;k<=Math.min(i+HOLD_BARS,c.length-1);k++){
    if(c[k].date.slice(0,10)!==day)break;              // never cross sessions
    const up=c[k].high-entry, dn=c[k].low-entry;
    if(dir==='BUY'){mae=Math.min(mae,dn);mfe=Math.max(mfe,up);}
    else{mae=Math.min(mae,-up);mfe=Math.max(mfe,-dn);}
    last=c[k].close;bars=k-i;
  }
  const signed=dir==='BUY'?last-entry:entry-last;
  return {mae:-mae,mfe,signed,bars};
}

const raw=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const C=raw.map(r=>({date:r.t,open:r.o,high:r.h,low:r.l,close:r.c}));
console.log(`bars ${C.length}  sessions ${new Set(C.map(x=>x.date.slice(0,10))).size}  ${C[0].date.slice(0,10)} -> ${C[C.length-1].date.slice(0,10)}`);

const strat=createTrapStrategyV2();
strat.initialize();
const S=strat.getSettings();
console.log(`engine DNA: maxTrades/day ${S.maxTradesPerDay}  R ${S.targetRMultiple}  entry ${S.entryTimeStart}-${S.entryTimeEnd}  windows "${S.extras.entryWindows}"`);

const sigs=[]; let day=null,nDay=0;
for(let i=CTX;i<C.length;i++){
  const d=C[i].date.slice(0,10);
  if(d!==day){day=d;nDay=0;strat.onTradeClosed?.(0,d);}
  if(nDay>=S.maxTradesPerDay)continue;
  const sg=strat.generateSignal(buildContext(C,i,'NIFTY 50'));
  if(sg.action!=='BUY'&&sg.action!=='SELL')continue;
  nDay++;
  const p=pathStats(C,i,sg.action,sg.entryPrice);
  sigs.push({d,t:C[i].date.slice(11,16),i,dir:sg.action,entry:sg.entryPrice,
    riskPts:Math.abs(sg.entryPrice-sg.stopLoss),...p});
}
console.log(`\nSIGNALS: ${sigs.length}  over ${new Set(sigs.map(s=>s.d)).size} sessions`);

/** CONTROL: same count, same time-of-day distribution, same direction mix, random days. */
const byIdx=new Map();C.forEach((c,i)=>{const t=c.date.slice(11,16);if(!byIdx.has(t))byIdx.set(t,[]);byIdx.get(t).push(i);});
let seed=12345;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const ctrl=[];
for(const s of sigs){
  const pool=byIdx.get(s.t)||[];if(!pool.length)continue;
  const j=pool[Math.floor(rnd()*pool.length)];
  if(j<1||j>=C.length-1)continue;
  const p=pathStats(C,j,s.dir,C[j].close);
  ctrl.push({d:C[j].date.slice(0,10),dir:s.dir,...p});
}

const WINS=[['DEV','2015','2018'],['VALID','2019','2022'],['TEST','2023','2026'],['ALL','2015','2026']];
function report(name,rows){
  console.log(`\n${'='.repeat(104)}\n${name}\n${'='.repeat(104)}`);
  console.log('Window   n      signed45m   t-stat   MAE_med  MAE_p75  MAE_p90  MAE_p95   MFE_med  MFE_p75  MFE_p90');
  for(const[w,a,b]of WINS){
    const r=rows.filter(x=>x.d>=a&&x.d<=b+'-12-31');
    if(r.length<20){console.log(`${w.padEnd(8)} ${String(r.length).padStart(5)}  (too few)`);continue;}
    const sg=r.map(x=>x.signed), t=mean(sg)/(sd(sg)/Math.sqrt(r.length));
    const mae=r.map(x=>x.mae), mfe=r.map(x=>x.mfe);
    console.log(`${w.padEnd(8)} ${String(r.length).padStart(5)} ${mean(sg).toFixed(2).padStart(11)} ${t.toFixed(2).padStart(8)} `+
      `${q(mae,.5).toFixed(1).padStart(9)} ${q(mae,.75).toFixed(1).padStart(8)} ${q(mae,.90).toFixed(1).padStart(8)} ${q(mae,.95).toFixed(1).padStart(8)} `+
      `${q(mfe,.5).toFixed(1).padStart(9)} ${q(mfe,.75).toFixed(1).padStart(8)} ${q(mfe,.90).toFixed(1).padStart(8)}`);
  }
}
report('A. STRATEGY SIGNALS — real Trap V2 entries (index points, 45-min hold)',sigs);
report('B. CONTROL — time-of-day-matched random entries, same direction mix',ctrl);

console.log(`\n${'='.repeat(104)}\nC. STOP ANALYSIS — % of REAL signals stopped by ordinary noise before 45 min\n${'='.repeat(104)}`);
console.log('Stop(pts)   DEV      VALID     TEST      | median MFE of survivors (DEV/VALID/TEST)');
for(const stop of [10,15,20,25,30,35,40,50]){
  let row=`${String(stop).padStart(6)}   `, surv='';
  for(const[w,a,b]of WINS.slice(0,3)){
    const r=sigs.filter(x=>x.d>=a&&x.d<=b+'-12-31');
    if(!r.length){row+='   n/a   ';continue;}
    const hit=r.filter(x=>x.mae>=stop);
    row+=`${(100*hit.length/r.length).toFixed(0).padStart(6)}%  `;
    const sv=r.filter(x=>x.mae<stop).map(x=>x.mfe);
    surv+=`${sv.length?q(sv,.5).toFixed(1):'-'}`.padStart(8);
  }
  console.log(row+' |'+surv);
}
console.log(`\nR-MULTIPLE FEASIBILITY (MFE/stop reached within 45 min, real paths)`);
console.log('Stop(pts)  reach1R   reach1.5R  reach2R   reach3R    [DEV]');
for(const stop of [15,20,25,30,35]){
  const r=sigs.filter(x=>x.d>='2015'&&x.d<='2018-12-31'&&x.mae<stop);
  if(!r.length)continue;
  const f=m=>(100*r.filter(x=>x.mfe>=stop*m).length/r.length).toFixed(0)+'%';
  console.log(`${String(stop).padStart(6)}  ${f(1).padStart(8)} ${f(1.5).padStart(10)} ${f(2).padStart(8)} ${f(3).padStart(9)}    n=${r.length}`);
}
