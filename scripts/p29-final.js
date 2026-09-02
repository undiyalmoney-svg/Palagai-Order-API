#!/usr/bin/env node
/** PHASE 29 — EXHAUSTION FADE, FINAL: select the most-overextended (biggest run)
 *  exhaustion signal each day, fade it, hold to close. Full stress test. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, SLIP=+(process.env.SLIP??0.03), RB=6, RP=+(process.env.RP??2.5), VM=+(process.env.VM??3.0);
const MODE=process.env.MODE||'fade', VIEW=process.env.VIEW||'windows', FROM=process.env.FROM||'2000';
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const sum=a=>a.reduce((x,y)=>x+y,0);
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d<FROM)continue; if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]||0});
  }
  if(bs.size)S.set(f.replace('.json',''),bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
function sig(a){
  for(let i=25;i<a.length-2;i++){
    if(a[i].hm<'10:15'||a[i].hm>'14:30') continue;
    const run=(a[i].c-a[i-RB].c)/a[i-RB].c*100, av=mean(a.slice(i-20,i).map(x=>x.v)); if(av<=0) continue;
    const volx=a[i].v/av, rg=a[i].h-a[i].l; if(rg<=0) continue;
    if(run>=RP&&volx>=VM&&(a[i].c-a[i].l)/rg<=0.34) return {i,dir:-1,run:Math.abs(run)};
    if(run<=-RP&&volx>=VM&&(a[i].h-a[i].c)/rg<=0.34) return {i,dir:1,run:Math.abs(run)};
  }
  return null;
}
let eq=50000; const rows=[]; const mo=new Map();
for(const d of dates){
  let cands=[];
  for(const [sym,bs] of S){ const a=bs.get(d); if(a&&a.length>=45){const s=sig(a); if(s){s.a=a;s.sym=sym;cands.push(s);}} }
  if(!cands.length) continue;
  cands.sort((x,y)=>y.run-x.run);           // most overextended first
  const c=cands[0], a=c.a, e=c.i+1; if(e>=a.length-1) continue;
  const dir = MODE==='fade'? c.dir : -c.dir;
  const fill=a[e].o*(1+dir*SLIP/100), qty=Math.floor(eq/fill); if(qty<1) continue;
  let px=null; for(let j=e;j<a.length;j++){ if(a[j].hm>='15:15'){px=a[j].c;break;} if(j===a.length-1)px=a[j].c; }
  const ex=px*(1-dir*SLIP/100), net=dir*(ex-fill)*qty-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
  eq+=net; mo.set(d.slice(0,7),(mo.get(d.slice(0,7))||0)+net);
  rows.push({d,sym:c.sym,side:dir>0?'BUY':'SELL',qty,fill,ex,net,eq});
}
const seg=(lo,hi)=>rows.filter(x=>x.d>=lo&&x.d<=hi);
const st=D=>{const dm=new Map();for(const t of D)dm.set(t.d,(dm.get(t.d)||0)+t.net);const dn=[...dm.values()];
  return D.length?{net:sum(D.map(x=>x.net)),n:D.length,green:100*dn.filter(v=>v>0).length/dn.length,
  t:mean(dn)/(sd(dn)/Math.sqrt(dn.length))}:null;};
if(VIEW==='months'){
  console.log(`EXHAUSTION FADE (biggest-run select) · honest 1x · slip ${SLIP}% · ${dates[0]}..${dates[dates.length-1]}\n`);
  console.log('date         stock          side  qty     entry     exit      net    equity');
  for(const r of rows) console.log(`${r.d}   ${r.sym.padEnd(13)}${r.side.padEnd(5)}${String(r.qty).padStart(5)} ${r.fill.toFixed(2).padStart(9)} ${r.ex.toFixed(2).padStart(8)} ${r.net.toFixed(0).padStart(7)} ${r.eq.toFixed(0).padStart(9)}`);
  console.log('\nMONTH BY MONTH');
  for(const m of [...mo.keys()].sort()) console.log(`  ${m}  ${mo.get(m)>=0?'+':''}${mo.get(m).toFixed(0).padStart(7)} (${(100*mo.get(m)/50000).toFixed(1)}%)`);
  const w=rows.filter(r=>r.net>0).length,g=[...mo.values()].filter(v=>v>0).length;
  console.log(`\n  trades ${rows.length} win ${(100*w/rows.length).toFixed(0)}% · green months ${g}/${mo.size}`);
  console.log(`  Rs50000 -> Rs${eq.toFixed(0)}  P/L Rs${(eq-50000).toFixed(0)} (${(100*(eq-50000)/50000).toFixed(1)}%)`);
  console.log(`  best +Rs${Math.max(...rows.map(r=>r.net)).toFixed(0)} worst Rs${Math.min(...rows.map(r=>r.net)).toFixed(0)}`);
}else{
  const A=st(seg('2018-01-01','2019-12-31')),B=st(seg('2020-01-01','2022-12-31')),Z=st(seg('2023-01-01','2099-12-31')),ALL=st(rows);
  console.log(`  ${MODE.padEnd(9)} slip${SLIP} | DEV ${A.net.toFixed(0).padStart(7)} ${A.green.toFixed(0)}% | VAL ${B.net.toFixed(0).padStart(7)} ${B.green.toFixed(0)}% | TEST ${Z.net.toFixed(0).padStart(7)} ${Z.green.toFixed(0)}% t${Z.t.toFixed(2)} | ALL n${ALL.n} Rs${ALL.net.toFixed(0)} t${ALL.t.toFixed(2)}`);
}
