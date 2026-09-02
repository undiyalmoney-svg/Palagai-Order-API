#!/usr/bin/env node
/** PHASE 17 — the three production engines run on MID-CAP STOCKS.
 *  Point-based NIFTY params converted to price-relative terms:
 *    stop cap 30pt on ~22,000 NIFTY  = 0.136% of price
 *    kutty Rs200 stop / Rs600 target on 75/pt = 2.67pt/8pt = 0.012%/0.036%
 *  Structural stop (signal bar low/high) capped at STOPCAP%, floored at 0.05%.
 *  Rs250,000 notional (5x MIS on Rs50k), 1 position/day, MIS charges,
 *  slippage 0.01%/side.  DEV 2018-19 | VALID 2020-22 | TEST 2023-26. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, PER=250000, SLIP=+(process.env.SLIP??0.01);
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const emaLast=(v,n)=>{if(v.length<n)return null;let k=2/(n+1),e=v[0];for(let i=1;i<v.length;i++)e=v[i]*k+e*(1-k);return e;};
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10);
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});
  }
  S.set(f.replace('.json',''),bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
/** returns list of {sym,a,i,dir,stopPx} signals for a day under a given engine */
function signalsFor(mode,a){
  const out=[];
  let H=-1e9,L=1e9; for(let k=0;k<12&&k<a.length;k++){H=Math.max(H,a[k].h);L=Math.min(L,a[k].l);}
  if(!(H>L)) return out; const mid=(H+L)/2;
  const ENTRY_S = mode==='C'?'10:00':'10:15';
  let lastSig=-99;
  for(let i=12;i<a.length-1;i++){
    const b=a[i];
    if(b.hm<ENTRY_S||b.hm>'14:30') continue;
    const closes=a.slice(0,i+1).map(x=>x.c);
    const ema50=emaLast(closes,50); if(ema50==null) continue;
    const prev=a[i-1];
    let dir=null;
    if(mode==='A'){
      if(i-lastSig<15) continue;
      const body=Math.abs(b.c-b.o), rng=b.h-b.l;
      const avgBody=mean(a.slice(i-9,i+1).map(x=>Math.abs(x.c-x.o)));
      const strongBull=b.c>b.o&&body>avgBody*0.6, strongBear=b.c<b.o&&body>avgBody*0.6;
      const thirdBull=rng>0&&(b.c-b.l)/rng>=0.66, thirdBear=rng>0&&(b.h-b.c)/rng>=0.66;
      const tol=0.0005*b.c;                       // retestTolerancePts 10 on 22000 = 0.045%
      if(b.c>prev.h&&b.c>ema50&&b.l<=prev.l+tol&&strongBull&&thirdBull&&b.c>=mid) dir=+1;
      else if(b.c<prev.l&&b.c<ema50&&b.h>=prev.h-tol&&strongBear&&thirdBear&&b.c<mid) dir=-1;
    } else if(mode==='B'){
      const w=a.slice(Math.max(0,i-20),i); if(w.length<20) continue;
      const dh=Math.max(...w.map(x=>x.h)), dl=Math.min(...w.map(x=>x.l));
      if(b.c>ema50&&b.c>dh) dir=+1; else if(b.c<ema50&&b.c<dl) dir=-1;
    } else {
      if(b.c>ema50&&b.c>prev.h) dir=+1; else if(b.c<ema50&&b.c<prev.l) dir=-1;
    }
    if(!dir) continue;
    out.push({a,i,dir,mid}); lastSig=i;
  }
  return out;
}
function run(mode){
  const ATRMULT = +(process.env.ATRMULT ?? (mode==='C'?1.0:1.5));
  const TGT_R   = mode==='A'?3:mode==='B'?2:3;   // kutty is 3:1 by construction
  const T=[];
  for(const d of dates){
    const cands=[];
    for(const [sym,bs] of S){
      const a=bs.get(d); if(!a||a.length<60) continue;
      const sg=signalsFor(mode,a);
      if(sg.length) cands.push({sym,...sg[0]});
    }
    if(!cands.length) continue;
    for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
    const c=cands[0], a=c.a, i=c.i, e=i+1;
    if(e>=a.length-1) continue;
    const raw=a[e].o; if(!(raw>0)) continue;
    const fill=raw*(1+c.dir*SLIP/100);
    const qty=Math.floor(PER/fill); if(qty<1) continue;
    // ATR(14)-scaled stop: the NIFTY point caps translate to ~1.5x ATR (others)
    // and ~0.15x ATR (kutty). Scale to each STOCK's own volatility instead.
    let tr=0,cnt=0;
    for(let j=Math.max(1,i-13);j<=i;j++){ tr+=Math.max(a[j].h-a[j].l,Math.abs(a[j].h-a[j-1].c),Math.abs(a[j].l-a[j-1].c)); cnt++; }
    const atr=cnt?tr/cnt:0;
    let riskPx=Math.abs(fill-(c.dir>0?a[i].l:a[i].h));
    const cap=ATRMULT*atr, flo=0.25*atr;
    if(!(atr>0)) continue;
    if(riskPx>cap) riskPx=cap; if(riskPx<flo) riskPx=flo;
    const stop=fill-c.dir*riskPx, tgt=fill+c.dir*riskPx*TGT_R;
    let px=null,why=null;
    for(let j=e;j<a.length;j++){
      const bb=a[j];
      if(c.dir>0){ if(bb.l<=stop){px=stop;why='STOP';break;} if(bb.h>=tgt){px=tgt;why='TGT';break;} }
      else { if(bb.h>=stop){px=stop;why='STOP';break;} if(bb.l<=tgt){px=tgt;why='TGT';break;} }
      if(bb.hm>='15:15'){px=bb.c;why='TIME';break;}
      if(j===a.length-1){px=bb.c;why='EOD';}
    }
    if(px==null) continue;
    const ex=px*(1-c.dir*SLIP/100);
    const gross=c.dir*(ex-fill)*qty;
    const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    T.push({d,sym:c.sym,gross,chg,net:gross-chg,why,notional:fill*qty});
  }
  return T;
}
const seg=(T,lo,hi)=>T.filter(t=>t.d>=lo&&t.d<=hi);
const st=X=>{ if(!X.length)return null;
  const dm=new Map(); for(const t of X) dm.set(t.d,(dm.get(t.d)||0)+t.net);
  const dn=[...dm.values()];
  return {n:X.length,net:sum(X.map(x=>x.net)),
    g:100*sum(X.map(x=>x.gross))/sum(X.map(x=>x.notional)),
    green:100*dn.filter(v=>v>0).length/dn.length,
    t:mean(dn)/(sd(dn)/Math.sqrt(dn.length))}; };
const NAMES={A:'smart-pullback-pro',B:'index-rule donch-20',C:'kutty-scalp'};
console.log(`THE THREE ENGINES ON MID-CAP STOCKS - ATR-SCALED STOPS (mult ${process.env.ATRMULT??'1.5/1.0'}, slip ${SLIP}%/side)`);
console.log('  charge rate at Rs250k = 0.0541% of notional\n');
for(const m of ['A','B','C']){
  const T=run(m);
  console.log(`===== ${NAMES[m]} =====`);
  console.log('  window            trades      NET Rs   gross%   green days     t');
  for(const [lbl,lo,hi] of [['DEV   2018-2019','2018-01-01','2019-12-31'],
                            ['VALID 2020-2022','2020-01-01','2022-12-31'],
                            ['TEST  2023-2026','2023-01-01','2099-12-31']]){
    const s=st(seg(T,lo,hi));
    if(!s){console.log(`  ${lbl}   no trades`);continue;}
    console.log(`  ${lbl}  ${String(s.n).padStart(6)}  ${s.net.toFixed(0).padStart(10)}  ${s.g.toFixed(4)}%   ${s.green.toFixed(0).padStart(3)}%      ${s.t.toFixed(2).padStart(6)}`);
  }
  console.log();
}
