#!/usr/bin/env node
/** PHASE 15 — faithful port of CHAMPION_PDHL (pdhl-opening-range) tested on NIFTY.
 *  Rules from pdhl-opening-range.evaluator.ts + PDHL_NIFTY_PARAMS:
 *    OR = 09:15-10:15. bias = close >= OR mid ? BUY : SELL
 *    entry = bias BUY and close > swingHigh(lookback 3) -> BUY (mirror for SELL)
 *    stop = current bar low/high, capped at maxStopPts(30), floored minStopPts(3)
 *    target = 1R. exit = stop | target | EMA20 cross | 15:15
 *    multi-entry; day stops at -60 pts. earliest 09:20, last entry 15:10
 *  WEEKDAY RULES tested ON and OFF to see if they generalise. */
const fs=require('fs');
const SWING=3, EMA_N=20;
const raw=JSON.parse(fs.readFileSync('research-data/intraday/nifty5m.json','utf8'));
const byD=new Map();
for(const r of raw){
  const d=r.t.slice(0,10);
  if(!byD.has(d))byD.set(d,[]);
  byD.get(d).push({hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c});
}
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
function ema(v,n){let k=2/(n+1),e=v[0];for(let i=1;i<v.length;i++)e=v[i]*k+e*(1-k);return e;}
/** pivot swing high/low using bars up to index i, lookback L, forward-fill */
function swings(a,i,L){
  let hi=null,lo=null;
  // FIX: a pivot at p is only CONFIRMED once L bars after it exist and are
  // already observed at decision time i. So p can go no further than i-L.
  for(let p=L;p<=i-L;p++){
    let isH=true,isL=true;
    for(let j=1;j<=L;j++){
      if(a[p].h<=a[p-j].h||a[p].h<=a[p+j].h) isH=false;
      if(a[p].l>=a[p-j].l||a[p].l>=a[p+j].l) isL=false;
    }
    if(isH)hi=a[p].h; if(isL)lo=a[p].l;
  }
  return {hi,lo};
}
function run(useWeekday){
  const P={maxStopPts:30,minStopPts:3,targetR:1,dayMaxLossPts:60,earliest:'09:20',last:'15:10'};
  const WD={2:{earliest:'11:30',maxTrades:3},3:{earliest:'11:00',maxOrWidth:90},5:{earliest:'11:30',maxTrades:3}};
  const T=[];
  for(const [d,a] of byD){
    if(a.length<40) continue;
    const dow=new Date(d+'T00:00:00Z').getUTCDay();
    const rule=useWeekday?WD[dow]:null;
    const earliest=rule&&rule.earliest?rule.earliest:P.earliest;
    const maxTrades=rule&&rule.maxTrades?rule.maxTrades:Infinity;
    const maxOrW=rule&&rule.maxOrWidth?rule.maxOrWidth:null;
    let H=-1e9,L=1e9;
    for(let k=0;k<12&&k<a.length;k++){H=Math.max(H,a[k].h);L=Math.min(L,a[k].l);}
    if(!(H>L)) continue;
    const mid=(H+L)/2, orW=H-L;
    if(maxOrW!=null && orW>=maxOrW) continue;
    let dayPts=0, nT=0, open=null;
    for(let i=12;i<a.length;i++){
      const b=a[i];
      if(open){
        let ex=null,why=null;
        if(open.dir>0){ if(b.l<=open.stop){ex=open.stop;why='STOP';} else if(b.h>=open.tgt){ex=open.tgt;why='TGT';} }
        else { if(b.h>=open.stop){ex=open.stop;why='STOP';} else if(b.l<=open.tgt){ex=open.tgt;why='TGT';} }
        if(!ex){
          const e20=ema(a.slice(Math.max(0,i-60),i+1).map(x=>x.c),EMA_N);
          if((open.dir>0&&b.c<e20)||(open.dir<0&&b.c>e20)){ex=b.c;why='EMA';}
        }
        if(!ex && b.hm>='15:15'){ ex=b.c; why='TIME'; }
        if(ex!=null){ const pts=open.dir*(ex-open.entry); dayPts+=pts;
          T.push({d,dow,pts,why,dir:open.dir}); open=null; }
        if(open) continue;
      }
      if(dayPts<=-P.dayMaxLossPts) break;
      if(nT>=maxTrades) break;
      if(b.hm<earliest||b.hm>P.last) continue;
      if(i+1>=a.length) break;
      const bias=b.c>=mid?+1:-1;
      const sw=swings(a,i,SWING);
      let dir=null;
      if(bias>0 && sw.hi!=null && b.c>sw.hi) dir=+1;
      if(bias<0 && sw.lo!=null && b.c<sw.lo) dir=-1;
      if(!dir) continue;
      const entry=a[i+1].o; if(!(entry>0)) continue;
      let stop=dir>0?b.l:b.h;
      let risk=Math.abs(entry-stop);
      if(risk>P.maxStopPts){ stop=dir>0?entry-P.maxStopPts:entry+P.maxStopPts; risk=P.maxStopPts; }
      if(risk<P.minStopPts){ stop=dir>0?entry-P.minStopPts:entry+P.minStopPts; risk=P.minStopPts; }
      open={dir,entry,stop,tgt:entry+dir*risk*P.targetR};
      nT++; i++;
    }
  }
  return T;
}
const seg=(T,lo,hi)=>T.filter(t=>t.d>=lo&&t.d<=hi);
const stat=X=>{ if(!X.length)return null;
  const dm=new Map(); for(const t of X) dm.set(t.d,(dm.get(t.d)||0)+t.pts);
  const dn=[...dm.values()];
  return {pts:sum(X.map(x=>x.pts)),n:X.length,days:dn.length,
          green:100*dn.filter(v=>v>0).length/dn.length,
          t:mean(dn)/(sd(dn)/Math.sqrt(dn.length))}; };
console.log('PHASE 15 - CHAMPION PDHL on NIFTY (index points, before costs)\n');
console.log('  weekday rules |  window        trades   net pts    green days    t');
for(const wd of [true,false]){
  for(const [lbl,lo,hi] of [['DEV   2015-2019','2015-01-01','2019-12-31'],
                            ['VALID 2020-2022','2020-01-01','2022-12-31'],
                            ['TEST  2023-2026','2023-01-01','2099-12-31']]){
    const s=stat(seg(run(wd),lo,hi)); if(!s) continue;
    console.log(`  ${(wd?'ON ':'OFF').padEnd(13)} | ${lbl}  ${String(s.n).padStart(6)}  ${s.pts.toFixed(0).padStart(8)}   ${s.green.toFixed(0).padStart(3)}%  ${s.days.toString().padStart(5)}d  ${s.t.toFixed(2).padStart(6)}`);
  }
  console.log();
}
console.log('  NIFTY option round trip is roughly 55-70 pts-equivalent per trade at 1 lot;');
console.log('  a futures round trip is ~5 index points. Net points must clear that.');
