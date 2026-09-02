#!/usr/bin/env node
/**
 * PHASE 3.7 — FUTURES ARCHIVE WATCHDOG
 * WATCHDOG_VERSION 1.0.0
 *
 * STRICTLY READ-ONLY with respect to the archive. It opens archive files for
 * READING only and never writes to FUT_DIR. Reports are written to a separate
 * output directory. Imports no broker module; no order path exists.
 *
 * SESSION CALENDAR: derived from the NIFTY INDEX itself, which is the
 * authoritative record of whether the exchange traded on a date — the index
 * has bars only on real trading sessions. No competing hand-made holiday list
 * is invented. A weekday with no index bars is classified HOLIDAY, not
 * MISSING_DATA.
 *
 * Usage: FUT_DIR=<archive> OUT_DIR=<reports> KAPI= KTOK= node fut-watchdog.js FROM TO
 */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const { fetchOI, nfoInstruments } = require('./fut-fetch');
const WATCHDOG_VERSION='1.0.0';
const DIR=process.env.FUT_DIR, OUT=process.env.OUT_DIR||path.join(process.cwd(),'futreports');
if(!DIR){console.error('FUT_DIR required');process.exit(1);}
const RAW=path.join(DIR,'candles.ndjson'), CON=path.join(DIR,'contracts.ndjson'),
      LED=path.join(DIR,'ledger.ndjson'), ERR=path.join(DIR,'errors.ndjson');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex').slice(0,16);
const readNd=f=>fs.existsSync(f)?fs.readFileSync(f,'utf8').split('\n').filter(x=>x.trim()).map(l=>{try{return JSON.parse(l)}catch(e){return{_parse_error:l.slice(0,80)}}}):[];
function add(d,n){const[y,m,dd]=d.split('-').map(Number);const t=new Date(Date.UTC(y,m-1,dd));t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);}
const dow=d=>new Date(d+'T00:00:00Z').getUTCDay();

