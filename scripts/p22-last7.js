#!/usr/bin/env node
/** ORB-retest hold-full, HONEST sizing (notional = LEV x current equity),
 *  last 7 months, mid-cap stocks. Shows every trade + monthly + running equity. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, ORB=24, SLIP=+(process.env.SLIP??0.02), LEV=+(process.env.LEV??1);
const START=+(process.env.EQ??50000);
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d<'2026-02-01')continue;
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});
  }
  if(bs.size)S.set(f.replace('.json',''),bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
function sig(a){
  let H=-1e9,L=1e9; for(let k=0;k<ORB;k++){H=Math.max(H,a[k].h);L=Math.min(L,a[k].l);}
  if(!(H>L)) return null; const W=H-L;
  let bi=null,dir=0;
  for(let i=ORB;i<a.length-2;i++){ if(a[i].hm>='14:45')break;
    if(a[i].c>H){bi=i;dir=1;break;} if(a[i].c<L){bi=i;dir=-1;break;} }
  if(bi==null) return null;
  const lvl=dir>0?H:L; let ri=null;
  for(let j=bi+1;j<Math.min(bi+13,a.length-1);j++){ if(a[j].hm>='14:45')break;
    if(dir>0?a[j].l<=lvl:a[j].h>=lvl){ri=j;break;} }
  if(ri==null) return null;
  const e=ri+1; if(e>=a.length-1) return null;
  return {a,e,dir,W};
}
let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let eq=START; const rows=[]; const mo=new Map();
for(const d of dates){
  const cands=[];
  for(const [sym,bs] of S){ const a=bs.get(d); if(a&&a.length>=ORB+14){const t=sig(a); if(t){t.sym=sym;cands.push(t);}} }
  if(!cands.length) continue;
  for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
  const c=cands[0]; const fill=c.a[c.e].o*(1+c.dir*SLIP/100);
  const qty=Math.floor((eq*LEV)/fill); if(qty<1) continue;
  const stopD=1.5*c.W; let px=null,why='TIME';
  for(let j=c.e;j<c.a.length;j++){ const b=c.a[j]; const adv=c.dir*((c.dir>0?b.l:b.h)-fill);
    if(b.hm>='15:15'){px=b.c;why='TIME';break;} if(adv<=-stopD){px=fill-c.dir*stopD;why='STOP';break;} if(j===c.a.length-1)px=b.c; }
  const ex=px*(1-c.dir*SLIP/100);
  const gross=c.dir*(ex-fill)*qty, chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
  const net=gross-chg; eq+=net;
  mo.set(d.slice(0,7),(mo.get(d.slice(0,7))||0)+net);
  rows.push({d,sym:c.sym,side:c.dir>0?'BUY':'SELL',qty,fill,ex,why,net,eq});
}
console.log(`ORB-RETEST hold-full · HONEST sizing (${LEV}x current equity) · slip ${SLIP}%/side`);
console.log(`Rs${START.toLocaleString('en-IN')} start · mid-cap stocks · Feb-Aug 2026\n`);
console.log('date         stock          side  qty     entry     exit   why      net    equity');
console.log('-'.repeat(90));
for(const r of rows) console.log(`${r.d}   ${r.sym.padEnd(13)}${r.side.padEnd(5)}${String(r.qty).padStart(5)} ${r.fill.toFixed(2).padStart(9)} ${r.ex.toFixed(2).padStart(8)}  ${r.why.padEnd(4)} ${r.net.toFixed(0).padStart(7)} ${r.eq.toFixed(0).padStart(9)}`);
console.log('-'.repeat(90));
console.log('\nMONTH BY MONTH');
for(const m of [...mo.keys()].sort()) console.log(`  ${m}   ${mo.get(m)>=0?'+':''}${mo.get(m).toFixed(0).padStart(8)}   (${(100*mo.get(m)/START).toFixed(2)}%)`);
const w=rows.filter(r=>r.net>0).length;
const g=[...mo.values()].filter(v=>v>0).length;
console.log('\nRESULT');
console.log(`  trades ${rows.length}   winners ${w}  losers ${rows.length-w}  (win ${(100*w/rows.length).toFixed(0)}%)`);
console.log(`  green months ${g}/${mo.size}`);
console.log(`  start Rs${START}   end Rs${eq.toFixed(0)}   P/L Rs${(eq-START).toFixed(0)}  (${(100*(eq-START)/START).toFixed(2)}%)`);
console.log(`  best day +Rs${Math.max(...rows.map(r=>r.net)).toFixed(0)}   worst day Rs${Math.min(...rows.map(r=>r.net)).toFixed(0)}`);
