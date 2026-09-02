#!/usr/bin/env node
/** PHASE 4.P — DUMMY-CONFIRMED 1H BREAKOUT, exactly as specified.
 *   wait first hour (09:15-10:15) -> 5-min bars
 *   stock crosses 1H high (long) or 1H low (short)
 *   FIRST cross = DUMMY trade (observed, not taken)
 *   if the dummy WINS, the NEXT cross in the same direction is a REAL trade
 *   SL = the 1H candle CLOSE (the 10:15 bar close)
 *   max 5 stocks/day, Rs10,000 per stock, capital Rs50,000
 *   exit 15:15. Read-only. TEST window excluded. */
const fs=require('fs'),path=require('path');
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const SLIP=0.05, PER=10000, MAXPOS=5;
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
/** simulate one leg from bar index e; returns exit price and reason */
function walk(a,e,side,stop,stopAt){
  for(let j=e;j<a.length;j++){
    if(a[j].hm>=stopAt){return {px:a[j].c,why:'TIME'};}
    const g=side>0?a[j].o<=stop:a[j].o>=stop;
    if(g)return {px:a[j].o,why:'GAPSTOP'};
    const h=side>0?a[j].l<=stop:a[j].h>=stop;
    if(h)return {px:stop,why:'STOP'};
    if(j===a.length-1)return {px:a[j].c,why:'EOD'};
  }
  return null;
}
const TRADES=[];
for(const d of dates){
  let taken=0;
  for(const [sym,bs] of S){
    if(taken>=MAXPOS)break;
    const a=bs.get(d); if(!a||a.length<40)continue;
    let H1=-1e9,L1=1e9;
    for(let k=0;k<12;k++){H1=Math.max(H1,a[k].h);L1=Math.min(L1,a[k].l);}
    if(!(H1>L1))continue;
    const SL=a[11].c;                                     // SL = 1H candle CLOSE
    for(const side of [+1,-1]){
      if(taken>=MAXPOS)break;
      const lvl=side>0?H1:L1;
      // ---- DUMMY: first cross ----
      let c1=null;
      for(let j=12;j<a.length-1;j++){
        if(a[j].hm>='14:30')break;
        if(side>0&&a[j].c>lvl){c1=j;break;}
        if(side<0&&a[j].c<lvl){c1=j;break;}}
      if(c1==null)continue;
      const de=c1+1; if(de>=a.length)continue;
      const dFill=a[de].o; if(!(dFill>0))continue;
      // dummy must have the stop on the correct side to be a valid trade
      if(side>0&&!(SL<dFill))continue;
      if(side<0&&!(SL>dFill))continue;
      const dR=Math.abs(dFill-SL);
      const dTgt=dFill+side*dR;                            // dummy target = 1R
      let dOut=null;
      for(let j=de;j<a.length;j++){
        if(a[j].hm>='15:15'){dOut={px:a[j].c,why:'TIME'};break;}
        const g=side>0?a[j].o<=SL:a[j].o>=SL;
        if(g){dOut={px:a[j].o,why:'STOP',j};break;}
        const hs=side>0?a[j].l<=SL:a[j].h>=SL;
        if(hs){dOut={px:SL,why:'STOP',j};break;}
        const ht=side>0?a[j].h>=dTgt:a[j].l<=dTgt;
        if(ht){dOut={px:dTgt,why:'WIN',j};break;}
        if(j===a.length-1){dOut={px:a[j].c,why:'TIME',j};}}
      if(!dOut)continue;
      const dummyWon=side*(dOut.px-dFill)>0;
      if(!dummyWon)continue;                               // dummy lost -> no real trade
      // ---- REAL: next cross in the SAME direction, after the dummy closed ----
      const from=(dOut.j!=null?dOut.j:de)+1;
      let c2=null;
      for(let j=from;j<a.length-1;j++){
        if(a[j].hm>='15:00')break;
        if(side>0&&a[j].c>lvl){c2=j;break;}
        if(side<0&&a[j].c<lvl){c2=j;break;}}
      if(c2==null)continue;
      const re=c2+1; if(re>=a.length)continue;
      const raw=a[re].o; if(!(raw>0))continue;
      const fill=raw*(1+side*SLIP/100);
      if(side>0&&!(SL<fill))continue;
      if(side<0&&!(SL>fill))continue;
      const qty=Math.floor(PER/fill); if(qty<1)continue;
      const out=walk(a,re,side,SL,'15:15'); if(!out)continue;
      const ex=out.px*(1-side*SLIP/100);
      const gross=side*(ex-fill)*qty;
      const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
      TRADES.push({d,sym,side,qty,fill,SL,exit:ex,why:out.why,
        gross,chg,net:gross-chg,notional:fill*qty,month:d.slice(0,7)});
      taken++;
    }
  }
}
const sum=a=>a.reduce((x,y)=>x+y,0);
console.log(`DUMMY-CONFIRMED 1H BREAKOUT · Rs${PER.toLocaleString('en-IN')}/stock · max ${MAXPOS} stocks/day · SL = 1H close\n`);
console.log(`real trades taken: ${TRADES.length.toLocaleString()} over ${new Set(TRADES.map(x=>x.d)).size} sessions`);
console.log(`(a real trade requires the dummy to have WON first)\n`);
const byM=new Map();
for(const t of TRADES){if(!byM.has(t.month))byM.set(t.month,[]);byM.get(t.month).push(t);}
const months=[...byM.keys()].sort().filter(m=>byM.get(m).length>=10);
let s=777;const rnd=()=>((s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff);
const pick=[...months].sort(()=>rnd()-0.5).slice(0,5).sort();
console.log('=== 5 RANDOM MONTHS (seeded, reproducible) ===');
console.log('month     trades  win%   gross Rs   charges Rs    NET Rs    return on Rs50k');
console.log('-'.repeat(78));
for(const m of pick){
  const t=byM.get(m);
  const n=sum(t.map(x=>x.net));
  console.log(`${m}  ${String(t.length).padStart(6)}${(100*t.filter(x=>x.net>0).length/t.length).toFixed(0).padStart(6)}%`+
    `${sum(t.map(x=>x.gross)).toFixed(0).padStart(11)}${sum(t.map(x=>x.chg)).toFixed(0).padStart(13)}`+
    `${n.toFixed(0).padStart(10)}${(100*n/50000).toFixed(2).padStart(15)}%`);
}
const pt=pick.flatMap(m=>byM.get(m));
console.log('-'.repeat(78));
console.log(`5-month total: Rs${sum(pt.map(x=>x.net)).toFixed(0)}  (${(100*sum(pt.map(x=>x.net))/50000).toFixed(2)}% on Rs50,000)\n`);
console.log('=== ALL MONTHS (is the 5-month sample representative?) ===');
const all=TRADES;
const mnet=months.map(m=>sum(byM.get(m).map(x=>x.net)));
console.log(`  months ${months.length} · profitable months ${mnet.filter(x=>x>0).length} (${(100*mnet.filter(x=>x>0).length/mnet.length).toFixed(0)}%)`);
console.log(`  best month Rs${Math.max(...mnet).toFixed(0)} · worst month Rs${Math.min(...mnet).toFixed(0)} · median Rs${med(mnet).toFixed(0)}`);
console.log(`  FULL PERIOD: gross Rs${sum(all.map(x=>x.gross)).toLocaleString('en-IN',{maximumFractionDigits:0})} · charges Rs${sum(all.map(x=>x.chg)).toLocaleString('en-IN',{maximumFractionDigits:0})} · NET Rs${sum(all.map(x=>x.net)).toLocaleString('en-IN',{maximumFractionDigits:0})}`);
console.log(`  win rate ${(100*all.filter(x=>x.net>0).length/all.length).toFixed(1)}% · avg win Rs${mean(all.filter(x=>x.net>0).map(x=>x.net)).toFixed(0)} · avg loss Rs${mean(all.filter(x=>x.net<=0).map(x=>x.net)).toFixed(0)}`);
console.log(`  net per trade Rs${mean(all.map(x=>x.net)).toFixed(1)} · avg notional Rs${mean(all.map(x=>x.notional)).toFixed(0)} · avg charges Rs${mean(all.map(x=>x.chg)).toFixed(1)}`);
const DEV=all.filter(x=>x.d<='2019-12-31'), VAL=all.filter(x=>x.d>='2020-01-01');
console.log(`\n  DEV   net Rs${sum(DEV.map(x=>x.net)).toFixed(0)} over ${DEV.length} trades (Rs${mean(DEV.map(x=>x.net)).toFixed(1)}/trade)`);
console.log(`  VALID net Rs${sum(VAL.map(x=>x.net)).toFixed(0)} over ${VAL.length} trades (Rs${mean(VAL.map(x=>x.net)).toFixed(1)}/trade)`);
console.log(`\n=== DID THE DUMMY FILTER HELP? ===`);
console.log(`  gross per trade WITH dummy confirmation: Rs${mean(all.map(x=>x.gross)).toFixed(1)}`);
console.log(`  charges per trade:                      Rs${mean(all.map(x=>x.chg)).toFixed(1)}`);
console.log(`  net per trade:                          Rs${mean(all.map(x=>x.net)).toFixed(1)}`);
console.log('\nSAMPLE TRADES');
console.log('date        stock       side  qty   entry      SL      exit   reason   gross  chg    net');
for(const t of pt.slice(0,12))
  console.log(`${t.d}  ${t.sym.padEnd(11)}${(t.side>0?'BUY ':'SELL').padEnd(6)}${String(t.qty).padStart(4)}${t.fill.toFixed(2).padStart(9)}${t.SL.toFixed(2).padStart(9)}${t.exit.toFixed(2).padStart(10)}  ${t.why.padEnd(8)}${t.gross.toFixed(0).padStart(6)}${t.chg.toFixed(0).padStart(5)}${t.net.toFixed(0).padStart(7)}`);
