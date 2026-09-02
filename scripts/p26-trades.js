#!/usr/bin/env node
/**
 * PHASE 2.6 — FULL TRADE SIMULATION, REALISTIC FILLS
 *
 * LOOK-AHEAD CONTROL: the engine sees bars <= i. Entry is forced to the OPEN
 * OF BAR i+1 — the earliest price actually obtainable once bar i has closed.
 * Nothing in the decision uses bar i+1 or later.
 *
 * SAME-BAR AMBIGUITY: if a bar touches both stop and target, STOP is assumed
 * first (conservative, deterministic).
 *
 * PRE-DECLARED GRID (frozen before running): stop {15,20,25,30} pts x target
 * {1.5R,2R,2.5R}. Selection on DEV ONLY. VALID/TEST reported, never used to
 * choose. Costs: Zerodha F&O + explicit slippage + explicit theta.
 */
const fs=require('fs');
const { createTrapStrategyV2 } = require('../live/strategy-core.cjs');
const CTX=400, HOLD=9, LOT=65, DELTA=0.5;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
function charges(prem,qty){const t=prem*qty;const b=40,ex=(2*t)*35e-5,stt=t*1e-3,st=t*3e-5,se=(2*t)*1e-6;
  return b+ex+stt+st+se+(b+ex+se)*0.18;}
function buildContext(c,i){return {candle60m:{...c[i]},candle30m:{...c[i]},candle15m:{...c[i]},candle5m:c[i],
  previous60m:[],previous30m:[],previous15m:[],previous5m:c.slice(Math.max(0,i-CTX),i),
  candleIndex5m:i,replayStepIndex:i,replayFrom:c[Math.max(0,i-CTX)]?.date??c[i].date,replayTo:c[i].date,instrumentId:'NIFTY 50'};}

const raw=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const C=raw.map(r=>({date:r.t,open:r.o,high:r.h,low:r.l,close:r.c}));
const strat=createTrapStrategyV2();strat.initialize();
const S=strat.getSettings();

// ---- generate signals ONCE (engine sees only bars <= i) ----
const sigs=[];let day=null,nDay=0;
for(let i=CTX;i<C.length-1;i++){
  const d=C[i].date.slice(0,10);
  if(d!==day){day=d;nDay=0;strat.onTradeClosed?.(0,d);}
  if(nDay>=S.maxTradesPerDay)continue;
  const sg=strat.generateSignal(buildContext(C,i));
  if(sg.action!=='BUY'&&sg.action!=='SELL')continue;
  if(C[i+1].date.slice(0,10)!==d)continue;           // no cross-session entry
  nDay++;
  sigs.push({d,i,dir:sg.action,fill:C[i+1].open});    // REALISTIC FILL
}
console.log(`signals ${sigs.length}  sessions ${new Set(sigs.map(s=>s.d)).size}  (entry = next bar OPEN)`);

// look-ahead sanity: index edge under the realistic fill, no stop
for(const[w,a,b] of [['DEV','2015','2018'],['VALID','2019','2022'],['TEST','2023','2026']]){
  const r=sigs.filter(x=>x.d>=a&&x.d<=b+'-12-31').map(s=>{
    let last=s.fill;const dd=s.d;
    for(let k=s.i+1;k<=Math.min(s.i+HOLD,C.length-1);k++){if(C[k].date.slice(0,10)!==dd)break;last=C[k].close;}
    return s.dir==='BUY'?last-s.fill:s.fill-last;});
  const t=mean(r)/(sd(r)/Math.sqrt(r.length));
  console.log(`  ${w} signed45m ${mean(r).toFixed(2)} pts  t=${t.toFixed(2)}  n=${r.length}`);
}

