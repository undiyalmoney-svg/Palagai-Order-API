#!/usr/bin/env node
/** PHASE 6.A — DETECTOR ONLY. Does "liquidity sweep + inverse FVG" occur?
 *  No P&L yet. Counts occurrences and measures raw forward drift so we know
 *  whether there is anything worth a full validation.
 *  Read-only. TEST (>=2023) excluded at load. */
const fs=require('fs'),path=require('path');
const DIR=process.env.EQDIR, SWING=+(process.env.SWING||10), MAXWAIT=+(process.env.MAXWAIT||12);
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};

const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d>='2023-01-01')continue;
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]});
  }
  S.set(f.replace('.json',''),bs);
}

let nDays=0, nFVG=0, nInv=0, nSweep=0, nEntry=0;
const fwd={};                 // forward return by horizon, per direction
for(const H of [1,3,6,12,24]) fwd[H]={sig:[],ctl:[]};
const events=[];

for(const [sym,bs] of S){
  for(const [d,a] of bs){
    if(a.length<40) continue;
    nDays++;
    // ---- build FVG list as we walk forward (no look-ahead) ----
    const gaps=[];            // {type:+1 bull/-1 bear, lo, hi, i, inverted:false, invAt}
    for(let i=2;i<a.length;i++){
      // 1. detect new FVG formed at bar i
      if(a[i].l>a[i-2].h) { gaps.push({type:+1,lo:a[i-2].h,hi:a[i].l,i,inverted:false}); nFVG++; }
      if(a[i].h<a[i-2].l) { gaps.push({type:-1,lo:a[i].h,hi:a[i-2].l,i,inverted:false}); nFVG++; }
      // 2. mark inversions: close fully through the gap in the opposite direction
      for(const g of gaps){
        if(g.inverted||g.i>=i) continue;
        if(g.type===+1 && a[i].c<g.lo){ g.inverted=true; g.invAt=i; g.invType=-1; nInv++; }
        if(g.type===-1 && a[i].c>g.hi){ g.inverted=true; g.invAt=i; g.invType=+1; nInv++; }
      }
      // 3. liquidity sweep at bar i (needs SWING prior bars)
      if(i<SWING+2) continue;
      let pH=-1e9,pL=1e9;
      for(let k=i-SWING;k<i;k++){ pH=Math.max(pH,a[k].h); pL=Math.min(pL,a[k].l); }
      const sellSweep = a[i].l<pL && a[i].c>pL;      // took sell-side liquidity, closed back up
      const buySweep  = a[i].h>pH && a[i].c<pH;      // took buy-side liquidity, closed back down
      if(!sellSweep && !buySweep) continue;
      nSweep++;
      const dir = sellSweep? +1 : -1;                // expect reversal in this direction
      // 4. within MAXWAIT bars, price retests an INVERTED gap whose new polarity == dir
      for(let j=i+1; j<Math.min(i+1+MAXWAIT, a.length-1); j++){
        const cand = gaps.filter(g=>g.inverted && g.invType===dir && g.invAt<=j);
        let hit=null;
        for(const g of cand){
          // retest = price trades back into the gap zone
          if(a[j].l<=g.hi && a[j].h>=g.lo){ hit=g; break; }
        }
        if(!hit) continue;
        const e=j+1; if(e>=a.length) break;
        const entry=a[e].o; if(!(entry>0)) break;
        nEntry++;
        events.push({sym,d,hm:a[e].hm,dir,e,entry,sweepIdx:i,gapLo:hit.lo,gapHi:hit.hi,
                     swingLo:pL,swingHi:pH,bars:a});
        break;
      }
    }
  }
}
console.log('PHASE 6.A - LIQUIDITY SWEEP + INVERSE FVG : DETECTOR');
console.log(`  swing lookback ${SWING} bars · max wait ${MAXWAIT} bars after sweep\n`);
console.log(`  symbol-days scanned      ${nDays.toLocaleString()}`);
console.log(`  fair value gaps formed   ${nFVG.toLocaleString()}`);
console.log(`  gaps that inverted       ${nInv.toLocaleString()}  (${(100*nInv/nFVG).toFixed(1)}% of FVGs)`);
console.log(`  liquidity sweeps         ${nSweep.toLocaleString()}`);
console.log(`  SWEEP + IFVG ENTRIES     ${nEntry.toLocaleString()}  (${(nEntry/nDays).toFixed(2)} per symbol-day)`);

// ---- raw forward drift, signal vs direction+time matched control ----
console.log('\n  RAW FORWARD MOVE (% of price), signal vs matched control');
console.log('  horizon    n      signal%   control%      diff%       t');
for(const H of [1,3,6,12,24]){
  const sig=[],ctl=[];
  for(const ev of events){
    const a=ev.bars, e=ev.e, x=e+H; if(x>=a.length) continue;
    sig.push(ev.dir*(a[x].c-ev.entry)/ev.entry*100);
    // control: SAME symbol, SAME day, SAME direction, SAME bar index - but no setup.
    // use the bar 30 positions earlier as a time-shifted placebo
    const c0=e-30, c1=c0+H;
    if(c0>0 && c1<a.length) ctl.push(ev.dir*(a[c1].c-a[c0].o)/a[c0].o*100);
  }
  const df=mean(sig)-mean(ctl);
  const se=Math.sqrt(sd(sig)**2/sig.length + sd(ctl)**2/ctl.length);
  console.log(`  ${String(H).padStart(5)}  ${String(sig.length).padStart(6)}   ${mean(sig).toFixed(4).padStart(8)}  ${mean(ctl).toFixed(4).padStart(9)}  ${df.toFixed(4).padStart(9)}  ${(df/se).toFixed(2).padStart(6)}`);
}
console.log('\n  cost reference: MIS round trip = 0.106% of notional');
