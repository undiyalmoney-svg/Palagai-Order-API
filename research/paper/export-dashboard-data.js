#!/usr/bin/env node
/** Export signal-by-signal record + equity curve for the dashboard UI. Read-only. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../../live/equity-charges.js');
const ST=require('../strategy/exhaustion-fade-v1.js');
const DIR='research-data/midintra', SLIP=0.05, CAP=50000;
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]||0});
  }
  S.set(f.replace('.json',''),bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
let eq=CAP, peak=CAP, maxDD=0; const trades=[]; const curve=[];
for(const d of dates){
  const day=new Map(); for(const [sym,bs] of S){const a=bs.get(d); if(a)day.set(sym,a);}
  const sig=ST.evaluateDay(day); if(!sig) continue;
  const bars=day.get(sig.symbol), ei=bars.findIndex(b=>b.hm===sig.entryTime);
  const dir=sig.side==='BUY'?1:-1, fill=sig.entryPrice*(1+dir*SLIP/100), qty=Math.floor(eq/fill);
  if(qty<1) continue;
  const stopD=Math.abs(sig.entryPrice-sig.stopLoss); let px=null,why='CLOSE';
  for(let j=ei;j<bars.length;j++){const b=bars[j];const adv=dir*((dir>0?b.l:b.h)-fill);
    if(b.hm>=sig.exitTime){px=b.c;why='CLOSE';break;} if(adv<=-stopD){px=sig.stopLoss;why='STOP';break;} if(j===bars.length-1)px=b.c;}
  const ex=px*(1-dir*SLIP/100), net=Math.round(dir*(ex-fill)*qty-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs);
  eq+=net; peak=Math.max(peak,eq); maxDD=Math.min(maxDD,eq-peak);
  trades.push({date:d,symbol:sig.symbol,side:sig.side,qty,entry:+fill.toFixed(2),exit:+ex.toFixed(2),
    stop:+sig.stopLoss.toFixed(2),why,net,runPct:sig.runPct});
  curve.push({date:d,equity:Math.round(eq)});
}
const wins=trades.filter(t=>t.net>0);
const yr={};for(const t of trades){const y=t.date.slice(0,4);yr[y]=(yr[y]||0)+t.net;}
const out={
  generated:new Date().toISOString(),
  params:ST.PARAMS,
  stats:{
    startCapital:CAP, endEquity:Math.round(eq), totalNet:Math.round(eq-CAP),
    trades:trades.length, winRate:Math.round(100*wins.length/trades.length),
    avgWin:Math.round(wins.reduce((a,b)=>a+b.net,0)/wins.length),
    avgLoss:Math.round(trades.filter(t=>t.net<=0).reduce((a,b)=>a+b.net,0)/(trades.length-wins.length)),
    worstDay:Math.min(...trades.map(t=>t.net)), bestDay:Math.max(...trades.map(t=>t.net)),
    maxDrawdown:Math.round(maxDD), sessions:dates.length,
    tradeFreq:+(dates.length/trades.length).toFixed(1),
    firstDate:dates[0], lastDate:dates[dates.length-1],
  },
  byYear:yr,
  curve, trades,
};
fs.writeFileSync(path.join(__dirname,'dashboard-data.json'),JSON.stringify(out));
console.log('exported',trades.length,'trades over',dates.length,'sessions');
console.log('  end equity Rs'+Math.round(eq)+'  net Rs'+Math.round(eq-CAP)+'  win '+out.stats.winRate+'%  maxDD Rs'+Math.round(maxDD));
console.log('  data file:',(fs.statSync(path.join(__dirname,'dashboard-data.json')).size/1024).toFixed(0),'KB');
