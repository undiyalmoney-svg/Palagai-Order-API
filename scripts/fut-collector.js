#!/usr/bin/env node
/**
 * PHASE 3.6 — NIFTY FUTURES INTRADAY COLLECTOR
 * COLLECTOR_VERSION 1.0.0 · SCHEMA_VERSION 1
 *
 * READ-ONLY. Retrieves market data only. Imports no broker order module and
 * contains no order placement / modification / cancellation path.
 *
 * NOT a research tool. It does not compute features, does not evaluate
 * signals and does not produce performance statistics.
 *
 * Guarantees:
 *   - append-only raw archive; historical observations are never overwritten
 *   - idempotent: re-running a date creates no duplicate canonical candle
 *   - duplicates DETECTED and RECORDED (identical -> confirmed; differing ->
 *     DISCREPANCY record appended, original preserved)
 *   - contract discovery uses only the live instrument dump; no future
 *     volume/OI ranking is used to decide what to collect
 *   - raw values stored unmodified; no normalisation, no winsorising, no
 *     zero-filling of missing OI
 *
 * Usage: SHADOW_DIR=<dir> KAPI=<key> KTOK=<token> node fut-collector.js FROM TO
 */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const { fetchOI, nfoInstruments } = require('./fut-fetch');
const COLLECTOR_VERSION='1.1.0', SCHEMA_VERSION=1;
const DIR=process.env.FUT_DIR;
if(!DIR){console.error('FUT_DIR required');process.exit(1);}
const RAW=path.join(DIR,'candles.ndjson'), CON=path.join(DIR,'contracts.ndjson'),
      LED=path.join(DIR,'ledger.ndjson'), ERR=path.join(DIR,'errors.ndjson');
