#!/usr/bin/env node
/** PHASE 14 — REAL ACCOUNT SIMULATION. Rs50,000 start.
 *  Position notional = LEV x current equity (shrinks after losses, as it must).
 *  Validated config: 120-min OR, 1.5W stop, exit 15:15, unbiased random pick,
 *  1 position/day, MIS charges, slippage 0.01%/side.
 *  Stops if equity falls below the minimum needed for one lot. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, ORB=24, SLIP=+(process.env.SLIP??0.01);
const LEV=+(process.env.LEV??5), STOPW=+(process.env.STOPW??1.5);
const FROM=process.env.FROM||'2026-07-01', TO=process.env.TO||'2026-08-28';
const sum=a=>a.reduce((x,y)=>x+y,0);
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d<FROM||d>TO)continue;
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});
  }
  if(bs.size)S.set(f.replace('.json',''),bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let eq=50000; const START=eq; let peak=eq, maxDD=0, ruined=null;
const rows=[];
for(const d of dates){
  if(eq<=0){ ruined=ruined||d; break; }
  const cands=[];
  for(const [sym,bs] of S){
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
    cands.push({sym,a,bi,dir,W:H-L});
  }
  if(!cands.length) continue;
  for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
  const c=cands[0], a=c.a, e=c.bi+1; if(e>=a.length-1) continue;
  const raw=a[e].o; if(!(raw>0)) continue;
  const fill=raw*(1+c.dir*SLIP/100);
  const notional=LEV*eq;
  const qty=Math.floor(notional/fill);
  if(qty<1){ rows.push({d,sym:'-',note:'equity too small for 1 share'}); continue; }
  const stopD=STOPW*c.W;
  let px=null,why='TIME';
  for(let j=e;j<a.length;j++){
    const adv=c.dir*((c.dir>0?a[j].l:a[j].h)-fill);
    if(a[j].hm>='15:15'){px=a[j].c;why='TIME';break;}
    if(adv<=-stopD){px=fill-c.dir*stopD;why='STOP';break;}
    if(j===a.length-1)px=a[j].c;
  }
  if(px==null) continue;
  const ex=px*(1-c.dir*SLIP/100);
  const gross=c.dir*(ex-fill)*qty;
  const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
  const net=gross-chg;
  eq+=net; peak=Math.max(peak,eq); maxDD=Math.min(maxDD,eq-peak);
  rows.push({d,sym:c.sym,side:c.dir>0?'BUY':'SELL',qty,fill,ex,why,notional:fill*qty,gross,chg,net,eq});
}
console.log(`ACCOUNT SIMULATION   Rs${START.toLocaleString('en-IN')} start · ${LEV}x MIS · stop ${STOPW}W · slip ${SLIP}%/side`);
console.log(`window ${FROM} .. ${TO}   sessions ${dates.length}\n`);
console.log('date         stock         side   qty    entry     exit   exit      notional      net    EQUITY');
console.log('-'.repeat(100));
for(const r of rows){
  if(r.note){ console.log(`${r.d}   ${r.note}`); continue; }
  console.log(`${r.d}   ${r.sym.padEnd(13)}${r.side.padEnd(5)}${String(r.qty).padStart(6)} ${r.fill.toFixed(2).padStart(8)} ${r.ex.toFixed(2).padStart(8)}  ${r.why.padEnd(5)} ${(r.notional/1000).toFixed(0).padStart(8)}k ${r.net.toFixed(0).padStart(8)} ${r.eq.toFixed(0).padStart(9)}`);
}
console.log('-'.repeat(100));
const T=rows.filter(r=>!r.note);
const w=T.filter(x=>x.net>0).length;
console.log(`\nRESULT`);
console.log(`  start equity        Rs${START.toLocaleString('en-IN')}`);
console.log(`  end equity          Rs${eq.toFixed(0)}`);
console.log(`  profit / loss       Rs${(eq-START).toFixed(0)}   (${(100*(eq-START)/START).toFixed(2)}%)`);
console.log(`  trades              ${T.length}   winners ${w}  losers ${T.length-w}  (win ${(100*w/T.length).toFixed(0)}%)`);
console.log(`  total charges paid  Rs${sum(T.map(x=>x.chg)).toFixed(0)}`);
console.log(`  max drawdown        Rs${maxDD.toFixed(0)}  (${(100*maxDD/peak).toFixed(1)}% of peak)`);
console.log(`  best day  Rs${Math.max(...T.map(x=>x.net)).toFixed(0)}    worst day  Rs${Math.min(...T.map(x=>x.net)).toFixed(0)}`);
if(ruined) console.log(`  ACCOUNT WIPED OUT on ${ruined}`);
