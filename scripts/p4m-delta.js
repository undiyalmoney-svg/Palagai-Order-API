#!/usr/bin/env node
/** PHASE 4.M — DELTA DECOMPOSITION: where does the loss actually come from?
 *  Everything normalised to % of NOTIONAL so position size cannot hide the truth.
 *  Also tests the narrow-range INVERTED setup on its own, both windows. */
const fs=require('fs'),path=require('path');
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const SLIP=0.05, CAP=100000, RISKPCT=1.0;
const DIR=process.argv[2];
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const s=f.replace('.json','');const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d>='2023-01-01')continue;
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});}
  S.set(s,bs);}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
const T=[];
for(const d of dates){
  for(const [sym,bs] of S){
    const a=bs.get(d); if(!a||a.length<40)continue;
    let H1=-1e9,L1=1e9;for(let k=0;k<12;k++){H1=Math.max(H1,a[k].h);L1=Math.min(L1,a[k].l);}
    if(!(H1>L1))continue;
    const rngPct=(H1-L1)/a[11].c*100;
    let cr=null;
    for(let j=12;j<a.length-1;j++){if(a[j].hm>='15:10')break; if(a[j].c>H1){cr=j;break;}}
    if(cr==null)continue;
    const e=cr+1; if(e>=a.length)continue;
    const raw=a[e].o; if(!(raw>0))continue;
    const fill=raw*(1+SLIP/100), stop=L1, R=fill-stop; if(!(R>0))continue;
    const qty=Math.floor((CAP*RISKPCT/100)/R); if(qty<1)continue;
    let exit=null;
    for(let j=e;j<a.length;j++){
      if(a[j].hm>='15:15'){exit=a[j].c;break;}
      if(a[j].o<=stop){exit=a[j].o;break;}
      if(a[j].l<=stop){exit=stop;break;}
      if(j===a.length-1)exit=a[j].c;}
    if(exit==null)continue;
    const ex=exit*(1-SLIP/100);
    const notional=fill*qty;
    const grossRs=(ex-fill)*qty;
    const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    T.push({d,sym,qty,notional,rngPct,
      grossPct:100*grossRs/notional, chgPct:100*chg/notional,
      grossRs,chgRs:chg,netRs:grossRs-chg,stopPct:100*R/fill});
  }
}
const DEVf=x=>x.d<='2019-12-31', VALf=x=>x.d>='2020-01-01';
console.log(`trades ${T.length.toLocaleString()}\n`);
console.log('=== DELTA DECOMPOSITION — everything as % OF NOTIONAL (position size removed) ===');
console.log('');
console.log('1H range bucket      n     avgQty   notional   gross%   charges%   NET%   | as-is Rs  inverted Rs');
console.log('='.repeat(108));
const B=[['narrow <1%',x=>x.rngPct<1],['mid 1-2%',x=>x.rngPct>=1&&x.rngPct<=2],['wide >2%',x=>x.rngPct>2],['ALL',()=>true]];
for(const [n,f] of B){
  const g=T.filter(x=>DEVf(x)&&f(x)); if(g.length<100)continue;
  const gp=mean(g.map(x=>x.grossPct)), cp=mean(g.map(x=>x.chgPct));
  console.log(`${n.padEnd(20)}${String(g.length).padStart(5)}${mean(g.map(x=>x.qty)).toFixed(0).padStart(9)}`+
    `${mean(g.map(x=>x.notional)).toFixed(0).padStart(11)}${gp.toFixed(4).padStart(9)}${cp.toFixed(4).padStart(11)}`+
    `${(gp-cp).toFixed(4).padStart(8)}   |${mean(g.map(x=>x.netRs)).toFixed(0).padStart(9)}`+
    `${(-mean(g.map(x=>x.grossRs))-mean(g.map(x=>x.chgRs))).toFixed(0).padStart(13)}`);
}
console.log('='.repeat(108));
console.log('\n>>> THE CULPRIT: charges% is essentially CONSTANT across every bucket.');
console.log('    It is a TAX RATE on turnover, not a variable you can select away from.');
console.log('    What varies is gross%, and it is ALWAYS smaller than the tax rate.\n');
console.log('=== WHY NARROW-RANGE "LOSES MOST" IN RUPEES ===');
const nar=T.filter(x=>DEVf(x)&&x.rngPct<1), wid=T.filter(x=>DEVf(x)&&x.rngPct>2);
console.log(`  narrow: avg stop ${mean(nar.map(x=>x.stopPct)).toFixed(2)}% -> qty ${mean(nar.map(x=>x.qty)).toFixed(0)} -> notional Rs${mean(nar.map(x=>x.notional)).toFixed(0)} -> charges Rs${mean(nar.map(x=>x.chgRs)).toFixed(0)}`);
console.log(`  wide  : avg stop ${mean(wid.map(x=>x.stopPct)).toFixed(2)}% -> qty ${mean(wid.map(x=>x.qty)).toFixed(0)} -> notional Rs${mean(wid.map(x=>x.notional)).toFixed(0)} -> charges Rs${mean(wid.map(x=>x.chgRs)).toFixed(0)}`);
console.log(`  A tighter stop forces a BIGGER position (qty = risk / stop distance).`);
console.log(`  Bigger position = bigger turnover = bigger tax. Same 1% risk, ${(mean(nar.map(x=>x.chgRs))/mean(wid.map(x=>x.chgRs))).toFixed(1)}x the charges.\n`);
console.log('=== THE NARROW-RANGE SETUP, TRADED OPPOSITE (short instead of long) ===');
console.log('window   n      gross%   charges%    NET%      net Rs/trade   verdict');
for(const [w,f] of [['DEV',DEVf],['VALID',VALf]]){
  const g=T.filter(x=>f(x)&&x.rngPct<1);
  const gp=-mean(g.map(x=>x.grossPct)), cp=mean(g.map(x=>x.chgPct));
  const rs=-mean(g.map(x=>x.grossRs))-mean(g.map(x=>x.chgRs));
  console.log(`${w.padEnd(8)}${String(g.length).padStart(5)}${gp.toFixed(4).padStart(10)}${cp.toFixed(4).padStart(11)}${(gp-cp).toFixed(4).padStart(9)}${rs.toFixed(0).padStart(15)}   ${gp>cp?'PROFITABLE':'still loses'}`);
}
console.log('\n=== HOW BIG WOULD THE EDGE HAVE TO BE? ===');
const cAll=mean(T.filter(DEVf).map(x=>x.chgPct));
const gAll=Math.abs(mean(T.filter(DEVf).map(x=>x.grossPct)));
console.log(`  charge rate (tax on turnover)     ${cAll.toFixed(4)}% of notional`);
console.log(`  observed |gross edge|             ${gAll.toFixed(4)}% of notional`);
console.log(`  edge needed to break even         ${cAll.toFixed(4)}%`);
console.log(`  shortfall factor                  ${(cAll/gAll).toFixed(1)}x`);
console.log(`\n  Inverting changes the SIGN of ${gAll.toFixed(4)}%. It does not change ${cAll.toFixed(4)}%.`);
console.log(`  Even a PERFECT inversion — every single trade flipped correctly —`);
console.log(`  yields ${gAll.toFixed(4)}% - ${cAll.toFixed(4)}% = ${(gAll-cAll).toFixed(4)}% per trade.`);
