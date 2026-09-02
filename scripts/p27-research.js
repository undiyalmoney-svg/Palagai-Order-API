#!/usr/bin/env node
/**
 * PHASE 2.7 — CAUSAL ENTRY RESEARCH
 *
 * NON-NEGOTIABLE RULE, ENFORCED STRUCTURALLY:
 *   features at bar i use ONLY bars 0..i  ->  entry = OPEN of bar i+1
 * A look-ahead injection test corrupts every bar > i and asserts that no
 * feature value changes. If it changes, the harness aborts.
 *
 * HYPOTHESIS LIBRARY IS FROZEN BEFORE ANY RESULT (17 primary tests).
 * Bonferroni: 0.05/17 = 0.0029.
 * Statistics are SESSION-CLUSTERED: each session contributes one observation
 * (the mean of its signals), because intra-session signals are not
 * independent. This is the conservative choice.
 *
 * TEST WINDOW IS NOT PRINTED unless a candidate has already survived
 * DEV and VALID. Structural protection against test-set contamination.
 */
const fs=require('fs'),crypto=require('crypto');
const HOLD=9, ENTRY_FROM='09:45', ENTRY_TO='14:45', MIN_FWD=3;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const pctl=(a,f)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*f))];};

const raw=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const HASH=crypto.createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex').slice(0,16);
const C=raw.map(r=>({t:r.t,d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c}));
const N=C.length;

// ---------- session index ----------
const sessStart=new Array(N); const sessOf=new Map();
{let cur=null,st=0;for(let i=0;i<N;i++){if(C[i].d!==cur){cur=C[i].d;st=i;sessOf.set(cur,st);}sessStart[i]=st;}}
const prevSessClose=new Array(N).fill(null), prevSessHi=new Array(N).fill(null), prevSessLo=new Array(N).fill(null);
{const days=[...new Set(C.map(x=>x.d))];
 const agg=new Map();
 for(const d of days){const s=sessOf.get(d);let e=s;while(e<N&&C[e].d===d)e++;
   let hi=-1e9,lo=1e9;for(let k=s;k<e;k++){hi=Math.max(hi,C[k].h);lo=Math.min(lo,C[k].l);}
   agg.set(d,{close:C[e-1].c,hi,lo,s,e});}
 for(let i=0;i<N;i++){const idx=days.indexOf; }
 const dayList=days;
 for(let di=1;di<dayList.length;di++){
   const p=agg.get(dayList[di-1]),cu=agg.get(dayList[di]);
   for(let k=cu.s;k<cu.e;k++){prevSessClose[k]=p.close;prevSessHi[k]=p.hi;prevSessLo[k]=p.lo;}}}

/** ALL features use bars <= i only. */
function features(i){
  const s=sessStart[i], b=C[i];
  const barsIn=i-s;
  const r=(n)=> i-n>=0 ? b.c-C[i-n].c : null;
  const rng=b.h-b.l;
  // trailing ranges / ATR (bars i-19..i)
  let atr=0,cnt=0;for(let k=Math.max(1,i-19);k<=i;k++){atr+=Math.max(C[k].h-C[k].l,Math.abs(C[k].h-C[k-1].c),Math.abs(C[k].l-C[k-1].c));cnt++;}
  atr=cnt?atr/cnt:0;
  // trailing distribution of bar ranges (100 bars, excluding i so thresholds are prior-known)
  const hist=[];for(let k=Math.max(0,i-100);k<i;k++)hist.push(C[k].h-C[k].l);
  const rngP50=pctl(hist,.5),rngP90=pctl(hist,.9),rngP25=pctl(hist,.25);
  // ATR percentile vs trailing 100 ATR values approximated by range median
  const atrPctRank=hist.length?hist.filter(x=>x<atr).length/hist.length:0.5;
  // sma20 of closes
  let sma=0,sc=0;for(let k=Math.max(0,i-19);k<=i;k++){sma+=C[k].c;sc++;}sma/=Math.max(1,sc);
  // opening range = first 6 bars of session (09:15-09:45); known only after bar s+5
  let orHi=null,orLo=null;
  if(barsIn>=6){orHi=-1e9;orLo=1e9;for(let k=s;k<s+6;k++){orHi=Math.max(orHi,C[k].h);orLo=Math.min(orLo,C[k].l);}}
  // consecutive directional bars ending at i
  let consec=0;{const dir=Math.sign(C[i].c-C[i].o);if(dir!==0){consec=1;
    for(let k=i-1;k>=Math.max(0,i-5);k--){if(Math.sign(C[k].c-C[k].o)===dir)consec++;else break;}consec*=dir;}}
  // session-so-far extremes (bars s..i)
  let sHi=-1e9,sLo=1e9;for(let k=s;k<=i;k++){sHi=Math.max(sHi,C[k].h);sLo=Math.min(sLo,C[k].l);}
  const gap = prevSessClose[i]!=null ? C[s].o - prevSessClose[i] : null;
  return {b,barsIn,r3:r(3),r6:r(6),r12:r(12),r1:b.c-b.o,rng,atr,rngP50,rngP90,rngP25,atrPctRank,
    sma,orHi,orLo,consec,sHi,sLo,gap,prevHi:prevSessHi[i],prevLo:prevSessLo[i]};
}

