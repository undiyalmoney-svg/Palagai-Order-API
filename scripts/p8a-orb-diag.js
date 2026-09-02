#!/usr/bin/env node
/** PHASE 8.A — ORB DIAGNOSTICS. No P&L, no grid search, no rule fitting.
 *  Measures WHERE price actually goes after an opening-range breakout, so the
 *  stop and target can be derived from the distribution instead of fitted to it.
 *  DEV ONLY (<=2019-12-31). VALID and TEST are not read. */
const fs=require('fs'),path=require('path');
const DIR=process.env.EQDIR;
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const pct=(a,p)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p*s.length))];};
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d>'2019-12-31')continue;          // DEV ONLY
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});
  }
  S.set(f.replace('.json',''),bs);
}
console.log('PHASE 8.A - ORB DIAGNOSTICS (DEV only, <=2019)\n');
for(const ORB of [12,18,24,30]){                        // 15min, 30min, 60min opening range
  const rows=[];
  for(const [sym,bs] of S){
    for(const [d,a] of bs){
      if(a.length<70) continue;
      let H=-1e9,L=1e9;
      for(let k=0;k<ORB;k++){H=Math.max(H,a[k].h);L=Math.min(L,a[k].l);}
      if(!(H>L)) continue;
      const W=H-L;                                  // opening range width
      // first CLOSE beyond the range
      let bi=null,dir=0;
      for(let j=ORB;j<a.length-6;j++){
        if(a[j].c>H){bi=j;dir=+1;break;}
        if(a[j].c<L){bi=j;dir=-1;break;}
      }
      if(bi==null) continue;
      const e=bi+1; if(e>=a.length-3) continue;
      const entry=a[e].o; if(!(entry>0)) continue;
      // excursions from entry to 15:15, in units of OR width and in %
      let mfe=0,mae=0,exitIdx=a.length-1;
      for(let j=e;j<a.length;j++){
        if(a[j].hm>='15:15'){exitIdx=j;break;}
        mfe=Math.max(mfe,dir*(a[j].h-entry)); if(dir<0) mfe=Math.max(mfe,dir*(a[j].l-entry));
        mae=Math.min(mae,dir*(a[j].l-entry)); if(dir<0) mae=Math.min(mae,dir*(a[j].h-entry));
        exitIdx=j;
      }
      const close=dir*(a[exitIdx].c-entry);
      rows.push({W,entry,dir,mfeW:mfe/W,maeW:-mae/W,mfeP:100*mfe/entry,maeP:-100*mae/entry,
                 closeP:100*close/entry, breakBar:bi, hm:a[bi].hm,
                 gapFromRange:Math.abs(entry-(dir>0?H:L))/W});
    }
  }
  const lbl=(ORB*5)+'-min';
  console.log(`=== opening range = ${lbl} (${ORB} bars) · ${rows.length.toLocaleString()} breakouts ===`);
  console.log('  MFE (best move in your favour) in units of OR width:');
  console.log(`    p25 ${pct(rows.map(r=>r.mfeW),.25).toFixed(2)}   median ${pct(rows.map(r=>r.mfeW),.5).toFixed(2)}   p75 ${pct(rows.map(r=>r.mfeW),.75).toFixed(2)}   p90 ${pct(rows.map(r=>r.mfeW),.9).toFixed(2)}`);
  console.log('  MAE (worst move against you) in units of OR width:');
  console.log(`    p25 ${pct(rows.map(r=>r.maeW),.25).toFixed(2)}   median ${pct(rows.map(r=>r.maeW),.5).toFixed(2)}   p75 ${pct(rows.map(r=>r.maeW),.75).toFixed(2)}   p90 ${pct(rows.map(r=>r.maeW),.9).toFixed(2)}`);
  console.log(`  MFE in %: median ${pct(rows.map(r=>r.mfeP),.5).toFixed(3)}%   MAE in %: median ${pct(rows.map(r=>r.maeP),.5).toFixed(3)}%`);
  console.log(`  close-at-15:15 return: mean ${mean(rows.map(r=>r.closeP)).toFixed(4)}%   median ${pct(rows.map(r=>r.closeP),.5).toFixed(4)}%`);
  // how many EVER reach various targets, and how many hit various stops first
  console.log('  reach rates (of OR width):');
  for(const k of [0.5,1.0,1.5,2.0]){
    const reach=100*rows.filter(r=>r.mfeW>=k).length/rows.length;
    console.log(`    MFE >= ${k.toFixed(1)}W : ${reach.toFixed(1)}%      MAE >= ${k.toFixed(1)}W : ${(100*rows.filter(r=>r.maeW>=k).length/rows.length).toFixed(1)}%`);
  }
  console.log(`  cost floor 0.106% expressed in OR widths: median OR width = ${pct(rows.map(r=>100*r.W/r.entry),.5).toFixed(3)}% of price`);
  console.log(`    -> you need to capture ${(0.106/pct(rows.map(r=>100*r.W/r.entry),.5)).toFixed(2)}W just to break even\n`);
}
