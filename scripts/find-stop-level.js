/**
 * "Where to stop" — build all-3 books once, then simulate daily discipline:
 *   - Daily profit target: once desk net >= target, STOP new entries (lock green).
 *   - Protect-green: once desk peaked >= arm, STOP if it gives back to <= floor.
 * Report green/red/avg per rule so we pick the stop that keeps EOD green.
 */
require('dotenv').config();
process.chdir(require('path').join(__dirname, '..'));
const fs = require('fs');
const path = require('path');
const {
  NIFTY_50_INSTRUMENT, BANK_NIFTY_INSTRUMENT, CRUDE_OIL_MINI_INSTRUMENT,
  createTrapStrategy, replayPaperOnIndex, replayPaperOnCrude,
  resolveCrudeOilMiniFuturesToken, resolveCrudeStrategyProfile,
} = require('../live/strategy-core.cjs');
const market = require('../live/kite-market');
const { LIVE_GREEN_DNA, liveGreenTrapExtras, liveGreenBankTrapExtras } = require('../live/dna-live-green');
const { liveCrudeGreenProfileOverrides } = require('../live/dna-live-crude-green');
const { filterTradesLivePath, DEFAULT_LIVE_PATH } = require('../live/live-path');

const FROM = process.env.FROM || '2026-07-01';
const TO = process.env.TO || '2026-08-12';
const CACHE = '/tmp/kite-opt-cache';
const log = (...a)=>process.stderr.write(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')+'\n');
function auth(){ if(process.env.KITE_AUTH){const a=process.env.KITE_AUTH;return a.startsWith('token')?a:`token ${a}`;} return fs.readFileSync('/tmp/kite/auth.txt','utf8').trim(); }
const addDays=(iso,n)=>{const [y,m,d]=iso.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));dt.setUTCDate(dt.getUTCDate()+n);return dt.toISOString().slice(0,10);};
const dayOf=t=>String(t.entryTime).slice(0,10);
const netOf=t=>Math.round(t.netOptionPnlRs??t.optionPnlRs??0);
async function f5(a,tok,from,to){const fp=path.join(CACHE,`${tok}_${from}_${to}.json`);if(fs.existsSync(fp))return JSON.parse(fs.readFileSync(fp,'utf8'));const ch=[];let cur=from;while(cur<=to){let e=addDays(cur,89);if(e>to)e=to;ch.push(...((await market.fetchHistorical5m(a,tok,cur,e))||[]));if(e>=to)break;cur=addDays(e,1);}const m=new Map();for(const r of ch)m.set(r.date,r);const rows=[...m.values()].sort((x,y)=>String(x.date).localeCompare(String(y.date)));fs.writeFileSync(fp,JSON.stringify(rows));return rows;}

async function bookIndex(a,inst,candles,instrument,kind,extras,optCache){
  const base={instrumentId:instrument.id,instrumentName:instrument.name,kind,candles,fromDate:FROM,toDate:TO,instruments:inst,forceCloseOpen:true,lotsMultiplier:1};
  const init={dayProfitLockPts:0,dayStopPts:0,dayProfitLockRs:0,dayStopRs:0,maxTradesPerDay:3,targetRMultiple:LIVE_GREEN_DNA.trap.targetRMultiple,extras};
  const need=new Set();
  replayPaperOnIndex({...base,optionCandlesByToken:new Map(),neededOptionTokens:need,strategy:(()=>{const s=createTrapStrategy();s.initialize(init);return s;})()});
  const opt=new Map();for(const tok of need){if(optCache.has(tok)){opt.set(tok,optCache.get(tok));continue;}try{const r=await f5(a,tok,addDays(FROM,-2),TO);optCache.set(tok,r);opt.set(tok,r);}catch{optCache.set(tok,[]);opt.set(tok,[]);}}
  return replayPaperOnIndex({...base,optionCandlesByToken:opt,neededOptionTokens:new Set(),strategy:(()=>{const s=createTrapStrategy();s.initialize(init);return s;})()}).trades||[];
}
async function bookCrude(a,inst,candles,optCache){
  const tp={...resolveCrudeStrategyProfile('live-crude-green'),...liveCrudeGreenProfileOverrides()};
  const base={instrumentId:CRUDE_OIL_MINI_INSTRUMENT.id,instrumentName:'Crude',candles,fromDate:FROM,toDate:TO,instruments:inst,forceCloseOpen:true,lotsMultiplier:1,dayLossStopPts:0,enableMorning:false,enableEvening:true,tradeParams:tp};
  const need=new Set();replayPaperOnCrude({...base,optionCandlesByToken:new Map(),neededOptionTokens:need});
  const opt=new Map();for(const tok of need){if(optCache.has(tok)){opt.set(tok,optCache.get(tok));continue;}try{const r=await f5(a,tok,addDays(FROM,-2),TO);optCache.set(tok,r);opt.set(tok,r);}catch{optCache.set(tok,[]);opt.set(tok,[]);}}
  return replayPaperOnCrude({...base,optionCandlesByToken:opt,neededOptionTokens:new Set()}).trades||[];
}

