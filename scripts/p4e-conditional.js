#!/usr/bin/env node
/** PHASE 4.E — CONDITIONAL ANALYSIS OF ORB ENTRIES, DONE HONESTLY.
 *  Question asked: "which entries give losses and which give profit?"
 *  Answered with: conditioning dimensions PRE-DECLARED, chronological split,
 *  replication in VALID required, and multiple-testing correction.
 *  Also measures how big the selection illusion is, and what a RANDOM day
 *  split does versus a chronological one. Read-only. TEST excluded at load. */
const fs=require('fs'),path=require('path');
const EF='09:45',ET='14:45',PB=0.0015,SR=0.0030;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const STAT=100*MIS({entryPrice:1000,exitPrice:1000,quantity:50}).totalRs/50000, FULL=STAT+0.20;
const DIR=process.argv[2];
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const s=f.replace('.json','');const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d>='2023-01-01')continue;   // TEST excluded
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]});}
  S.set(s,bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
const dPos=new Map(dates.map((d,i)=>[d,i]));
function srLevels(sym,d){const i=dPos.get(d);if(i<6)return null;const bs=S.get(sym);
  const p=bs.get(dates[i-1]);if(!p||!p.length)return null;
  let ph=-1e9,pl=1e9;for(const b of p){ph=Math.max(ph,b.h);pl=Math.min(pl,b.l);}
  const out=[ph,pl,p[p.length-1].c];let h5=-1e9,l5=1e9,ok=0;
  for(let k=i-5;k<i;k++){const a=bs.get(dates[k]);if(!a||!a.length)continue;ok++;
    for(const b of a){h5=Math.max(h5,b.h);l5=Math.min(l5,b.l);}}
  if(ok>=3)out.push(h5,l5);return out;}
/** collect ORB pullback entries (OR15) with all PRE-DECLARED conditioning tags */
const E=[];
for(const d of dates){
  for(const [sym,bs] of S){
    const arr=bs.get(d); if(!arr||arr.length<30)continue;
    let orH=-1e9,orL=1e9;for(let k=0;k<3;k++){orH=Math.max(orH,arr[k].h);orL=Math.min(orL,arr[k].l);}
    if(!(orH>orL))continue;
    const sr=srLevels(sym,d);
    const i=dPos.get(d);
    const prev=i>0?bs.get(dates[i-1]):null;
    const gap=(prev&&prev.length)?(arr[0].o-prev[prev.length-1].c)/prev[prev.length-1].c*100:null;
    const orW=(orH-orL)/arr[0].o*100;
    let brk=null,ev=null;
    for(let j=3;j<arr.length;j++){
      if(!brk){ if(arr[j].c>orH)brk={dir:1,level:orH};else if(arr[j].c<orL)brk={dir:-1,level:orL}; continue; }
      if(!brk.pulled){ if((brk.dir>0&&arr[j].l<=brk.level*(1+PB))||(brk.dir<0&&arr[j].h>=brk.level*(1-PB)))brk.pulled=true; continue; }
      const ok=brk.dir>0?arr[j].c>brk.level:arr[j].c<brk.level;
      if(!ok)continue;
      if(arr[j].hm<EF||arr[j].hm>ET)break;
      ev={j,dir:brk.dir,level:brk.level};break;
    }
    if(!ev||ev.j+1>=arr.length)continue;
    const fill=arr[ev.j+1].o; if(!(fill>0))continue;
    const e=Math.min(ev.j+1+12,arr.length-1); if(e-(ev.j+1)<3)continue;
    const ret=ev.dir*((arr[e].c-fill)/fill*100);
    const rets=[];for(let k=Math.max(1,ev.j-20);k<ev.j;k++)rets.push((arr[k].c-arr[k-1].c)/arr[k-1].c*100);
    const vol=sd(rets); if(!(vol>0))continue;
    E.push({d,sym,ret,dir:ev.dir,
      hmBucket: arr[ev.j].hm<'11:00'?'morning':arr[ev.j].hm<'13:00'?'midday':'afternoon',
      confl: sr?sr.some(L=>Math.abs(ev.level-L)/ev.level<=SR):false,
      volB: vol>0.25?'highVol':vol>0.15?'midVol':'lowVol',
      gapB: gap==null?'na':gap>0.3?'gapUp':gap<-0.3?'gapDn':'flat',
      orwB: orW>1.2?'wideOR':orW<0.6?'narrowOR':'midOR',
      sym});
  }
}
console.log(`ORB pullback entries collected: ${E.length.toLocaleString()} over ${new Set(E.map(x=>x.d)).size} sessions`);
console.log(`hurdles: statutory ${STAT.toFixed(3)}% · full ${FULL.toFixed(3)}%\n`);
const DEVf=x=>x.d<='2019-12-31', VALf=x=>x.d>='2020-01-01';
const dev=E.filter(DEVf), val=E.filter(VALf);
function clus(rows){const by=new Map();for(const r of rows){if(!by.has(r.d))by.set(r.d,[]);by.get(r.d).push(r.ret);}
  const v=[...by.values()].map(mean);const se=v.length>1?sd(v)/Math.sqrt(v.length):NaN;
  return {n:rows.length,days:v.length,mean:mean(v),t:se>0?mean(v)/se:NaN};}
console.log('=== 1. PRE-DECLARED CONDITIONING (declared before looking) ===');
console.log('Six dimensions: direction · time-of-day · S/R confluence · volatility · gap · OR width');
const DIMS={direction:x=>x.dir>0?'long':'short',timeOfDay:x=>x.hmBucket,srConfluence:x=>x.confl?'yes':'no',
            volatility:x=>x.volB,gap:x=>x.gapB,orWidth:x=>x.orwB};
console.log('');
console.log('dimension      bucket      DEV n    DEV%     t    | VALID n   VALID%     t   | replicates?');
console.log('-'.repeat(104));
let cells=0,devPos=0,repl=0,replEcon=0;
const LED=[];
for(const [dim,fn] of Object.entries(DIMS)){
  const keys=[...new Set(E.map(fn))].sort();
  for(const k of keys){
    const a=clus(dev.filter(x=>fn(x)===k)), b=clus(val.filter(x=>fn(x)===k));
    if(a.days<80||b.days<80)continue;
    cells++;
    const dPos_=a.mean>0; if(dPos_)devPos++;
    const rep=dPos_&&b.mean>0; if(rep)repl++;
    const econ=rep&&Math.min(a.mean,b.mean)>FULL; if(econ)replEcon++;
    console.log(`${dim.padEnd(14)}${k.padEnd(11)}${String(a.n).padStart(6)}${a.mean.toFixed(3).padStart(9)}${(Number.isFinite(a.t)?a.t.toFixed(2):'-').padStart(7)} |`+
      `${String(b.n).padStart(8)}${b.mean.toFixed(3).padStart(9)}${(Number.isFinite(b.t)?b.t.toFixed(2):'-').padStart(7)} |`+
      `  ${dPos_?(rep?(econ?'YES + clears cost':'sign holds, below cost'):'NO — flips'):'DEV already negative'}`);
    LED.push({dim,k,dev:a,val:b,rep,econ});
  }
}
console.log('-'.repeat(104));
console.log(`\ncells examined ${cells} · positive in DEV ${devPos} · still positive in VALID ${repl} · AND clearing cost ${replEcon}`);
console.log('\n=== 2. HOW BIG IS THE SELECTION ILLUSION? ===');
console.log('Slice the SAME entries by STOCK (26 cells) — the classic "find the winners" move:');
const bySym=[...new Set(E.map(x=>x.sym))];
let sPos=0,sRep=0,sEcon=0;
const symRows=[];
for(const s of bySym){
  const a=clus(dev.filter(x=>x.sym===s)),b=clus(val.filter(x=>x.sym===s));
  if(a.days<80||b.days<80)continue;
  symRows.push({s,a,b});
  if(a.mean>0){sPos++; if(b.mean>0){sRep++; if(Math.min(a.mean,b.mean)>FULL)sEcon++;}}
}
symRows.sort((x,y)=>y.a.mean-x.a.mean);
console.log('  top 5 stocks BY DEV RETURN (what a naive search would select):');
for(const r of symRows.slice(0,5))
  console.log(`    ${r.s.padEnd(12)} DEV ${r.a.mean.toFixed(3)}%  ->  VALID ${r.b.mean.toFixed(3)}%  ${r.b.mean>0?'':'<-- FLIPS NEGATIVE'}`);
console.log(`  stocks profitable in DEV: ${sPos}/${symRows.length} · still profitable in VALID: ${sRep} · clearing cost: ${sEcon}`);
console.log('\n=== 3. RANDOM DAY SPLIT vs CHRONOLOGICAL SPLIT (same data) ===');
let seed=987;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const allDays=[...new Set(E.map(x=>x.d))];
const shuf=[...allDays].sort(()=>rnd()-0.5);
const rTrain=new Set(shuf.slice(0,Math.floor(shuf.length/2))), rTest=new Set(shuf.slice(Math.floor(shuf.length/2)));
function bestSubgroupGain(trainPred,testPred){
  // pick the single best stock on TRAIN, measure it on TEST — the naive procedure
  let best=null;
  for(const s of bySym){
    const a=clus(E.filter(x=>x.sym===s&&trainPred(x)));
    if(a.days<60)continue;
    if(!best||a.mean>best.a.mean)best={s,a};
  }
  if(!best)return null;
  const b=clus(E.filter(x=>x.sym===best.s&&testPred(x)));
  return {sym:best.s,train:best.a.mean,test:b.mean};
}
const rr=bestSubgroupGain(x=>rTrain.has(x.d),x=>rTest.has(x.d));
const cc=bestSubgroupGain(x=>x.d<='2019-12-31',x=>x.d>='2020-01-01');
console.log(`  RANDOM split   : best stock on train ${rr.sym.padEnd(11)} train ${rr.train.toFixed(3)}%  ->  test ${rr.test.toFixed(3)}%   (decay ${(100*(1-rr.test/rr.train)).toFixed(0)}%)`);
console.log(`  CHRONOLOGICAL  : best stock on train ${cc.sym.padEnd(11)} train ${cc.train.toFixed(3)}%  ->  test ${cc.test.toFixed(3)}%   (decay ${(100*(1-cc.test/cc.train)).toFixed(0)}%)`);
console.log('\n  A random split makes the same procedure look better than it is, because');
console.log('  adjacent days share market regime and leak across the boundary.');
fs.writeFileSync('/tmp/p4e_ledger.json',JSON.stringify({cells,devPos,repl,replEcon,symbols:symRows.length,sPos,sRep,sEcon,LED},null,1));
