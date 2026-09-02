#!/usr/bin/env node
/** PHASE 4.J — up/down day behaviour + real trade log with stock and quantity.
 *  TWO day classifications:
 *    CAUSAL    index return 09:15->10:15 (known BEFORE entry) -> tradeable
 *    HINDSIGHT index return 09:15->close (known only AFTER)   -> diagnostic ONLY */
const fs=require('fs'),path=require('path');
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const SLIP=0.05, CAP=100000, RISKPCT=1.0, MAXPOS=3;
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
const IX=new Map();
for(const r of JSON.parse(fs.readFileSync(process.argv[3],'utf8'))){
  const d=r.t.slice(0,10); if(d>='2023-01-01')continue;
  if(!IX.has(d))IX.set(d,[]); IX.get(d).push({hm:r.t.slice(11,16),c:r.c});}
const DAY=new Map();
for(const d of dates){
  const a=IX.get(d); if(!a||a.length<20)continue;
  const o=a[0].c; const at1015=a.find(x=>x.hm==='10:15');
  if(!at1015)continue;
  DAY.set(d,{causal:(at1015.c-o)/o*100, hind:(a[a.length-1].c-o)/o*100});
}
/** long 1H ORB, stop 1H low, exit 15:15, with real share quantity */
function trades(side){
  const out=[];
  for(const d of dates){
    if(!DAY.has(d))continue;
    for(const [sym,bs] of S){
      const a=bs.get(d); if(!a||a.length<40)continue;
      let H1=-1e9,L1=1e9;for(let k=0;k<12;k++){H1=Math.max(H1,a[k].h);L1=Math.min(L1,a[k].l);}
      if(!(H1>L1))continue;
      let cr=null;
      for(let j=12;j<a.length-1;j++){if(a[j].hm>='15:10')break;
        if(side>0&&a[j].c>H1){cr=j;break;} if(side<0&&a[j].c<L1){cr=j;break;}}
      if(cr==null)continue;
      const e=cr+1; if(e>=a.length)continue;
      const raw=a[e].o; if(!(raw>0))continue;
      const fill=raw*(1+side*SLIP/100);
      const stop=side>0?L1:H1;
      const riskPerShare=Math.abs(fill-stop); if(!(riskPerShare>0))continue;
      const qty=Math.floor((CAP*RISKPCT/100)/riskPerShare);
      if(qty<1)continue;
      let exit=null,reason=null;
      for(let j=e;j<a.length;j++){
        if(a[j].hm>='15:15'){exit=a[j].c;reason='EOD';break;}
        const g=side>0?a[j].o<=stop:a[j].o>=stop;
        if(g){exit=a[j].o;reason='GAPSTOP';break;}
        const h=side>0?a[j].l<=stop:a[j].h>=stop;
        if(h){exit=stop;reason='STOP';break;}
        if(j===a.length-1){exit=a[j].c;reason='EOD';}}
      if(exit==null)continue;
      const ex=exit*(1-side*SLIP/100);
      const grossRs=side*(ex-fill)*qty;
      const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
      out.push({d,sym,qty,entry:fill,stop,exit:ex,reason,
        grossRs,chargesRs:chg,netRs:grossRs-chg,
        riskRs:riskPerShare*qty, entryTime:a[e].hm});
    }
  }
  return out;
}
const T=trades(+1);
const byDay=new Map();
for(const x of T){if(!byDay.has(x.d))byDay.set(x.d,[]);byDay.get(x.d).push(x);}
const dayRows=[];
for(const d of dates){
  const l=(byDay.get(d)||[]).slice(0,MAXPOS); if(!l.length)continue;
  const dd=DAY.get(d); if(!dd)continue;
  dayRows.push({d,n:l.length,net:l.reduce((a,b)=>a+b.netRs,0),
    causal:dd.causal,hind:dd.hind,trades:l});
}
const sum=a=>a.reduce((x,y)=>x+y,0);
function bucket(rows,key,lo,hi){
  const up=rows.filter(x=>x[key]>hi), dn=rows.filter(x=>x[key]<lo), fl=rows.filter(x=>x[key]>=lo&&x[key]<=hi);
  return {up,dn,fl};
}
function show(label,key,note){
  console.log(`\n${'='.repeat(96)}`);
  console.log(`${label}   ${note}`);
  console.log('='.repeat(96));
  const {up,dn,fl}=bucket(dayRows,key,-0.3,0.3);
  console.log('day type      days   totalRs      avgRs/day   medianRs   win-day%   avg trades');
  for(const [n,g] of [['INDEX UP',up],['FLAT',fl],['INDEX DOWN',dn]]){
    if(!g.length)continue;
    const p=g.map(x=>x.net);
    console.log(`${n.padEnd(13)}${String(g.length).padStart(5)}${sum(p).toLocaleString('en-IN',{maximumFractionDigits:0}).padStart(11)}`+
      `${mean(p).toFixed(0).padStart(13)}${med(p).toFixed(0).padStart(11)}`+
      `${(100*p.filter(x=>x>0).length/p.length).toFixed(1).padStart(10)}%${mean(g.map(x=>x.n)).toFixed(2).padStart(11)}`);
  }
}
show('1. CAUSAL — index direction by 10:15 (KNOWN BEFORE ENTRY, tradeable)','causal','');
show('2. HINDSIGHT — index direction at CLOSE (NOT knowable at entry)','hind','** DIAGNOSTIC ONLY **');
console.log('\n  The gap between these two tables is the value of information you do NOT have.');
console.log('\n=== SAME PATTERN ON UP AND DOWN DAYS? (split DEV/VALID, causal classification) ===');
console.log('day type    window   days   avgRs/day    win-day%');
for(const [n,f] of [['INDEX UP',x=>x.causal>0.3],['FLAT',x=>Math.abs(x.causal)<=0.3],['INDEX DOWN',x=>x.causal<-0.3]]){
  for(const [w,g] of [['DEV',x=>x.d<='2019-12-31'],['VALID',x=>x.d>='2020-01-01']]){
    const r=dayRows.filter(x=>f(x)&&g(x)); if(r.length<30)continue;
    const p=r.map(x=>x.net);
    console.log(`${n.padEnd(12)}${w.padEnd(8)}${String(r.length).padStart(5)}${mean(p).toFixed(0).padStart(11)}${(100*p.filter(x=>x>0).length/p.length).toFixed(1).padStart(11)}%`);
  }
}
console.log('\n=== SAMPLE TRADE LOG — stock, quantity, entry, stop, exit, charges, net ===');
let s=4242;const rnd=()=>((s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff);
const samp=[...dayRows].sort(()=>rnd()-0.5).slice(0,8).sort((a,b)=>a.d.localeCompare(b.d));
console.log('date        stock        qty    entry     stop      exit   reason   gross    charges     net');
for(const day of samp){
  for(const t of day.trades){
    console.log(`${t.d}  ${t.sym.padEnd(11)}${String(t.qty).padStart(5)}${t.entry.toFixed(2).padStart(9)}${t.stop.toFixed(2).padStart(9)}`+
      `${t.exit.toFixed(2).padStart(10)}  ${t.reason.padEnd(8)}${t.grossRs.toFixed(0).padStart(7)}${t.chargesRs.toFixed(0).padStart(9)}${t.netRs.toFixed(0).padStart(8)}`);
  }
  console.log(`${' '.repeat(12)}day total (idx ${day.causal>=0?'+':''}${day.causal.toFixed(2)}% by 10:15, ${day.hind>=0?'+':''}${day.hind.toFixed(2)}% close)${String(day.net.toFixed(0)).padStart(24)}`);
}
console.log('\n=== AVERAGE POSITION SIZE ===');
console.log(`  avg quantity ${mean(T.map(x=>x.qty)).toFixed(0)} shares · avg notional Rs${mean(T.map(x=>x.qty*x.entry)).toFixed(0)}`);
console.log(`  avg risk Rs${mean(T.map(x=>x.riskRs)).toFixed(0)} (target Rs1000 = 1% of Rs1,00,000)`);
console.log(`  avg charges Rs${mean(T.map(x=>x.chargesRs)).toFixed(0)} per trade`);
console.log(`  charges as % of the Rs1000 risked: ${(100*mean(T.map(x=>x.chargesRs))/1000).toFixed(1)}%`);