function guard(trades){ // per-book max/day + cooldown (anti-churn)
  const s={};const out=[];
  for(const t of [...trades].sort((a,b)=>String(a.entryTime).localeCompare(String(b.entryTime)))){
    const id=String(t.instrumentId||'').toLowerCase();const book=id.includes('crude')?'crude':id.includes('bank')?'bank':'nifty';
    const k=book+dayOf(t);s[k]=s[k]||{n:0,le:0};const st=s[k];const max=book==='crude'?2:3;const cd=book==='crude'?20:12;
    if(st.n>=max)continue;const em=Date.parse(t.entryTime);if(st.le&&(em-st.le)/60000<cd)continue;
    out.push(t);st.n++;st.le=Date.parse(t.exitTime||t.entryTime);
  }
  return out;
}

/** Simulate a stop discipline over already-filtered+guarded trades. */
function simulate(trades, { target=0, protectArm=0, protectFloor=0 }={}) {
  const byDay=new Map();
  for(const t of trades){(byDay.get(dayOf(t))||byDay.set(dayOf(t),[]).get(dayOf(t))).push(t);}
  const rows=[];
  for(const [day,list] of byDay){
    list.sort((a,b)=>String(a.entryTime).localeCompare(String(b.entryTime)));
    let net=0,peak=0,stopped=false,n=0;
    for(const t of list){
      if(stopped)continue;
      net+=netOf(t);n++;
      peak=Math.max(peak,net);
      if(target>0 && net>=target){stopped=true;}
      if(!stopped && protectArm>0 && peak>=protectArm && net<=protectFloor){stopped=true;}
    }
    rows.push({date:day,net,n});
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date));
  const green=rows.filter(r=>r.net>0).length,red=rows.filter(r=>r.net<0).length;
  const tot=rows.reduce((s,r)=>s+r.net,0);
  return {days:rows.length,green,red,net:tot,avg:rows.length?Math.round(tot/rows.length):0,worst:Math.min(...rows.map(r=>r.net)),rows};
}

(async()=>{
  const a=auth();log('build books',FROM,'->',TO);
  const inst=await market.fetchInstruments(a);
  const crudeInst=inst.filter(i=>/CRUDEOILM/i.test(String(i.tradingsymbol||i.tradingSymbol||'')));
  const oc=new Map();
  const nc=await f5(a,NIFTY_50_INSTRUMENT.instrumentToken,addDays(FROM,-12),TO);
  const bc=await f5(a,BANK_NIFTY_INSTRUMENT.instrumentToken,addDays(FROM,-12),TO);
  const fut=resolveCrudeOilMiniFuturesToken(inst);const cc=await f5(a,fut.instrumentToken,addDays(FROM,-12),TO);
  const nTr=await bookIndex(a,inst,nc,NIFTY_50_INSTRUMENT,'nifty',liveGreenTrapExtras(),oc);
  const bTr=await bookIndex(a,inst,bc,BANK_NIFTY_INSTRUMENT,'banknifty',liveGreenBankTrapExtras(),oc);
  const cTr=await bookCrude(a,crudeInst,cc,oc);
  const kept=guard(filterTradesLivePath([...nTr,...bTr,...cTr],{...DEFAULT_LIVE_PATH,maxOpenLegs:1,dayProfitLockRs:0,dayStopRs:0,bankOnlyAfterNifty:false,winStreakToBand:false,indexFirstWinLock:false,deskGreenLockRs:0,dustTradeRs:10}));
  log('guarded trades',kept.length);

  const rules=[
    ['no stop (run all day)',{}],
    ['target 800',{target:800}],
    ['target 1000',{target:1000}],
    ['target 1200',{target:1200}],
    ['target 1500',{target:1500}],
    ['target 2000',{target:2000}],
    ['protect: arm500 floor150',{protectArm:500,protectFloor:150}],
    ['target1500 + protect arm500 floor150',{target:1500,protectArm:500,protectFloor:150}],
    ['target2000 + protect arm600 floor200',{target:2000,protectArm:600,protectFloor:200}],
    ['target1200 + protect arm400 floor100',{target:1200,protectArm:400,protectFloor:100}],
  ];
  const out=[];
  console.log('\nRULE                                  days green red   net    avg   worst');
  for(const [name,cfg] of rules){
    const r=simulate(kept,cfg);
    out.push({name,cfg,...r});
    console.log(name.padEnd(38),String(r.days).padStart(3),String(r.green).padStart(5),String(r.red).padStart(3),String(r.net).padStart(7),String(r.avg).padStart(6),String(r.worst).padStart(6));
  }
  // best: zero red, then max avg
  out.sort((a,b)=>a.red-b.red||b.avg-a.avg);
  console.log('\nBEST (fewest red, then avg):',out[0].name,'avg',out[0].avg,'green',out[0].green+'/'+out[0].days);
  fs.writeFileSync('/tmp/find-stop.json',JSON.stringify({FROM,TO,results:out},null,2));
})().catch(e=>{console.error(e);process.exit(1);});
