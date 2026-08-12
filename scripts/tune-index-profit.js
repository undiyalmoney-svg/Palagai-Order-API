/**
 * Tune index signal so Nifty+Bank actually participate (they were filtered to
 * 0 under the ultra-strict pro DNA), keep anti-churn caps, measure ALL-3
 * combined on real option marks. Window default Jul1 -> Aug12.
 */
require('dotenv').config();
process.chdir(require('path').join(__dirname, '..'));
const fs = require('fs');
const path = require('path');
const {
  NIFTY_50_INSTRUMENT,
  BANK_NIFTY_INSTRUMENT,
  CRUDE_OIL_MINI_INSTRUMENT,
  createTrapStrategy,
  replayPaperOnIndex,
  replayPaperOnCrude,
  resolveCrudeOilMiniFuturesToken,
  resolveCrudeStrategyProfile,
} = require('../live/strategy-core.cjs');
const market = require('../live/kite-market');
const { LIVE_GREEN_DNA, liveGreenTrapExtras } = require('../live/dna-live-green');
const { liveCrudeGreenProfileOverrides } = require('../live/dna-live-crude-green');
const { filterTradesLivePath, DEFAULT_LIVE_PATH } = require('../live/live-path');

const FROM = process.env.FROM || '2026-07-01';
const TO = process.env.TO || '2026-08-12';
const CACHE = '/tmp/kite-opt-cache';
fs.mkdirSync(CACHE, { recursive: true });
const log = (...a) => process.stderr.write(a.map((x)=>typeof x==='string'?x:JSON.stringify(x)).join(' ')+'\n');

function auth() {
  if (process.env.KITE_AUTH) { const a=process.env.KITE_AUTH; return a.startsWith('token')?a:`token ${a}`; }
  return fs.readFileSync('/tmp/kite/auth.txt','utf8').trim();
}
const addDays=(iso,n)=>{const [y,m,d]=iso.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));dt.setUTCDate(dt.getUTCDate()+n);return dt.toISOString().slice(0,10);};
const dayOf=(t)=>String(t.entryTime).slice(0,10);
const netOf=(t)=>Math.round(t.netOptionPnlRs??t.optionPnlRs??0);

async function fetch5mCached(a, token, from, to) {
  const fp=path.join(CACHE,`${token}_${from}_${to}.json`);
  if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp,'utf8'));
  const chunks=[]; let cur=from;
  while(cur<=to){let end=addDays(cur,89);if(end>to)end=to;chunks.push(...((await market.fetchHistorical5m(a,token,cur,end))||[]));if(end>=to)break;cur=addDays(end,1);}
  const map=new Map(); for(const r of chunks)map.set(r.date,r);
  const rows=[...map.values()].sort((x,y)=>String(x.date).localeCompare(String(y.date)));
  fs.writeFileSync(fp,JSON.stringify(rows)); return rows;
}

async function bookIndex(a, instruments, candles, inst, kind, extras, maxTrades, targetR, optCache) {
  const base={instrumentId:inst.id,instrumentName:inst.name,kind,candles,fromDate:FROM,toDate:TO,instruments,forceCloseOpen:true,lotsMultiplier:1};
  const init={dayProfitLockPts:0,dayStopPts:0,dayProfitLockRs:0,dayStopRs:0,maxTradesPerDay:maxTrades,targetRMultiple:targetR,extras};
  const need=new Set();
  replayPaperOnIndex({...base,optionCandlesByToken:new Map(),neededOptionTokens:need,strategy:(()=>{const s=createTrapStrategy();s.initialize(init);return s;})()});
  const opt=new Map();
  for(const tok of need){ if(optCache.has(tok)){opt.set(tok,optCache.get(tok));continue;} try{const r=await fetch5mCached(a,tok,addDays(FROM,-2),TO);optCache.set(tok,r);opt.set(tok,r);}catch{optCache.set(tok,[]);opt.set(tok,[]);} }
  return replayPaperOnIndex({...base,optionCandlesByToken:opt,neededOptionTokens:new Set(),strategy:(()=>{const s=createTrapStrategy();s.initialize(init);return s;})()}).trades||[];
}

