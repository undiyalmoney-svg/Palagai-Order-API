#!/usr/bin/env node
/** PHASE 4.G — 1H ORB, hold to 15:15, stop at 1H low. Read-only. TEST excluded at load. */
const fs=require('fs'),path=require('path');
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const STAT=100*MIS({entryPrice:1000,exitPrice:1000,quantity:50}).totalRs/50000;
const DIR=process.argv[2];
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const s=f.replace('.json','');const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d>='2023-01-01')continue;      // TEST EXCLUDED
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});}
  S.set(s,bs);}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
const dPos=new Map(dates.map((d,i)=>[d,i]));
const IX=new Map();
for(const r of JSON.parse(fs.readFileSync(process.argv[3],'utf8'))){
  const d=r.t.slice(0,10); if(d>='2023-01-01')continue;
  if(!IX.has(d))IX.set(d,new Map()); IX.get(d).set(r.t.slice(11,16),r.c);}
console.log(`symbols ${S.size} · sessions ${dates.length} · ${dates[0]} -> ${dates[dates.length-1]} (TEST excluded)`);
console.log(`statutory cost floor ${STAT.toFixed(3)}%\n`);
/** run the strategy for one side. slip = % per side applied adversely. */
function trades(side,slip){
  const out=[];
  for(const d of dates){
    const ixm=IX.get(d)||new Map(); const ixO=ixm.get('09:15'), ix1015=ixm.get('10:15');
    const ixMove=(ixO&&ix1015)?(ix1015-ixO)/ixO*100:null;
    for(const [sym,bs] of S){
      const a=bs.get(d); if(!a||a.length<40)continue;
      let H1=-1e9,L1=1e9;
      for(let k=0;k<12&&k<a.length;k++){H1=Math.max(H1,a[k].h);L1=Math.min(L1,a[k].l);}
      if(!(H1>L1))continue;
      const i=dPos.get(d); const prev=i>0?bs.get(dates[i-1]):null;
      const gap=(prev&&prev.length)?(a[0].o-prev[prev.length-1].c)/prev[prev.length-1].c*100:null;
      const rngPct=(H1-L1)/a[11].c*100;
      // find the cross
      let cross=null;
      for(let j=12;j<a.length-1;j++){
        if(a[j].hm>='15:10')break;
        if(side>0&&a[j].c>H1){cross=j;break;}
        if(side<0&&a[j].c<L1){cross=j;break;}
      }
      if(cross==null)continue;
      const e=cross+1; if(e>=a.length)continue;
      const rawFill=a[e].o; if(!(rawFill>0))continue;
      const fill=rawFill*(1+side*slip/100);              // entry slippage adverse
      const stop=side>0?L1:H1;
      const riskPct=Math.abs(fill-stop)/fill*100;
      if(!(riskPct>0))continue;
      // walk forward: intrabar stop, else 15:15
      let exit=null,reason=null;
      for(let j=e;j<a.length;j++){
        if(a[j].hm>='15:15'){exit=a[j].c;reason='EOD';break;}
        const gapped=side>0?a[j].o<=stop:a[j].o>=stop;
        if(gapped){exit=a[j].o;reason='GAP_STOP';break;}          // fills at the gap open, worse
        const hit=side>0?a[j].l<=stop:a[j].h>=stop;
        if(hit){exit=stop;reason='STOP';break;}
        if(j===a.length-1){exit=a[j].c;reason='EOD';}
      }
      if(exit==null)continue;
      const exitAdj=exit*(1-side*slip/100);              // exit slippage adverse
      const gross=side*((exitAdj-fill)/fill*100);
      out.push({d,sym,gross,net:gross-STAT,reason,riskPct,rngPct,gap,ixMove,
        R:gross/riskPct, hm:a[cross].hm});
    }
  }
  return out;
}
const DEVf=x=>x.d<='2019-12-31', VALf=x=>x.d>='2020-01-01';
function stats(t){
  if(!t.length)return null;
  const g=t.map(x=>x.gross), n=t.map(x=>x.net);
  const w=t.filter(x=>x.net>0), l=t.filter(x=>x.net<=0);
  const byD=new Map();for(const x of t){if(!byD.has(x.d))byD.set(x.d,[]);byD.get(x.d).push(x.net);}
  const dv=[...byD.values()].map(mean);
  const se=dv.length>1?sd(dv)/Math.sqrt(dv.length):NaN;
  const gw=w.reduce((a,b)=>a+b.net,0), gl=Math.abs(l.reduce((a,b)=>a+b.net,0));
  return {n:t.length,days:dv.length,gross:mean(g),net:mean(n),tNet:se>0?mean(dv)/se:NaN,
    win:100*w.length/t.length, aw:w.length?mean(w.map(x=>x.net)):0, al:l.length?mean(l.map(x=>x.net)):0,
    pf:gl>0?gw/gl:Infinity, medR:med(t.map(x=>x.R)), risk:mean(t.map(x=>x.riskPct)),
    stopRate:100*t.filter(x=>x.reason!=='EOD').length/t.length};
}
console.log('=== THE STRATEGY AS SPECIFIED (long: close above 1H high, stop 1H low, exit 15:15) ===');
console.log('slip%  window   n      days  gross%   net%    tNet   win%   avgWin  avgLoss   PF    stop%  avgRisk%');
for(const slip of [0,0.02,0.05,0.10]){
  const T=trades(+1,slip);
  for(const [wn,f] of [['DEV',DEVf],['VALID',VALf]]){
    const s=stats(T.filter(f)); if(!s)continue;
    console.log(`${slip.toFixed(2).padStart(5)}  ${wn.padEnd(7)}${String(s.n).padStart(6)}${String(s.days).padStart(6)}`+
     `${s.gross.toFixed(3).padStart(8)}${s.net.toFixed(3).padStart(8)}${s.tNet.toFixed(2).padStart(7)}`+
     `${s.win.toFixed(1).padStart(7)}${s.aw.toFixed(2).padStart(9)}${s.al.toFixed(2).padStart(9)}`+
     `${s.pf.toFixed(2).padStart(6)}${s.stopRate.toFixed(0).padStart(7)}${s.risk.toFixed(2).padStart(9)}`);
  }
}
console.log('\n=== SHORT MIRROR (close below 1H low, stop 1H high, exit 15:15) ===');
console.log('slip%  window   n      days  gross%   net%    tNet   win%   avgWin  avgLoss   PF    stop%');
for(const slip of [0,0.05]){
  const T=trades(-1,slip);
  for(const [wn,f] of [['DEV',DEVf],['VALID',VALf]]){
    const s=stats(T.filter(f)); if(!s)continue;
    console.log(`${slip.toFixed(2).padStart(5)}  ${wn.padEnd(7)}${String(s.n).padStart(6)}${String(s.days).padStart(6)}`+
     `${s.gross.toFixed(3).padStart(8)}${s.net.toFixed(3).padStart(8)}${s.tNet.toFixed(2).padStart(7)}`+
     `${s.win.toFixed(1).padStart(7)}${s.aw.toFixed(2).padStart(9)}${s.al.toFixed(2).padStart(9)}`+
     `${s.pf.toFixed(2).padStart(6)}${s.stopRate.toFixed(0).padStart(7)}`);
  }
}
console.log('\n=== PRE-DECLARED CONDITIONING ON THE LONG ARM (slippage 0.05%/side) ===');
const T=trades(+1,0.05);
const DIMS={
 '1H range':      x=>x.rngPct<1?'narrow(<1%)':x.rngPct<2?'mid(1-2%)':'wide(>2%)',
 'gap':           x=>x.gap==null?'na':x.gap>0.3?'gapUp':x.gap<-0.3?'gapDn':'flat',
 'index by 10:15':x=>x.ixMove==null?'na':x.ixMove>0.3?'idxUp':x.ixMove<-0.3?'idxDn':'idxFlat',
 'cross time':    x=>x.hm<'11:30'?'early':x.hm<'13:30'?'mid':'late',
 'stop distance': x=>x.riskPct<1?'tight(<1%)':x.riskPct<2?'mid(1-2%)':'wide(>2%)',
};
console.log('dimension        bucket          DEV n   DEV net%   t   win% |  VALID net%   t   win% | both>0?');
console.log('-'.repeat(102));
let cells=0,both=0;
for(const [dim,fn] of Object.entries(DIMS)){
  for(const k of [...new Set(T.map(fn))].sort()){
    const a=stats(T.filter(x=>DEVf(x)&&fn(x)===k)), b=stats(T.filter(x=>VALf(x)&&fn(x)===k));
    if(!a||!b||a.days<60||b.days<60)continue;
    cells++; const ok=a.net>0&&b.net>0; if(ok)both++;
    console.log(`${dim.padEnd(17)}${k.padEnd(15)}${String(a.n).padStart(6)}${a.net.toFixed(3).padStart(10)}${a.tNet.toFixed(2).padStart(6)}${a.win.toFixed(0).padStart(6)} |`+
      `${b.net.toFixed(3).padStart(11)}${b.tNet.toFixed(2).padStart(6)}${b.win.toFixed(0).padStart(6)} |  ${ok?'YES':'no'}`);
  }
}
console.log('-'.repeat(102));
console.log(`\ncells ${cells} · net-positive in BOTH DEV and VALID: ${both}`);
fs.writeFileSync('/tmp/p4g_ledger.json',JSON.stringify({cells,both},null,1));
