#!/usr/bin/env node
/** PHASE 4.K — can win rate be pushed toward 100%? What does it cost?
 *  Same 1H ORB entry. Only the TARGET is varied, from very tight to wide.
 *  A tight target mechanically raises win rate. The question is what happens
 *  to expectancy when it does. Read-only. TEST excluded. */
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
console.log(`symbols ${S.size} · sessions ${dates.length}\n`);
function run(side,tgtR){
  const out=[];
  for(const d of dates){
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
      const R=Math.abs(fill-stop); if(!(R>0))continue;
      const qty=Math.floor((CAP*RISKPCT/100)/R); if(qty<1)continue;
      const tgt=fill+side*tgtR*R;
      let exit=null,reason=null;
      for(let j=e;j<a.length;j++){
        if(a[j].hm>='15:15'){exit=a[j].c;reason='EOD';break;}
        const g=side>0?a[j].o<=stop:a[j].o>=stop;
        if(g){exit=a[j].o;reason='GAPSTOP';break;}
        const hs=side>0?a[j].l<=stop:a[j].h>=stop;
        if(hs){exit=stop;reason='STOP';break;}           // stop assumed first
        if(tgtR>0){const ht=side>0?a[j].h>=tgt:a[j].l<=tgt; if(ht){exit=tgt;reason='TARGET';break;}}
        if(j===a.length-1){exit=a[j].c;reason='EOD';}}
      if(exit==null)continue;
      const ex=exit*(1-side*SLIP/100);
      const gross=side*(ex-fill)*qty;
      const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
      out.push({d,sym,qty,net:gross-chg,gross,chg,reason});
    }
  }
  return out;
}
console.log('CAN WE BUY A HIGH WIN RATE? (1H ORB long, stop = 1H low, only the TARGET changes)');
console.log('');
console.log('target   trades  TRADE-win%  avgWin   avgLoss  |  net/trade   DAY-win%   totalRs      avgRs/day');
console.log('='.repeat(104));
for(const tr of [0.10,0.20,0.30,0.50,1.00,2.00,0]){
  const T=run(+1,tr);
  if(T.length<100)continue;
  const w=T.filter(x=>x.net>0), l=T.filter(x=>x.net<=0);
  const byD=new Map();for(const x of T){if(!byD.has(x.d))byD.set(x.d,[]);byD.get(x.d).push(x);}
  const days=[...byD.entries()].map(([d,a])=>({d,p:a.slice(0,MAXPOS).reduce((s,x)=>s+x.net,0)}));
  const dp=days.map(x=>x.p);
  const lbl=tr===0?'none(EOD)':(tr.toFixed(2)+'R');
  console.log(`${lbl.padEnd(9)}${String(T.length).padStart(6)}${(100*w.length/T.length).toFixed(1).padStart(11)}%`+
    `${(w.length?mean(w.map(x=>x.net)):0).toFixed(0).padStart(9)}${(l.length?mean(l.map(x=>x.net)):0).toFixed(0).padStart(10)}  |`+
    `${mean(T.map(x=>x.net)).toFixed(0).padStart(10)}${(100*dp.filter(x=>x>0).length/dp.length).toFixed(1).padStart(11)}%`+
    `${dp.reduce((a,b)=>a+b,0).toLocaleString('en-IN',{maximumFractionDigits:0}).padStart(12)}${mean(dp).toFixed(0).padStart(13)}`);
}
console.log('='.repeat(104));
console.log('\nWHAT WOULD "ALL DAYS GREEN" REQUIRE? (measured from the same trades)');
const T=run(+1,0.10);
const byD=new Map();for(const x of T){if(!byD.has(x.d))byD.set(x.d,[]);byD.get(x.d).push(x);}
const days=[...byD.entries()].map(([d,a])=>({d,p:a.slice(0,MAXPOS).reduce((s,x)=>s+x.net,0)}));
const dp=days.map(x=>x.p).sort((a,b)=>a-b);
console.log(`  tightest target tested (0.10R) reaches ${(100*dp.filter(x=>x>0).length/dp.length).toFixed(1)}% green days — the highest achievable here`);
console.log(`  the ${dp.filter(x=>x<=0).length} red days still lose a total of Rs${dp.filter(x=>x<=0).reduce((a,b)=>a+b,0).toFixed(0)}`);
console.log(`  worst single day Rs${dp[0].toFixed(0)} · 5th percentile Rs${dp[Math.floor(dp.length*0.05)].toFixed(0)}`);
console.log('');
console.log('  For EVERY day to be green, every red day above would have to be eliminated.');
console.log('  A stop that is never hit means no stop; a target always reached means no risk.');
console.log('  The red days are where the stop did its job — removing them removes the protection.');
console.log('');
console.log('BEST DAY-WIN-RATE FOUND ANYWHERE IN THIS PROGRAMME, AND ITS COST:');
for(const tr of [0.10,0.20,0.50]){
  const X=run(+1,tr);
  const b=new Map();for(const x of X){if(!b.has(x.d))b.set(x.d,[]);b.get(x.d).push(x);}
  const dd=[...b.entries()].map(([d,a])=>a.slice(0,MAXPOS).reduce((s,x)=>s+x.net,0));
  const green=100*dd.filter(x=>x>0).length/dd.length;
  const tot=dd.reduce((a,b)=>a+b,0);
  console.log(`  target ${tr.toFixed(2)}R -> ${green.toFixed(1)}% green days, and Rs${tot.toLocaleString('en-IN',{maximumFractionDigits:0})} total over ${dd.length} days`);
}