async function bookCrude(a, instruments, candles, optCache) {
  const tp={...resolveCrudeStrategyProfile('live-crude-green'),...liveCrudeGreenProfileOverrides()};
  const base={instrumentId:CRUDE_OIL_MINI_INSTRUMENT.id,instrumentName:'Crude',candles,fromDate:FROM,toDate:TO,instruments,forceCloseOpen:true,lotsMultiplier:1,dayLossStopPts:0,enableMorning:false,enableEvening:true,tradeParams:tp};
  const need=new Set();
  replayPaperOnCrude({...base,optionCandlesByToken:new Map(),neededOptionTokens:need});
  const opt=new Map();
  for(const tok of need){ if(optCache.has(tok)){opt.set(tok,optCache.get(tok));continue;} try{const r=await fetch5mCached(a,tok,addDays(FROM,-2),TO);optCache.set(tok,r);opt.set(tok,r);}catch{optCache.set(tok,[]);opt.set(tok,[]);} }
  return replayPaperOnCrude({...base,optionCandlesByToken:opt,neededOptionTokens:new Set()}).trades||[];
}

/** Post-filter: enforce per-book max trades/day + cooldown so replay ~ live guard. */
function applyGuard(trades, { indexMax=3, crudeMax=2, indexCdMin=12, crudeCdMin=20 }={}) {
  const sorted=[...trades].sort((a,b)=>String(a.entryTime).localeCompare(String(b.entryTime)));
  const st={}; const out=[];
  for(const t of sorted){
    const id=String(t.instrumentId||'').toLowerCase();
    const book=id.includes('crude')?'crude':id.includes('bank')?'bank':'nifty';
    const day=dayOf(t);
    const kkey=book+day; st[kkey]=st[kkey]||{n:0,lastExit:0};
    const s=st[kkey];
    const max=book==='crude'?crudeMax:indexMax;
    const cd=book==='crude'?crudeCdMin:indexCdMin;
    if(s.n>=max) continue;
    const entryMs=Date.parse(t.entryTime);
    if(s.lastExit && (entryMs-s.lastExit)/60000 < cd) continue;
    out.push(t); s.n++; s.lastExit=Date.parse(t.exitTime||t.entryTime);
  }
  return out;
}

