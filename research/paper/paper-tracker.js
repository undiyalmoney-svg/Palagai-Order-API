#!/usr/bin/env node
/** PAPER TRACKER for exhaustion-fade-v1. RESEARCH ONLY — logs signals, never
 *  trades. Two modes:
 *    signal DATE [DATADIR]  -> print TRADE/NO-TRADE for that day, append to ledger
 *    score  [DATADIR]       -> replay ledger vs actual outcomes, show running P&L
 *  Ledger: research/paper/ledger.ndjson (append-only). No broker imports. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../../live/equity-charges.js');
const ST=require('../strategy/exhaustion-fade-v1.js');
const LEDGER=path.join(__dirname,'ledger.ndjson');
const SLIP=0.05, CAP=50000;
function loadDay(DIR,date){
  const day=new Map();
  for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
    const bars=[];
    for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
      if(r[0].slice(0,10)!==date) continue;
      bars.push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]||0});
    }
    if(bars.length) day.set(f.replace('.json',''),bars);
  }
  return day;
}
const mode=process.argv[2];
if(mode==='signal'){
  const date=process.argv[3], DIR=process.argv[4]||'research-data/midintra';
  const day=loadDay(DIR,date);
  if(!day.size){ console.log(`no data for ${date}`); process.exit(0); }
  const sig=ST.evaluateDay(day);
  const rec={date,ts:new Date().toISOString(),...(sig?{action:'TRADE',...sig}:{action:'NO_TRADE'})};
  fs.appendFileSync(LEDGER,JSON.stringify(rec)+'\n');
  if(sig){
    console.log(`${date}  TRADE`);
    console.log(`  ${sig.side} ${sig.symbol}  entry ~${sig.entryPrice.toFixed(2)} at ${sig.entryTime}  stop ${sig.stopLoss.toFixed(2)}  exit ${sig.exitTime}`);
    console.log(`  run ${sig.runPct}% · ATR ${sig.atr} · logged to ledger`);
  } else {
    console.log(`${date}  NO TRADE  (no qualifying exhaustion) · logged`);
  }
}else if(mode==='score'){
  const DIR=process.argv[3]||'research-data/midintra';
  if(!fs.existsSync(LEDGER)){ console.log('no ledger yet'); process.exit(0); }
  const recs=fs.readFileSync(LEDGER,'utf8').trim().split('\n').map(l=>JSON.parse(l));
  let eq=CAP; console.log('PAPER LEDGER SCORE\n  date        result                              net      equity');
  for(const rec of recs){
    if(rec.action!=='TRADE'){ console.log(`  ${rec.date}  NO TRADE`); continue; }
    const day=loadDay(DIR,rec.date); const bars=day.get(rec.symbol);
    if(!bars){ console.log(`  ${rec.date}  ${rec.symbol} (no data to score)`); continue; }
    const ei=bars.findIndex(b=>b.hm===rec.entryTime);
    const dir=rec.side==='BUY'?1:-1, fill=rec.entryPrice*(1+dir*SLIP/100), qty=Math.floor(eq/fill);
    const stopD=Math.abs(rec.entryPrice-rec.stopLoss);
    let px=null; for(let j=ei;j<bars.length;j++){const b=bars[j];const adv=dir*((dir>0?b.l:b.h)-fill);
      if(b.hm>=rec.exitTime){px=b.c;break;} if(adv<=-stopD){px=rec.stopLoss;break;} if(j===bars.length-1)px=b.c;}
    const ex=px*(1-dir*SLIP/100), net=dir*(ex-fill)*qty-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    eq+=net;
    console.log(`  ${rec.date}  ${rec.side} ${rec.symbol.padEnd(11)} qty ${String(qty).padStart(5)}  Rs${net.toFixed(0).padStart(7)}  ${eq.toFixed(0).padStart(9)}`);
  }
  console.log(`\n  start Rs${CAP}  now Rs${eq.toFixed(0)}  P/L Rs${(eq-CAP).toFixed(0)} (${(100*(eq-CAP)/CAP).toFixed(1)}%)`);
}else{
  console.log('usage: node paper-tracker.js signal <YYYY-MM-DD> [datadir]');
  console.log('       node paper-tracker.js score [datadir]');
}
