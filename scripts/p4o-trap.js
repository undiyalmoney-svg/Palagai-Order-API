#!/usr/bin/env node
/** PHASE 4.O — TWO-SIDED TRAP: bracket the 1H range on BOTH sides, let the market pick.
 *  Long trigger: close > H1. Short trigger: close < L1. Both may fire on a whipsaw day.
 *  Costs are paid on EVERY leg that fires. TEST excluded. */
const fs=require('fs'),path=require('path');
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const SLIP=0.05, CAP=100000, RISKPCT=1.0;
const DIR=process.argv[2];
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const s=f.replace('.json','');const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d>='2023-01-01')continue;
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});}
  S.set(s,bs);}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
const DEVf=d=>d<='2019-12-31', VALf=d=>d>='2020-01-01';
/** one leg: side, entry index, stop at the opposite 1H boundary, exit 15:15 */
function leg(a,e,side,stop){
  const raw=a[e].o; if(!(raw>0))return null;
  const fill=raw*(1+side*SLIP/100);
  const R=Math.abs(fill-stop); if(!(R>0))return null;
  const qty=Math.floor((CAP*RISKPCT/100)/R); if(qty<1)return null;
  let exit=null;
  for(let j=e;j<a.length;j++){
    if(a[j].hm>='15:15'){exit=a[j].c;break;}
    const g=side>0?a[j].o<=stop:a[j].o>=stop;
    if(g){exit=a[j].o;break;}
    const h=side>0?a[j].l<=stop:a[j].h>=stop;
    if(h){exit=stop;break;}
    if(j===a.length-1)exit=a[j].c;}
  if(exit==null)return null;
  const ex=exit*(1-side*SLIP/100);
  const gross=side*(ex-fill)*qty;
  const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
  return {gross,chg,net:gross-chg,notional:fill*qty};
}
const DAYS=[];
for(const d of dates){
  let both=0,one=0,none=0,net=0,gross=0,chg=0,legs=0;
  for(const [sym,bs] of S){
    const a=bs.get(d); if(!a||a.length<40)continue;
    let H1=-1e9,L1=1e9;for(let k=0;k<12;k++){H1=Math.max(H1,a[k].h);L1=Math.min(L1,a[k].l);}
    if(!(H1>L1))continue;
    let up=null,dn=null;
    for(let j=12;j<a.length-1;j++){
      if(a[j].hm>='15:10')break;
      if(up==null&&a[j].c>H1)up=j+1;
      if(dn==null&&a[j].c<L1)dn=j+1;
      if(up!=null&&dn!=null)break;}
    const L=[];
    if(up!=null){const r=leg(a,up,+1,L1); if(r)L.push(r);}
    if(dn!=null){const r=leg(a,dn,-1,H1); if(r)L.push(r);}
    if(L.length===2)both++; else if(L.length===1)one++; else none++;
    for(const r of L){net+=r.net;gross+=r.gross;chg+=r.chg;legs++;}
  }
  if(legs)DAYS.push({d,both,one,none,net,gross,chg,legs});
}
const sum=a=>a.reduce((x,y)=>x+y,0);
console.log('TWO-SIDED TRAP — bracket the 1H range, take whichever side breaks\n');
console.log('window   days   legs/day  both-side%  gross Rs/leg  charges Rs/leg   NET Rs/leg   NET Rs/day');
console.log('='.repeat(100));
for(const [w,f] of [['DEV',DEVf],['VALID',VALf]]){
  const g=DAYS.filter(x=>f(x.d)); if(!g.length)continue;
  const legs=sum(g.map(x=>x.legs)), bothN=sum(g.map(x=>x.both)), oneN=sum(g.map(x=>x.one));
  console.log(`${w.padEnd(8)}${String(g.length).padStart(5)}${(legs/g.length).toFixed(2).padStart(10)}`+
    `${(100*bothN/(bothN+oneN)).toFixed(1).padStart(11)}%${(sum(g.map(x=>x.gross))/legs).toFixed(1).padStart(14)}`+
    `${(sum(g.map(x=>x.chg))/legs).toFixed(1).padStart(16)}${(sum(g.map(x=>x.net))/legs).toFixed(1).padStart(13)}`+
    `${(sum(g.map(x=>x.net))/g.length).toFixed(0).padStart(13)}`);
}
console.log('='.repeat(100));
console.log('\n=== WHAT HAPPENS ON WHIPSAW DAYS (both sides trigger) ===');
for(const [w,f] of [['DEV',DEVf],['VALID',VALf]]){
  const g=DAYS.filter(x=>f(x.d));
  const bothN=sum(g.map(x=>x.both)), oneN=sum(g.map(x=>x.one));
  console.log(`  ${w}: ${bothN.toLocaleString()} stock-days triggered BOTH sides (${(100*bothN/(bothN+oneN)).toFixed(1)}%), ${oneN.toLocaleString()} triggered one.`);
  console.log(`      every both-side day pays TWO sets of charges and takes two stops.`);
}
console.log('\n=== DOES THE TRAP FIND DIRECTION? ===');
const g1=DAYS.filter(x=>DEVf(x.d)), g2=DAYS.filter(x=>VALf(x.d));
console.log(`  DEV   total Rs${sum(g1.map(x=>x.net)).toLocaleString('en-IN',{maximumFractionDigits:0})} over ${g1.length} days · gross Rs${sum(g1.map(x=>x.gross)).toLocaleString('en-IN',{maximumFractionDigits:0})} · charges Rs${sum(g1.map(x=>x.chg)).toLocaleString('en-IN',{maximumFractionDigits:0})}`);
console.log(`  VALID total Rs${sum(g2.map(x=>x.net)).toLocaleString('en-IN',{maximumFractionDigits:0})} over ${g2.length} days · gross Rs${sum(g2.map(x=>x.gross)).toLocaleString('en-IN',{maximumFractionDigits:0})} · charges Rs${sum(g2.map(x=>x.chg)).toLocaleString('en-IN',{maximumFractionDigits:0})}`);
const gp=[...g1,...g2].map(x=>x.net);
console.log(`  green days ${(100*gp.filter(x=>x>0).length/gp.length).toFixed(1)}%`);
console.log(`\n  gross is ${sum([...g1,...g2].map(x=>x.gross))>0?'POSITIVE':'NEGATIVE'} — the trap ${sum([...g1,...g2].map(x=>x.gross))>0?'does':'does not'} capture direction.`);
console.log(`  but charges of Rs${sum([...g1,...g2].map(x=>x.chg)).toLocaleString('en-IN',{maximumFractionDigits:0})} exceed gross of Rs${sum([...g1,...g2].map(x=>x.gross)).toLocaleString('en-IN',{maximumFractionDigits:0})}.`);