function score(trades) {
  const kept=filterTradesLivePath(trades,{...DEFAULT_LIVE_PATH,maxOpenLegs:1,dayProfitLockRs:0,dayStopRs:0,bankOnlyAfterNifty:false,winStreakToBand:false,indexFirstWinLock:false,deskGreenLockRs:0,dustTradeRs:10});
  const guarded=applyGuard(kept);
  const byDay=new Map();
  for(const t of guarded){const d=dayOf(t);const r=byDay.get(d)||{date:d,net:0,n:0,nifty:0,bank:0,crude:0};const n=netOf(t);r.net+=n;r.n++;const id=String(t.instrumentId||'').toLowerCase();if(id.includes('bank'))r.bank+=n;else if(id.includes('crude'))r.crude+=n;else r.nifty+=n;byDay.set(d,r);}
  const days=[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const green=days.filter(d=>d.net>0).length,red=days.filter(d=>d.net<0).length;
  const net=days.reduce((s,d)=>s+d.net,0);
  return {days:days.length,green,red,net,avg:days.length?Math.round(net/days.length):0,worst:days.length?Math.min(...days.map(d=>d.net)):0,best:days.length?Math.max(...days.map(d=>d.net)):0,byBook:{nifty:days.reduce((s,d)=>s+d.nifty,0),bank:days.reduce((s,d)=>s+d.bank,0),crude:days.reduce((s,d)=>s+d.crude,0)},dayRows:days};
}

function ex(over={}) { return liveGreenTrapExtras(over); }

(async()=>{
  const a=auth();
  log('tune',FROM,'->',TO);
  const instruments=await market.fetchInstruments(a);
  const crudeInst=instruments.filter(i=>/CRUDEOILM/i.test(String(i.tradingsymbol||i.tradingSymbol||'')));
  const optCache=new Map();
  const niftyC=await fetch5mCached(a,NIFTY_50_INSTRUMENT.instrumentToken,addDays(FROM,-12),TO);
  const bankC=await fetch5mCached(a,BANK_NIFTY_INSTRUMENT.instrumentToken,addDays(FROM,-12),TO);
  const fut=resolveCrudeOilMiniFuturesToken(instruments);
  const crudeC=await fetch5mCached(a,fut.instrumentToken,addDays(FROM,-12),TO);
  log('crude book…');
  const cTr=await bookCrude(a,crudeInst,crudeC,optCache);
  log('crude trades',cTr.length);

  const candidates=[
    { id:'pro_strict(current)', n:ex({srMethod:'pivot',pivotStrength:3,trapMode:'trap',minConfirmBody:8,minRiskPts:10,maxRiskPts:45,pdhlConfluencePts:30,profitLockArmRs:900,profitLockLockRs:500,profitLockGivebackRs:300}), b:ex({srMethod:'pivot',pivotStrength:3,trapMode:'trap',minConfirmBody:20,minRiskPts:25,maxRiskPts:120,pdhlConfluencePts:80,profitLockArmRs:900,profitLockLockRs:500,profitLockGivebackRs:300}), r:2.5 },
    { id:'balanced_p2_both', n:ex({srMethod:'pivot',pivotStrength:2,trapMode:'both',minConfirmBody:0,minRiskPts:5,maxRiskPts:40,pdhlConfluencePts:0,piercePts:20,profitLockArmRs:200,profitLockLockRs:120,profitLockGivebackRs:120}), b:ex({srMethod:'pivot',pivotStrength:2,trapMode:'both',minConfirmBody:0,minRiskPts:10,maxRiskPts:120,pdhlConfluencePts:0,bankPiercePts:60,profitLockArmRs:200,profitLockLockRs:120,profitLockGivebackRs:120}), r:3.0 },
    { id:'balanced_p2_both_conf', n:ex({srMethod:'pivot',pivotStrength:2,trapMode:'both',minConfirmBody:5,minRiskPts:6,maxRiskPts:40,pdhlConfluencePts:0,profitLockArmRs:250,profitLockLockRs:150,profitLockGivebackRs:120}), b:ex({srMethod:'pivot',pivotStrength:2,trapMode:'both',minConfirmBody:12,minRiskPts:12,maxRiskPts:120,pdhlConfluencePts:0,profitLockArmRs:250,profitLockLockRs:150,profitLockGivebackRs:120}), r:3.0 },
    { id:'active_p2_both_35R', n:ex({srMethod:'pivot',pivotStrength:2,trapMode:'both',minConfirmBody:0,minRiskPts:5,maxRiskPts:40,pdhlConfluencePts:0,profitLockArmRs:150,profitLockLockRs:80,profitLockGivebackRs:80}), b:ex({srMethod:'pivot',pivotStrength:2,trapMode:'both',minConfirmBody:0,minRiskPts:10,maxRiskPts:120,pdhlConfluencePts:0,profitLockArmRs:150,profitLockLockRs:80,profitLockGivebackRs:80}), r:3.5 },
  ];

  const results=[];
  for(const c of candidates){
    log('index book',c.id,'…');
    const nTr=await bookIndex(a,instruments,niftyC,NIFTY_50_INSTRUMENT,'nifty',c.n,3,c.r,optCache);
    const bTr=await bookIndex(a,instruments,bankC,BANK_NIFTY_INSTRUMENT,'banknifty',c.b,3,c.r,optCache);
    const s=score([...nTr,...bTr,...cTr]);
    results.push({id:c.id,rawN:nTr.length,rawB:bTr.length,...s});
    log(`  ${c.id}: all3 ${s.green}/${s.days} red=${s.red} net=Rs${s.net} avg=Rs${s.avg} | nifty=${s.byBook.nifty} bank=${s.byBook.bank} crude=${s.byBook.crude} (rawN${nTr.length}/B${bTr.length})`);
  }
  results.sort((a,b)=>b.net-a.net);
  log('\n==== RANK by net (all 3 combined, guarded, live-path) ====');
  for(const r of results) log(`net=Rs${r.net} avg=Rs${r.avg} ${r.green}/${r.days} red=${r.red} | N ${r.byBook.nifty} B ${r.byBook.bank} C ${r.byBook.crude} | ${r.id}`);
  fs.writeFileSync('/tmp/tune-index.json',JSON.stringify({FROM,TO,results},null,2));
  console.log(JSON.stringify({FROM,TO,best:results[0],results},null,2));
})().catch(e=>{console.error(e);process.exit(1);});
