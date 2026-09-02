#!/usr/bin/env node
/** Backtest runner for orb-retest-v1. Read-only. Uses the SHIPPED module. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../../live/equity-charges.js');
const ST=require('./orb-retest-v1.js');
const DIR=process.env.EQDIR, SLIP=+(process.env.SLIP??0.01), LEV=+(process.env.LEV??5);
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
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
let eq=+(process.env.EQ??50000); const START=eq;
let peak=eq,maxDD=0; const T=[];
for(const d of dates){
  const cands=[];
  for(const [sym,bs] of S){
    const a=bs.get(d); if(!a) continue;
    const sig=ST.evaluate(a);
    if(sig) cands.push({sym,a,sig});
  }
  if(!cands.length) continue;
  for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
  const {sym,a,sig}=cands[0];
  const dir=sig.direction==='BUY'?1:-1;
  const fill=sig.entryPrice*(1+dir*SLIP/100);
  const qty=Math.floor((eq*LEV)/fill); if(qty<1){ if(eq<=0){console.log('  ACCOUNT WIPED on '+d);break;} continue; }
  let px=null; const stopDist=Math.abs(fill-sig.stopLoss);
  for(let j=sig.entryBarIndex;j<a.length;j++){
    const b=a[j];
    const adv=dir*((dir>0?b.l:b.h)-fill);
    if(b.hm>=sig.exitTime){px=b.c;break;}
    if(adv<=-stopDist){px=fill-dir*stopDist;break;}   // hold full to close, wide stop only
    if(j===a.length-1)px=b.c;
  }
  const realized=0,q=qty;
  if(px==null) continue;
  const ex=px*(1-dir*SLIP/100);
  const gross=realized+dir*(ex-fill)*q;
  const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
  const net=gross-chg;
  eq+=net; peak=Math.max(peak,eq); maxDD=Math.min(maxDD,eq-peak);
  T.push({d,sym,net,eq});
}
const seg=(lo,hi)=>T.filter(t=>t.d>=lo&&t.d<=hi);
const st=X=>{ if(!X.length)return null;
  const dm=new Map(); for(const t of X) dm.set(t.d,(dm.get(t.d)||0)+t.net);
  const dn=[...dm.values()];
  return {net:sum(X.map(x=>x.net)),n:X.length,days:dn.length,
    green:100*dn.filter(v=>v>0).length/dn.length,
    t:mean(dn)/(sd(dn)/Math.sqrt(dn.length))}; };
if(process.env.FROM){ const F=process.env.FROM,TO=process.env.TO||'2099';
  const R=T.filter(t=>t.d>=F&&t.d<=TO);
  console.log(`ORB-RETEST-V1  ${F} .. ${TO}   Rs${START.toLocaleString('en-IN')} start, ${LEV}x, slip ${SLIP}%/side\n`);
  console.log('date         stock            net       equity');
  let e2=START,pk=START,dd=0;
  const mo=new Map();
  for(const t of R){ e2+=t.net; pk=Math.max(pk,e2); dd=Math.min(dd,e2-pk);
    mo.set(t.d.slice(0,7),(mo.get(t.d.slice(0,7))||0)+t.net);
    console.log(`${t.d}   ${t.sym.padEnd(14)} ${t.net.toFixed(0).padStart(8)} ${e2.toFixed(0).padStart(10)}`); }
  const w=R.filter(x=>x.net>0).length;
  console.log(`\nMONTH BY MONTH`);
  for(const k of [...mo.keys()].sort()) console.log(`  ${k}   ${mo.get(k)>=0?'+':''}${mo.get(k).toFixed(0).padStart(8)}`);
  console.log(`\nRESULT  trades ${R.length}  winners ${w} losers ${R.length-w} (win ${(100*w/R.length).toFixed(0)}%)`);
  console.log(`  start Rs${START}   end Rs${e2.toFixed(0)}   P/L Rs${(e2-START).toFixed(0)}  (${(100*(e2-START)/START).toFixed(2)}%)`);
  console.log(`  max drawdown Rs${dd.toFixed(0)}`);
  console.log(`  best Rs${Math.max(...R.map(x=>x.net)).toFixed(0)}   worst Rs${Math.min(...R.map(x=>x.net)).toFixed(0)}`);
  process.exit(0); }
console.log(`ORB-RETEST-V1 - full record  (Rs${START.toLocaleString('en-IN')} start, ${LEV}x, slip ${SLIP}%/side)\n`);
console.log('  window            trades   days   NET Rs    green   t');
for(const [l,lo,hi] of [['DEV   2018-2019','2018-01-01','2019-12-31'],
                        ['VALID 2020-2022','2020-01-01','2022-12-31'],
                        ['TEST  2023-2026','2023-01-01','2099-12-31']]){
  const s=st(seg(lo,hi)); if(!s) continue;
  console.log(`  ${l}  ${String(s.n).padStart(6)} ${String(s.days).padStart(6)} ${s.net.toFixed(0).padStart(9)}   ${s.green.toFixed(0)}%  ${s.t.toFixed(2).padStart(5)}`);
}
const a=st(T);
console.log(`\n  ALL           ${String(a.n).padStart(6)} ${String(a.days).padStart(6)} ${a.net.toFixed(0).padStart(9)}   ${a.green.toFixed(0)}%  ${a.t.toFixed(2)}`);
console.log(`  trades on ${a.days} sessions = ${(a.n/a.days).toFixed(2)}/day  (no trade when no retest)`);
console.log(`  end equity Rs${eq.toFixed(0)}  from Rs${START}   max drawdown Rs${maxDD.toFixed(0)}`);
const yr=new Map();
for(const t of T){const y=t.d.slice(0,4); yr.set(y,(yr.get(y)||0)+t.net);}
console.log('\n  YEAR BY YEAR');
for(const y of [...yr.keys()].sort()) console.log(`    ${y}  ${yr.get(y)>=0?'+':''}${yr.get(y).toFixed(0).padStart(8)}`);
