#!/usr/bin/env node
/**
 * PHASE 3.0 FORWARD SHADOW ENGINE — PHASE-3.0-SPEC-v1 (hash dffe2ac3cddacb1c)
 *
 * READ-ONLY. Imports NO broker order module. Cannot place, modify or cancel
 * an order. Fetches market data only.
 *
 * Forward-only: processes sessions STRICTLY AFTER the research frontier
 * (2026-08-27) and only sessions not already in the append-only ledger.
 * Never reprocesses or rewrites a completed event record.
 */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const { fetchHistoricalCandles } = require('../live/kite-market');
const SPEC='dffe2ac3cddacb1c', FRONTIER='2026-08-27';
const EF='09:45',ET='14:45',LOOKBACK=20,MULT=2.0,HOLD=9,MINF=3;
const BOUNDS=JSON.parse(fs.readFileSync('/tmp/frozen_bounds.json','utf8')).bounds;
const LEDGER=process.env.SHADOW_DIR+'/events.ndjson';
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const decile=v=>{let lo=0;for(let d=0;d<9;d++)if(v>BOUNDS[d])lo=d+1;return lo;};

function analyseSession(bars){
  const n=bars.length, out={events:[],quality:null};
  // ---- data integrity (never silently repaired) ----
  const times=bars.map(b=>b.date.slice(11,16));
  const dup=times.length-new Set(times).size;
  let ooo=0;for(let i=1;i<n;i++)if(bars[i].date<=bars[i-1].date)ooo++;
  out.quality={bar_count:n,expected_bar_count:75,missing_bar_count:Math.max(0,75-n),
    duplicate_count:dup,out_of_order:ooo,
    status:(n===75&&dup===0&&ooo===0)?'OK':'ANOMALY'};
  if(out.quality.status!=='OK')return out;
  // ---- trailing realised vol (same-session, bars <= i) ----
  const TV=new Array(n).fill(NaN);
  for(let i=0;i<n;i++){const r=[];for(let k=Math.max(1,i-19);k<=i;k++)r.push(bars[k].close-bars[k-1].close);
    if(r.length>2)TV[i]=sd(r);}
  // ---- FIRST compression event of the session ----
  for(let i=0;i<n;i++){
    const hm=bars[i].date.slice(11,16);
    if(hm<EF||hm>ET)continue;
    if(i-LOOKBACK<0)continue;
    let a=0;for(let k=i-LOOKBACK;k<i;k++)a+=bars[k].high-bars[k].low;a/=LOOKBACK;
    const rg=bars[i].high-bars[i].low, m=bars[i].close-bars[i].open;
    if(!(a>0&&rg>MULT*a&&m!==0))continue;
    if(i+1>=n)break;
    const dir=Math.sign(m), fill=bars[i+1].open;
    let last=fill,fb=0,mae=0,mfe=0,rng=0;
    for(let k=i+1;k<=Math.min(i+HOLD,n-1);k++){
      const up=dir>0?bars[k].high-fill:fill-bars[k].low;
      const dn=dir>0?fill-bars[k].low:bars[k].high-fill;
      if(dn>mae)mae=dn; if(up>mfe)mfe=up; rng+=bars[k].high-bars[k].low;
      last=bars[k].close;fb=k-i;}
    if(fb<MINF)break;
    const ret=dir*(last-fill);
    out.events.push({spec_version:SPEC,event_id:crypto.randomUUID(),
      date:bars[i].date.slice(0,10),event_timestamp:bars[i].date,event_bar_index:i,
      event_price:bars[i].close,next_bar_open:fill,
      compression_measure:rg/a,compression_threshold:MULT,
      trailing_realised_volatility:TV[i],volatility_regime:decile(TV[i]),
      time_of_day:hm,direction:dir,first_occurrence:true,
      forward_bars:fb,forward_signed_return:ret,forward_abs_return:Math.abs(ret),
      forward_squared_return:ret*ret,forward_range:rng,MAE:mae,MFE:mfe,
      ingestion_timestamp:new Date().toISOString()});
    break;   // FIRST event only — spec rule
  }
  return out;
}
(async()=>{
  const auth=`token ${process.env.KAPI}:${process.env.KTOK}`;
  const seen=new Set();
  if(fs.existsSync(LEDGER))for(const l of fs.readFileSync(LEDGER,'utf8').split('\n'))
    if(l.trim())try{seen.add(JSON.parse(l).date)}catch(e){}
  const c=await fetchHistoricalCandles(auth,256265,process.argv[2],process.argv[3],'5minute');
  const byDay=new Map();
  for(const b of c){const d=b.date.slice(0,10);if(d<=FRONTIER)continue;   // forward-only
    if(!byDay.has(d))byDay.set(d,[]);byDay.get(d).push(b);}
  console.log(`SHADOW ENGINE  spec ${SPEC}  frontier ${FRONTIER}`);
  console.log(`candidate forward sessions: ${byDay.size}   already in ledger: ${seen.size}`);
  let added=0;
  for(const[d,bars]of [...byDay.entries()].sort()){
    if(seen.has(d)){console.log(`  ${d}  SKIP (already recorded — ledger is append-only)`);continue;}
    const r=analyseSession(bars);
    console.log(`  ${d}  bars ${r.quality.bar_count}/75  dup ${r.quality.duplicate_count}  ooo ${r.quality.out_of_order}  status ${r.quality.status}  events ${r.events.length}`);
    for(const e of r.events){fs.appendFileSync(LEDGER,JSON.stringify(e)+'\n');added++;
      console.log(`     EVENT ${e.event_timestamp}  compression ${e.compression_measure.toFixed(2)}x  volDecile ${e.volatility_regime}  |ret45| ${e.forward_abs_return.toFixed(2)}`);}
  }
  // ---- look-ahead corruption test on the live engine ----
  const day=[...byDay.keys()].sort().pop();
  if(day){
    const bars=byDay.get(day).map(b=>({...b}));
    const before=JSON.stringify(analyseSession(bars).events.map(e=>[e.event_timestamp,e.compression_measure,e.volatility_regime]));
    const ev=analyseSession(bars).events[0];
    if(ev){const idx=ev.event_bar_index;
      for(let k=idx+1;k<bars.length;k++){bars[k].open*=1.9;bars[k].high*=2.0;bars[k].low*=0.2;bars[k].close*=1.9;}
      const after=JSON.stringify(analyseSession(bars).events.map(e=>[e.event_timestamp,e.compression_measure,e.volatility_regime]));
      console.log(`\nlook-ahead corruption test: ${before===after?'PASS — event detection unchanged when all future bars corrupted':'FAIL — ABORT'}`);
    } else console.log('\nlook-ahead corruption test: no event to probe this session');
  }
  const total=fs.existsSync(LEDGER)?fs.readFileSync(LEDGER,'utf8').split('\n').filter(x=>x.trim()).length:0;
  console.log(`\nledger total events: ${total}   added this run: ${added}`);
  console.log(`REQUIRED: 837 events (939 sessions). PROGRESS: ${total}/837 = ${(100*total/837).toFixed(2)}%`);
})();