// ---------- LOOK-AHEAD INJECTION TEST ----------
(function leakTest(){
  const probes=[5000,20000,60000,120000,180000];
  let fail=0;
  for(const i of probes){
    const before=JSON.stringify(features(i));
    const saved=[];
    for(let k=i+1;k<Math.min(N,i+30);k++){saved.push({...C[k]});
      C[k].o*=1.5;C[k].h*=1.6;C[k].l*=0.4;C[k].c*=1.5;}
    const after=JSON.stringify(features(i));
    for(let k=i+1,j=0;k<Math.min(N,i+30);k++,j++)Object.assign(C[k],saved[j]);
    if(before!==after){console.error(`LEAK at bar ${i}`);fail++;}
  }
  if(fail){console.error('LOOK-AHEAD INJECTION TEST FAILED — aborting');process.exit(1);}
  console.log(`look-ahead injection test: PASS (${probes.length} probes, future bars corrupted, 0 feature changes)`);
})();

// ---------- forward outcome, entry at NEXT BAR OPEN ----------
function outcome(i,dir){
  if(i+1>=N||C[i+1].d!==C[i].d)return null;
  const fill=C[i+1].o, day=C[i].d;
  let last=fill,bars=0,mae=0,mfe=0;
  for(let k=i+1;k<=Math.min(i+HOLD,N-1);k++){
    if(C[k].d!==day)break;
    const up=C[k].h-fill,dn=C[k].l-fill;
    if(dir>0){mae=Math.min(mae,dn);mfe=Math.max(mfe,up);}else{mae=Math.min(mae,-up);mfe=Math.max(mfe,-dn);}
    last=C[k].c;bars=k-i;
  }
  if(bars<MIN_FWD)return null;
  return {d:day,hm:C[i].hm,dir,ret:dir*(last-fill),mae:-mae,mfe,bars,fill};
}

