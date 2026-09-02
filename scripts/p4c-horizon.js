#!/usr/bin/env node
/** PHASE 4.C — does the CONFIRMED 4.A mean-reversion mechanism scale with holding period?
 *  Read-only; no broker imports. TEST (>=2023) physically excluded at load. */
const fs=require('fs'),path=require('path');
const EF='09:45',ET='14:45',MINF=3;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const {estimateEquityRoundTripCharges:MIS,estimateDeliveryRoundTripCharges:CNC}=require('../live/equity-charges.js');
const P=1000,Q=50,TV=P*Q;
const H_MIS=100*MIS({entryPrice:P,exitPrice:P,quantity:Q}).totalRs/TV;   // 0.106
const H_CNC=100*CNC({entryPrice:P,exitPrice:P,quantity:Q}).totalRs/TV;   // 0.258
const FULL_MIS=H_MIS+0.20, FULL_CNC=H_CNC+0.40;
const DIR=process.argv[2];
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const s=f.replace('.json','');
  const rows=JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'));
  const bs=new Map();
  for(const r of rows){const d=r[0].slice(0,10);
    if(d>='2023-01-01')continue;                       // TEST PHYSICALLY EXCLUDED
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]});}
  S.set(s,bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
const dPos=new Map(dates.map((d,i)=>[d,i]));
console.log(`symbols ${S.size} · sessions ${dates.length} · ${dates[0]} -> ${dates[dates.length-1]}  (TEST excluded at load)`);
console.log(`hurdles: MIS statutory ${H_MIS.toFixed(3)}% full ${FULL_MIS.toFixed(3)}% | CNC statutory ${H_CNC.toFixed(3)}% full ${FULL_CNC.toFixed(3)}%\n`);
const DEVf=d=>d<='2019-12-31', VALf=d=>d>='2020-01-01'&&d<='2022-12-31';
const HZ=[['15m',3,'intra'],['30m',6,'intra'],['45m',9,'intra'],['60m',12,'intra'],
          ['90m',18,'intra'],['120m',24,'intra'],['EOD',null,'intra'],
          ['nextOpen',null,'over'],['2d',2,'over'],['3d',3,'over'],['5d',5,'over']];
function feats(arr,j){
  const b=arr[j];
  const rets=[];for(let k=Math.max(1,j-20);k<j;k++)rets.push((arr[k].c-arr[k-1].c)/arr[k-1].c*100);
  const vol=sd(rets); if(!(vol>0))return null;
  const rH=arr.slice(Math.max(0,j-20),j).map(x=>(x.h-x.l)/x.c*100), mrng=med(rH);
  if(!(mrng>0))return null;
  const rng=(b.h-b.l)/b.c*100, body=b.c-b.o;
  const r1=(b.c-arr[j-1].c)/arr[j-1].c*100;
  return {rng,mrng,body,r1,vol,vB:vol>0.25?2:vol>0.15?1:0};
}
/** exit price for a horizon; returns null if unobservable */
function exitPx(sym,d,arr,j,hz){
  const [,n,kind]=hz;
  if(kind==='intra'){
    if(hz[0]==='EOD')return arr[arr.length-1].c;
    const e=j+n; if(e>=arr.length)return null;   // must not spill past the session
    return arr[e].c;
  }
  const i=dPos.get(d);
  if(hz[0]==='nextOpen'){const nd=dates[i+1];if(!nd)return null;
    const a2=S.get(sym).get(nd); return a2&&a2.length?a2[0].o:null;}
  const nd=dates[i+n]; if(!nd)return null;
  const a2=S.get(sym).get(nd); return a2&&a2.length?a2[a2.length-1].c:null;
}
const SIG={
  S1_A12:f=>(f.rng>3*f.mrng&&f.body!==0)?-Math.sign(f.body):0,
  S2_A4 :f=>(Math.abs(f.r1)>3*f.vol)?-Math.sign(f.r1):0,
};
const NTEST=Object.keys(SIG).length*HZ.length, TCRIT=3.05;
console.log(`tests ${NTEST} (2 frozen signals x ${HZ.length} horizons)  Bonferroni ${(0.05/NTEST).toFixed(5)} -> |t|>${TCRIT}\n`);
let seed=717171;
const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
function run(sigFn,hz){
  const sig=new Map(),ctl=new Map();
  for(const d of dates){
    const pool=[],fired=[];
    for(const [sym,bs] of S){
      const arr=bs.get(d); if(!arr||arr.length<30)continue;
      let hit=null;
      for(let j=21;j<arr.length;j++){
        if(arr[j].hm<EF||arr[j].hm>ET)continue;
        const f=feats(arr,j); if(!f)continue;
        pool.push({sym,arr,j,f});
        if(hit)continue;
        const dir=sigFn(f); if(!dir)continue;
        if(j+1>=arr.length)continue;
        const fill=arr[j+1].o; if(!(fill>0))continue;
        const px=exitPx(sym,d,arr,j,hz); if(px==null||!(px>0))continue;
        hit={sym,dir,r:dir*((px-fill)/fill*100),vB:f.vB,j};
      }
      if(hit)fired.push(hit);
    }
    if(!fired.length)continue;
    sig.set(d,fired.map(x=>x.r));
    const cr=[];
    for(const s of fired){
      const cand=pool.filter(p=>p.sym!==s.sym&&p.f.vB===s.vB&&Math.abs(p.j-s.j)<=3);
      if(!cand.length)continue;
      const p=cand[Math.floor(rnd()*cand.length)];
      if(p.j+1>=p.arr.length)continue;
      const fill=p.arr[p.j+1].o; if(!(fill>0))continue;
      const px=exitPx(p.sym,d,p.arr,p.j,hz); if(px==null||!(px>0))continue;
      cr.push(s.dir*((px-fill)/fill*100));
    }
    if(cr.length)ctl.set(d,cr);
  }
  return {sig,ctl};
}
const cl=(m,pr)=>{const v=[];for(const[d,a]of m)if(pr(d))v.push(mean(a));
  const se=v.length>1?sd(v)/Math.sqrt(v.length):NaN;return{n:v.length,mean:mean(v),t:se>0?mean(v)/se:NaN,v};};
const W=(x,y)=>(x.length<10||y.length<10)?NaN:(mean(x)-mean(y))/Math.sqrt(sd(x)**2/x.length+sd(y)**2/y.length);
console.log('signal   horizon  cost | DEV diff%    t   | VALID diff%    t   | full hurdle  1.5x  | verdict');
console.log('='.repeat(108));
const LED=[];
for(const [sname,sfn] of Object.entries(SIG)){
  for(const hz of HZ){
    const {sig,ctl}=run(sfn,hz);
    const ds=cl(sig,DEVf),dc=cl(ctl,DEVf),vs=cl(sig,VALf),vc=cl(ctl,VALf);
    if(ds.n<100){console.log(`${sname.padEnd(9)}${hz[0].padEnd(9)}${hz[2].padEnd(6)}| too few dates (${ds.n})`);continue;}
    const dD=ds.mean-dc.mean, vD=vs.mean-vc.mean;
    const dT=W(ds.v,dc.v), vT=W(vs.v,vc.v);
    const stat=hz[2]==='intra'?H_MIS:H_CNC, full=hz[2]==='intra'?FULL_MIS:FULL_CNC;
    const need=1.5*full;
    const best=Math.min(Math.abs(dD),Math.abs(vD));
    const sameSign=Math.sign(dD)===Math.sign(vD);
    const statOK=best>stat, econOK=best>need;
    const passStat=Math.abs(dT)>TCRIT&&sameSign&&Math.abs(vT)>1.96;
    const verdict=(passStat&&econOK)?'YES-GO CAND':(passStat?'stat only':'fails stat');
    console.log(`${sname.padEnd(9)}${hz[0].padEnd(9)}${hz[2].padEnd(6)}|`+
      `${dD.toFixed(3).padStart(9)}${(Number.isFinite(dT)?dT.toFixed(2):'-').padStart(7)} |`+
      `${vD.toFixed(3).padStart(10)}${(Number.isFinite(vT)?vT.toFixed(2):'-').padStart(7)} |`+
      `${full.toFixed(3).padStart(9)}${need.toFixed(3).padStart(7)}  | ${verdict}`);
    LED.push({sig:sname,hz:hz[0],kind:hz[2],dD,dT,vD,vT,stat,full,need,statOK,econOK,passStat,verdict});
  }
}
console.log('='.repeat(108));
const C=LED.filter(x=>x.passStat&&x.econOK);
console.log(`\nYES-GO CANDIDATES (stat gate + >=1.5x full cost): ${C.length}`);
if(!C.length)console.log('  NONE — TEST NOT OPENED.');
const statOnly=LED.filter(x=>x.passStat&&!x.econOK);
console.log(`statistically significant but economically insufficient: ${statOnly.length}`);
for(const s of statOnly.slice(0,12))
  console.log(`  ${s.sig} ${s.hz.padEnd(9)} DEV ${s.dD.toFixed(3)}% t=${s.dT.toFixed(2)} · VALID ${s.vD.toFixed(3)}% t=${s.vT.toFixed(2)} · needs ${s.need.toFixed(3)}%`);
const bestAny=LED.filter(x=>Number.isFinite(x.dT)).sort((a,b)=>Math.min(Math.abs(b.dD),Math.abs(b.vD))-Math.min(Math.abs(a.dD),Math.abs(a.vD)))[0];
if(bestAny)console.log(`\nlargest control-adjusted effect anywhere: ${bestAny.sig} ${bestAny.hz} = ${Math.min(Math.abs(bestAny.dD),Math.abs(bestAny.vD)).toFixed(3)}% (needs ${bestAny.need.toFixed(3)}%)`);
fs.writeFileSync('/tmp/p4c_ledger.json',JSON.stringify(LED,null,1));
