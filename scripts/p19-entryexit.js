#!/usr/bin/env node
/** PHASE 19 — ENTRY x EXIT matrix on mid-cap stocks. 120-min OR breakout base.
 *  ENTRIES: immediate | retest | delay3 | second | strongbody
 *  EXITS:   time | stop1.5W | trail1W | trail1.5W | emacross | partial1R
 *  Rs250,000 notional, MIS charges, slip 0.01%/side. DEV-select, VALID/TEST honest. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, ORB=24, PER=250000, SLIP=+(process.env.SLIP??0.01);
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
/** find entry bar index for a given entry rule; null = no trade */
function entryIdx(a,bi,dir,lvl,W,ENT){
  if(ENT==='immediate') return bi+1;
  if(ENT==='delay3')    return bi+3<a.length-1?bi+3:null;
  if(ENT==='strongbody'){
    const b=a[bi], body=Math.abs(b.c-b.o);
    const avg=mean(a.slice(Math.max(0,bi-9),bi+1).map(x=>Math.abs(x.c-x.o)));
    return body>avg*0.6?bi+1:null;
  }
  if(ENT==='retest'){                      // wait for price to come back to the OR level
    for(let j=bi+1;j<Math.min(bi+13,a.length-1);j++){
      if(a[j].hm>='14:45') return null;
      if(dir>0 && a[j].l<=lvl) return j+1;
      if(dir<0 && a[j].h>=lvl) return j+1;
    }
    return null;
  }
  if(ENT==='second'){                      // dummy: require a SECOND cross of the level
    let back=false;
    for(let j=bi+1;j<Math.min(bi+25,a.length-1);j++){
      if(a[j].hm>='14:45') return null;
      if(!back){ if((dir>0&&a[j].c<lvl)||(dir<0&&a[j].c>lvl)) back=true; }
      else { if((dir>0&&a[j].c>lvl)||(dir<0&&a[j].c<lvl)) return j+1; }
    }
    return null;
  }
  return null;
}
function run(ENT,EXI){
  let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
  const T=[];
  for(const d of dates){
    const cands=[];
    for(const [sym,bs] of S){
      const a=bs.get(d); if(!a||a.length<ORB+14) continue;
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
      cands.push({sym,a,bi,dir,W:H-L,lvl:dir>0?H:L});
    }
    if(!cands.length) continue;
    for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
    const c=cands[0], a=c.a;
    const e=entryIdx(a,c.bi,c.dir,c.lvl,c.W,ENT);
    if(e==null||e>=a.length-1) continue;
    const raw=a[e].o; if(!(raw>0)) continue;
    const fill=raw*(1+c.dir*SLIP/100);
    const qty=Math.floor(PER/fill); if(qty<1) continue;
    const stopD=1.5*c.W;
    let px=null, peak=0, halfDone=false, realized=0, q=qty;
    for(let j=e;j<a.length;j++){
      const b=a[j];
      const adv=c.dir*((c.dir>0?b.l:b.h)-fill), fav=c.dir*((c.dir>0?b.h:b.l)-fill);
      if(b.hm>='15:15'){px=b.c;break;}
      if(EXI!=='time'&&adv<=-stopD){px=fill-c.dir*stopD;break;}
      if(EXI==='partial1R'&&!halfDone&&fav>=stopD){ realized+=c.dir*(fill+c.dir*stopD-fill)*(qty/2); q=qty-Math.floor(qty/2); halfDone=true; }
      peak=Math.max(peak,fav);
      if(EXI==='trail1W'&&peak>=1.0*c.W&&fav<=peak-1.0*c.W){px=b.c;break;}
      if(EXI==='trail1.5W'&&peak>=1.5*c.W&&fav<=peak-1.5*c.W){px=b.c;break;}
      if(EXI==='emacross'){
        const e20=emaLast(a.slice(0,j+1).map(x=>x.c),20);
        if(e20!=null&&((c.dir>0&&b.c<e20)||(c.dir<0&&b.c>e20))){px=b.c;break;}
      }
      if(j===a.length-1)px=b.c;
    }
    if(px==null) continue;
    const ex=px*(1-c.dir*SLIP/100);
    const gross=realized + c.dir*(ex-fill)*q;
    const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    T.push({d,net:gross-chg});
  }
  return T;
}
const seg=(T,lo,hi)=>T.filter(t=>t.d>=lo&&t.d<=hi);
const st=X=>{ if(!X.length)return {net:0,n:0,t:0};
  const dm=new Map(); for(const t of X) dm.set(t.d,(dm.get(t.d)||0)+t.net);
  const dn=[...dm.values()];
  return {net:sum(X.map(x=>x.net)),n:X.length,t:mean(dn)/(sd(dn)/Math.sqrt(dn.length))}; };
const ENTS=['immediate','retest','delay3','second','strongbody'];
const EXIS=['time','stop1.5W','trail1W','trail1.5W','emacross','partial1R'];
console.log('PHASE 19 - ENTRY x EXIT MATRIX (mid-caps, Rs250k, DEV-selected)\n');
console.log('  entry        exit          n     DEV net   VALID net    TEST net   TESTt');
const rows=[];
for(const ENT of ENTS) for(const EXI of EXIS){
  const T=run(ENT,EXI); if(T.length<150) continue;
  const D=st(seg(T,'2018-01-01','2019-12-31')),V=st(seg(T,'2020-01-01','2022-12-31')),Z=st(seg(T,'2023-01-01','2099-12-31'));
  rows.push({ENT,EXI,D,V,Z,n:T.length});
  console.log(`  ${ENT.padEnd(12)} ${EXI.padEnd(11)} ${String(T.length).padStart(5)} ${D.net.toFixed(0).padStart(10)} ${V.net.toFixed(0).padStart(11)} ${Z.net.toFixed(0).padStart(11)}  ${Z.t.toFixed(2).padStart(5)}`);
}
const all=rows.filter(r=>r.D.net>0&&r.V.net>0&&r.Z.net>0).sort((a,b)=>b.Z.t-a.Z.t);
console.log(`\n  POSITIVE IN ALL THREE WINDOWS: ${all.length} of ${rows.length}`);
for(const r of all) console.log(`    ${r.ENT.padEnd(12)} ${r.EXI.padEnd(11)} DEV ${r.D.net.toFixed(0).padStart(8)} VALID ${r.V.net.toFixed(0).padStart(8)} TEST ${r.Z.net.toFixed(0).padStart(8)}  t=${r.Z.t.toFixed(2)}`);
console.log('\n  BEST ENTRY (avg TEST across exits):');
for(const E of ENTS){ const g=rows.filter(r=>r.ENT===E); if(g.length) console.log(`    ${E.padEnd(12)} ${(mean(g.map(r=>r.Z.net))).toFixed(0).padStart(9)}`); }
console.log('  BEST EXIT (avg TEST across entries):');
for(const X of EXIS){ const g=rows.filter(r=>r.EXI===X); if(g.length) console.log(`    ${X.padEnd(12)} ${(mean(g.map(r=>r.Z.net))).toFixed(0).padStart(9)}`); }
