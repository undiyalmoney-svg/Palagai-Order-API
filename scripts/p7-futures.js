#!/usr/bin/env node
/** PHASE 7 — NIFTY FUTURES, MULTI-DAY. Attacking cost, not entry.
 *
 *  PRE-REGISTERED BEFORE ANY RESULT (frozen family, 5 hypotheses x 3 horizons = 15 tests):
 *    H1 MOMENTUM   : N-day return > 0            -> long   (and inverse)
 *    H2 REVERSION  : N-day return < 0            -> long   (and inverse)
 *    H3 OI-PRICE   : OI up + price up -> long ; OI up + price down -> short
 *    H4 TREND      : close > 20-day MA           -> long   (and inverse)
 *    H5 GAP        : open vs prior close gap     -> fade
 *  Horizons: hold 3, 5, 10 sessions.
 *
 *  COSTS: NIFTY futures round trip 0.0218% of notional. A position spanning a
 *  contract roll is charged an EXTRA round trip.
 *  CONTROLS: every result is reported against (a) buy-and-hold and
 *  (b) a direction-matched random-entry control with identical trade count and
 *  identical holding period - because NIFTY rose over this window and any
 *  long-biased rule beats cash trivially.
 *  SPLIT: DEV 2015-2019 | VALID 2020-2022. Read-only. */
const fs=require('fs');
const S=JSON.parse(fs.readFileSync('research-data/futdaily/nifty-fut-daily.json','utf8'));
const COST=0.0218;                       // % of notional, round trip
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};

/** trade return in %, entry next-day OPEN, exit close of day i+H. charges incl. rolls */
function trade(i,H,dir){
  const e=i+1; if(e>=S.length) return null;
  const x=Math.min(e+H-1,S.length-1);
  const entry=S[e].o, exit=S[x].c;
  if(!(entry>0&&exit>0)) return null;
  let rolls=0;
  for(let k=e;k<=x;k++) if(k>e && S[k].exp!==S[k-1].exp) rolls++;
  const gross=dir*(exit-entry)/entry*100;
  return gross - COST*(1+rolls);
}
function signals(name,N){
  const out=[];
  for(let i=Math.max(N,20);i<S.length-1;i++){
    const r=(S[i].c-S[i-N].c)/S[i-N].c*100;
    const ma=mean(S.slice(i-19,i+1).map(s=>s.c));
    const oiUp=S[i].oi>S[i-1].oi;
    const pUp=S[i].c>S[i-1].c;
    const gap=(S[i].o-S[i-1].c)/S[i-1].c*100;
    let dir=0;
    if(name==='H1_MOM')  dir = r>0?+1:-1;
    if(name==='H2_REV')  dir = r<0?+1:-1;
    if(name==='H3_OI')   dir = oiUp?(pUp?+1:-1):0;
    if(name==='H4_TREND')dir = S[i].c>ma?+1:-1;
    if(name==='H5_GAP')  dir = Math.abs(gap)>0.3?(gap>0?-1:+1):0;
    if(dir!==0) out.push({i,dir,date:S[i].date});
  }
  return out;
}
// buy and hold benchmark
const bh=(S[S.length-1].c-S[0].o)/S[0].o*100;
console.log('PHASE 7 - NIFTY FUTURES MULTI-DAY  (cost '+COST+'% round trip + rolls)');
console.log('  sessions '+S.length+'   '+S[0].date+' -> '+S[S.length-1].date);
console.log('  buy & hold over the whole window: '+bh.toFixed(1)+'%\n');
console.log('  hypothesis     N   H   trades   mean%    total%   ann%     t     DEV%    VALID%   vs randCtl   t');
let seed=7; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const results=[];
for(const [name,N] of [['H1_MOM',5],['H2_REV',5],['H3_OI',1],['H4_TREND',1],['H5_GAP',1]]){
  for(const H of [3,5,10]){
    const sig=signals(name,N);
    const rs=[],devs=[],vals=[];
    for(const s of sig){ const r=trade(s.i,H,s.dir); if(r===null)continue;
      rs.push(r); (s.date<'2020-01-01'?devs:vals).push(r); }
    if(rs.length<30) continue;
    // direction-matched random control: same count, same H, same dir distribution
    const ctl=[];
    for(const s of sig){ const j=20+Math.floor(rnd()*(S.length-25-H));
      const r=trade(j,H,s.dir); if(r!==null) ctl.push(r); }
    const t=mean(rs)/(sd(rs)/Math.sqrt(rs.length));
    const df=mean(rs)-mean(ctl);
    const se=Math.sqrt(sd(rs)**2/rs.length+sd(ctl)**2/ctl.length);
    const yrs=8, ann=sum(rs)/yrs;
    results.push({name,H,rs,t,tc:df/se,total:sum(rs)});
    console.log(`  ${name.padEnd(9)} ${String(N).padStart(3)} ${String(H).padStart(3)}  ${String(rs.length).padStart(6)}  ${mean(rs).toFixed(3).padStart(7)}  ${sum(rs).toFixed(1).padStart(8)}  ${ann.toFixed(1).padStart(6)}  ${t.toFixed(2).padStart(6)}  ${sum(devs).toFixed(1).padStart(7)}  ${sum(vals).toFixed(1).padStart(8)}  ${df.toFixed(3).padStart(9)}  ${(df/se).toFixed(2).padStart(6)}`);
  }
}
console.log('\n  15 tests -> Bonferroni |t| threshold 2.94');
const best=results.reduce((a,b)=>b.total>a.total?b:a);
console.log(`  BEST: ${best.name} H=${best.H}  total ${best.total.toFixed(1)}%  t=${best.t.toFixed(2)}  vs-control t=${best.tc.toFixed(2)}`);
