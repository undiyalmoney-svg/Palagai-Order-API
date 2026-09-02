#!/usr/bin/env node
/** PHASE 31 — WHAT do the losers have in common? Split fade trades by
 *  signal-time features (all causal), measure win rate + net per bucket,
 *  find the filter that removes the trend-resumption disasters. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, SLIP=0.03, RB=6, RP=2.5, VM=3.0;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sum=a=>a.reduce((x,y)=>x+y,0);
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]||0});
  }
  S.set(f.replace('.json',''),bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
function atr14(a,i){let tr=0,n=0;for(let j=Math.max(1,i-13);j<=i;j++){tr+=Math.max(a[j].h-a[j].l,Math.abs(a[j].h-a[j-1].c),Math.abs(a[j].l-a[j-1].c));n++;}return n?tr/n:0;}
function sig(a){for(let i=25;i<a.length-2;i++){if(a[i].hm<'10:15'||a[i].hm>'14:30')continue;
  const run=(a[i].c-a[i-RB].c)/a[i-RB].c*100,av=mean(a.slice(i-20,i).map(x=>x.v));if(av<=0)continue;
  const volx=a[i].v/av,rg=a[i].h-a[i].l;if(rg<=0)continue;
  if(run>=RP&&volx>=VM&&(a[i].c-a[i].l)/rg<=0.34)return{i,dir:-1,run:Math.abs(run)};
  if(run<=-RP&&volx>=VM&&(a[i].h-a[i].c)/rg<=0.34)return{i,dir:1,run:Math.abs(run)};}return null;}
// build all fade trades with signal-time features + outcome
const T=[];
let eq=50000;
for(const d of dates){
  let cands=[];
  for(const [sym,bs] of S){const a=bs.get(d);if(a&&a.length>=45){const s=sig(a);if(s){s.a=a;cands.push(s);}}}
  if(!cands.length)continue; cands.sort((x,y)=>y.run-x.run);
  const c=cands[0],a=c.a,i=c.i,e=i+1;if(e>=a.length-1)continue;
  const dir=c.dir,fill=a[e].o*(1+dir*SLIP/100),qty=Math.floor(eq/fill);if(qty<1)continue;
  const atr=atr14(a,i),stopD=2*atr;
  // signal-time features (all knowable at bar i):
  let pv=0,vv=0; for(let j=0;j<=i;j++){pv+=((a[j].h+a[j].l+a[j].c)/3)*a[j].v;vv+=a[j].v;}
  const vwap=vv>0?pv/vv:a[i].c;
  const openPx=a[0].o;
  const dayMove=(a[i].c-openPx)/openPx*100;           // net move on day at signal
  const vsVwap=(a[i].c-vwap)/vwap*100;                 // distance from vwap
  // withTrend: up-spike (dir<0 fade) while price ABOVE vwap & up on day = fading strength
  const withTrend = (dir<0 && vsVwap>0 && dayMove>0) || (dir>0 && vsVwap<0 && dayMove<0);
  const rg=a[i].h-a[i].l; const wick = dir<0 ? (a[i].h-Math.max(a[i].o,a[i].c))/rg : (Math.min(a[i].o,a[i].c)-a[i].l)/rg;
  const hm=+a[i].hm.slice(0,2)+ +a[i].hm.slice(3)/60;
  let px=null; for(let j=e;j<a.length;j++){const b=a[j];const adv=dir*((dir>0?b.l:b.h)-fill);
    if(b.hm>='15:15'){px=b.c;break;} if(adv<=-stopD){px=fill-dir*stopD;break;} if(j===a.length-1)px=b.c;}
  const ex=px*(1-dir*SLIP/100),net=dir*(ex-fill)*qty-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
  eq+=net;
  T.push({d,net,withTrend,vsVwap:Math.abs(vsVwap),dayMove:Math.abs(dayMove),wick,hm,run:c.run});
}
const rpt=(name,W)=>{const w=W.filter(x=>x.net>0);console.log(`  ${name.padEnd(26)} n=${String(W.length).padStart(4)}  win ${(100*w.length/W.length).toFixed(0)}%  net Rs${sum(W.map(x=>x.net)).toFixed(0).padStart(8)}  avg Rs${mean(W.map(x=>x.net)).toFixed(0).padStart(6)}`);};
const WIN=T.filter(x=>x.net>0),LOS=T.filter(x=>x.net<=0);
const BIGL=[...T].sort((a,b)=>a.net-b.net).slice(0,40);
console.log('  WINNERS vs LOSERS vs 40-BIGGEST-LOSERS - feature means (find the separator):');
const feat=(f)=>`W ${mean(WIN.map(f)).toFixed(2)}  L ${mean(LOS.map(f)).toFixed(2)}  bigL ${mean(BIGL.map(f)).toFixed(2)}`;
console.log('    run%        '+feat(x=>x.run));
console.log('    vsVwap%     '+feat(x=>x.vsVwap));
console.log('    dayMove%    '+feat(x=>x.dayMove));
console.log('    wick        '+feat(x=>x.wick));
console.log('    hour        '+feat(x=>x.hm));
console.log('  -> if bigL column ~= W column on every feature, losers are UNPREDICTABLE at entry.');
console.log();
console.log('PHASE 31 - WHAT MAKES A FADE LOSE? (2xATR stop applied)\n');
console.log('  ALL:'); rpt('all',T);
console.log('\n  (1) WITH-TREND vs COUNTER-TREND (is the faded spike with the day trend?):');
rpt('with-trend (fade strength)',T.filter(x=>x.withTrend));
rpt('counter-trend (fade bounce)',T.filter(x=>!x.withTrend));
console.log('\n  (2) DISTANCE FROM VWAP at signal (overextension):');
rpt('far from vwap (>1%)',T.filter(x=>x.vsVwap>1));
rpt('near vwap (<1%)',T.filter(x=>x.vsVwap<=1));
console.log('\n  (3) TIME OF DAY:');
rpt('morning (<12:00)',T.filter(x=>x.hm<12));
rpt('midday (12:00-13:30)',T.filter(x=>x.hm>=12&&x.hm<13.5));
rpt('late (>13:30)',T.filter(x=>x.hm>=13.5));
console.log('\n  (4) REJECTION WICK size:');
rpt('big wick (>0.4)',T.filter(x=>x.wick>0.4));
rpt('small wick (<0.4)',T.filter(x=>x.wick<=0.4));
