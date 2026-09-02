#!/usr/bin/env node
/** PHASE 4.0 — INDIAN CASH-EQUITY EDGE DISCOVERY. Read-only; no broker imports.
 *  Spec hash 85e379fc040d416f (frozen before any predictive result).
 *  Event -> entry at OPEN of T+1 -> exit at CLOSE of T+5. One event/symbol/date.
 *  Controls: same-date, different-symbol, liquidity- and volatility-bucket matched,
 *  direction matched. Stats DATE-CLUSTERED. DEV+VALID only; TEST NOT READ. */
const fs=require('fs');
const HOLD=5, MIN_PX=20, MIN_TV=5e7, MIN_HIST=60;
const HURDLE=0.658;                       // % net move, from repo equity-charges + slippage
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const J=JSON.parse(fs.readFileSync('/tmp/eq_panel.json','utf8'));
const dates=J.dates, T=dates.length;
const P=new Map(J.panel.map(([s,arr])=>[s,new Map(arr)]));
const NIF=new Map(JSON.parse(fs.readFileSync(process.argv[2],'utf8')).map(r=>[r.d,r.c]));
const nifAt=dates.map(d=>NIF.get(d)??null);
// TEST window index cut — bars after this are never read
const DEV=[0,dates.findIndex(d=>d>'2018-12-31')];
const VAL=[DEV[1],dates.findIndex(d=>d>'2022-12-31')];
const LAST=VAL[1];
console.log(`panel ${P.size} symbols · ${T} sessions · DEV ${dates[DEV[0]]}..${dates[DEV[1]-1]} · VALID ${dates[VAL[0]]}..${dates[VAL[1]-1]}`);
console.log(`TEST (${dates[LAST]}..) NOT READ. hurdle ${HURDLE}% net.\n`);

/** causal features for symbol s at index i (uses only <= i) */
function feat(m,i){
  const c=m.get(i); if(!c)return null;
  if(!(c.c>=MIN_PX))return null;
  const hist=[];for(let k=i-20;k<i;k++){const b=m.get(k);if(b)hist.push(b);}
  if(hist.length<14)return null;
  const mtv=med(hist.map(b=>b.val||0)); if(!(mtv>=MIN_TV))return null;
  let n=0;for(let k=i-MIN_HIST;k<i;k++)if(m.get(k))n++;
  if(n<MIN_HIST*0.7)return null;
  const p1=m.get(i-1); if(!p1)return null;
  const r1=(c.c-p1.c)/p1.c*100;
  const rets=[];for(let k=i-20;k<i;k++){const a=m.get(k),b=m.get(k-1);if(a&&b)rets.push((a.c-b.c)/b.c*100);}
  const vol=sd(rets); if(!(vol>0))return null;
  const p5=m.get(i-5), p20=m.get(i-20);
  const r5=p5?(c.c-p5.c)/p5.c*100:null, r20=p20?(c.c-p20.c)/p20.c*100:null;
  const mv=med(hist.map(b=>b.v||0));
  const relVol=mv>0?c.v/mv:null;
  const rng=(c.h-c.l)/c.c*100;
  const mrng=med(hist.map(b=>(b.h-b.l)/b.c*100));
  const gap=(c.o-p1.c)/p1.c*100;
  const clv=(c.h-c.l)>0?(c.c-c.l)/(c.h-c.l):0.5;
  // relative to NIFTY (index known at same close)
  let rel1=null,rel5=null;
  if(nifAt[i]&&nifAt[i-1])rel1=r1-((nifAt[i]-nifAt[i-1])/nifAt[i-1]*100);
  if(nifAt[i]&&nifAt[i-5])rel5=(r5!=null)?r5-((nifAt[i]-nifAt[i-5])/nifAt[i-5]*100):null;
  return {c,r1,r5,r20,vol,relVol,rng,mrng,gap,clv,rel1,rel5,mtv,
          volB:mtv>2e8?2:mtv>1e8?1:0, vB:vol>3?2:vol>1.8?1:0};
}
/** entry OPEN of i+1, exit CLOSE of i+HOLD */
function fwd(m,i,dir){
  const e=m.get(i+1); if(!e||!(e.o>0))return null;
  const x=m.get(i+HOLD); if(!x||!(x.c>0))return null;
  return dir*((x.c-e.o)/e.o*100);
}
// ---------- FROZEN LIBRARY: 20 distinct conditions, each two-sided ----------
const L=[];const A=(id,fam,rat,fn)=>L.push({id,fam,rat,fn});
A('M1','momentum','|1d move|>2*vol -> continue',        f=>Math.abs(f.r1)>2*f.vol?Math.sign(f.r1):0);
A('M2','momentum','|1d move|>3*vol -> continue',        f=>Math.abs(f.r1)>3*f.vol?Math.sign(f.r1):0);
A('M3','momentum','5d move >2*vol*sqrt5 -> continue',   f=>f.r5!=null&&Math.abs(f.r5)>2*f.vol*Math.sqrt(5)?Math.sign(f.r5):0);
A('M4','momentum','20d move >8% -> continue',           f=>f.r20!=null&&Math.abs(f.r20)>8?Math.sign(f.r20):0);
A('R1','reversal','|1d move|>3*vol -> FADE',            f=>Math.abs(f.r1)>3*f.vol?-Math.sign(f.r1):0);
A('R2','reversal','5d move >2*vol*sqrt5 -> FADE',       f=>f.r5!=null&&Math.abs(f.r5)>2*f.vol*Math.sqrt(5)?-Math.sign(f.r5):0);
A('R3','reversal','exhaustion: big range + close at opposite extreme',
   f=>{if(!(f.rng>2*f.mrng))return 0;return f.clv<0.2?1:f.clv>0.8?-1:0;});