function sim(stopPts,rMult,slipPts,thetaRs){
  const out=[];
  for(const s of sigs){
    const dir=s.dir,fill=s.fill,dd=s.d;
    const stop=dir==='BUY'?fill-stopPts:fill+stopPts;
    const tgt =dir==='BUY'?fill+stopPts*rMult:fill-stopPts*rMult;
    let exit=null,reason=null;
    for(let k=s.i+1;k<=Math.min(s.i+HOLD,C.length-1);k++){
      if(C[k].date.slice(0,10)!==dd)break;
      const hitS=dir==='BUY'?C[k].low<=stop:C[k].high>=stop;
      const hitT=dir==='BUY'?C[k].high>=tgt:C[k].low<=tgt;
      if(hitS){exit=stop;reason='STOP';break;}          // conservative: stop first
      if(hitT){exit=tgt;reason='TARGET';break;}
      exit=C[k].close;reason='TIMEOUT';
    }
    if(exit==null)continue;
    const movePts=(dir==='BUY'?exit-fill:fill-exit)-slipPts;   // slippage both legs
    const prem=120;                                            // representative ATM premium
    const grossRs=movePts*DELTA*LOT;
    const net=grossRs-charges(prem,LOT)-thetaRs;
    out.push({d:s.d,movePts,net,reason,R:net/(stopPts*DELTA*LOT)});
  }
  return out;
}
function stats(r){
  if(!r.length)return null;
  const w=r.filter(x=>x.net>0),l=r.filter(x=>x.net<=0);
  const nets=r.map(x=>x.net);
  const gw=w.reduce((a,b)=>a+b.net,0),gl=Math.abs(l.reduce((a,b)=>a+b.net,0));
  let eq=0,pk=0,dd=0;for(const x of r){eq+=x.net;pk=Math.max(pk,eq);dd=Math.min(dd,eq-pk);}
  return {n:r.length,win:100*w.length/r.length,exp:mean(nets),
    t:mean(nets)/(sd(nets)/Math.sqrt(r.length)),
    pf:gl>0?gw/gl:Infinity,total:eq,dd,
    aw:w.length?mean(w.map(x=>x.net)):0,al:l.length?mean(l.map(x=>x.net)):0};
}
const WIN=[['DEV','2015','2018'],['VALID','2019','2022'],['TEST','2023','2026']];
console.log(`\n${'='.repeat(112)}`);
console.log('PRE-DECLARED GRID — SELECTION ON DEV ONLY  (slippage 1.0 pt round trip, theta Rs40/trade)');
console.log('='.repeat(112));
console.log('stop  R     | DEV   n    win%   exp Rs   t     PF    totalRs   maxDD | VALID exp  t     | TEST exp  t');
const cands=[];
for(const stop of [15,20,25,30])for(const rM of [1.5,2,2.5]){
  const all=sim(stop,rM,1.0,40);
  const g={};for(const[w,a,b]of WIN)g[w]=stats(all.filter(x=>x.d>=a&&x.d<=b+'-12-31'));
  if(!g.DEV)continue;
  cands.push({stop,rM,...g});
  console.log(`${String(stop).padStart(4)} ${rM.toFixed(1)}  |`+
   `${String(g.DEV.n).padStart(6)} ${g.DEV.win.toFixed(0).padStart(5)}% ${g.DEV.exp.toFixed(0).padStart(7)} ${g.DEV.t.toFixed(2).padStart(6)} ${g.DEV.pf.toFixed(2).padStart(5)} `+
   `${Math.round(g.DEV.total).toLocaleString('en-IN').padStart(9)} ${Math.round(g.DEV.dd).toLocaleString('en-IN').padStart(8)} |`+
   `${g.VALID.exp.toFixed(0).padStart(9)} ${g.VALID.t.toFixed(2).padStart(6)}  |`+
   `${g.TEST.exp.toFixed(0).padStart(8)} ${g.TEST.t.toFixed(2).padStart(6)}`);
}
const best=cands.filter(c=>c.DEV).sort((a,b)=>b.DEV.exp-a.DEV.exp)[0];
console.log(`\nDEV-SELECTED (highest DEV expectancy): stop ${best.stop}pts  target ${best.rM}R`);
console.log(`  DEV   n=${best.DEV.n} win ${best.DEV.win.toFixed(1)}% exp Rs${best.DEV.exp.toFixed(0)} PF ${best.DEV.pf.toFixed(2)} t=${best.DEV.t.toFixed(2)}`);
console.log(`  VALID n=${best.VALID.n} win ${best.VALID.win.toFixed(1)}% exp Rs${best.VALID.exp.toFixed(0)} PF ${best.VALID.pf.toFixed(2)} t=${best.VALID.t.toFixed(2)}`);
console.log(`  TEST  n=${best.TEST.n} win ${best.TEST.win.toFixed(1)}% exp Rs${best.TEST.exp.toFixed(0)} PF ${best.TEST.pf.toFixed(2)} t=${best.TEST.t.toFixed(2)}`);

console.log(`\n${'='.repeat(112)}\nSLIPPAGE / THETA SENSITIVITY on the DEV-selected config\n${'='.repeat(112)}`);
console.log('slipPts  theta  | DEV exp   VALID exp   TEST exp');
for(const sl of [0.5,1.0,2.0,3.0])for(const th of [40,80]){
  const all=sim(best.stop,best.rM,sl,th);
  const g={};for(const[w,a,b]of WIN)g[w]=stats(all.filter(x=>x.d>=a&&x.d<=b+'-12-31'));
  console.log(`${sl.toFixed(1).padStart(6)} ${String(th).padStart(6)}  |`+
    `${g.DEV.exp.toFixed(0).padStart(8)} ${g.VALID.exp.toFixed(0).padStart(11)} ${g.TEST.exp.toFixed(0).padStart(11)}`);
}
