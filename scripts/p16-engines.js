#!/usr/bin/env node
/** PHASE 16 — the three remaining production engines, ported and tested on NIFTY.
 *  NO LOOK-AHEAD: every indicator uses bars[0..i] only; entry fills at bars[i+1].open.
 *  A: smart-pullback-pro  EMA50 breakout+retest+strong body+close-third, OR-mid, 3R,
 *     skip-sideways, entry 10:15-14:30, stop cap 30pt, day stop 60pt
 *  B: index-rule (donchian-20, EMA bias, eod/ema exit) - representative of the
 *     donch/vol_expand/swing family that shares this engine
 *  C: kutty-scalp  fixed Rs600 target / Rs200 stop (3:1), entry 10:00-14:30 */
const fs=require('fs');
const raw=JSON.parse(fs.readFileSync('research-data/intraday/nifty5m.json','utf8'));
const byD=new Map();
for(const r of raw){const d=r.t.slice(0,10);if(!byD.has(d))byD.set(d,[]);byD.get(d).push({hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c});}
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const emaLast=(v,n)=>{if(v.length<n)return null;let k=2/(n+1),e=v[0];for(let i=1;i<v.length;i++)e=v[i]*k+e*(1-k);return e;};
function atrSeriesOf(a,i){const trs=[];for(let j=1;j<=i;j++)trs.push(Math.max(a[j].h-a[j].l,Math.abs(a[j].h-a[j-1].c),Math.abs(a[j].l-a[j-1].c)));
  const out=[];let w=0;for(let j=0;j<trs.length;j++){w+=trs[j];if(j>=14)w-=trs[j-14];if(j>=13)out.push(w/14);}return out;}
