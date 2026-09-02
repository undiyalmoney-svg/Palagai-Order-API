#!/usr/bin/env node
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, SLIP=+(process.env.SLIP??0.02);
const RUNBARS=6, RUNPCT=+(process.env.RUNPCT??2.5), VOLMULT=+(process.env.VOLMULT??3.0);
const FROM=process.env.FROM||'2026-02-01';
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d<FROM)continue;
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]||0});
  }
  if(bs.size)S.set(f.replace('.json',''),bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
function findSignal(a){
  for(let i=25;i<a.length-2;i++){
    if(a[i].hm<'10:15'||a[i].hm>'14:30') continue;
    const run=(a[i].c-a[i-RUNBARS].c)/a[i-RUNBARS].c*100;
    const avgVol=mean(a.slice(i-20,i).map(x=>x.v)); if(avgVol<=0) continue;
    const climax=a[i].v>=VOLMULT*avgVol; const rng=a[i].h-a[i].l; if(rng<=0) continue;
    if(run>=RUNPCT&&climax&&(a[i].c-a[i].l)/rng<=0.34) return {i,fadeDir:-1};
    if(run<=-RUNPCT&&climax&&(a[i].h-a[i].c)/rng<=0.34) return {i,fadeDir:+1};
  }
  return null;
}
let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let eq=50000; const rows=[]; const mo=new Map();
for(const d of dates){
  const cands=[];
  for(const [sym,bs] of S){ const a=bs.get(d); if(a&&a.length>=45){const s=findSignal(a); if(s){s.a=a;s.sym=sym;cands.push(s);}} }
  if(!cands.length) continue;
  for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
  const c=cands[0], a=c.a, e=c.i+1; if(e>=a.length-1) continue;
  const dir=c.fadeDir, fill=a[e].o*(1+dir*SLIP/100), qty=Math.floor(eq/fill); if(qty<1) continue;
  let px=null; for(let j=e;j<a.length;j++){const b=a[j]; if(b.hm>='15:15'){px=b.c;break;} if(j===a.length-1)px=b.c;}
  const ex=px*(1-dir*SLIP/100), net=dir*(ex-fill)*qty-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
  eq+=net; mo.set(d.slice(0,7),(mo.get(d.slice(0,7))||0)+net);
  rows.push({d,sym:c.sym,side:dir>0?'BUY':'SELL',qty,fill,ex,net,eq});
}
console.log(`EXHAUSTION FADE · honest 1x sizing · slip ${SLIP}%/side · run>=${RUNPCT}% vol>=${VOLMULT}x`);
console.log(`Rs50,000 start · ${dates[0]} .. ${dates[dates.length-1]}\n`);
console.log('date         stock          side  qty     entry     exit       net    equity');
for(const r of rows) console.log(`${r.d}   ${r.sym.padEnd(13)}${r.side.padEnd(5)}${String(r.qty).padStart(5)} ${r.fill.toFixed(2).padStart(9)} ${r.ex.toFixed(2).padStart(8)} ${r.net.toFixed(0).padStart(7)} ${r.eq.toFixed(0).padStart(9)}`);
console.log('\nMONTH BY MONTH');
for(const m of [...mo.keys()].sort()) console.log(`  ${m}   ${mo.get(m)>=0?'+':''}${mo.get(m).toFixed(0).padStart(7)}  (${(100*mo.get(m)/50000).toFixed(2)}%)`);
const w=rows.filter(r=>r.net>0).length, g=[...mo.values()].filter(v=>v>0).length;
console.log(`\n  trades ${rows.length}  win ${(100*w/rows.length).toFixed(0)}%  · green months ${g}/${mo.size}`);
console.log(`  start Rs50000  end Rs${eq.toFixed(0)}  P/L Rs${(eq-50000).toFixed(0)} (${(100*(eq-50000)/50000).toFixed(1)}%)`);
if(rows.length) console.log(`  best +Rs${Math.max(...rows.map(r=>r.net)).toFixed(0)}  worst Rs${Math.min(...rows.map(r=>r.net)).toFixed(0)}`);
