#!/usr/bin/env node
/** PHASE 4.Q — SECTOR-ROTATION INTRADAY, exactly as specified.
 *  at 10:15: Nifty direction -> pick leading sector (if up) or lagging sector (if down)
 *  -> drop EXTENDED stocks -> keep NEUTRAL ones -> pick best -> hold to 15:15
 *  All inputs causal (09:15-10:15 only). Entry = OPEN of the 10:20 bar. TEST excluded. */
const fs=require('fs'),path=require('path');
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const SLIP=0.05;
const SECTOR={
  AXISBANK:'BANK',SBIN:'BANK',ICICIBANK:'BANK',HDFCBANK:'BANK',INDUSINDBK:'BANK',
  BANKBARODA:'BANK',PNB:'BANK',YESBANK:'BANK',
  INFY:'IT',TCS:'IT',HCLTECH:'IT',
  SUNPHARMA:'PHARMA',LUPIN:'PHARMA',AUROPHARMA:'PHARMA',
  TATASTEEL:'METAL',VEDL:'METAL',HINDALCO:'METAL',
  RELIANCE:'OILGAS',BPCL:'OILGAS',HINDPETRO:'OILGAS',
  MARUTI:'AUTO','M&M':'AUTO',HEROMOTOCO:'AUTO',
  ITC:'FMCG', LT:'INFRA', DLF:'INFRA',
};
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
const dPos=new Map(dates.map((d,i)=>[d,i]));
const IX=new Map();
for(const r of JSON.parse(fs.readFileSync(process.argv[3],'utf8'))){
  const d=r.t.slice(0,10); if(d>='2023-01-01')continue;
  if(!IX.has(d))IX.set(d,new Map()); IX.get(d).set(r.t.slice(11,16),r.c);}
