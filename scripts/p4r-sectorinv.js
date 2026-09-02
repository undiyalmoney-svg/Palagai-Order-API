#!/usr/bin/env node
/** PHASE 4.R — SECTOR ROTATION, INVERTED. Nifty up -> SHORT the leading sector.
 *  Nifty down -> BUY the lagging sector. Stop rebuilt on the correct side.
 *  Reported at several position sizes because the charge RATE falls with size.
 *  DEV and VALID reported SEPARATELY. TEST excluded. */
const fs=require('fs'),path=require('path');
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const SLIP=0.05;
const SECTOR={AXISBANK:'BANK',SBIN:'BANK',ICICIBANK:'BANK',HDFCBANK:'BANK',INDUSINDBK:'BANK',
  BANKBARODA:'BANK',PNB:'BANK',YESBANK:'BANK',INFY:'IT',TCS:'IT',HCLTECH:'IT',
  SUNPHARMA:'PHARMA',LUPIN:'PHARMA',AUROPHARMA:'PHARMA',TATASTEEL:'METAL',VEDL:'METAL',HINDALCO:'METAL',
  RELIANCE:'OILGAS',BPCL:'OILGAS',HINDPETRO:'OILGAS',MARUTI:'AUTO','M&M':'AUTO',HEROMOTOCO:'AUTO',
  ITC:'FMCG',LT:'INFRA',DLF:'INFRA'};
const DIR=process.argv[2];
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const s=f.replace('.json','');const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d>='2023-01-01')continue;
    if(!bs.has(d))bs.set(d,[]);bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});}
  S.set(s,bs);}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
const dPos=new Map(dates.map((d,i)=>[d,i]));
const IX=new Map();
for(const r of JSON.parse(fs.readFileSync(process.argv[3],'utf8'))){
  const d=r.t.slice(0,10); if(d>='2023-01-01')continue;
  if(!IX.has(d))IX.set(d,new Map()); IX.get(d).set(r.t.slice(11,16),r.c);}
