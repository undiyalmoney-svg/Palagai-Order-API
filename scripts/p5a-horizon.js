#!/usr/bin/env node
/** PHASE 5.A — DUMMY-CONFIRMED 1H BREAKOUT, HELD FOR MULTIPLE DAYS.
 *
 *  PRE-REGISTERED BEFORE ANY RESULT IS SEEN:
 *    Hypothesis: the +Rs2.0/trade gross edge of the dummy-confirmed 1H breakout
 *    is real but is consumed by a 0.106% per-round-trip charge. If the edge
 *    persists (or grows) over a multi-day horizon, holding longer pays the toll
 *    once instead of ~20 times and can turn net positive.
 *
 *  FROZEN — copied verbatim from p4p-dummy.js, NOT re-tuned:
 *    first hour 09:15-10:15 -> 1H high/low; first 5-min close beyond the level
 *    is a DUMMY (observed, not taken); the dummy must reach +1R before its stop;
 *    only then the NEXT cross in the same direction is a REAL trade.
 *    Entry fill = NEXT bar open (never intrabar). Slippage 0.05%/side.
 *    Stop = the 1H candle close (a[11].c).
 *
 *  THE ONLY CHANGE: exit horizon H.
 *    H=0  -> exit 15:15 same day, MIS intraday charges (the original)
 *    H>0  -> exit 15:15 on the H-th following SESSION, CNC delivery charges
 *            (overnight => delivery; DP charge Rs15+GST applies per sell)
 *    Overnight gaps through the stop exit at the next open (GAPSTOP).
 *
 *  CAPITAL IS CONSTRAINED (this is what makes long holds costly):
 *    Rs50,000 total. A position occupies its slot until it exits. A signal is
 *    skipped if no slot is free. Conservative: a slot freed at 15:15 on day d
 *    is not reusable until day d+1.
 *
 *  TEST WINDOW (>=2023-01-01) EXCLUDED AT LOAD. DEV<=2019-12-31, VALID 2020-2022.
 *  Read-only. No broker imports. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS,estimateDeliveryRoundTripCharges:CNC}=require('../live/equity-charges.js');
const SLIP=0.05;
const DIR=process.argv[2];
const sum=a=>a.reduce((x,y)=>x+y,0);
const mean=a=>a.length?sum(a)/a.length:0;

// ---------- load ----------
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const s=f.replace('.json','');const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d>='2023-01-01')continue;          // TEST excluded
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});
  }
  S.set(s,bs);
}
const symDates=new Map();
for(const [s,bs] of S) symDates.set(s,[...bs.keys()].sort());
const dates=[...new Set([].concat(...[...symDates.values()]))].sort();

/** walk from bar e on the entry day, then across the next H sessions.
 *  returns {px, why, exitDate} */
function walkH(sym,d0,e,side,stop,H,useStop){
  const ds=symDates.get(sym), i0=ds.indexOf(d0);
  const last=Math.min(i0+H, ds.length-1);
  for(let di=i0; di<=last; di++){
    const day=ds[di], a=S.get(sym).get(day);
    const start = di===i0 ? e : 0;
    for(let j=start;j<a.length;j++){
      if(di===last && a[j].hm>='15:15') return {px:a[j].c,why:'HORIZON',exitDate:day};
      if(useStop){
        const g=side>0?a[j].o<=stop:a[j].o>=stop;
        if(g)return {px:a[j].o,why:di===i0?'STOP':'GAPSTOP',exitDate:day};
        const h=side>0?a[j].l<=stop:a[j].h>=stop;
        if(h)return {px:stop,why:'STOP',exitDate:day};
      }
      if(di===last && j===a.length-1) return {px:a[j].c,why:'HORIZON',exitDate:day};
    }
  }
  return null;
}

