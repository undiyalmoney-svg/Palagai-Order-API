#!/usr/bin/env node
/** PHASE 5.C — the dummy-confirmed 1H breakout run on the MOST RECENT month.
 *  Signal frozen (p4p-dummy.js). TEST window deliberately spent on an
 *  already-failed candidate: this can confirm the failure, not reverse it.
 *  Read-only. Every trade printed. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const SLIP=0.05, PER=10000, MAXPOS=5;
const NOSTOP=process.env.NOSTOP==='1';
const DIR=process.env.EQDIR, MONTH=process.argv[2];
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const s=f.replace('.json','');const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d.slice(0,7)!==MONTH)continue;
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});
  }
  if(bs.size)S.set(s,bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
function walk(a,e,side,stop,stopAt){
  for(let j=e;j<a.length;j++){
    if(a[j].hm>=stopAt)return {px:a[j].c,why:'TIME'};
    if(NOSTOP){ if(j===a.length-1)return {px:a[j].c,why:'EOD'}; continue; }
    const g=side>0?a[j].o<=stop:a[j].o>=stop; if(g)return {px:a[j].o,why:'GAPSTOP'};
    const h=side>0?a[j].l<=stop:a[j].h>=stop; if(h)return {px:stop,why:'STOP'};
    if(j===a.length-1)return {px:a[j].c,why:'EOD'};
  } return null;
}
const T=[];
for(const d of dates){
  let taken=0;
  for(const [sym,bs] of S){
    if(taken>=MAXPOS)break;
    const a=bs.get(d); if(!a||a.length<40)continue;
    let H1=-1e9,L1=1e9;
    for(let k=0;k<12;k++){H1=Math.max(H1,a[k].h);L1=Math.min(L1,a[k].l);}
    if(!(H1>L1))continue;
    const SL=a[11].c;
    for(const side of [+1,-1]){
      if(taken>=MAXPOS)break;
      const lvl=side>0?H1:L1;
      let c1=null;
      for(let j=12;j<a.length-1;j++){
        if(a[j].hm>='14:30')break;
        if(side>0&&a[j].c>lvl){c1=j;break;}
        if(side<0&&a[j].c<lvl){c1=j;break;}}
      if(c1==null)continue;
      const de=c1+1; if(de>=a.length)continue;
      const dFill=a[de].o; if(!(dFill>0))continue;
      if(side>0&&!(SL<dFill))continue;
      if(side<0&&!(SL>dFill))continue;
      const dR=Math.abs(dFill-SL), dTgt=dFill+side*dR;
      let dOut=null;
      for(let j=de;j<a.length;j++){
        if(a[j].hm>='15:15'){dOut={px:a[j].c,why:'TIME',j};break;}
        const g=side>0?a[j].o<=SL:a[j].o>=SL; if(g){dOut={px:a[j].o,why:'STOP',j};break;}
        const hs=side>0?a[j].l<=SL:a[j].h>=SL; if(hs){dOut={px:SL,why:'STOP',j};break;}
        const ht=side>0?a[j].h>=dTgt:a[j].l<=dTgt; if(ht){dOut={px:dTgt,why:'WIN',j};break;}
        if(j===a.length-1)dOut={px:a[j].c,why:'TIME',j};}
      if(!dOut)continue;
      const dummyWon=side*(dOut.px-dFill)>0;
      if(!dummyWon)continue;
      const from=(dOut.j!=null?dOut.j:de)+1;
      let c2=null;
      for(let j=from;j<a.length-1;j++){
        if(a[j].hm>='15:00')break;
        if(side>0&&a[j].c>lvl){c2=j;break;}
        if(side<0&&a[j].c<lvl){c2=j;break;}}
      if(c2==null)continue;
      const re=c2+1; if(re>=a.length)continue;
      const raw=a[re].o; if(!(raw>0))continue;
      const fill=raw*(1+side*SLIP/100);
      if(side>0&&!(SL<fill))continue;
      if(side<0&&!(SL>fill))continue;
      const qty=Math.floor(PER/fill); if(qty<1)continue;
      const out=walk(a,re,side,SL,'15:15'); if(!out)continue;
      const ex=out.px*(1-side*SLIP/100);
      const gross=side*(ex-fill)*qty;
      const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
      T.push({d,sym,side:side>0?'BUY':'SELL',qty,fill,SL,exit:ex,why:out.why,
              gross,chg,net:gross-chg,entryTime:a[re].hm});
      taken++;
    }
  }
}
const sum=a=>a.reduce((x,y)=>x+y,0);
console.log(`DUMMY-CONFIRMED 1H BREAKOUT - ${MONTH}`);
console.log(`Rs${PER.toLocaleString('en-IN')}/stock, max ${MAXPOS}/day, SL = ${NOSTOP?'NONE':'1H candle close'}, exit 15:15, MIS charges`);
console.log(`sessions in month: ${dates.length}   real trades: ${T.length}\n`);
console.log('date        time   stock       side   qty     entry        SL      exit  reason     gross    chg      net');
console.log('-'.repeat(108));
let run=0;
for(const t of T){
  run+=t.net;
  console.log(`${t.d}  ${t.entryTime}  ${t.sym.padEnd(10)}  ${t.side.padEnd(4)}  ${String(t.qty).padStart(4)}  ${t.fill.toFixed(2).padStart(8)}  ${t.SL.toFixed(2).padStart(8)}  ${t.exit.toFixed(2).padStart(8)}  ${t.why.padEnd(8)}  ${t.gross.toFixed(0).padStart(6)}  ${t.chg.toFixed(0).padStart(5)}  ${t.net.toFixed(0).padStart(7)}`);
}
console.log('-'.repeat(108));
const byDay=new Map();
for(const t of T){byDay.set(t.d,(byDay.get(t.d)||0)+t.net);}
console.log('\nDAY BY DAY');
let cum=0;
for(const d of [...byDay.keys()].sort()){
  cum+=byDay.get(d);
  console.log(`  ${d}   ${byDay.get(d)>=0?'+':''}${byDay.get(d).toFixed(0).padStart(6)}   running ${cum>=0?'+':''}${cum.toFixed(0)}`);
}
const g=sum(T.map(x=>x.gross)),c=sum(T.map(x=>x.chg)),n=g-c;
const wins=T.filter(x=>x.net>0).length;
console.log('\nMONTH TOTAL');
console.log(`  trades            ${T.length}`);
console.log(`  winners / losers  ${wins} / ${T.length-wins}   (win rate ${T.length?(100*wins/T.length).toFixed(0):0}%)`);
console.log(`  gross             Rs${g.toFixed(0)}`);
console.log(`  charges           Rs${c.toFixed(0)}`);
console.log(`  NET               Rs${n.toFixed(0)}`);
console.log(`  return on Rs50k   ${(100*n/50000).toFixed(2)}%`);
const green=[...byDay.values()].filter(v=>v>0).length;
console.log(`  green days        ${green} / ${byDay.size}`);
if(T.length){
  console.log(`  best trade        Rs${Math.max(...T.map(x=>x.net)).toFixed(0)}   worst Rs${Math.min(...T.map(x=>x.net)).toFixed(0)}`);
  const bywhy={};for(const t of T){bywhy[t.why]=bywhy[t.why]||{n:0,net:0};bywhy[t.why].n++;bywhy[t.why].net+=t.net;}
  console.log('  exit reasons      '+Object.entries(bywhy).map(([k,v])=>`${k}:${v.n} (Rs${v.net.toFixed(0)})`).join('  '));
}