function run(mode){
  const T=[];
  for(const [d,a] of byD){
    if(a.length<45) continue;
    let H=-1e9,L=1e9; for(let k=0;k<12&&k<a.length;k++){H=Math.max(H,a[k].h);L=Math.min(L,a[k].l);}
    if(!(H>L)) continue; const mid=(H+L)/2;
    let dayPts=0, open=null, lastSig=-99;
    const ENTRY_S = mode==='C' ? '10:00' : '10:15';
    const ENTRY_E = '14:30';
    for(let i=12;i<a.length-1;i++){
      const b=a[i];
      if(open){
        let ex=null,why=null;
        if(open.dir>0){ if(b.l<=open.stop){ex=open.stop;why='STOP';} else if(b.h>=open.tgt){ex=open.tgt;why='TGT';} }
        else { if(b.h>=open.stop){ex=open.stop;why='STOP';} else if(b.l<=open.tgt){ex=open.tgt;why='TGT';} }
        if(!ex && b.hm>='15:15'){ex=b.c;why='TIME';}
        if(ex!=null){const pts=open.dir*(ex-open.entry);dayPts+=pts;T.push({d,pts,why});open=null;}
        if(open) continue;
      }
      if(dayPts<=-60) break;
      if(b.hm<ENTRY_S||b.hm>ENTRY_E) continue;
      const closes=a.slice(0,i+1).map(x=>x.c);
      const ema50=emaLast(closes,50); if(ema50==null) continue;
      const prev=a[i-1];
      let dir=null, stopCap=30;
      if(mode==='A'){
        if(i-lastSig<15) continue;
        // sideways filter
        const atrS=atrSeriesOf(a,i);
        if(atrS.length>=20){
          const atr=atrS[atrS.length-1];
          const atrSma=mean(atrS.slice(-20));
          const emaPrev=emaLast(closes.slice(0,-5),50);
          if(emaPrev!=null && atr<atrSma*0.7 && Math.abs(ema50-emaPrev)<10) continue;
        }
        const body=Math.abs(b.c-b.o), rng=b.h-b.l;
        const bodies=a.slice(i-9,i+1).map(x=>Math.abs(x.c-x.o));
        const avgBody=mean(bodies);
        const strongBull=b.c>b.o&&body>avgBody*0.6, strongBear=b.c<b.o&&body>avgBody*0.6;
        const thirdBull=rng>0&&(b.c-b.l)/rng>=0.66, thirdBear=rng>0&&(b.h-b.c)/rng>=0.66;
        const buyBO=b.c>prev.h&&b.c>ema50, sellBO=b.c<prev.l&&b.c<ema50;
        const buyRT=b.l<=prev.l+10, sellRT=b.h>=prev.h-10;
        if(buyBO&&buyRT&&strongBull&&thirdBull&&b.c>=mid) dir=+1;
        else if(sellBO&&sellRT&&strongBear&&thirdBear&&b.c<mid) dir=-1;
      } else if(mode==='B'){
        const w=a.slice(Math.max(0,i-20),i);              // donchian 20, prior bars only
        if(w.length<20) continue;
        const dh=Math.max(...w.map(x=>x.h)), dl=Math.min(...w.map(x=>x.l));
        const bias=b.c>ema50?+1:-1;
        if(bias>0&&b.c>dh) dir=+1; else if(bias<0&&b.c<dl) dir=-1;
      } else {
        const bias=b.c>ema50?+1:-1;
        if(bias>0&&b.c>prev.h) dir=+1; else if(bias<0&&b.c<prev.l) dir=-1;
      }
      if(!dir) continue;
      const entry=a[i+1].o; if(!(entry>0)) continue;
      let stop,tgt;
      if(mode==='C'){ const RPP=75; stop=entry-dir*(200/RPP); tgt=entry+dir*(600/RPP); }
      else{
        let s=dir>0?b.l:b.h; let risk=Math.abs(entry-s);
        if(risk>stopCap){risk=stopCap;} if(risk<3){risk=3;}
        stop=entry-dir*risk; tgt=entry+dir*risk*(mode==='A'?3:2);
      }
      open={dir,entry,stop,tgt}; lastSig=i; i++;
    }
  }
  return T;
}
const seg=(T,lo,hi)=>T.filter(t=>t.d>=lo&&t.d<=hi);
const stat=(X,COST)=>{ if(!X.length)return null;
  const dm=new Map(), dc=new Map();
  for(const t of X){ dm.set(t.d,(dm.get(t.d)||0)+t.pts); dc.set(t.d,(dc.get(t.d)||0)+1); }
  const dn=[...dm.keys()].map(k=>dm.get(k)-COST*dc.get(k));
  const raw=[...dm.values()];
  return {pts:sum(X.map(x=>x.pts))-COST*X.length,n:X.length,days:dn.length,
    green:100*raw.filter(v=>v>0).length/raw.length,
    greenNet:100*dn.filter(v=>v>0).length/dn.length,
    tradesPerDay:X.length/dn.length,
    per:sum(X.map(x=>x.pts))/X.length-COST,
    t:mean(dn)/(sd(dn)/Math.sqrt(dn.length))}; };
const NAMES={A:'smart-pullback-pro (EMA50 breakout - 3R)',B:'index-rule (donchian-20 + EMA bias - 2R)',C:'kutty-scalp (Rs600 tgt / Rs200 stop)'};
console.log('GREEN-DAY RATE BEFORE vs AFTER COSTS   (TEST window 2023-2026)\n');
console.log('  engine                  trades/day | GREEN DAYS: gross  after futures(5pt)  after options(60pt)');
for(const m of ['C','B','A']){
  const T=seg(run(m),'2023-01-01','2099-12-31');
  const g0=stat(T,0), g5=stat(T,5), g60=stat(T,60);
  console.log(`  ${NAMES[m].slice(0,34).padEnd(36)} ${g0.tradesPerDay.toFixed(1).padStart(4)} |  ${g0.green.toFixed(0).padStart(4)}%          ${g5.greenNet.toFixed(0).padStart(4)}%             ${g60.greenNet.toFixed(0).padStart(4)}%`);
}
console.log();
console.log('  net points/day after futures cost:');
for(const m of ['C','B','A']){
  const T=seg(run(m),'2023-01-01','2099-12-31');
  const s5=stat(T,5), s0=stat(T,0);
  console.log(`    ${NAMES[m].slice(0,34).padEnd(36)} gross ${(s0.pts/s0.days).toFixed(2).padStart(6)} pts/day   after cost ${(s5.pts/s5.days).toFixed(2).padStart(7)} pts/day`);
}
console.log('\n  cost reference: NIFTY futures round trip ~5 index pts; options ~55-70 pts-equivalent.');
