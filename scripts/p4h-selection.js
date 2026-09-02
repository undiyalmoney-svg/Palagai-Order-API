#!/usr/bin/env node
/** PHASE 4.H — intraday stock SELECTION applied to the 1H ORB strategy. Read-only. */
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
    const d=r[0].slice(0,10); if(d>='2023-01-01')continue;
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]});}
  S.set(s,bs);}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
const dPos=new Map(dates.map((d,i)=>[d,i]));
const IX=new Map();
for(const r of JSON.parse(fs.readFileSync(process.argv[3],'utf8'))){
  const d=r.t.slice(0,10); if(d>='2023-01-01')continue;
  if(!IX.has(d))IX.set(d,new Map()); IX.get(d).set(r.t.slice(11,16),r.c);}
console.log(`symbols ${S.size} · sessions ${dates.length} · statutory floor ${STAT.toFixed(3)}%\n`);
/** hour-1 volume history per symbol, for the participation filter (causal) */
const V1H=new Map();
for(const [sym,bs] of S){
  const m=new Map();
  for(const d of dates){const a=bs.get(d);if(!a||a.length<12)continue;
    let v=0;for(let k=0;k<12;k++)v+=a[k].v;m.set(d,v);}
  V1H.set(sym,m);
}
/** build every candidate for a given side, with all causal selection fields */
function candidates(side,slip){
  const byDay=new Map();
  for(const d of dates){
    const ixm=IX.get(d)||new Map();
    const ixO=ixm.get('09:15'), ix1=ixm.get('10:15');
    const ixRet=(ixO&&ix1)?(ix1-ixO)/ixO*100:null;
    const list=[];
    for(const [sym,bs] of S){
      const a=bs.get(d); if(!a||a.length<40)continue;
      let H1=-1e9,L1=1e9,vol1=0;
      for(let k=0;k<12;k++){H1=Math.max(H1,a[k].h);L1=Math.min(L1,a[k].l);vol1+=a[k].v;}
      if(!(H1>L1))continue;
      const px=a[11].c;
      const rngPct=(H1-L1)/px*100;
      const stkRet=(a[11].c-a[0].o)/a[0].o*100;
      // 20-session prior average hour-1 volume (strictly before today)
      const i=dPos.get(d); const vh=[];
      for(let k=Math.max(0,i-20);k<i;k++){const v=V1H.get(sym).get(dates[k]);if(v!=null)vh.push(v);}
      const avgV=vh.length>=10?mean(vh):null;
      const relVol=avgV>0?vol1/avgV:null;
      const rs=(ixRet!=null)?stkRet-ixRet:null;
      // trigger
      let cross=null;
      for(let j=12;j<a.length-1;j++){
        if(a[j].hm>='15:10')break;
        if(side>0&&a[j].c>H1){cross=j;break;}
        if(side<0&&a[j].c<L1){cross=j;break;}}
      if(cross==null)continue;
      const e=cross+1; if(e>=a.length)continue;
      const raw=a[e].o; if(!(raw>0))continue;
      const fill=raw*(1+side*slip/100);
      const stop=side>0?L1:H1;
      const riskPct=Math.abs(fill-stop)/fill*100; if(!(riskPct>0))continue;
      let exit=null,reason=null;
      for(let j=e;j<a.length;j++){
        if(a[j].hm>='15:15'){exit=a[j].c;reason='EOD';break;}
        const gapped=side>0?a[j].o<=stop:a[j].o>=stop;
        if(gapped){exit=a[j].o;reason='GAP';break;}
        const hit=side>0?a[j].l<=stop:a[j].h>=stop;
        if(hit){exit=stop;reason='STOP';break;}
        if(j===a.length-1){exit=a[j].c;reason='EOD';}}
      if(exit==null)continue;
      const ex=exit*(1-side*slip/100);
      const gross=side*((ex-fill)/fill*100);
      list.push({d,sym,gross,net:gross-STAT,riskPct,rngPct,rs,relVol,reason,R:gross/riskPct});
    }
    if(list.length)byDay.set(d,list);
  }
  return byDay;
}
const F1=x=>x.rngPct<=1.2;
const F2=(x,side)=>x.rs!=null&&(side>0?x.rs>0:x.rs<0);
const F3=x=>x.relVol!=null&&x.relVol>=1.2;
const VARIANTS=[
 ['S0 baseline (all triggers)',      (l,s)=>l],
 ['S1 tight 1H range',               (l,s)=>l.filter(F1)],
 ['S2 tight + rel-strength',         (l,s)=>l.filter(x=>F1(x)&&F2(x,s))],
 ['S3 tight + RS + volume',          (l,s)=>l.filter(x=>F1(x)&&F2(x,s)&&F3(x))],
 ['S4 rank only, top 3/day',         (l,s)=>[...l].sort((a,b)=>Math.abs(b.rs??0)-Math.abs(a.rs??0)).slice(0,3)],
 ['S5 full filter, top 3/day',       (l,s)=>[...l.filter(x=>F1(x)&&F2(x,s)&&F3(x))].sort((a,b)=>Math.abs(b.rs??0)-Math.abs(a.rs??0)).slice(0,3)],
];
const DEVf=x=>x.d<='2019-12-31', VALf=x=>x.d>='2020-01-01';
function stats(t){
  if(t.length<50)return null;
  const w=t.filter(x=>x.net>0), l=t.filter(x=>x.net<=0);
  const byD=new Map();for(const x of t){if(!byD.has(x.d))byD.set(x.d,[]);byD.get(x.d).push(x.net);}
  const dv=[...byD.values()].map(mean);
  const se=dv.length>1?sd(dv)/Math.sqrt(dv.length):NaN;
  const gw=w.reduce((a,b)=>a+b.net,0), gl=Math.abs(l.reduce((a,b)=>a+b.net,0));
  return {n:t.length,days:dv.length,gross:mean(t.map(x=>x.gross)),net:mean(dv),
    t:se>0?mean(dv)/se:NaN,win:100*w.length/t.length,
    aw:w.length?mean(w.map(x=>x.net)):0,al:l.length?mean(l.map(x=>x.net)):0,
    pf:gl>0?gw/gl:Infinity,risk:mean(t.map(x=>x.riskPct)),medR:med(t.map(x=>x.R)),
    ratio:(w.length?mean(w.map(x=>x.net)):0)/Math.max(1e-9,Math.abs(l.length?mean(l.map(x=>x.net)):1))};
}
for(const slip of [0,0.05]){
  console.log(`\n${'='.repeat(114)}`);
  console.log(`SLIPPAGE ${slip.toFixed(2)}%/side`);
  console.log('='.repeat(114));
  console.log('variant                      arm    win  DEV n  DEV net%   t   | VALID net%   t   | win%  avgW/avgL  risk%  PF');
  for(const [name,sel] of VARIANTS){
    for(const [an,side] of [['LONG',+1],['SHORT',-1]]){
      const byDay=candidates(side,slip);
      const all=[];for(const [d,l] of byDay)all.push(...sel(l,side));
      const a=stats(all.filter(DEVf)), b=stats(all.filter(VALf));
      if(!a||!b){console.log(`${name.padEnd(29)}${an.padEnd(7)}  too few`);continue;}
      const ok=a.net>0&&b.net>0;
      console.log(`${name.padEnd(29)}${an.padEnd(7)}${ok?'YES':' no'}${String(a.n).padStart(7)}`+
        `${a.net.toFixed(3).padStart(10)}${a.t.toFixed(2).padStart(6)} |`+
        `${b.net.toFixed(3).padStart(11)}${b.t.toFixed(2).padStart(6)} |`+
        `${a.win.toFixed(0).padStart(5)}${(a.aw.toFixed(2)+'/'+Math.abs(a.al).toFixed(2)).padStart(12)}`+
        `${a.risk.toFixed(2).padStart(7)}${a.pf.toFixed(2).padStart(6)}`);
    }
  }
}
console.log(`\n${'='.repeat(114)}`);
console.log('DID SELECTION ACTUALLY FIX THE DIAGNOSED FLAW? (risk denominator, LONG arm, 0.05% slip)');
const byDay=candidates(+1,0.05);
for(const [name,sel] of VARIANTS){
  const all=[];for(const [d,l] of byDay)all.push(...sel(l,+1));
  const a=stats(all.filter(DEVf));
  if(!a)continue;
  console.log(`  ${name.padEnd(29)} avg risk ${a.risk.toFixed(2)}%  avg win ${a.aw.toFixed(2)}%  avg loss ${Math.abs(a.al).toFixed(2)}%  W/L ratio ${a.ratio.toFixed(2)}  win ${a.win.toFixed(0)}%  trades ${a.n}`);
}