A('V1','volume','relVol>3 -> continue day direction',   f=>f.relVol>3&&f.r1!==0?Math.sign(f.r1):0);
A('V2','volume','relVol>5 -> continue day direction',   f=>f.relVol>5&&f.r1!==0?Math.sign(f.r1):0);
A('V3','volume','relVol>3 -> FADE day direction',       f=>f.relVol>3&&f.r1!==0?-Math.sign(f.r1):0);
A('V4','volume','relVol<0.4 (quiet) -> continue',       f=>f.relVol!=null&&f.relVol<0.4&&f.r1!==0?Math.sign(f.r1):0);
A('D1','relative','1d rel-to-NIFTY >2*vol -> continue', f=>f.rel1!=null&&Math.abs(f.rel1)>2*f.vol?Math.sign(f.rel1):0);
A('D2','relative','1d rel-to-NIFTY >2*vol -> FADE',     f=>f.rel1!=null&&Math.abs(f.rel1)>2*f.vol?-Math.sign(f.rel1):0);
A('D3','relative','5d rel-to-NIFTY >5% -> continue',    f=>f.rel5!=null&&Math.abs(f.rel5)>5?Math.sign(f.rel5):0);
A('D4','relative','5d rel-to-NIFTY >5% -> FADE',        f=>f.rel5!=null&&Math.abs(f.rel5)>5?-Math.sign(f.rel5):0);
A('G1','gap','gap >1.5*vol -> continue',                f=>Math.abs(f.gap)>1.5*f.vol?Math.sign(f.gap):0);
A('G2','gap','gap >1.5*vol -> FADE',                    f=>Math.abs(f.gap)>1.5*f.vol?-Math.sign(f.gap):0);
A('G3','gap','gap >1.5*vol WITH relVol>2 -> continue',  f=>(Math.abs(f.gap)>1.5*f.vol&&f.relVol>2)?Math.sign(f.gap):0);
A('F1','volatility','range compression then expansion', f=>(f.mrng>0&&f.rng>2.5*f.mrng&&f.r1!==0)?Math.sign(f.r1):0);
A('F2','volatility','range>2.5x median -> FADE',        f=>(f.mrng>0&&f.rng>2.5*f.mrng&&f.r1!==0)?-Math.sign(f.r1):0);