fs.mkdirSync(DIR,{recursive:true});
const appendLine=(f,o)=>fs.appendFileSync(f,JSON.stringify(o)+'\n');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,16);
function loadIndex(){
  const m=new Map();
  if(!fs.existsSync(RAW))return m;
  for(const l of fs.readFileSync(RAW,'utf8').split('\n')){
    if(!l.trim())continue; let o; try{o=JSON.parse(l)}catch(e){continue}
    if(o._type==='candle') m.set(o.instrument_token+'|'+o.timestamp,
      `${o.open}|${o.high}|${o.low}|${o.close}|${o.volume}|${o.open_interest}`);
  }
  return m;
}
async function withRetry(fn,label,tries=4){
  let wait=1500;
  for(let a=1;a<=tries;a++){
    try{ return await fn(); }
    catch(e){
      const msg=e.message||String(e);
      appendLine(ERR,{_type:'error',label,attempt:a,message:msg,at:new Date().toISOString()});
      if(a===tries) throw e;
      await new Promise(r=>setTimeout(r,wait)); wait*=2;   // bounded backoff, no infinite loop
    }
  }
}
(async()=>{
  const auth=`token ${process.env.KAPI}:${process.env.KTOK}`;
  const FROM=process.argv[2], TO=process.argv[3];
  if(!FROM||!TO){console.error('usage: FROM TO');process.exit(1);}
  const runAt=new Date().toISOString();
  console.log(`FUTURES COLLECTOR v${COLLECTOR_VERSION} schema ${SCHEMA_VERSION}`);
  console.log(`window ${FROM} .. ${TO}   archive ${DIR}`);

  // ---- contract discovery: LIVE instrument dump only (no future info) ----
  const ins=await withRetry(()=>nfoInstruments(auth),'instruments');
  const fut=ins.filter(x=>x.name==='NIFTY'&&x.type==='FUT').sort((a,b)=>a.exp.localeCompare(b.exp));
  console.log(`\ncontract universe discovered this run: ${fut.length}`);
  const seenCon=new Set();
  if(fs.existsSync(CON))for(const l of fs.readFileSync(CON,'utf8').split('\n')){
    if(!l.trim())continue;try{seenCon.add(JSON.parse(l).instrument_token)}catch(e){}}
  for(const f of fut){
    console.log(`  ${f.sym.padEnd(15)} token ${f.tok}  expiry ${f.exp}  lot ${f.lot}`);
    if(!seenCon.has(f.tok))
      appendLine(CON,{_type:'contract',schema:SCHEMA_VERSION,instrument_token:f.tok,
        tradingsymbol:f.sym,name:f.name,expiry:f.exp,lot_size:f.lot,instrument_type:f.type,
        exchange:'NFO',first_seen:runAt,discovered_by:'live_instrument_dump'});
  }

  const idx=loadIndex();
  console.log(`\nexisting canonical candles in archive: ${idx.size}`);
  let added=0,dupOk=0,discrep=0;
  const bySession=new Map();

  for(const f of fut){
    let rows;
    try{ rows=await withRetry(()=>fetchOI(auth,f.tok,FROM,TO,'5minute'),`hist:${f.sym}`); }
    catch(e){
      appendLine(LED,{_type:'ledger',schema:SCHEMA_VERSION,run_at:runAt,collector:COLLECTOR_VERSION,
        date:null,contract:f.sym,instrument_token:f.tok,status:'API_ERROR',error:e.message});
      console.log(`  ${f.sym}: API_ERROR ${e.message}`); continue;
    }
    for(const r of rows){
      const day=r.date.slice(0,10);
      const key=f.tok+'|'+r.date;
      const sig=`${r.o}|${r.h}|${r.l}|${r.c}|${r.v}|${r.oi}`;
      const k2=day+'|'+f.sym;
      if(!bySession.has(k2))bySession.set(k2,{day,sym:f.sym,tok:f.tok,bars:[],dups:0,disc:0});
      const S=bySession.get(k2);
      if(idx.has(key)){
        if(idx.get(key)===sig){dupOk++;S.dups++;}
        else{ discrep++;S.disc++;
          appendLine(RAW,{_type:'discrepancy',schema:SCHEMA_VERSION,instrument_token:f.tok,
            timestamp:r.date,existing:idx.get(key),incoming:sig,observed_at:new Date().toISOString(),
            note:'original preserved; not overwritten'});}
        S.bars.push(r); continue;
      }
      appendLine(RAW,{_type:'candle',schema:SCHEMA_VERSION,collector:COLLECTOR_VERSION,
        instrument_token:f.tok,tradingsymbol:f.sym,expiry:f.exp,lot_size:f.lot,
        trading_date:day,timestamp:r.date,
        open:r.o,high:r.h,low:r.l,close:r.c,volume:r.v,open_interest:r.oi,
        exchange_timestamp:r.date, collected_at:new Date().toISOString(), request_window:`${FROM}..${TO}`});
      idx.set(key,sig); added++; S.bars.push(r);
    }
  }

  // ---- session integrity + ledger ----
  // §8: expected bar count is DERIVED PER DATE from the contracts observed that
  // date, never hardcoded. NSE changed F&O session hours mid-sample (75-bar
  // sessions ending 15:25 became 77-bar sessions ending 15:35), so any constant
  // would misclassify every session on one side of the change.
  const expectedByDate=new Map();
  for(const [,S] of bySession){
    const n=S.bars.length; if(!n)continue;
    const cur=expectedByDate.get(S.day)||0;
    if(n>cur)expectedByDate.set(S.day,n);          // modal/max across contracts that date
  }
  console.log(`\nSESSION INTEGRITY  (expected bars derived per date; observed lengths: ${[...new Set(expectedByDate.values())].sort((a,b)=>a-b).join(', ')})`);
  console.log('date        contract        bars  dup  disc | distinctOI  minOI      maxOI      zeroVolBars  status');
  const stats={OK:0,INCOMPLETE:0,DUPLICATE:0,OUT_OF_ORDER:0,OI_CONSTANT:0,OI_MISSING:0};
  for(const [,S] of [...bySession.entries()].sort()){
    const b=S.bars; if(!b.length)continue;
    const times=b.map(x=>x.date);
    const ooo=times.some((t,i)=>i>0&&t<=times[i-1]);
    const oiVals=b.map(x=>x.oi).filter(v=>v!=null);
    const distinctOI=new Set(oiVals).size;
    const zeroVol=b.filter(x=>x.v===0).length;
    const bad=b.filter(x=>!(x.h>=x.l)||x.o<0||x.c<0||x.v<0||(x.oi!=null&&x.oi<0)).length;
    let status='OK';
    if(oiVals.length===0)status='OI_MISSING';
    else if(distinctOI<=1)status='OI_CONSTANT';
    else if(ooo)status='OUT_OF_ORDER';
    else if(b.length < (expectedByDate.get(S.day)||b.length))status='INCOMPLETE';
    else if(S.disc>0)status='DUPLICATE';
    stats[status]=(stats[status]||0)+1;
    console.log(`${S.day}  ${S.sym.padEnd(15)}${String(b.length).padStart(4)}${String(S.dups).padStart(5)}${String(S.disc).padStart(6)} |`+
      `${String(distinctOI).padStart(10)}${String(oiVals.length?Math.min(...oiVals):'-').padStart(11)}${String(oiVals.length?Math.max(...oiVals):'-').padStart(11)}`+
      `${String(zeroVol).padStart(13)}  ${status}`);
    appendLine(LED,{_type:'ledger',schema:SCHEMA_VERSION,run_at:runAt,collector:COLLECTOR_VERSION,
      date:S.day,contract:S.sym,instrument_token:S.tok,
      collected_bars:b.length,expected_bars:expectedByDate.get(S.day)??null,
      duplicate_confirmed:S.dups,discrepancies:S.disc,
      first_timestamp:times[0],last_timestamp:times[times.length-1],
      distinct_oi_values:distinctOI,oi_available:oiVals.length>0,volume_available:true,
      zero_volume_bars:zeroVol,impossible_values:bad,out_of_order:ooo,status});
  }
  const total=fs.existsSync(RAW)?fs.readFileSync(RAW,'utf8').split('\n').filter(x=>x.trim()).length:0;
  const hash=fs.existsSync(RAW)?sha(fs.readFileSync(RAW)):'-';
  console.log(`\nadded ${added} new candles · ${dupOk} identical duplicates confirmed · ${discrep} discrepancies`);
  console.log('status counts:',JSON.stringify(stats));
  console.log(`archive lines ${total}  dataset_hash ${hash}`);
  appendLine(LED,{_type:'run_summary',schema:SCHEMA_VERSION,collector:COLLECTOR_VERSION,run_at:runAt,
    window:`${FROM}..${TO}`,contracts:fut.length,added,duplicates_confirmed:dupOk,
    discrepancies:discrep,archive_lines:total,dataset_hash:hash,status_counts:stats});
})();
