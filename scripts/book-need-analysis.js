/**
 * Answer: is Crude needed? are all three needed? + charge drag per book.
 * Builds all-3 books once (current DNA + guards), scores subsets, all net of charges.
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
const grossOf=t=>Math.round(t.optionPnlRs??t.netOptionPnlRs??0);
const chOf=t=>Math.round(t.chargesRs??0);
const bookOf=id=>{const s=String(id||'').toLowerCase();return s.includes('crude')?'crude':s.includes('bank')?'bank':'nifty';};
async function f5(a,tok,from,to){const fp=path.join(CACHE,`${tok}_${from}_${to}.json`);if(fs.existsSync(fp))return JSON.parse(fs.readFileSync(fp,'utf8'));const ch=[];let cur=from;while(cur<=to){let e=addDays(cur,89);if(e>to)e=to;ch.push(...((await market.fetchHistorical5m(a,tok,cur,e))||[]));if(e>=to)break;cur=addDays(e,1);}const m=new Map();for(const r of ch)m.set(r.date,r);const rows=[...m.values()].sort((x,y)=>String(x.date).localeCompare(String(y.date)));fs.writeFileSync(fp,JSON.stringify(rows));return rows;}

async function bookIndex(a,inst,candles,instrument,kind,extras,oc){
  const base={instrumentId:instrument.id,instrumentName:instrument.name,kind,candles,fromDate:FROM,toDate:TO,instruments:inst,forceCloseOpen:true,lotsMultiplier:1};
  const init={dayProfitLockPts:0,dayStopPts:0,dayProfitLockRs:0,dayStopRs:0,maxTradesPerDay:3,targetRMultiple:LIVE_GREEN_DNA.trap.targetRMultiple,extras};
  const need=new Set();replayPaperOnIndex({...base,optionCandlesByToken:new Map(),neededOptionTokens:need,strategy:(()=>{const s=createTrapStrategy();s.initialize(init);return s;})()});
  const opt=new Map();for(const tok of need){if(oc.has(tok)){opt.set(tok,oc.get(tok));continue;}try{const r=await f5(a,tok,addDays(FROM,-2),TO);oc.set(tok,r);opt.set(tok,r);}catch{oc.set(tok,[]);opt.set(tok,[]);}}
  return replayPaperOnIndex({...base,optionCandlesByToken:opt,neededOptionTokens:new Set(),strategy:(()=>{const s=createTrapStrategy();s.initialize(init);return s;})()}).trades||[];
}
async function bookCrude(a,inst,candles,oc){
  const tp={...resolveCrudeStrategyProfile('live-crude-green'),...liveCrudeGreenProfileOverrides()};
  const base={instrumentId:CRUDE_OIL_MINI_INSTRUMENT.id,instrumentName:'Crude',candles,fromDate:FROM,toDate:TO,instruments:inst,forceCloseOpen:true,lotsMultiplier:1,dayLossStopPts:0,enableMorning:false,enableEvening:true,tradeParams:tp};
  const need=new Set();replayPaperOnCrude({...base,optionCandlesByToken:new Map(),neededOptionTokens:need});
  const opt=new Map();for(const tok of need){if(oc.has(tok)){opt.set(tok,oc.get(tok));continue;}try{const r=await f5(a,tok,addDays(FROM,-2),TO);oc.set(tok,r);opt.set(tok,r);}catch{oc.set(tok,[]);opt.set(tok,[]);}}
  return replayPaperOnCrude({...base,optionCandlesByToken:opt,neededOptionTokens:new Set()}).trades||[];
}
function guard(trades){const s={};const out=[];for(const t of [...trades].sort((a,b)=>String(a.entryTime).localeCompare(String(b.entryTime)))){const book=bookOf(t.instrumentId);const k=book+dayOf(t);s[k]=s[k]||{n:0,le:0};const st=s[k];const max=book==='crude'?2:3;const cd=book==='crude'?20:12;if(st.n>=max)continue;const em=Date.parse(t.entryTime);if(st.le&&(em-st.le)/60000<cd)continue;out.push(t);st.n++;st.le=Date.parse(t.exitTime||t.entryTime);}return out;}

function score(trades){
  const kept=guard(filterTradesLivePath(trades,{...DEFAULT_LIVE_PATH,maxOpenLegs:1,dayProfitLockRs:0,dayStopRs:0,bankOnlyAfterNifty:false,winStreakToBand:false,indexFirstWinLock:false,deskGreenLockRs:0,dustTradeRs:10}));
  const byDay=new Map();let gross=0,charges=0;
  for(const t of kept){const d=dayOf(t);const r=byDay.get(d)||{net:0};r.net+=netOf(t);byDay.set(d,r);gross+=grossOf(t);charges+=chOf(t);}
  const days=[...byDay.values()];const green=days.filter(d=>d.net>0).length,red=days.filter(d=>d.net<0).length;
  const net=days.reduce((s,d)=>s+d.net,0);
  return {trades:kept.length,days:days.length,green,red,net,avg:days.length?Math.round(net/days.length):0,gross:Math.round(gross),charges:Math.round(charges)};
}

(async()=>{
  const a=auth();log('book-need',FROM,'->',TO);
  const inst=await market.fetchInstruments(a);
  const crudeInst=inst.filter(i=>/CRUDEOILM/i.test(String(i.tradingsymbol||i.tradingSymbol||'')));
  const oc=new Map();
  const nc=await f5(a,NIFTY_50_INSTRUMENT.instrumentToken,addDays(FROM,-12),TO);
  const bc=await f5(a,BANK_NIFTY_INSTRUMENT.instrumentToken,addDays(FROM,-12),TO);
  const fut=resolveCrudeOilMiniFuturesToken(inst);const cc=await f5(a,fut.instrumentToken,addDays(FROM,-12),TO);
  const nTr=await bookIndex(a,inst,nc,NIFTY_50_INSTRUMENT,'nifty',liveGreenTrapExtras(),oc);
  const bTr=await bookIndex(a,inst,bc,BANK_NIFTY_INSTRUMENT,'banknifty',liveGreenBankTrapExtras(),oc);
  const cTr=await bookCrude(a,crudeInst,cc,oc);
  const sets={
    'Nifty only':nTr,
    'Bank only':bTr,
    'Crude only':cTr,
    'Index (N+B)':[...nTr,...bTr],
    'N+B+Crude (all 3)':[...nTr,...bTr,...cTr],
    'Bank+Crude':[...bTr,...cTr],
  };
  console.log('\nSET                  trades days green red    net   avg   gross  charges  chg%');
  const res={};
  for(const [name,tr] of Object.entries(sets)){
    const s=score(tr);res[name]=s;
    const chgPct=s.gross?Math.round(s.charges/Math.abs(s.gross)*100):0;
    console.log(name.padEnd(20),String(s.trades).padStart(5),String(s.days).padStart(5),String(s.green).padStart(5),String(s.red).padStart(4),String(s.net).padStart(7),String(s.avg).padStart(6),String(s.gross).padStart(7),String(s.charges).padStart(8),String(chgPct).padStart(4)+'%');
  }
  fs.writeFileSync('/tmp/book-need.json',JSON.stringify(res,null,2));
})().catch(e=>{console.error(e);process.exit(1);});
