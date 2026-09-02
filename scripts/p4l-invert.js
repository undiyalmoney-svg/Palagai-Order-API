#!/usr/bin/env node
/** PHASE 4.L — "FOLLOW THE LOSERS": find the biggest-losing conditions, invert them,
 *  and test whether the inverted version clears costs. Read-only. TEST excluded.
 *  KEY: gross inverts, CHARGES DO NOT. Inverted net = |gross| - charges.
 *  Conditions are all CAUSAL (known at entry). DEV finds the losers; VALID must confirm. */
const fs=require('fs'),path=require('path');
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const SLIP=0.05, CAP=100000, RISKPCT=1.0;
const DIR=process.argv[2];
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const s=f.replace('.json','');const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10); if(d>='2023-01-01')continue;
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]});}
  S.set(s,bs);}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
const dPos=new Map(dates.map((d,i)=>[d,i]));
const IX=new Map();
for(const r of JSON.parse(fs.readFileSync(process.argv[3],'utf8'))){
  const d=r.t.slice(0,10); if(d>='2023-01-01')continue;
  if(!IX.has(d))IX.set(d,new Map()); IX.get(d).set(r.t.slice(11,16),r.c);}
/** every 1H-ORB long trade with causal tags, gross and charges kept SEPARATE */
const T=[];
for(const d of dates){
  const ixm=IX.get(d)||new Map();
  const ixO=ixm.get('09:15'), ix1=ixm.get('10:15');
  const ixMove=(ixO&&ix1)?(ix1-ixO)/ixO*100:null;
  for(const [sym,bs] of S){
    const a=bs.get(d); if(!a||a.length<40)continue;
    let H1=-1e9,L1=1e9,v1=0;
    for(let k=0;k<12;k++){H1=Math.max(H1,a[k].h);L1=Math.min(L1,a[k].l);v1+=a[k].v;}
    if(!(H1>L1))continue;
    const px=a[11].c, rngPct=(H1-L1)/px*100;
    const i=dPos.get(d); const prev=i>0?bs.get(dates[i-1]):null;
    const gap=(prev&&prev.length)?(a[0].o-prev[prev.length-1].c)/prev[prev.length-1].c*100:null;
    const stkRet=(a[11].c-a[0].o)/a[0].o*100;
    const rs=(ixMove!=null)?stkRet-ixMove:null;
    let cr=null;
    for(let j=12;j<a.length-1;j++){if(a[j].hm>='15:10')break; if(a[j].c>H1){cr=j;break;}}
    if(cr==null)continue;
    const e=cr+1; if(e>=a.length)continue;
    const raw=a[e].o; if(!(raw>0))continue;
    const fill=raw*(1+SLIP/100), stop=L1;
    const R=fill-stop; if(!(R>0))continue;
    const qty=Math.floor((CAP*RISKPCT/100)/R); if(qty<1)continue;
    let exit=null;
    for(let j=e;j<a.length;j++){
      if(a[j].hm>='15:15'){exit=a[j].c;break;}
      if(a[j].o<=stop){exit=a[j].o;break;}
      if(a[j].l<=stop){exit=stop;break;}
      if(j===a.length-1)exit=a[j].c;}
    if(exit==null)continue;
    const ex=exit*(1-SLIP/100);
    const grossRs=(ex-fill)*qty;
    const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
    T.push({d,sym,qty,grossRs,chg,netRs:grossRs-chg,
      ixMove,gap,rngPct,rs,hm:a[cr].hm});
  }
}
console.log(`trades ${T.length.toLocaleString()} · avg charges Rs${mean(T.map(x=>x.chg)).toFixed(0)}\n`);
const DEVf=x=>x.d<='2019-12-31', VALf=x=>x.d>='2020-01-01';
/** CAUSAL conditions only */
const C={
 'idx down by 10:15':      x=>x.ixMove!=null&&x.ixMove<-0.3,
 'idx up by 10:15':        x=>x.ixMove!=null&&x.ixMove>0.3,
 'idx flat by 10:15':      x=>x.ixMove!=null&&Math.abs(x.ixMove)<=0.3,
 'gap down >0.3%':         x=>x.gap!=null&&x.gap<-0.3,
 'gap up >0.3%':           x=>x.gap!=null&&x.gap>0.3,
 'wide 1H range >2%':      x=>x.rngPct>2,
 'narrow 1H range <1%':    x=>x.rngPct<1,
 'stock lagging index':    x=>x.rs!=null&&x.rs<0,
 'stock leading index':    x=>x.rs!=null&&x.rs>0,
 'late cross (after 13:30)':x=>x.hm>='13:30',
 'early cross (<11:30)':   x=>x.hm<'11:30',
 'ALL TRADES':             ()=>true,
};
console.log('THE "FOLLOW THE LOSERS" TEST');
console.log('For each condition: what is the AS-IS result, and what does INVERTING it give?');
console.log('Inverted net = -gross - charges   (gross flips sign; charges are paid either way)\n');
console.log('condition                    n     | DEV as-is  DEV gross  chg | INVERTED DEV | INVERTED VALID | works?');
console.log('='.repeat(112));
const rows=[];
for(const [name,f] of Object.entries(C)){
  const dv=T.filter(x=>DEVf(x)&&f(x)), vl=T.filter(x=>VALf(x)&&f(x));
  if(dv.length<200||vl.length<200)continue;
  const dGross=mean(dv.map(x=>x.grossRs)), dChg=mean(dv.map(x=>x.chg)), dNet=mean(dv.map(x=>x.netRs));
  const vGross=mean(vl.map(x=>x.grossRs)), vChg=mean(vl.map(x=>x.chg));
  const invD=-dGross-dChg, invV=-vGross-vChg;
  const ok=invD>0&&invV>0;
  rows.push({name,n:dv.length,dNet,dGross,dChg,invD,invV,ok});
  console.log(`${name.padEnd(27)}${String(dv.length).padStart(6)} |`+
    `${dNet.toFixed(0).padStart(10)}${dGross.toFixed(0).padStart(11)}${dChg.toFixed(0).padStart(5)} |`+
    `${invD.toFixed(0).padStart(13)} |${invV.toFixed(0).padStart(15)} |  ${ok?'YES':'no'}`);
}
console.log('='.repeat(112));
rows.sort((a,b)=>a.dNet-b.dNet);
console.log(`\nBIGGEST LOSERS IN DEV (the ones "following the losers" would target):`);
for(const r of rows.slice(0,4))
  console.log(`  ${r.name.padEnd(27)} loses Rs${r.dNet.toFixed(0)}/trade  ->  inverted gives Rs${r.invD.toFixed(0)} DEV, Rs${r.invV.toFixed(0)} VALID`);