console.log(`symbols ${S.size} · sectors ${new Set(Object.values(SECTOR)).size} · sessions ${dates.length}\n`);
/** run with N positions and optional stop */
function run(NPOS,useStop,capital){
  const PER=capital/NPOS;
  const T=[];
  for(const d of dates){
    const ixm=IX.get(d); if(!ixm)continue;
    const o=ixm.get('09:15'), at=ixm.get('10:15'); if(!o||!at)continue;
    const nifRet=(at-o)/o*100;
    const up=nifRet>0;
    // per-stock causal 1H stats
    const rows=[];
    for(const [sym,bs] of S){
      const sec=SECTOR[sym]; if(!sec)continue;
      const a=bs.get(d); if(!a||a.length<40)continue;
      const r1h=(a[11].c-a[0].o)/a[0].o*100;
      // its own typical 1H move over the prior 20 sessions (causal)
      const i=dPos.get(d); const hist=[];
      for(let k=Math.max(0,i-20);k<i;k++){const p=bs.get(dates[k]);
        if(p&&p.length>=12)hist.push(Math.abs((p[11].c-p[0].o)/p[0].o*100));}
      if(hist.length<10)continue;
      const typ=med(hist); if(!(typ>0))continue;
      rows.push({sym,sec,r1h,ext:Math.abs(r1h)/typ,arr:a});
    }
    if(rows.length<10)continue;
    // sector strength (causal)
    const bySec=new Map();
    for(const r of rows){if(!bySec.has(r.sec))bySec.set(r.sec,[]);bySec.get(r.sec).push(r);}
    const secR=[...bySec.entries()].filter(([,v])=>v.length>=2)
      .map(([s,v])=>({s,r:mean(v.map(x=>x.r1h))}));
    if(!secR.length)continue;
    secR.sort((a,b)=>b.r-a.r);
    const target = up ? secR[0].s : secR[secR.length-1].s;      // leading if Nifty up, lagging if down
    const side = up ? +1 : -1;
    // candidates in that sector, EXCLUDING extended stocks, aligned with the side
    let cand=bySec.get(target).filter(x=>x.ext<=1.5);            // "went too high" -> ignore
    cand=cand.filter(x=>side>0?x.r1h>0:x.r1h<0);                 // aligned with direction
    if(!cand.length)continue;
    // "best stock" = most representative of the sector, least extended
    cand.sort((a,b)=>a.ext-b.ext);
    for(const c of cand.slice(0,NPOS)){
      const a=c.arr;
      const e=a.findIndex(x=>x.hm==='10:20'); if(e<0||e+1>=a.length)continue;
      const raw=a[e].o; if(!(raw>0))continue;
      const fill=raw*(1+side*SLIP/100);
      const qty=Math.floor(PER/fill); if(qty<1)continue;
      let H1=-1e9,L1=1e9;for(let k=0;k<12;k++){H1=Math.max(H1,a[k].h);L1=Math.min(L1,a[k].l);}
      const stop=side>0?L1:H1;
      let exit=null,why=null;
      for(let j=e;j<a.length;j++){
        if(a[j].hm>='15:15'){exit=a[j].c;why='EOD';break;}
        if(useStop){
          const g=side>0?a[j].o<=stop:a[j].o>=stop;
          if(g){exit=a[j].o;why='STOP';break;}
          const h=side>0?a[j].l<=stop:a[j].h>=stop;
          if(h){exit=stop;why='STOP';break;}}
        if(j===a.length-1){exit=a[j].c;why='EOD';}}
      if(exit==null)continue;
      const ex=exit*(1-side*SLIP/100);
      const gross=side*(ex-fill)*qty;
      const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
      T.push({d,sym:c.sym,sec:target,side,qty,fill,exit:ex,why,gross,chg,net:gross-chg,
        nifRet,month:d.slice(0,7),notional:fill*qty});
    }
  }
  return T;
}
const sum=a=>a.reduce((x,y)=>x+y,0);
const DEVf=x=>x.d<='2019-12-31', VALf=x=>x.d>='2020-01-01';
console.log('=== CONFIGURATIONS ===');
console.log('config                       trades   win%   gross Rs   charges Rs     NET Rs   DEV/trade  VALID/trade');
console.log('='.repeat(104));
for(const [lbl,N,stp,cap] of [['5 stocks Rs10k, no stop',5,false,50000],
                              ['5 stocks Rs10k, 1H stop',5,true,50000],
                              ['1 stock  Rs50k, no stop',1,false,50000],
                              ['1 stock  Rs50k, 1H stop',1,true,50000]]){
  const T=run(N,stp,cap); if(T.length<100)continue;
  const dv=T.filter(DEVf), vl=T.filter(VALf);
  console.log(lbl.padEnd(29)+String(T.length).padStart(6)+
    (100*T.filter(x=>x.net>0).length/T.length).toFixed(0).padStart(6)+'%'+
    sum(T.map(x=>x.gross)).toFixed(0).padStart(11)+sum(T.map(x=>x.chg)).toFixed(0).padStart(13)+
    sum(T.map(x=>x.net)).toFixed(0).padStart(11)+
    mean(dv.map(x=>x.net)).toFixed(1).padStart(11)+mean(vl.map(x=>x.net)).toFixed(1).padStart(13));
}
console.log('='.repeat(104));
const T=run(5,false,50000);
console.log('\n=== SPLIT BY NIFTY DIRECTION AT 10:15 ===');
console.log('nifty      window   trades   net Rs/trade   win%   total Rs');
for(const [n,f] of [['UP',x=>x.nifRet>0],['DOWN',x=>x.nifRet<=0]]){
  for(const [w,g] of [['DEV',DEVf],['VALID',VALf]]){
    const r=T.filter(x=>f(x)&&g(x)); if(r.length<50)continue;
    console.log(n.padEnd(11)+w.padEnd(9)+String(r.length).padStart(6)+
      mean(r.map(x=>x.net)).toFixed(1).padStart(15)+
      (100*r.filter(x=>x.net>0).length/r.length).toFixed(0).padStart(7)+'%'+
      sum(r.map(x=>x.net)).toFixed(0).padStart(11));
  }
}
console.log('\n=== BY SECTOR SELECTED ===');
const bySec=new Map();for(const t of T){if(!bySec.has(t.sec))bySec.set(t.sec,[]);bySec.get(t.sec).push(t);}
for(const [s,v] of [...bySec.entries()].sort((a,b)=>b[1].length-a[1].length)){
  if(v.length<100)continue;
  console.log('  '+s.padEnd(9)+String(v.length).padStart(6)+' trades   net Rs'+mean(v.map(x=>x.net)).toFixed(1).padStart(7)+'/trade   total Rs'+sum(v.map(x=>x.net)).toFixed(0).padStart(8));
}
console.log('\n=== SAMPLE DAYS ===');
console.log('date        nifty1H  sector   stock       side  qty    entry     exit   gross  chg    net');
let s2=99;const rnd=()=>((s2=(s2*1103515245+12345)&0x7fffffff)/0x7fffffff);
const days=[...new Set(T.map(x=>x.d))].sort(()=>rnd()-0.5).slice(0,4).sort();
for(const d of days){
  for(const t of T.filter(x=>x.d===d)){
    console.log(`${t.d}  ${t.nifRet.toFixed(2).padStart(6)}%  ${t.sec.padEnd(8)} ${t.sym.padEnd(11)}${(t.side>0?'BUY':'SELL').padEnd(6)}${String(t.qty).padStart(4)}${t.fill.toFixed(2).padStart(9)}${t.exit.toFixed(2).padStart(9)}${t.gross.toFixed(0).padStart(7)}${t.chg.toFixed(0).padStart(5)}${t.net.toFixed(0).padStart(7)}`);
  }
  const dt=T.filter(x=>x.d===d);
  console.log(' '.repeat(12)+`day total  ${sum(dt.map(x=>x.net)).toFixed(0).padStart(58)}`);
}
console.log('\n=== ECONOMICS ===');
console.log('  gross per trade Rs'+mean(T.map(x=>x.gross)).toFixed(2)+'  ('+(100*mean(T.map(x=>x.gross))/mean(T.map(x=>x.notional))).toFixed(4)+'% of notional)');
console.log('  charges per trade Rs'+mean(T.map(x=>x.chg)).toFixed(2)+'  ('+(100*mean(T.map(x=>x.chg))/mean(T.map(x=>x.notional))).toFixed(4)+'% of notional)');
console.log('  net per trade Rs'+mean(T.map(x=>x.net)).toFixed(2));
