#!/usr/bin/env node
/** PHASE 4.I — exit management + rupee P&L simulation. Read-only. TEST excluded. */
const fs=require('fs'),path=require('path');
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const STATP=100*MIS({entryPrice:1000,exitPrice:1000,quantity:50}).totalRs/50000;
const SLIP=0.05;
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
console.log(`symbols ${S.size} · sessions ${dates.length} · statutory ${STATP.toFixed(3)}% · slippage ${SLIP}%/side\n`);
/** returns per-trade gross % for a given exit rule */
function runExit(side,mode){
  const out=[];
  for(const d of dates){
    for(const [sym,bs] of S){
      const a=bs.get(d); if(!a||a.length<40)continue;
      let H1=-1e9,L1=1e9;for(let k=0;k<12;k++){H1=Math.max(H1,a[k].h);L1=Math.min(L1,a[k].l);}
      if(!(H1>L1))continue;
      let cross=null;
      for(let j=12;j<a.length-1;j++){if(a[j].hm>='15:10')break;
        if(side>0&&a[j].c>H1){cross=j;break;} if(side<0&&a[j].c<L1){cross=j;break;}}
      if(cross==null)continue;
      const e=cross+1; if(e>=a.length)continue;
      const raw=a[e].o; if(!(raw>0))continue;
      const fill=raw*(1+side*SLIP/100);
      let stop=side>0?L1:H1;
      const R=Math.abs(fill-stop); if(!(R>0))continue;
      const tgt1=fill+side*R, tgt2=fill+side*2*R, tgtH=fill+side*0.5*R;
      let hw=fill, halfDone=false, realised=0, exit=null, reason=null, beMoved=false;
      for(let j=e;j<a.length;j++){
        const b=a[j];
        hw=side>0?Math.max(hw,b.h):Math.min(hw,b.l);
        // forced close
        if(b.hm>='15:15'){exit=b.c;reason='EOD';break;}
        // gap through stop -> fill at open (worse)
        const gapped=side>0?b.o<=stop:b.o>=stop;
        if(gapped){exit=b.o;reason='GAPSTOP';break;}
        const hitStop=side>0?b.l<=stop:b.h>=stop;
        if(hitStop){exit=stop;reason='STOP';break;}          // stop assumed first
        if(mode==='E1'){const t=side>0?b.h>=tgt1:b.l<=tgt1; if(t){exit=tgt1;reason='TGT1R';break;}}
        if(mode==='E2'){const t=side>0?b.h>=tgt2:b.l<=tgt2; if(t){exit=tgt2;reason='TGT2R';break;}}
        if(mode==='E3'&&!beMoved){const t=side>0?b.h>=tgt1:b.l<=tgt1; if(t){stop=fill;beMoved=true;}}
        if(mode==='E4'){const tr=side>0?hw*(1-0.01):hw*(1+0.01);
          if(side>0&&tr>stop)stop=tr; if(side<0&&tr<stop)stop=tr;}
        if(mode==='E5'&&!halfDone){const t=side>0?b.h>=tgt1:b.l<=tgt1;
          if(t){realised+=0.5*side*((tgt1-fill)/fill*100);halfDone=true;}}
        if(mode==='E6'&&b.hm>='13:00'){
          const reached=side>0?hw>=tgtH:hw<=tgtH;
          if(!reached){exit=b.c;reason='TIMESTOP';break;}}
        if(j===a.length-1){exit=b.c;reason='EOD';}
      }
      if(exit==null)continue;
      const ex=exit*(1-side*SLIP/100);
      let gross;
      if(mode==='E5'&&halfDone) gross=realised+0.5*side*((ex-fill)/fill*100);
      else gross=side*((ex-fill)/fill*100);
      const cost=(mode==='E5'&&halfDone)?STATP*1.5:STATP;   // extra exit leg
      out.push({d,sym,gross,net:gross-cost,reason,Rmult:side*((ex-fill)/fill)/(R/fill)});
    }
  }
  return out;
}
const DEVf=x=>x.d<='2019-12-31', VALf=x=>x.d>='2020-01-01';
function st(t){
  if(t.length<50)return null;
  const w=t.filter(x=>x.net>0), l=t.filter(x=>x.net<=0);
  const by=new Map();for(const x of t){if(!by.has(x.d))by.set(x.d,[]);by.get(x.d).push(x.net);}
  const dv=[...by.values()].map(mean); const se=dv.length>1?sd(dv)/Math.sqrt(dv.length):NaN;
  const gw=w.reduce((a,b)=>a+b.net,0), gl=Math.abs(l.reduce((a,b)=>a+b.net,0));
  return {n:t.length,net:mean(dv),t:se>0?mean(dv)/se:NaN,win:100*w.length/t.length,
    aw:w.length?mean(w.map(x=>x.net)):0,al:l.length?mean(l.map(x=>x.net)):0,pf:gl>0?gw/gl:Infinity};
}
const MODES=['E0','E1','E2','E3','E4','E5','E6'];
const LBL={E0:'hold to 15:15',E1:'target +1R',E2:'target +2R',E3:'breakeven after 1R',
           E4:'trailing 1.0%',E5:'half at 1R, rest EOD',E6:'time stop 13:00'};