// ---------- FROZEN HYPOTHESIS LIBRARY (17) ----------
const H=[
 // MOMENTUM
 ['M1','ret3 continuation, |ret3|>median bar range', f=>f.r3!=null&&Math.abs(f.r3)>f.rngP50?Math.sign(f.r3):0],
 ['M2','ret6 continuation, |ret6|>median bar range', f=>f.r6!=null&&Math.abs(f.r6)>f.rngP50?Math.sign(f.r6):0],
 ['M3','ret12 continuation, |ret12|>median bar range',f=>f.r12!=null&&Math.abs(f.r12)>f.rngP50?Math.sign(f.r12):0],
 ['M4','opening-range(30m) breakout continuation',   f=>f.orHi==null?0:(f.b.c>f.orHi?1:f.b.c<f.orLo?-1:0)],
 ['M5','prior-session high/low breakout',            f=>f.prevHi==null?0:(f.b.c>f.prevHi?1:f.b.c<f.prevLo?-1:0)],
 // MEAN REVERSION
 ['R1','single-bar move > p90 range -> fade',        f=>f.rng>f.rngP90&&f.r1!==0?-Math.sign(f.r1):0],
 ['R2','extension from sma20 > 1.5*ATR -> fade',     f=>f.atr>0&&Math.abs(f.b.c-f.sma)>1.5*f.atr?-Math.sign(f.b.c-f.sma):0],
 ['R3','failed OR breakout -> fade',                 f=>{if(f.orHi==null)return 0;
      const brokeUp=f.sHi>f.orHi&&f.b.c<f.orHi, brokeDn=f.sLo<f.orLo&&f.b.c>f.orLo;
      return brokeUp?-1:brokeDn?1:0;}],
 ['R4','ret6 > 2*ATR -> fade',                       f=>f.r6!=null&&f.atr>0&&Math.abs(f.r6)>2*f.atr?-Math.sign(f.r6):0],
 // VOLATILITY / RANGE
 ['V1','compression then expansion -> breakout dir', f=>f.atrPctRank<0.25&&f.rng>f.atr&&f.r1!==0?Math.sign(f.r1):0],
 ['V2','range>p90 -> continuation of that bar',      f=>f.rng>f.rngP90&&f.r1!==0?Math.sign(f.r1):0],
 ['V3','range<p25 -> ret3 continuation',             f=>f.rng<f.rngP25&&f.r3!=null&&f.r3!==0?Math.sign(f.r3):0],
 // STRUCTURE
 ['S1','3-bar HH+HL / LH+LL structure',              f=>0],  // filled below (needs raw bars)
 ['S2','consecutive >=3 directional bars',           f=>Math.abs(f.consec)>=3?Math.sign(f.consec):0],
 // GAP / OVERNIGHT
 ['G1','gap > 0.3% -> continuation',                 f=>f.gap==null?0:(Math.abs(f.gap)/f.b.c>0.003?Math.sign(f.gap):0)],
 ['G2','gap > 0.3% -> fade',                         f=>f.gap==null?0:(Math.abs(f.gap)/f.b.c>0.003?-Math.sign(f.gap):0)],
 ['G3','small gap (<0.1%) -> ret6 continuation',     f=>f.gap==null?0:(Math.abs(f.gap)/f.b.c<0.001&&f.r6!=null&&f.r6!==0?Math.sign(f.r6):0)],
];
function s1(i){ if(i<3)return 0;
  const a=C[i-2],b=C[i-1],c=C[i];
  if(c.h>b.h&&b.h>a.h&&c.l>b.l&&b.l>a.l)return 1;
  if(c.h<b.h&&b.h<a.h&&c.l<b.l&&b.l<a.l)return -1; return 0;}

// ---------- evaluate ----------
const WIN={DEV:['2015','2018-12-31'],VALID:['2019','2022-12-31'],TEST:['2023','2026-12-31']};
let seed=987654321;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const byHm=new Map();for(let i=0;i<N;i++){if(!byHm.has(C[i].hm))byHm.set(C[i].hm,[]);byHm.get(C[i].hm).push(i);}

/** session-clustered t: one observation per session (mean of its signals). */
function clustered(rows){
  const bySess=new Map();
  for(const r of rows){if(!bySess.has(r.d))bySess.set(r.d,[]);bySess.get(r.d).push(r.ret);}
  const m=[...bySess.values()].map(v=>mean(v));
  const se=m.length>1?sd(m)/Math.sqrt(m.length):NaN;
  return {n:rows.length,sess:m.length,mean:mean(m),t:se>0?mean(m)/se:NaN,
    ci:se>0?1.96*se:NaN, win:100*rows.filter(r=>r.ret>0).length/rows.length};
}
function run(fn,isS1){
  const out=[];
  for(let i=20;i<N-1;i++){
    if(C[i].hm<ENTRY_FROM||C[i].hm>ENTRY_TO)continue;
    const f=features(i);
    const dir=isS1?s1(i):fn(f);
    if(!dir)continue;
    const o=outcome(i,dir);
    if(o)out.push(o);
  }
  return out;
}
function control(sigs){
  const out=[];
  for(const s of sigs){
    const pool=byHm.get(s.hm)||[];if(!pool.length)continue;
    const j=pool[Math.floor(rnd()*pool.length)];
    const o=outcome(j,s.dir);   // DIRECTION-MATCHED: same side as the signal it pairs with
    if(o)out.push(o);
  }
  return out;
}
const seg=(rows,w)=>rows.filter(r=>r.d>=WIN[w][0]&&r.d<=WIN[w][1]);

