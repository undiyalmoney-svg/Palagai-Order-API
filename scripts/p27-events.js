#!/usr/bin/env node
/**
 * PHASE 2.7b — STATE -> EVENT CONVERSION
 * The four DEV+VALID survivors fire 20-40x per session: persistent states,
 * not tradeable events. Here each fires AT MOST ONCE PER SESSION, on the
 * first bar the condition becomes true (a causal transition). Entry remains
 * OPEN OF BAR i+1. If the effect was real it survives; if it was an artifact
 * of averaging over a persistent state, it collapses.
 * TEST WINDOW REMAINS CLOSED.
 */
const fs=require('fs');
const HOLD=9,ENTRY_FROM='09:45',ENTRY_TO='14:45',MIN_FWD=3;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const raw=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const C=raw.map(r=>({t:r.t,d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c}));
const N=C.length;
const sessStart=new Array(N);{let cur=null,st=0;for(let i=0;i<N;i++){if(C[i].d!==cur){cur=C[i].d;st=i;}sessStart[i]=st;}}
const days=[...new Set(C.map(x=>x.d))];
const dayRange=new Map();{for(const d of days){let s=-1,e=-1;for(let i=0;i<N;i++){if(C[i].d===d){if(s<0)s=i;e=i;}else if(s>=0)break;}dayRange.set(d,[s,e]);}}
const prevHi=new Array(N).fill(null),prevLo=new Array(N).fill(null);
{for(let di=1;di<days.length;di++){const[ps,pe]=dayRange.get(days[di-1]);const[cs,ce]=dayRange.get(days[di]);
 let hi=-1e9,lo=1e9;for(let k=ps;k<=pe;k++){hi=Math.max(hi,C[k].h);lo=Math.min(lo,C[k].l);}
 for(let k=cs;k<=ce;k++){prevHi[k]=hi;prevLo[k]=lo;}}}
function outcome(i,dir){
  if(i+1>=N||C[i+1].d!==C[i].d)return null;
  const fill=C[i+1].o,day=C[i].d;let last=fill,bars=0,mae=0,mfe=0;
  for(let k=i+1;k<=Math.min(i+HOLD,N-1);k++){if(C[k].d!==day)break;
    const up=C[k].h-fill,dn=C[k].l-fill;
    if(dir>0){mae=Math.min(mae,dn);mfe=Math.max(mfe,up);}else{mae=Math.min(mae,-up);mfe=Math.max(mfe,-dn);}
    last=C[k].c;bars=k-i;}
  if(bars<MIN_FWD)return null;
  return {d:day,hm:C[i].hm,dir,ret:dir*(last-fill),mae:-mae,mfe};
}
function clustered(rows){
  const b=new Map();for(const r of rows){if(!b.has(r.d))b.set(r.d,[]);b.get(r.d).push(r.ret);}
  const m=[...b.values()].map(v=>mean(v));const se=m.length>1?sd(m)/Math.sqrt(m.length):NaN;
  return {n:rows.length,sess:m.length,mean:mean(m),t:se>0?mean(m)/se:NaN,ci:se>0?1.96*se:NaN,
    win:rows.length?100*rows.filter(r=>r.ret>0).length/rows.length:0,
    mae:rows.length?mean(rows.map(r=>r.mae)):0,mfe:rows.length?mean(rows.map(r=>r.mfe)):0};
}
/** ONE event per session: first bar where cond(i) turns true. */
function events(cond){
  const out=[];
  for(const d of days){
    const[s,e]=dayRange.get(d);
    let orHi=-1e9,orLo=1e9;
    if(e-s<8)continue;
    for(let k=s;k<s+6&&k<=e;k++){orHi=Math.max(orHi,C[k].h);orLo=Math.min(orLo,C[k].l);}
    let sHi=-1e9,sLo=1e9;
    for(let i=s;i<=e;i++){
      sHi=Math.max(sHi,C[i].h);sLo=Math.min(sLo,C[i].l);   // includes bar i — causal at bar close
      if(i<s+6)continue;
      if(C[i].hm<ENTRY_FROM||C[i].hm>ENTRY_TO)continue;
      let sma=0,sc=0;for(let k=Math.max(0,i-19);k<=i;k++){sma+=C[k].c;sc++;}sma/=Math.max(1,sc);
      let atr=0,ac=0;for(let k=Math.max(1,i-19);k<=i;k++){atr+=Math.max(C[k].h-C[k].l,Math.abs(C[k].h-C[k-1].c),Math.abs(C[k].l-C[k-1].c));ac++;}
      atr=ac?atr/ac:0;
      const dir=cond({i,c:C[i],orHi,orLo,sHi,sLo,sma,atr,prevHi:prevHi[i],prevLo:prevLo[i]});
      if(dir){const o=outcome(i,dir);if(o)out.push(o);break;}   // ONE per session
    }
  }
  return out;
}
const WIN={DEV:['2015','2018-12-31'],VALID:['2019','2022-12-31']};
const seg=(r,w)=>r.filter(x=>x.d>=WIN[w][0]&&x.d<=WIN[w][1]);
let seed=555;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const byHm=new Map();for(let i=0;i<N;i++){if(!byHm.has(C[i].hm))byHm.set(C[i].hm,[]);byHm.get(C[i].hm).push(i);}
function control(sigs){const o=[];for(const s of sigs){const p=byHm.get(s.hm)||[];if(!p.length)continue;
  const j=p[Math.floor(rnd()*p.length)];const r=outcome(j,s.dir);if(r)o.push(r);}return o;}