/** INVERT = -1 flips the side the original rule would take */
function run(NPOS,perPos,useStop,INVERT){
  const T=[];
  for(const d of dates){
    const ixm=IX.get(d); if(!ixm)continue;
    const o=ixm.get('09:15'), at=ixm.get('10:15'); if(!o||!at)continue;
    const nifRet=(at-o)/o*100, up=nifRet>0;
    const rows=[];
    for(const [sym,bs] of S){
      const sec=SECTOR[sym]; if(!sec)continue;
      const a=bs.get(d); if(!a||a.length<40)continue;
      const r1h=(a[11].c-a[0].o)/a[0].o*100;
      const i=dPos.get(d); const hist=[];
      for(let k=Math.max(0,i-20);k<i;k++){const p=bs.get(dates[k]);
        if(p&&p.length>=12)hist.push(Math.abs((p[11].c-p[0].o)/p[0].o*100));}
      if(hist.length<10)continue;
      const typ=med(hist); if(!(typ>0))continue;
      rows.push({sym,sec,r1h,ext:Math.abs(r1h)/typ,arr:a});
    }
    if(rows.length<10)continue;
    const bySec=new Map();
    for(const r of rows){if(!bySec.has(r.sec))bySec.set(r.sec,[]);bySec.get(r.sec).push(r);}
    const secR=[...bySec.entries()].filter(([,v])=>v.length>=2).map(([s,v])=>({s,r:mean(v.map(x=>x.r1h))}));
    if(!secR.length)continue;
    secR.sort((a,b)=>b.r-a.r);
    const target=up?secR[0].s:secR[secR.length-1].s;
    const origSide=up?+1:-1;
    const side=origSide*INVERT;                       // <-- the inversion
    let cand=bySec.get(target).filter(x=>x.ext<=1.5);
    cand=cand.filter(x=>origSide>0?x.r1h>0:x.r1h<0);  // selection unchanged
    if(!cand.length)continue;
    cand.sort((a,b)=>a.ext-b.ext);
    for(const c of cand.slice(0,NPOS)){
      const a=c.arr;
      const e=a.findIndex(x=>x.hm==='10:20'); if(e<0||e+1>=a.length)continue;
      const raw=a[e].o; if(!(raw>0))continue;
      const fill=raw*(1+side*SLIP/100);
      const qty=Math.floor(perPos/fill); if(qty<1)continue;
      let H1=-1e9,L1=1e9;for(let k=0;k<12;k++){H1=Math.max(H1,a[k].h);L1=Math.min(L1,a[k].l);}
      const stop=side>0?L1:H1;                        // stop on the CORRECT side for the traded direction
      const valid=side>0?stop<fill:stop>fill;
      let exit=null,why=null;
      for(let j=e;j<a.length;j++){
        if(a[j].hm>='15:15'){exit=a[j].c;why='EOD';break;}
        if(useStop&&valid){
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
        notional:fill*qty,nifRet});
    }
  }
  return T;
}
const sum=a=>a.reduce((x,y)=>x+y,0);
const DEVf=x=>x.d<='2019-12-31', VALf=x=>x.d>='2020-01-01';
function line(lbl,T){
  const dv=T.filter(DEVf), vl=T.filter(VALf);
  if(dv.length<100||vl.length<100)return;
  const gp=100*mean(T.map(x=>x.gross))/mean(T.map(x=>x.notional));
  const cp=100*mean(T.map(x=>x.chg))/mean(T.map(x=>x.notional));
  const dgp=100*mean(dv.map(x=>x.gross))/mean(dv.map(x=>x.notional));
  const vgp=100*mean(vl.map(x=>x.gross))/mean(vl.map(x=>x.notional));
  const both=(dgp-cp>0)&&(vgp-cp>0);
  console.log(lbl.padEnd(30)+String(T.length).padStart(6)+
    gp.toFixed(4).padStart(10)+cp.toFixed(4).padStart(10)+(gp-cp).toFixed(4).padStart(10)+
    dgp.toFixed(4).padStart(11)+vgp.toFixed(4).padStart(11)+
    mean(dv.map(x=>x.net)).toFixed(1).padStart(11)+mean(vl.map(x=>x.net)).toFixed(1).padStart(11)+
    (both?'   BOTH+':''));
}
console.log('SECTOR ROTATION — ORIGINAL vs INVERTED, at several position sizes');
console.log('(gross% already includes 0.05%/side slippage)\n');
console.log('config                        trades   gross%   chg%    net%    DEVgross%  VALgross%   DEVRs      VALRs');
console.log('='.repeat(112));
line('ORIGINAL  Rs10k x5',            run(5,10000,false,+1));
line('INVERTED  Rs10k x5',            run(5,10000,false,-1));
line('INVERTED  Rs10k x5 +stop',      run(5,10000,true ,-1));
line('INVERTED  Rs1L x5',             run(5,100000,false,-1));
line('INVERTED  Rs5L x5',             run(5,500000,false,-1));
line('INVERTED  Rs20L x5',            run(5,2000000,false,-1));
console.log('='.repeat(112));
const T=run(5,10000,false,-1);
const dv=T.filter(DEVf), vl=T.filter(VALf);
const dgp=100*mean(dv.map(x=>x.gross))/mean(dv.map(x=>x.notional));
const vgp=100*mean(vl.map(x=>x.gross))/mean(vl.map(x=>x.notional));
const se=g=>{const b=new Map();for(const x of g){if(!b.has(x.d))b.set(x.d,[]);b.get(x.d).push(100*x.gross/x.notional);}
  const v=[...b.values()].map(mean);return {m:mean(v),t:mean(v)/(sd(v)/Math.sqrt(v.length)),n:v.length};};
const sd_=se(dv), sv_=se(vl);
console.log(`\nINVERTED gross, date-clustered:`);
console.log(`  DEV   ${sd_.m.toFixed(4)}%  t=${sd_.t.toFixed(2)}  (${sd_.n} sessions)`);
console.log(`  VALID ${sv_.m.toFixed(4)}%  t=${sv_.t.toFixed(2)}  (${sv_.n} sessions)`);
console.log(`\ncharge rate by position size:`);
for(const p of [10000,100000,500000,2000000]){
  const c=MIS({entryPrice:1000,exitPrice:1000,quantity:p/1000}).totalRs;
  const rate=100*c/p;
  console.log(`  Rs${p.toLocaleString('en-IN').padEnd(11)} ${rate.toFixed(4)}%  -> net DEV ${(dgp-rate).toFixed(4)}%  VALID ${(vgp-rate).toFixed(4)}%  ${(dgp-rate>0&&vgp-rate>0)?'<== BOTH POSITIVE':''}`);
}