console.log('exit rule                 arm     DEV n  DEV net%    t   | VALID net%    t   | win%  avgW/avgL   PF   both>0');
console.log('='.repeat(110));
let best=null;
for(const m of MODES){
  for(const [an,side] of [['LONG',+1],['SHORT',-1]]){
    const T=runExit(side,m);
    const a=st(T.filter(DEVf)), b=st(T.filter(VALf));
    if(!a||!b){console.log(`${LBL[m].padEnd(26)}${an.padEnd(8)}too few`);continue;}
    const ok=a.net>0&&b.net>0;
    if(!best||Math.min(a.net,b.net)>best.v)best={m,an,v:Math.min(a.net,b.net),a,b};
    console.log(`${LBL[m].padEnd(26)}${an.padEnd(8)}${String(a.n).padStart(6)}${a.net.toFixed(3).padStart(10)}${a.t.toFixed(2).padStart(7)} |`+
      `${b.net.toFixed(3).padStart(11)}${b.t.toFixed(2).padStart(7)} |`+
      `${a.win.toFixed(0).padStart(5)}${(a.aw.toFixed(2)+'/'+Math.abs(a.al).toFixed(2)).padStart(12)}${a.pf.toFixed(2).padStart(6)}   ${ok?'YES':'no'}`);
  }
}
console.log('='.repeat(110));
console.log(`\nbest cell (worst-window net): ${LBL[best.m]} ${best.an} = ${best.v.toFixed(3)}%\n`);
// ---------- RUPEE P&L SIMULATION ----------
console.log('='.repeat(110));
console.log('RUPEE P&L — best exit rule, risk-based sizing, capital Rs1,00,000, 1% risk/trade, max 3 positions/day');
console.log('='.repeat(110));
const T=runExit(best.an==='LONG'?+1:-1,best.m);
const byDay=new Map();
for(const x of T){if(!byDay.has(x.d))byDay.set(x.d,[]);byDay.get(x.d).push(x);}
const CAP=100000, RISKPCT=1.0, MAXPOS=3;
const dayPnl=[];
for(const d of dates){
  const l=(byDay.get(d)||[]).slice(0,MAXPOS);
  if(!l.length)continue;
  let p=0;
  for(const x of l){
    const notional=CAP*RISKPCT/100/ (Math.abs(x.Rmult)>0? Math.max(0.005,Math.abs(1/ (x.net/ (x.Rmult||1)||1))) : 1);
    // simpler and honest: size so that a full 1R loss = 1% of capital
    const rupeePerPct=CAP*RISKPCT/100;   // value of 1R
    p+= (x.Rmult||0)*rupeePerPct;
  }
  dayPnl.push({d,p,n:l.length});
}
const pnls=dayPnl.map(x=>x.p);
const dev=dayPnl.filter(x=>x.d<='2019-12-31'), val=dayPnl.filter(x=>x.d>='2020-01-01');
const sum=a=>a.reduce((x,y)=>x+y,0);
console.log(`trading days ${dayPnl.length} · avg trades/day ${(mean(dayPnl.map(x=>x.n))).toFixed(2)}`);
console.log(`  mean daily P&L   Rs${mean(pnls).toFixed(0)}   median Rs${med(pnls).toFixed(0)}`);
console.log(`  DEV total        Rs${sum(dev.map(x=>x.p)).toLocaleString('en-IN',{maximumFractionDigits:0})} over ${dev.length} days`);
console.log(`  VALID total      Rs${sum(val.map(x=>x.p)).toLocaleString('en-IN',{maximumFractionDigits:0})} over ${val.length} days`);
console.log(`  win days ${(100*pnls.filter(x=>x>0).length/pnls.length).toFixed(1)}%  ·  worst day Rs${Math.min(...pnls).toFixed(0)}  ·  best day Rs${Math.max(...pnls).toFixed(0)}`);
let eq=0,pk=0,dd=0;for(const x of dayPnl){eq+=x.p;pk=Math.max(pk,eq);dd=Math.min(dd,eq-pk);}
console.log(`  final equity change Rs${eq.toLocaleString('en-IN',{maximumFractionDigits:0})}  ·  max drawdown Rs${dd.toFixed(0)}`);
console.log('\n20 RANDOMLY SAMPLED TRADING DAYS (seeded, reproducible):');
let s=20260829;const rnd=()=>((s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff);
const pick=[...dayPnl].sort(()=>rnd()-0.5).slice(0,20).sort((a,b)=>a.d.localeCompare(b.d));
console.log('  date         trades   P&L Rs');
for(const x of pick)console.log(`  ${x.d}   ${String(x.n).padStart(4)}   ${x.p>=0?' ':''}${x.p.toFixed(0).padStart(8)}`);
console.log(`  --- sample total: Rs${sum(pick.map(x=>x.p)).toFixed(0)} over 20 days`);
