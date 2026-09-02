#!/usr/bin/env node
/** PHASE 4.N — how much is there to capture, and can any exit capture enough? */
const fs=require('fs'),path=require('path');
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const pc=(a,f)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*f))];};
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
/** collect the narrow-range SHORT setups with their full forward path */
const SET=[];
for(const d of dates){
  for(const [sym,bs] of S){
    const a=bs.get(d); if(!a||a.length<40)continue;
    let H1=-1e9,L1=1e9;for(let k=0;k<12;k++){H1=Math.max(H1,a[k].h);L1=Math.min(L1,a[k].l);}
    if(!(H1>L1))continue;
    const rng=H1-L1, px=a[11].c;
    if(!(rng/px*100<1.0))continue;                        // NARROW only
    let cr=null;
    for(let j=12;j<a.length-1;j++){if(a[j].hm>='15:10')break; if(a[j].c>H1){cr=j;break;}}
    if(cr==null)continue;
    const e=cr+1; if(e>=a.length)continue;
    const raw=a[e].o; if(!(raw>0))continue;
    const fill=raw*(1-SLIP/100);                          // SHORT: adverse entry = lower
    const stop=H1+0.25*rng;
    const R=stop-fill; if(!(R>0))continue;
    const path=a.slice(e);
    let mfe=0,mae=0,tMfe=0;
    for(let k=0;k<path.length;k++){
      if(path[k].hm>'15:15')break;
      const fav=(fill-path[k].l)/fill*100, adv=(path[k].h-fill)/fill*100;
      if(fav>mfe){mfe=fav;tMfe=k;} if(adv>mae)mae=adv;
    }
    SET.push({d,sym,fill,stop,R,path,mfe,mae,tMfe,rngPct:rng/px*100});
  }
}
const DEVf=x=>x.d<='2019-12-31', VALf=x=>x.d>='2020-01-01';
console.log(`narrow-range SHORT setups: ${SET.length.toLocaleString()} (DEV ${SET.filter(DEVf).length}, VALID ${SET.filter(VALf).length})\n`);
console.log('=== 1. THE CEILING — how much is actually available? ===');
for(const [w,f] of [['DEV',DEVf],['VALID',VALf]]){
  const g=SET.filter(f);
  const mfe=g.map(x=>x.mfe), mae=g.map(x=>x.mae);
  console.log(`  ${w}:  MFE mean ${mean(mfe).toFixed(3)}%  median ${med(mfe).toFixed(3)}%  p75 ${pc(mfe,.75).toFixed(3)}%  p90 ${pc(mfe,.90).toFixed(3)}%`);
  console.log(`        MAE mean ${mean(mae).toFixed(3)}%  median ${med(mae).toFixed(3)}%   median time-to-MFE ${med(g.map(x=>x.tMfe)).toFixed(0)} bars (${(5*med(g.map(x=>x.tMfe))).toFixed(0)} min)`);
}
console.log('\n  MFE is what a PERFECT exit (with hindsight) would capture. No real rule beats it.');
console.log('\n=== 2. FROZEN EXIT GRID — gross% captured vs the charge rate ===');
function runExit(g,kind,param){
  const out=[];
  for(const s of g){
    let exit=null, trail=null;
    for(let k=0;k<s.path.length;k++){
      const b=s.path[k];
      if(b.hm>='15:15'){exit=b.c;break;}
      if(b.o>=s.stop){exit=b.o;break;}                    // gap through stop
      if(b.h>=s.stop){exit=s.stop;break;}                 // stop first (conservative)
      if(kind==='target'){const t=s.fill-param*s.R; if(b.l<=t){exit=t;break;}}
      if(kind==='trail'){
        const low=b.l; trail=trail==null?low:Math.min(trail,low);
        const tr=trail*(1+param/100);
        if(b.h>=tr&&k>0){exit=tr;break;}
      }
      if(kind==='time'&&k>=param){exit=b.c;break;}
      if(k===s.path.length-1)exit=b.c;
    }
    if(exit==null)continue;
    const ex=exit*(1+SLIP/100);
    const grossPct=(s.fill-ex)/s.fill*100;
    const qty=Math.floor((CAP*RISKPCT/100)/s.R);if(qty<1)continue;
    const chgPct=100*MIS({entryPrice:s.fill,exitPrice:ex,quantity:qty}).totalRs/(s.fill*qty);
    out.push({grossPct,chgPct,net:grossPct-chgPct});
  }
  return out;
}
const GRID=[
 ...[0.25,0.5,0.75,1,1.5,2,3].map(x=>['target '+x+'R','target',x]),
 ...[0.5,1.0,1.5].map(x=>['trail '+x+'%','trail',x]),
 ...[6,12,24].map(x=>['time '+(x*5)+'m','time',x]),
 ['hold 15:15','time',999],
];
console.log('exit rule        | DEV gross%  chg%    NET%   | VALID gross%  chg%    NET%  | clears?');
console.log('='.repeat(92));
let best=null;
for(const [lbl,kind,p] of GRID){
  const dv=runExit(SET.filter(DEVf),kind,p), vl=runExit(SET.filter(VALf),kind,p);
  if(dv.length<200||vl.length<200)continue;
  const dg=mean(dv.map(x=>x.grossPct)), dc=mean(dv.map(x=>x.chgPct));
  const vg=mean(vl.map(x=>x.grossPct)), vc=mean(vl.map(x=>x.chgPct));
  const ok=(dg>dc)&&(vg>vc);
  if(!best||Math.min(dg-dc,vg-vc)>best.v)best={lbl,v:Math.min(dg-dc,vg-vc),dg,dc,vg,vc};
  console.log(`${lbl.padEnd(16)} |${dg.toFixed(4).padStart(11)}${dc.toFixed(4).padStart(8)}${(dg-dc).toFixed(4).padStart(9)}  |`+
    `${vg.toFixed(4).padStart(12)}${vc.toFixed(4).padStart(8)}${(vg-vc).toFixed(4).padStart(9)} |  ${ok?'YES':'no'}`);
}
console.log('='.repeat(92));
console.log(`\nbest exit: ${best.lbl}  worst-window net ${best.v.toFixed(4)}%`);
console.log('\n=== 3. THE HARD LIMIT ===');
const dv=SET.filter(DEVf), vl=SET.filter(VALf);
const perfectD=mean(dv.map(x=>x.mfe)), perfectV=mean(vl.map(x=>x.mfe));
console.log(`  PERFECT hindsight exit at MFE:   DEV ${perfectD.toFixed(3)}%   VALID ${perfectV.toFixed(3)}%`);
console.log(`  charge rate on this setup:       DEV ${best.dc.toFixed(4)}%   VALID ${best.vc.toFixed(4)}%`);
console.log(`  so even a PERFECT exit nets:     DEV ${(perfectD-best.dc).toFixed(3)}%   VALID ${(perfectV-best.vc).toFixed(3)}%`);
console.log(`  best REAL exit found nets:       ${best.v.toFixed(4)}%`);
console.log(`  fraction of the ceiling captured by the best real rule: ${(100*best.dg/perfectD).toFixed(0)}%`);
