#!/usr/bin/env node
/**
 * PORTFOLIO TRACKER — separates real profit from deposits.
 * Usage:  node scripts/portfolio-track.js <ledger.json>
 * Ledger format (edit the file by hand, one entry per line):
 *   {"date":"2026-09-01","type":"START","amount":50000}
 *   {"date":"2026-10-01","type":"DEPOSIT","amount":5000}
 *   {"date":"2026-10-31","type":"VALUE","amount":57200}   <- what the broker shows
 */
const fs=require('fs');
const L=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).sort((a,b)=>a.date.localeCompare(b.date));
let invested=0; const flows=[]; let lastVal=null,lastDate=null;
console.log('date         type       amount    total invested   portfolio value   REAL PROFIT   return%');
console.log('='.repeat(96));
for(const e of L){
  if(e.type==='START'||e.type==='DEPOSIT'){invested+=e.amount;flows.push({d:e.date,a:-e.amount});}
  if(e.type==='WITHDRAW'){invested-=e.amount;flows.push({d:e.date,a:e.amount});}
  if(e.type==='VALUE'){lastVal=e.amount;lastDate=e.date;}
  const prof=lastVal!=null?lastVal-invested:null;
  console.log(e.date.padEnd(13)+e.type.padEnd(11)+
    ('Rs'+e.amount.toLocaleString('en-IN')).padStart(9)+
    ('Rs'+invested.toLocaleString('en-IN')).padStart(17)+
    (lastVal!=null?('Rs'+lastVal.toLocaleString('en-IN')):'-').padStart(18)+
    (prof!=null?((prof>=0?'+':'-')+'Rs'+Math.abs(prof).toLocaleString('en-IN')):'-').padStart(14)+
    (prof!=null&&invested>0?((100*prof/invested).toFixed(2)+'%'):'-').padStart(10));
}
console.log('='.repeat(96));
if(lastVal!=null){
  const prof=lastVal-invested;
  console.log('');
  console.log('  total you put in      Rs'+invested.toLocaleString('en-IN'));
  console.log('  portfolio value now   Rs'+lastVal.toLocaleString('en-IN'));
  console.log('  REAL PROFIT           '+(prof>=0?'+':'-')+'Rs'+Math.abs(prof).toLocaleString('en-IN'));
  console.log('  return on capital     '+(100*prof/invested).toFixed(2)+'%');
  // money-weighted annual return (XIRR-style, bisection)
  flows.push({d:lastDate,a:lastVal});
  const t0=new Date(flows[0].d);
  const npv=r=>flows.reduce((s,f)=>s+f.a/Math.pow(1+r,(new Date(f.d)-t0)/(365.25*864e5)),0);
  let lo=-0.95,hi=5;
  for(let i=0;i<200;i++){const m=(lo+hi)/2; if(npv(m)>0)lo=m;else hi=m;}
  const yrs=(new Date(lastDate)-t0)/(365.25*864e5);
  if(yrs>0.08)console.log('  annualised return     '+(100*lo).toFixed(2)+'%  over '+yrs.toFixed(2)+' years');
  console.log('');
  console.log(prof>=0?'  CAPITAL INCREASED.':'  CAPITAL DECREASED — deposits are masking a loss.');
}
