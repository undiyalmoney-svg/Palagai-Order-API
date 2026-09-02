#!/usr/bin/env node
/** PHASE 12 — mid-cap ORB on the most recent months, full trade detail.
 *  Rs250,000 notional (5x MIS on Rs50,000), 1 position/day, unbiased (seeded
 *  random) selection among that day's breakouts - the version that was validated.
 *  120-min opening range, enter next bar open after the breakout close, exit 15:15. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, ORB=24, PER=250000, MONTH=process.argv[2];
const SLIP=+(process.env.SLIP??0.01);
const STOPW=process.env.STOPW?+process.env.STOPW:null;
const sum=a=>a.reduce((x,y)=>x+y,0);
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d.slice(0,7)!==MONTH)continue;
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});
  }
  if(bs.size)S.set(f.replace('.json',''),bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const T=[];
for(const d of dates){
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
    cands.push({sym,a,bi,dir,H,L,W:H-L});
  }
  if(!cands.length) continue;
  for(let k=cands.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cands[k],cands[j]]=[cands[j],cands[k]];}
  const c=cands[0];
  const a=c.a,e=c.bi+1; if(e>=a.length-1) continue;
  const raw=a[e].o; if(!(raw>0)) continue;
  const fill=raw*(1+c.dir*SLIP/100);
  const qty=Math.floor(PER/fill); if(qty<1) continue;
  let px=null,eh=null,why='TIME';
  const stopD=STOPW!=null?STOPW*c.W:null;
  for(let j=e;j<a.length;j++){
    const adv=c.dir*((c.dir>0?a[j].l:a[j].h)-fill);
    if(a[j].hm>='15:15'){px=a[j].c;eh=a[j].hm;why='TIME';break;}
    if(stopD!=null&&adv<=-stopD){px=fill-c.dir*stopD;eh=a[j].hm;why='STOP';break;}
    if(j===a.length-1){px=a[j].c;eh=a[j].hm;} }
  const ex=px*(1-c.dir*SLIP/100);
  const gross=c.dir*(ex-fill)*qty;
  const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
  T.push({d,sym:c.sym,side:c.dir>0?'BUY':'SELL',qty,fill,ex,gross,chg,net:gross-chg,
          entryTime:a[e].hm,why,nCand:cands.length,notional:fill*qty});
}
console.log(`MID-CAP ORB - ${MONTH}   (Rs250,000/position, 1 trade/day, slippage ${SLIP}%/side, stop ${STOPW?STOPW+'W':'none'})`);
console.log(`sessions ${dates.length}   trades ${T.length}\n`);
console.log('date        time   stock          side   qty     entry      exit  exitwhy    gross    chg      net   run');
console.log('-'.repeat(110));
let run=0;
for(const t of T){ run+=t.net;
  console.log(`${t.d}  ${t.entryTime}  ${t.sym.padEnd(13)} ${t.side.padEnd(4)} ${String(t.qty).padStart(5)}  ${t.fill.toFixed(2).padStart(8)}  ${t.ex.toFixed(2).padStart(8)}  ${t.why.padEnd(7)}  ${t.gross.toFixed(0).padStart(8)}  ${t.chg.toFixed(0).padStart(5)}  ${t.net.toFixed(0).padStart(7)}  ${run.toFixed(0).padStart(6)}`);
}
console.log('-'.repeat(110));
const g=sum(T.map(x=>x.gross)),c2=sum(T.map(x=>x.chg)),n=g-c2;
const w=T.filter(x=>x.net>0).length;
console.log(`\nMONTH TOTAL   trades ${T.length}   winners ${w}  losers ${T.length-w}  (win ${T.length?(100*w/T.length).toFixed(0):0}%)`);
console.log(`  gross Rs${g.toFixed(0)}   charges Rs${c2.toFixed(0)}   NET Rs${n.toFixed(0)}`);
console.log(`  return on Rs50,000 capital: ${(100*n/50000).toFixed(2)}%`);
console.log(`  charge rate ${(100*c2/sum(T.map(x=>x.notional))).toFixed(4)}% of notional`);
if(T.length) console.log(`  best Rs${Math.max(...T.map(x=>x.net)).toFixed(0)}   worst Rs${Math.min(...T.map(x=>x.net)).toFixed(0)}`);