function run(H,PER,MAXPOS,useStop){
  const open=[];                                   // {exitDate}
  const T=[];
  for(const d of dates){
    for(let k=open.length-1;k>=0;k--) if(open[k].exitDate<d) open.splice(k,1);
    for(const [sym,bs] of S){
      if(open.length>=MAXPOS)break;
      const a=bs.get(d); if(!a||a.length<40)continue;
      let H1=-1e9,L1=1e9;
      for(let k=0;k<12;k++){H1=Math.max(H1,a[k].h);L1=Math.min(L1,a[k].l);}
      if(!(H1>L1))continue;
      const SL=a[11].c;
      for(const side of [+1,-1]){
        if(open.length>=MAXPOS)break;
        const lvl=side>0?H1:L1;
        let c1=null;
        for(let j=12;j<a.length-1;j++){
          if(a[j].hm>='14:30')break;
          if(side>0&&a[j].c>lvl){c1=j;break;}
          if(side<0&&a[j].c<lvl){c1=j;break;}}
        if(c1==null)continue;
        const de=c1+1; if(de>=a.length)continue;
        const dFill=a[de].o; if(!(dFill>0))continue;
        if(side>0&&!(SL<dFill))continue;
        if(side<0&&!(SL>dFill))continue;
        const dR=Math.abs(dFill-SL), dTgt=dFill+side*dR;
        let dOut=null;
        for(let j=de;j<a.length;j++){
          if(a[j].hm>='15:15'){dOut={px:a[j].c,why:'TIME',j};break;}
          const g=side>0?a[j].o<=SL:a[j].o>=SL;
          if(g){dOut={px:a[j].o,why:'STOP',j};break;}
          const hs=side>0?a[j].l<=SL:a[j].h>=SL;
          if(hs){dOut={px:SL,why:'STOP',j};break;}
          const ht=side>0?a[j].h>=dTgt:a[j].l<=dTgt;
          if(ht){dOut={px:dTgt,why:'WIN',j};break;}
          if(j===a.length-1){dOut={px:a[j].c,why:'TIME',j};}}
        if(!dOut)continue;
        if(!(side*(dOut.px-dFill)>0))continue;                 // dummy must WIN
        const from=(dOut.j!=null?dOut.j:de)+1;
        let c2=null;
        for(let j=from;j<a.length-1;j++){
          if(a[j].hm>='15:00')break;
          if(side>0&&a[j].c>lvl){c2=j;break;}
          if(side<0&&a[j].c<lvl){c2=j;break;}}
        if(c2==null)continue;
        const re=c2+1; if(re>=a.length)continue;
        const raw=a[re].o; if(!(raw>0))continue;
        const fill=raw*(1+side*SLIP/100);
        if(side>0&&!(SL<fill))continue;
        if(side<0&&!(SL>fill))continue;
        const qty=Math.floor(PER/fill); if(qty<1)continue;
        const out=walkH(sym,d,re,side,SL,H,useStop); if(!out)continue;
        const ex=out.px*(1-side*SLIP/100);
        const gross=side*(ex-fill)*qty;
        const chg=(H===0?MIS:CNC)({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
        T.push({d,exitDate:out.exitDate,sym,side,qty,fill,exit:ex,why:out.why,
                gross,chg,net:gross-chg,notional:fill*qty});
        open.push({exitDate:out.exitDate});
      }
    }
  }
  return T;
}

const CAP=50000;
console.log('PHASE 5.A - HOLDING THE DUMMY-CONFIRMED BREAKOUT LONGER');
console.log('signal frozen from p4p-dummy.js; only the exit horizon changes');
console.log('capital Rs50,000, slot-constrained, TEST(>=2023) excluded\n');

for(const [PER,MAXPOS] of [[10000,5],[25000,2],[50000,1]]){
  for(const useStop of [true,false]){
    console.log(`=== Rs${PER.toLocaleString('en-IN')} x ${MAXPOS} positions | stop: ${useStop?'1H close':'NONE (horizon only)'} ===`);
    console.log('  hold   trades   win%   gross Rs   charges Rs     NET Rs    on Rs50k   gross/tr  chg/tr   DEV net  VALID net');
    for(const H of [0,1,2,3,5,10,20]){
      const T=run(H,PER,MAXPOS,useStop);
      if(!T.length){console.log(`  ${String(H).padStart(4)}       0`);continue;}
      const g=sum(T.map(x=>x.gross)),c=sum(T.map(x=>x.chg)),n=g-c;
      const w=100*T.filter(x=>x.gross>0).length/T.length;
      const dev=sum(T.filter(x=>x.d<='2019-12-31').map(x=>x.net));
      const val=sum(T.filter(x=>x.d>='2020-01-01').map(x=>x.net));
      console.log(`  ${String(H).padStart(4)}  ${String(T.length).padStart(7)}   ${w.toFixed(0).padStart(3)}%  ${g.toFixed(0).padStart(9)}  ${c.toFixed(0).padStart(11)}  ${n.toFixed(0).padStart(9)}  ${(100*n/CAP).toFixed(1).padStart(7)}%  ${mean(T.map(x=>x.gross)).toFixed(1).padStart(8)}  ${mean(T.map(x=>x.chg)).toFixed(1).padStart(6)}  ${dev.toFixed(0).padStart(8)}  ${val.toFixed(0).padStart(9)}`);
    }
    console.log();
  }
}