// SIGNAL DIRECTIONS AS WRITTEN (inverse = negate the mean)
const E={
 'E-M4 first close beyond OR30 (breakout dir)': x=> x.c.c>x.orHi?1 : x.c.c<x.orLo?-1 : 0,
 'E-M5 first close beyond prior-day H/L'      : x=> x.prevHi==null?0 : x.c.c>x.prevHi?1 : x.c.c<x.prevLo?-1 : 0,
 'E-R3 first failed OR breakout (fade dir)'   : x=> (x.sHi>x.orHi&&x.c.c<x.orHi)?-1 : (x.sLo<x.orLo&&x.c.c>x.orLo)?1 : 0,
 'E-R2 first extension >1.5ATR from sma20'    : x=> (x.atr>0&&Math.abs(x.c.c-x.sma)>1.5*x.atr)?-Math.sign(x.c.c-x.sma):0,
};
console.log('ONE EVENT PER SESSION — entry at next bar OPEN, 45-min hold, session-clustered t\n');
console.log('signal                                          n    sess | DEV mean   t     95%CI      win% | VALID mean   t    | CTRL(DEV)');
console.log('='.repeat(126));
for(const[name,fn]of Object.entries(E)){
  const sg=events(fn);
  const dev=clustered(seg(sg,'DEV')),val=clustered(seg(sg,'VALID')),ctl=clustered(seg(control(sg),'DEV'));
  console.log(`${name.padEnd(46)}${String(dev.n).padStart(5)} ${String(dev.sess).padStart(5)} |`+
   `${dev.mean.toFixed(2).padStart(9)} ${dev.t.toFixed(2).padStart(6)}  +/-${dev.ci.toFixed(2).padStart(5)} ${dev.win.toFixed(1).padStart(6)} |`+
   `${val.mean.toFixed(2).padStart(10)} ${val.t.toFixed(2).padStart(6)}  |`+
   `${ctl.mean.toFixed(2).padStart(8)} (t=${ctl.t.toFixed(2)})`);
}
console.log('\nNOTE: a significantly NEGATIVE mean means the INVERSE signal is the tradeable one.');
console.log('Economic scale: 1 index pt ~ Rs32.5 gross on 1 NIFTY lot (65 x delta 0.5).');
console.log('Round-trip cost ~Rs57-71 + theta ~Rs40  =>  need ~3.0-3.4 index pts just to break even.');
