#!/usr/bin/env node
/** BANK 1H-BODY + WHIPSAW FILTERS. Filters declared BEFORE running.
 *  Then: the "tune repeatedly" test — pick the winner on one period, check the other. */
const fs=require('fs'),path=require('path');
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const SLIP=0.02,PER=10000;
const BANKS=['HDFCBANK','ICICIBANK','AXISBANK','SBIN','INDUSINDBK'];
const S=new Map();
for(const s of BANKS){const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(process.argv[2],s+'.json'),'utf8'))){
    const d=r[0].slice(0,10);if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});}
  S.set(s,bs);}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
/** mode: 'none' | 'dummy' | 'buf' | 'two' | 'dummybuf' | 'dummytwo' ; buf in % */
function run(mode,buf){
  const T=[];
  for(const d of dates){
    for(const [sym,bs] of S){
      const a=bs.get(d); if(!a||a.length<40)continue;
      const o1=a[0].o,c1=a[11].c,top=Math.max(o1,c1),bot=Math.min(o1,c1);
      if(!(top>bot))continue;
      const upL=top*(1+(buf||0)/100), dnL=bot*(1-(buf||0)/100);
      let side=0,e=-1;
      let dummyOK=(mode.indexOf('dummy')<0);      // if no dummy required, treat as satisfied
      let firstCross=null, prevBeyond=false;
      for(let j=12;j<a.length-1;j++){
        if(a[j].hm>='15:05')break;
        const up=a[j].c>upL, dn=a[j].c<dnL;
        if(!up&&!dn){prevBeyond=false;continue;}
        const sd=up?+1:-1;
        // --- dummy stage: the FIRST cross is only observed
        if(mode.indexOf('dummy')>=0&&firstCross===null){
          firstCross={j,sd,px:a[j+1]?a[j+1].o:a[j].c};
          prevBeyond=true; continue;
        }
        if(mode.indexOf('dummy')>=0&&!dummyOK){
          // dummy wins if price moved in its direction since the dummy entry
          const dv=firstCross.sd*(a[j].c-firstCross.px);
          if(dv>0&&sd===firstCross.sd)dummyOK=true; else {prevBeyond=true;continue;}
        }
        if(mode.indexOf('two')>=0&&!prevBeyond){prevBeyond=true;continue;}   // need 2 consecutive
        side=sd;e=j+1;break;
      }
      if(!side||e>=a.length)continue;
      const raw=a[e].o; if(!(raw>0))continue;
      const fill=raw*(1+side*SLIP/100);
      const qty=Math.floor(PER/fill); if(qty<1)continue;
      let exit=null;
      for(let j=e;j<a.length;j++){if(a[j].hm>='15:15'){exit=a[j].c;break;} if(j===a.length-1)exit=a[j].c;}
      const ex=exit*(1-side*SLIP/100);
      const gross=side*(ex-fill)*qty;
      const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
      T.push({d,sym,net:gross-chg,gross,chg});
    }
  }
  return T;
}
const A=x=>x.d<'2023-01-01', B=x=>x.d>='2023-01-01';
const sum=a=>a.reduce((x,y)=>x+y,0);
const VAR=[
 ['F0 no filter (baseline)','none',0],
 ['F1 dummy confirmation','dummy',0],
 ['F2 buffer 0.10%','buf',0.10],
 ['F3 buffer 0.20%','buf',0.20],
 ['F4 two closes beyond','two',0],
 ['F5 dummy + buffer 0.10%','dummybuf',0.10],
 ['F6 dummy + two closes','dummytwo',0],
];
console.log('WHIPSAW FILTERS — all declared before running\n');
console.log('filter                     |  2017-2022: trades   gross    net   |  2023-2026: trades   gross    net');
console.log('='.repeat(108));
const R=[];
for(const [lbl,mode,buf] of VAR){
  const T=run(mode,buf);
  const a=T.filter(A), b=T.filter(B);
  if(a.length<100||b.length<100){console.log(lbl.padEnd(27)+'| too few');continue;}
  R.push({lbl,a:{n:a.length,g:sum(a.map(x=>x.gross)),net:sum(a.map(x=>x.net))},
              b:{n:b.length,g:sum(b.map(x=>x.gross)),net:sum(b.map(x=>x.net))}});
  console.log(lbl.padEnd(27)+'|'+String(a.length).padStart(12)+sum(a.map(x=>x.gross)).toFixed(0).padStart(9)+
    sum(a.map(x=>x.net)).toFixed(0).padStart(8)+'   |'+String(b.length).padStart(12)+
    sum(b.map(x=>x.gross)).toFixed(0).padStart(9)+sum(b.map(x=>x.net)).toFixed(0).padStart(8));
}
console.log('='.repeat(108));
console.log('\n=== DID ANY FILTER MAKE MONEY IN BOTH PERIODS? ===');
const both=R.filter(x=>x.a.net>0&&x.b.net>0);
console.log('  '+(both.length?both.map(x=>x.lbl).join(', '):'NONE — every filter loses in at least one period'));
console.log('\n=== THE "TUNE REPEATEDLY" TEST ===');
const bestA=[...R].sort((x,y)=>y.a.net-x.a.net)[0];
const bestB=[...R].sort((x,y)=>y.b.net-x.b.net)[0];
console.log('  best on 2017-2022:  '+bestA.lbl);
console.log('     that period Rs'+bestA.a.net.toFixed(0)+'   ->   other period Rs'+bestA.b.net.toFixed(0));
console.log('  best on 2023-2026:  '+bestB.lbl);
console.log('     that period Rs'+bestB.b.net.toFixed(0)+'   ->   other period Rs'+bestB.a.net.toFixed(0));
console.log('');
console.log('  If you tune until one period looks good, the other period tells you the truth.');
console.log('  That is what "fine tune repeatedly" produces: a filter fitted to the past you looked at.');
console.log('\n=== GROSS vs CHARGES for the best filter ===');
const bf=[...R].sort((x,y)=>(y.a.net+y.b.net)-(x.a.net+x.b.net))[0];
console.log('  '+bf.lbl);
console.log('    2017-2022  gross Rs'+bf.a.g.toFixed(0)+'  net Rs'+bf.a.net.toFixed(0)+'  -> charges Rs'+(bf.a.g-bf.a.net).toFixed(0));
console.log('    2023-2026  gross Rs'+bf.b.g.toFixed(0)+'  net Rs'+bf.b.net.toFixed(0)+'  -> charges Rs'+(bf.b.g-bf.b.net).toFixed(0));
