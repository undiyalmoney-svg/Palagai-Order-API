#!/usr/bin/env node
/** BANK 1H-BODY BREAK BOT — exactly as specified.
 *  top 5 bank stocks · 1H candle 09:15-10:15 · levels = the BODY (open & close)
 *  after 10:15, a 5-min candle CLOSING above the body top -> BUY
 *                                CLOSING below the body bottom -> SELL
 *  Rs10,000 per stock · all positions closed 15:15 · month-by-month, last 3 years */
const fs=require('fs'),path=require('path');
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const SLIP=+(process.env.SLIP||0.02), PER=10000;
const BANKS=['HDFCBANK','ICICIBANK','AXISBANK','SBIN','INDUSINDBK'];   // top 5 by liquidity
const DIR=process.argv[2];
const S=new Map();
for(const s of BANKS){
  const f=path.join(DIR,s+'.json'); if(!fs.existsSync(f)){console.log('missing '+s);continue;}
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(f,'utf8'))){
    const d=r[0].slice(0,10);
    if(!bs.has(d))bs.set(d,[]);bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});}
  S.set(s,bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
console.log(`banks ${S.size} (${[...S.keys()].join(', ')}) · sessions ${dates.length} · ${dates[0]} -> ${dates[dates.length-1]}`);
console.log(`Rs${PER.toLocaleString('en-IN')}/stock · slippage ${SLIP}%/side · exit 15:15\n`);
const T=[];
for(const d of dates){
  for(const [sym,bs] of S){
    const a=bs.get(d); if(!a||a.length<40)continue;
    // 1H candle: open of the 09:15 bar, close of the 10:15 bar
    const o1=a[0].o, c1=a[11].c;
    const top=Math.max(o1,c1), bot=Math.min(o1,c1);
    if(!(top>bot))continue;
    let side=0, e=-1;
    for(let j=12;j<a.length-1;j++){
      if(a[j].hm>='15:05')break;
      if(a[j].c>top){side=+1;e=j+1;break;}
      if(a[j].c<bot){side=-1;e=j+1;break;}
    }
    if(!side||e>=a.length)continue;
    const raw=a[e].o; if(!(raw>0))continue;
    const fill=raw*(1+side*SLIP/100);
    const qty=Math.floor(PER/fill); if(qty<1)continue;
    let exit=null;
    for(let j=e;j<a.length;j++){
      if(a[j].hm>='15:15'){exit=a[j].c;break;}
      if(j===a.length-1)exit=a[j].c;}
    if(exit==null)continue;
    const ex=exit*(1-side*SLIP/100);
    const gross=side*(ex-fill)*qty;
    const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    T.push({d,sym,side,qty,fill,exit:ex,gross,chg,net:gross-chg,month:d.slice(0,7)});
  }
}
const sum=a=>a.reduce((x,y)=>x+y,0);
const L3=T.filter(x=>x.d>='2023-09-01');
console.log('=== LAST 3 YEARS, MONTH BY MONTH (Rs50,000 deployed, 5 x Rs10,000) ===');
console.log('month     trades  win%    gross Rs   charges Rs     NET Rs   on Rs50k   running');
console.log('='.repeat(84));
const months=[...new Set(L3.map(x=>x.month))].sort();
let run=0;
for(const m of months){
  const t=L3.filter(x=>x.month===m); if(!t.length)continue;
  const n=sum(t.map(x=>x.net)); run+=n;
  console.log(m+'  '+String(t.length).padStart(6)+
    (100*t.filter(x=>x.net>0).length/t.length).toFixed(0).padStart(6)+'%'+
    sum(t.map(x=>x.gross)).toFixed(0).padStart(11)+sum(t.map(x=>x.chg)).toFixed(0).padStart(13)+
    n.toFixed(0).padStart(11)+((100*n/50000).toFixed(2)+'%').padStart(11)+run.toFixed(0).padStart(10));
}
console.log('='.repeat(84));
const mn=months.map(m=>sum(L3.filter(x=>x.month===m).map(x=>x.net)));
console.log('');
console.log('  months            '+months.length);
console.log('  profitable months '+mn.filter(x=>x>0).length+' ('+(100*mn.filter(x=>x>0).length/mn.length).toFixed(0)+'%)');
console.log('  best month        Rs'+Math.max(...mn).toFixed(0)+'   worst month Rs'+Math.min(...mn).toFixed(0));
console.log('  median month      Rs'+med(mn).toFixed(0));
console.log('  TOTAL 3 years     Rs'+sum(mn).toFixed(0)+'  ('+(100*sum(mn)/50000).toFixed(1)+'% on Rs50,000)');
console.log('  trades            '+L3.length+'   win rate '+(100*L3.filter(x=>x.net>0).length/L3.length).toFixed(1)+'%');
console.log('  gross Rs'+sum(L3.map(x=>x.gross)).toFixed(0)+'   charges Rs'+sum(L3.map(x=>x.chg)).toFixed(0));
console.log('');
console.log('=== EARLIER PERIOD (2017-2022) — same rules, for comparison ===');
const E=T.filter(x=>x.d<'2023-01-01');
console.log('  trades '+E.length+'  gross Rs'+sum(E.map(x=>x.gross)).toFixed(0)+
  '  charges Rs'+sum(E.map(x=>x.chg)).toFixed(0)+'  NET Rs'+sum(E.map(x=>x.net)).toFixed(0));
const em=[...new Set(E.map(x=>x.month))];
const emn=em.map(m=>sum(E.filter(x=>x.month===m).map(x=>x.net)));
console.log('  profitable months '+emn.filter(x=>x>0).length+' of '+emn.length+' ('+(100*emn.filter(x=>x>0).length/emn.length).toFixed(0)+'%)');
console.log('');
console.log('=== PER STOCK, LAST 3 YEARS ===');
for(const s of BANKS){
  const t=L3.filter(x=>x.sym===s); if(!t.length)continue;
  console.log('  '+s.padEnd(12)+String(t.length).padStart(5)+' trades  net Rs'+sum(t.map(x=>x.net)).toFixed(0).padStart(8)+
    '  per trade Rs'+mean(t.map(x=>x.net)).toFixed(1).padStart(7)+'  win '+(100*t.filter(x=>x.net>0).length/t.length).toFixed(0)+'%');
}
console.log('');
console.log('=== ECONOMICS PER TRADE (last 3 years) ===');
const nt=mean(L3.map(x=>x.fill*x.qty));
console.log('  avg notional Rs'+nt.toFixed(0)+'  gross '+(100*mean(L3.map(x=>x.gross))/nt).toFixed(4)+'%  charges '+(100*mean(L3.map(x=>x.chg))/nt).toFixed(4)+'%  net Rs'+mean(L3.map(x=>x.net)).toFixed(2));