console.log(`\nworking inversions: ${rows.filter(r=>r.ok).length} of ${rows.length}`);
console.log('\n=== WHY: THE ARITHMETIC, PER TRADE ===');
const all=rows.find(r=>r.name==='ALL TRADES');
console.log(`  as-is      gross Rs${all.dGross.toFixed(0)}  - charges Rs${all.dChg.toFixed(0)}  = Rs${all.dNet.toFixed(0)}`);
console.log(`  inverted   gross Rs${(-all.dGross).toFixed(0)}  - charges Rs${all.dChg.toFixed(0)}  = Rs${all.invD.toFixed(0)}`);
console.log(`  the loss is NOT Rs${Math.abs(all.dNet).toFixed(0)} of edge going the wrong way.`);
console.log(`  it is Rs${Math.abs(all.dGross).toFixed(0)} of edge going the wrong way PLUS Rs${all.dChg.toFixed(0)} of charges.`);
console.log(`  inverting recovers the Rs${Math.abs(all.dGross).toFixed(0)}. It does not recover the Rs${all.dChg.toFixed(0)}.`);
console.log(`  breakeven needs |gross| > Rs${all.dChg.toFixed(0)} per trade. Observed |gross| = Rs${Math.abs(all.dGross).toFixed(0)}.`);