(async()=>{
const FROM=process.argv[2], TO=process.argv[3];
if(!FROM||!TO){console.error('usage: FROM TO');process.exit(1);}
const auth=`token ${process.env.KAPI}:${process.env.KTOK}`;
fs.mkdirSync(OUT,{recursive:true});

// ---------- archive load (READ ONLY) ----------
const rows=readNd(RAW), contracts=readNd(CON), ledger=readNd(LED), errors=readNd(ERR);
const parseErrors=rows.filter(r=>r._parse_error).length;
const candles=rows.filter(r=>r._type==='candle');
const discrep=rows.filter(r=>r._type==='discrepancy');
const archiveHash=fs.existsSync(RAW)?sha(fs.readFileSync(RAW)):'-';

// ---------- §4 SESSION CALENDAR from the NIFTY index (authoritative) ----------
let idxDays=new Set(), calSource='kite:NIFTY50(256265)';
const calFailures=[];
{ let cur=FROM;
  while(cur<=TO){ const e=add(cur,95)>TO?TO:add(cur,95);
    try{ const c=await fetchOI(auth,256265,cur,e,'5minute');
      for(const x of c) idxDays.add(x.date.slice(0,10)); }
    catch(err){ console.error('calendar fetch failed for',cur,e,'-',err.message);
      calFailures.push(cur+'..'+e+': '+err.message); }
    cur=add(e,1); } }
// FAIL-CLOSED: without the authoritative calendar every weekday would silently
// classify as HOLIDAY, expected would collapse to 0, and the watchdog would
// report HEALTHY having verified nothing. An expired daily Kite token is the
// most likely failure mode, so this must abort loudly rather than pass.
if(calFailures.length){
  console.error('');
  console.error('ABORT: session calendar could not be established ('+calFailures.length+' window(s) failed).');
  for(const f of calFailures) console.error('  '+f);
  console.error('Without it, session-completeness cannot be checked. Refusing to report a verdict.');
  console.error('Most likely cause: expired daily Kite token (KTOK).');
  process.exit(2);
}
const calendar=[];
for(let d=FROM; d<=TO; d=add(d,1)){
  const w=dow(d);
  calendar.push({date:d, kind: (w===0||w===6)?'WEEKEND' : idxDays.has(d)?'SESSION':'HOLIDAY'});
}
const expected=calendar.filter(c=>c.kind==='SESSION').map(c=>c.date);

// ---------- index the archive by date/contract ----------
const byDate=new Map();
const dupKeys=new Map();
for(const c of candles){
  const k=c.instrument_token+'|'+c.timestamp;
  dupKeys.set(k,(dupKeys.get(k)||0)+1);
  if(!byDate.has(c.trading_date))byDate.set(c.trading_date,new Map());
  const m=byDate.get(c.trading_date);
  if(!m.has(c.tradingsymbol))m.set(c.tradingsymbol,[]);
  m.get(c.tradingsymbol).push(c);
}
const physicalDupes=[...dupKeys.values()].filter(v=>v>1).length;

// ---------- §5 contract coverage ----------
const conSeen=new Map();
for(const c of candles){
  if(!conSeen.has(c.tradingsymbol))conSeen.set(c.tradingsymbol,{sym:c.tradingsymbol,tok:c.instrument_token,exp:c.expiry,first:c.trading_date,last:c.trading_date,bars:0,expiries:new Set()});
  const e=conSeen.get(c.tradingsymbol);
  if(c.trading_date<e.first)e.first=c.trading_date;
  if(c.trading_date>e.last)e.last=c.trading_date;
  e.bars++; e.expiries.add(c.expiry);
  if(e.tok!==c.instrument_token)e.tokenConflict=true;
}

// ---------- §6 recoverability of missing sessions ----------
let live=[];
try{ const ins=await nfoInstruments(auth);
  live=ins.filter(x=>x.name==='NIFTY'&&x.type==='FUT'); }catch(e){}
async function recoverable(date){
  for(const f of live){
    try{ const c=await fetchOI(auth,f.tok,date,date,'5minute');
      if(c.length) return {recoverable:true,via:f.sym}; }catch(e){}
  }
  return {recoverable:false,via:null};
}

// ---------- per-session integrity ----------
const daily=[]; const anomalies=[];
for(const d of expected){
  const m=byDate.get(d);
  if(!m||m.size===0){ daily.push({date:d,expected_session:true,contracts_seen:0,status:'MISSING'}); continue; }
  const barsBy={}; let firstTs=null,lastTs=null,oiBad=0,volBad=0,ohlcBad=0,ooo=0,oiConst=0,missOI=0;
  const lens=[];
  for(const [sym,arr] of m){
    arr.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
    barsBy[sym]=arr.length; lens.push(arr.length);
    const t0=arr[0].timestamp, t1=arr[arr.length-1].timestamp;
    if(!firstTs||t0<firstTs)firstTs=t0; if(!lastTs||t1>lastTs)lastTs=t1;
    for(let i=1;i<arr.length;i++) if(arr[i].timestamp<=arr[i-1].timestamp) ooo++;
    for(const c of arr){
      if(!(c.high>=c.low)||!(c.high>=c.open)||!(c.high>=c.close)||!(c.low<=c.open)||!(c.low<=c.close)
         ||[c.open,c.high,c.low,c.close].some(v=>v==null||!Number.isFinite(v)||v<=0)) ohlcBad++;
      if(c.volume==null||!Number.isFinite(c.volume)||c.volume<0) volBad++;
      if(c.open_interest==null||!Number.isFinite(c.open_interest)||c.open_interest<0) missOI++;
    }
    const oi=arr.map(c=>c.open_interest).filter(v=>v!=null);
    if(oi.length && new Set(oi).size<=1) oiConst++;
  }
  // §3 expected bar count from the DATE's own observed session, never hardcoded
  const expBars=Math.max(...lens);
  const short=Object.entries(barsBy).filter(([,n])=>n<expBars);
  let status='OK';
  if(ohlcBad||volBad)status='INVALID_VALUES';
  else if(missOI)status='OI_MISSING';
  else if(oiConst)status='OI_CONSTANT';
  else if(ooo)status='OUT_OF_ORDER';
  else if(short.length)status='INCOMPLETE';
  const row={date:d,expected_session:true,contracts_seen:m.size,bars_by_contract:barsBy,
    expected_bars:expBars,first_timestamp:firstTs,last_timestamp:lastTs,
    volume_status:volBad?'INVALID':'OK', oi_status:missOI?'MISSING':oiConst?'CONSTANT':'OK',
    duplicate_count:0, discrepancy_count:discrep.filter(x=>String(x.timestamp||'').startsWith(d)).length,
    out_of_order:ooo, ohlc_invalid:ohlcBad, archive_hash:archiveHash, status};
  daily.push(row);
  if(status!=='OK')anomalies.push(row);
}
const missing=daily.filter(r=>r.status==='MISSING').map(r=>r.date);
const incomplete=daily.filter(r=>r.status==='INCOMPLETE').map(r=>r.date);

// recoverability probe for missing sessions (bounded)
const recov=[];
for(const d of missing.slice(0,25)){ const r=await recoverable(d); recov.push({date:d,...r}); }

// ---------- roll / coverage anomalies ----------
const covAnom=[];
for(const r of daily){
  if(r.status==='MISSING')continue;
  if(r.contracts_seen===1)covAnom.push({date:r.date,issue:'SINGLE_CONTRACT_ONLY',contracts:Object.keys(r.bars_by_contract||{})});
}
for(const [,e] of conSeen) if(e.expiries.size>1)covAnom.push({contract:e.sym,issue:'MULTIPLE_EXPIRIES_FOR_SYMBOL',expiries:[...e.expiries]});
for(const [,e] of conSeen) if(e.tokenConflict)covAnom.push({contract:e.sym,issue:'TOKEN_CONFLICT'});

const okDays=daily.filter(r=>r.status==='OK');
const summary={
  watchdog_version:WATCHDOG_VERSION, generated_at:new Date().toISOString(),
  window:{from:FROM,to:TO}, calendar_source:calSource,
  calendar:{weekend:calendar.filter(c=>c.kind==='WEEKEND').length,
            holiday:calendar.filter(c=>c.kind==='HOLIDAY').length,
            sessions:expected.length},
  last_successful_session: okDays.length?okDays[okDays.length-1].date:null,
  last_attempted_session: daily.length?daily[daily.length-1].date:null,
  usable_sessions: okDays.length,
  missing_sessions: missing, incomplete_sessions: incomplete,
  unrecoverable_sessions: recov.filter(r=>!r.recoverable).map(r=>r.date),
  recoverable_sessions: recov.filter(r=>r.recoverable).map(r=>r.date),
  contract_coverage_anomalies: covAnom,
  oi_anomalies: anomalies.filter(a=>a.oi_status!=='OK').map(a=>({date:a.date,oi_status:a.oi_status})),
  duplicate_physical_keys: physicalDupes,
  discrepancy_records: discrep.length,
  archive:{candles:candles.length,contracts:contracts.length,ledger_rows:ledger.length,
           error_rows:errors.length,parse_errors:parseErrors,hash:archiveHash},
  overall_status: (parseErrors||physicalDupes||anomalies.length||missing.length)?'ATTENTION':'HEALTHY',
};
fs.writeFileSync(path.join(OUT,'health-summary.json'),JSON.stringify(summary,null,2));
fs.writeFileSync(path.join(OUT,'health-daily.json'),JSON.stringify(daily,null,2));

// ---------- human report ----------
console.log(`FUTURES ARCHIVE WATCHDOG v${WATCHDOG_VERSION}   (READ-ONLY)`);
console.log(`window ${FROM} .. ${TO}   calendar source: ${calSource}`);
console.log(`calendar: ${expected.length} sessions · ${summary.calendar.weekend} weekend · ${summary.calendar.holiday} exchange holiday`);
console.log('');
console.log(`archive: ${candles.length} candles · ${contracts.length} contracts · ${ledger.length} ledger rows · ${errors.length} errors`);
console.log(`         parse errors ${parseErrors} · physical duplicate keys ${physicalDupes} · discrepancy records ${discrep.length}`);
console.log(`         hash ${archiveHash}`);
console.log('');
console.log('CONTRACT COVERAGE');
for(const [,e] of [...conSeen].sort())
  console.log(`  ${e.sym.padEnd(15)} token ${String(e.tok).padEnd(10)} expiry ${e.exp}  ${e.first} -> ${e.last}  bars ${e.bars}`);
console.log('');
console.log(`SESSION STATUS   usable(OK) ${okDays.length} / expected ${expected.length}`);
const counts={};for(const r of daily)counts[r.status]=(counts[r.status]||0)+1;
console.log('  '+JSON.stringify(counts));
if(missing.length){console.log(`  MISSING (${missing.length}): ${missing.slice(0,12).join(', ')}${missing.length>12?' …':''}`);
  for(const r of recov)console.log(`    ${r.date}  ${r.recoverable?'RECOVERABLE via '+r.via:'PERMANENTLY UNRECOVERABLE (contract expired)'}`);}
if(incomplete.length)console.log(`  INCOMPLETE (${incomplete.length}): ${incomplete.slice(0,12).join(', ')}`);
if(covAnom.length){console.log('  COVERAGE ANOMALIES:');for(const a of covAnom.slice(0,10))console.log('    '+JSON.stringify(a));}
console.log('');
console.log(`OVERALL: ${summary.overall_status}`);
console.log(`reports written to ${OUT}/health-summary.json and health-daily.json`);
// verify we did not write into the archive
const postHash=fs.existsSync(RAW)?sha(fs.readFileSync(RAW)):'-';
console.log(`archive hash before/after watchdog: ${archiveHash} / ${postHash}  ${archiveHash===postHash?'UNCHANGED (read-only verified)':'*** MUTATED — BUG ***'}`);
})();