const TCRIT=3.02, ALPHA=0.05/L.length;
console.log(`conditions ${L.length}  Bonferroni ${ALPHA.toFixed(5)} -> |t|>${TCRIT}\n`);
// ---------- precompute features once per (symbol,date) ----------
const byDate=new Map();          // i -> [{sym,f}]
for(const[sym,m]of P){
  for(const i of m.keys()){
    if(i<MIN_HIST||i+HOLD>=LAST)continue;
    const f=feat(m,i); if(!f)continue;
    if(!byDate.has(i))byDate.set(i,[]);
    byDate.get(i).push({sym,f,m});
  }
}
const dIdx=[...byDate.keys()].sort((a,b)=>a-b);
console.log(`eligible symbol-dates after frozen universe filter: ${dIdx.reduce((a,i)=>a+byDate.get(i).length,0).toLocaleString()} over ${dIdx.length} dates\n`);
let seed=40040;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
function run(fn){
  const sig=[],ctl=[];
  for(const i of dIdx){
    const pool=byDate.get(i);
    const fired=[];
    for(const e of pool){ const d=fn(e.f); if(d){const r=fwd(e.m,i,d); if(r!=null)fired.push({sym:e.sym,dir:d,r,volB:e.f.volB,vB:e.f.vB});} }
    if(!fired.length)continue;
    sig.push({i,d:dates[i],rows:fired});
    // matched control: same date, different symbol, same liquidity+vol bucket, same direction
    const cr=[];
    for(const s of fired){
      const cand=pool.filter(e=>e.sym!==s.sym&&e.f.volB===s.volB&&e.f.vB===s.vB);
      if(!cand.length)continue;
      const pick=cand[Math.floor(rnd()*cand.length)];
      const r=fwd(pick.m,i,s.dir); if(r!=null)cr.push({r});
    }
    if(cr.length)ctl.push({i,d:dates[i],rows:cr});
  }
  return {sig,ctl};
}
/** DATE-CLUSTERED: one observation per date */
function clus(days,a,b){
  const v=days.filter(x=>x.i>=a&&x.i<b).map(x=>mean(x.rows.map(r=>r.r)));
  const se=v.length>1?sd(v)/Math.sqrt(v.length):NaN;
  return {n:v.length,mean:mean(v),t:se>0?mean(v)/se:NaN,ci:se>0?1.96*se:NaN,v};
}
const W=(x,y)=>(x.length<10||y.length<10)?NaN:(mean(x)-mean(y))/Math.sqrt(sd(x)**2/x.length+sd(y)**2/y.length);
console.log('ID  fam         dates | DEV sig%  ctrl%   DIFF     t    | VALID sig%  ctrl%  DIFF     t    | econ');
console.log('='.repeat(114));
const LED=[];
for(const h of L){
  const {sig,ctl}=run(h.fn);
  const ds=clus(sig,DEV[0],DEV[1]), dc=clus(ctl,DEV[0],DEV[1]);
  const vs=clus(sig,VAL[0],VAL[1]), vc=clus(ctl,VAL[0],VAL[1]);
  if(ds.n<100){console.log(`${h.id.padEnd(4)}${h.fam.padEnd(12)}${String(ds.n).padStart(5)}  too few dates`);
    LED.push({id:h.id,fam:h.fam,rat:h.rat,status:'INSUFFICIENT'});continue;}
  const dD=ds.mean-dc.mean, vD=vs.mean-vc.mean;
  const dT=W(ds.v,dc.v), vT=W(vs.v,vc.v);
  const econ=Math.abs(dD)>HURDLE&&Math.abs(vD)>HURDLE;
  const pass=Math.abs(dT)>TCRIT&&Math.sign(dD)===Math.sign(vD)&&Math.abs(vT)>1.96&&econ;
  console.log(`${h.id.padEnd(4)}${h.fam.padEnd(12)}${String(ds.n).padStart(5)} |`+
    `${ds.mean.toFixed(3).padStart(8)}${dc.mean.toFixed(3).padStart(8)}${dD.toFixed(3).padStart(8)}${(Number.isFinite(dT)?dT.toFixed(2):'-').padStart(6)} |`+
    `${vs.mean.toFixed(3).padStart(9)}${vc.mean.toFixed(3).padStart(8)}${vD.toFixed(3).padStart(8)}${(Number.isFinite(vT)?vT.toFixed(2):'-').padStart(6)} |`+
    `${econ?' YES':'  no'}`+(pass?'  <== PASS':''));
  LED.push({id:h.id,fam:h.fam,rat:h.rat,devDates:ds.n,dD,dT,vD,vT,econ,
    status:pass?'SURVIVES':'REJECTED',
    reason:!Number.isFinite(dT)||Math.abs(dT)<=TCRIT?'fails DEV Bonferroni'
      :Math.sign(dD)!==Math.sign(vD)?'sign flip in VALID'
      :Math.abs(vT)<=1.96?'not significant in VALID':!econ?'below economic hurdle':'-'});
}
console.log('='.repeat(114));
const S=LED.filter(x=>x.status==='SURVIVES');
console.log(`\nSURVIVORS (DEV |t|>${TCRIT}, VALID same sign & |t|>1.96, |diff| > ${HURDLE}% in BOTH): ${S.length}`);
for(const s of S)console.log(`  ${s.id} ${s.rat}\n     DEV ${s.dD.toFixed(3)}% t=${s.dT.toFixed(2)} | VALID ${s.vD.toFixed(3)}% t=${s.vT.toFixed(2)}`);
if(!S.length)console.log('  NONE — TEST WINDOW NOT OPENED.');
const R={};for(const l of LED)R[l.reason||l.status]=(R[l.reason||l.status]||0)+1;
console.log('\nREJECTION REASONS:');for(const[k,v]of Object.entries(R))console.log(`  ${String(v).padStart(3)}  ${k}`);
const wt=LED.filter(x=>Number.isFinite(x.dT)).sort((a,b)=>Math.abs(b.dT)-Math.abs(a.dT))[0];
if(wt)console.log(`\nstrongest DEV |t|: ${wt.id} = ${Math.abs(wt.dT).toFixed(2)}  (diff ${wt.dD.toFixed(3)}%, hurdle ${HURDLE}%)`);
fs.writeFileSync('/tmp/p40_ledger.json',JSON.stringify(LED,null,1));
