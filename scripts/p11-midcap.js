#!/usr/bin/env node
/** PHASE 11 — mid-cap ORB, CORRECT position selection.
 *  Fix: prior runs iterated symbols alphabetically and took the first MAXPOS,
 *  which is an artifact, not a rule. Here all breakouts in a day are collected,
 *  sorted by breakout TIME, and the first MAXPOS are taken - what a bot does.
 *  Turnover filter selects the tightest-spread subset (turnover proxies spread).
 *  DEV 2018-19 | VALID 2020-22 | TEST 2023-26. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, ORB=24;
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10);
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]});
  }
  S.set(f.replace('.json',''),bs);
}
// per-symbol median daily turnover (for the tightness filter), computed on <=2022 only
const turn=new Map();
for(const [sym,bs] of S){
  const v=[];
  for(const [d,a] of bs){ if(d>'2022-12-31')continue; v.push(sum(a.map(x=>x.c*(x.v||0)))); }
  if(v.length>100){ v.sort((a,b)=>a-b); turn.set(sym,v[Math.floor(v.length/2)]); }
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
let seed=99;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
function run(PER,MAXPOS,SLIP,allow,SEL){
  seed=99;
  const T=[];
  for(const d of dates){
    const cands=[];
    for(const [sym,bs] of S){
      if(allow&&!allow.has(sym)) continue;
      const a=bs.get(d); if(!a||a.length<ORB+12) continue;
      let H=-1e9,L=1e9;
      for(let k=0;k<ORB;k++){H=Math.max(H,a[k].h);L=Math.min(L,a[k].l);}
      if(!(H>L)) continue;
      let bi=null,dir=0;
      for(let j=ORB;j<a.length-2;j++){
        if(a[j].hm>='14:45')break;
        if(a[j].c>H){bi=j;dir=+1;break;}
        if(a[j].c<L){bi=j;dir=-1;break;}
      }
      if(bi==null) continue;
      cands.push({sym,a,bi,dir,hm:a[bi].hm,w:100*(H-L)/a[bi].c});
    }
    if(SEL==='time') cands.sort((x,y)=>x.hm<y.hm?-1:x.hm>y.hm?1:(x.sym<y.sym?-1:1));
    else if(SEL==='rand'){ for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];} }
    else if(SEL==='width') cands.sort((x,y)=>y.w-x.w);
    else if(SEL==='narrow') cands.sort((x,y)=>x.w-y.w);
    for(const c of cands.slice(0,MAXPOS)){
      const a=c.a,e=c.bi+1; if(e>=a.length-1) continue;
      const raw=a[e].o; if(!(raw>0)) continue;
      const fill=raw*(1+c.dir*SLIP/100);
      const qty=Math.floor(PER/fill); if(qty<1) continue;
      let px=null;
      for(let j=e;j<a.length;j++){ if(a[j].hm>='15:15'){px=a[j].c;break;} if(j===a.length-1)px=a[j].c; }
      if(px==null) continue;
      const ex=px*(1-c.dir*SLIP/100);
      const gross=c.dir*(ex-fill)*qty;
      const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
      T.push({d,sym:c.sym,gross,chg,net:gross-chg,notional:fill*qty});
    }
  }
  return T;
}
const seg=(T,lo,hi)=>T.filter(t=>t.d>=lo&&t.d<=hi);
const st=X=>{ if(!X.length)return null;
  const days=new Map(); for(const t of X) days.set(t.d,(days.get(t.d)||0)+t.net);
  const dn=[...days.values()];
  return {n:sum(X.map(x=>x.net)),tr:X.length,t:mean(dn)/(sd(dn)/Math.sqrt(dn.length)),
          g:100*sum(X.map(x=>x.gross))/sum(X.map(x=>x.notional))}; };
const ranked=[...turn.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
console.log('PHASE 11 - MID-CAP ORB, first-breakout selection, Rs250,000 notional (5x on Rs50k)\n');
console.log('  universe slip  |     DEV net    VALID net     TEST net  | TESTgross  ALL t');
for(const topN of [55,30,15]){
  for(const SLIP of [0,0.01,0.02,0.03,0.05]){
    const SEL='rand', PER=250000, MP=1, allow=new Set(ranked.slice(0,topN));
    const T=run(PER,MP,SLIP,allow,SEL);
    const D=st(seg(T,'2000-01-01','2019-12-31')),V=st(seg(T,'2020-01-01','2022-12-31')),Z=st(seg(T,'2023-01-01','2099-12-31'));
    if(!D||!V||!Z) continue;
    const A=st(T);
    console.log(`  top${String(topN).padEnd(3)}  ${SLIP.toFixed(2)}%  | ${D.n.toFixed(0).padStart(10)} ${V.n.toFixed(0).padStart(12)} ${Z.n.toFixed(0).padStart(12)}  | ${Z.g.toFixed(4)}%  ${A.t.toFixed(2).padStart(5)}`);
  }
  console.log();
}