console.log(`\ndataset ${HASH}  bars ${N}  entry window ${ENTRY_FROM}-${ENTRY_TO}  hold ${HOLD} bars (45m)`);
console.log(`hypotheses ${H.length}  Bonferroni alpha = ${(0.05/H.length).toFixed(4)}\n`);
console.log('='.repeat(118));
console.log('ID   n     sess  | DEV mean    t      win%  | CTRL mean    t   | DIFF    | VALID mean    t     win%  | long%');
console.log('='.repeat(118));
const ledger=[];
for(const [id,def,fn] of H){
  const sigs=run(fn,id==='S1');
  if(sigs.length<200){console.log(`${id.padEnd(4)} ${String(sigs.length).padStart(5)}  -- too few signals`);
    ledger.push({id,def,status:'REJECTED',reason:'insufficient signals'});continue;}
  const dev=clustered(seg(sigs,'DEV')), val=clustered(seg(sigs,'VALID'));
  const dseg=seg(sigs,'DEV'); const pctLong=100*dseg.filter(x=>x.dir>0).length/Math.max(1,dseg.length);
  const ctl=clustered(seg(control(sigs),'DEV'));
  const diff=dev.mean-ctl.mean;
  console.log(`${id.padEnd(4)} ${String(dev.n).padStart(5)} ${String(dev.sess).padStart(5)}  |`+
    `${dev.mean.toFixed(3).padStart(9)} ${dev.t.toFixed(2).padStart(7)} ${dev.win.toFixed(1).padStart(7)}  |`+
    `${ctl.mean.toFixed(3).padStart(9)} ${ctl.t.toFixed(2).padStart(6)}  |`+
    `${diff.toFixed(3).padStart(7)}  |`+
    `${val.mean.toFixed(3).padStart(10)} ${val.t.toFixed(2).padStart(7)} ${val.win.toFixed(1).padStart(7)}` +
    `  |${pctLong.toFixed(0).padStart(6)}%`);
  ledger.push({id,def,dev,val,ctl,diff,
    pctLong,
    status:(Math.abs(dev.t)>2.94&&Math.sign(dev.mean)===Math.sign(val.mean)&&Math.abs(val.t)>1.96)?'SURVIVES DEV+VALID':'REJECTED',
    reason:Math.abs(dev.t)<=2.94?'fails DEV Bonferroni':
      Math.sign(dev.mean)!==Math.sign(val.mean)?'sign flips in VALID':
      Math.abs(val.t)<=1.96?'not significant in VALID':'—'});
}
console.log('='.repeat(118));
const surv=ledger.filter(x=>x.status==='SURVIVES DEV+VALID');
console.log(`\nSURVIVORS OF DEV(Bonferroni t>2.94) + VALID(same sign, t>1.96): ${surv.length}`);
for(const s of surv)console.log(`  ${s.id}  ${s.def}\n      DEV ${s.dev.mean.toFixed(3)}pts t=${s.dev.t.toFixed(2)} | VALID ${s.val.mean.toFixed(3)}pts t=${s.val.t.toFixed(2)} | vs control ${s.diff.toFixed(3)}pts`);
if(!surv.length)console.log('  NONE. TEST window not opened.');
fs.writeFileSync('/tmp/p27_ledger.json',JSON.stringify(ledger,null,1));
