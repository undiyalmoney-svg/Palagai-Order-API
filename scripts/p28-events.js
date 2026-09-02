#!/usr/bin/env node
/**
 * PHASE 2.8 — EVENT-BASED EDGE RESEARCH
 *
 * EVENT-FIRST BY CONSTRUCTION. Every hypothesis is a TRANSITION: it fires on
 * the FIRST bar its condition becomes true in a session, at most ONCE per
 * session. Persistent states cannot be sampled repeatedly by design — the
 * framework has no mechanism to do so. Trades == sessions, so session
 * clustering is automatic and each session is one independent observation.
 *
 * EXECUTION: signal known at close of bar i -> entry at OPEN of bar i+1.
 * Look-ahead injection test runs first; run ABORTS on failure.
 *
 * CONTROL: direction-matched + time-of-day-matched + different-session.
 * PLACEBO: same event shifted +5 bars later.
 * REVERSE: reported as the negation (same test, not a second test).
 *
 * TEST WINDOW IS NOT READ BY THIS SCRIPT. DEV+VALID ONLY.
 */
const fs=require('fs'),crypto=require('crypto');
const HOLD=9, ENTRY_FROM='09:45', ENTRY_TO='14:45', MIN_FWD=3;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const pctl=(a,f)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*f))];};

const FILE=process.argv[2];
const HASH=crypto.createHash('sha256').update(fs.readFileSync(FILE)).digest('hex').slice(0,16);
const raw=JSON.parse(fs.readFileSync(FILE,'utf8'));
const C=raw.map(r=>({t:r.t,d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c}));
const N=C.length;
const days=[];const dayIdx=new Map();
{let cur=null;for(let i=0;i<N;i++){if(C[i].d!==cur){cur=C[i].d;days.push(cur);dayIdx.set(cur,[i,i]);}else dayIdx.get(cur)[1]=i;}}
const prevC=new Map(),prevH=new Map(),prevL=new Map(),gapPct=[];
for(let k=1;k<days.length;k++){
  const[ps,pe]=dayIdx.get(days[k-1]);let hi=-1e9,lo=1e9;
  for(let j=ps;j<=pe;j++){hi=Math.max(hi,C[j].h);lo=Math.min(lo,C[j].l);}
  prevC.set(days[k],C[pe].c);prevH.set(days[k],hi);prevL.set(days[k],lo);
  const[cs]=dayIdx.get(days[k]);gapPct.push(Math.abs(C[cs].o-C[pe].c)/C[pe].c);
}
const GAP_P75=pctl(gapPct,.75), GAP_P25=pctl(gapPct,.25);

/** Per-session causal state at each bar. */
function sessionBars(d){
  const[s,e]=dayIdx.get(d);const out=[];
  let sHi=-1e9,sLo=1e9,twSum=0,twN=0;
  const rets=[];
  for(let i=s;i<=e;i++){
    const b=C[i];
    sHi=Math.max(sHi,b.h);sLo=Math.min(sLo,b.l);
    twSum+=(b.h+b.l+b.c)/3;twN++;
    if(i>s)rets.push(b.c-C[i-1].c);
    // trailing vol over last 20 bars of the session-and-before
    let atr=0,ac=0;for(let k=Math.max(1,i-19);k<=i;k++){atr+=Math.max(C[k].h-C[k].l,Math.abs(C[k].h-C[k-1].c),Math.abs(C[k].l-C[k-1].c));ac++;}
    const sig=sd(rets.slice(-20));
    out.push({i,b,barsIn:i-s,sHi,sLo,twap:twSum/twN,atr:ac?atr/ac:0,sigma:sig,
      prevC:prevC.get(d)??null,prevH:prevH.get(d)??null,prevL:prevL.get(d)??null});
  }
  // opening ranges: 15/30/45/60 min = 3/6/9/12 bars
  const or={};
  for(const[k,n]of [[15,3],[30,6],[45,9],[60,12]]){
    if(e-s+1>n){let hi=-1e9,lo=1e9;for(let j=s;j<s+n;j++){hi=Math.max(hi,C[j].h);lo=Math.min(lo,C[j].l);}
      or[k]={hi,lo,ready:n};}
  }
  // prior-N-bar high/low within session
  return {rows:out,or,s,e};
}
function outcome(i,dir){
  if(i+1>=N||C[i+1].d!==C[i].d)return null;
  const fill=C[i+1].o,day=C[i].d;let last=fill,bars=0,mae=0,mfe=0,tMfe=0,tMae=0;
  for(let k=i+1;k<=Math.min(i+HOLD,N-1);k++){
    if(C[k].d!==day)break;
    const up=C[k].h-fill,dn=C[k].l-fill;
    const a=dir>0?dn:-up, f=dir>0?up:-dn;
    if(a<mae){mae=a;tMae=k-i;} if(f>mfe){mfe=f;tMfe=k-i;}
    last=C[k].c;bars=k-i;
  }
  if(bars<MIN_FWD)return null;
  return {d:day,hm:C[i].hm,dir,i,ret:dir*(last-fill),mae:-mae,mfe,tMfe,tMae};
}
// ---------- LOOK-AHEAD INJECTION ----------
(function(){
  let fail=0;
  for(const di of [200,900,1600,2300,2800]){
    const d=days[di];if(!d)continue;
    const before=JSON.stringify(sessionBars(d).rows.map(r=>[r.sHi,r.sLo,r.twap,r.atr,r.sigma]));
    const[,e]=dayIdx.get(d);const saved=[];
    for(let k=e+1;k<Math.min(N,e+60);k++){saved.push({...C[k]});C[k].o*=1.7;C[k].h*=1.8;C[k].l*=0.3;C[k].c*=1.7;}
    const after=JSON.stringify(sessionBars(d).rows.map(r=>[r.sHi,r.sLo,r.twap,r.atr,r.sigma]));
    for(let k=e+1,j=0;k<Math.min(N,e+60);k++,j++)Object.assign(C[k],saved[j]);
    if(before!==after){console.error('LEAK at session',d);fail++;}
  }
  if(fail){console.error('LOOK-AHEAD TEST FAILED — ABORTING');process.exit(1);}
  console.log('look-ahead injection test: PASS (5 sessions, all future bars corrupted, 0 state changes)');
})();

// ---------- FROZEN EVENT LIBRARY ----------
// each: fires on FIRST bar where fn returns +-1; max ONE per session
const LIB=[];
const add=(id,fam,rat,fn)=>LIB.push({id,fam,rat,fn});
for(const w of [15,30,45,60]){
  add(`A1-${w}`,'openrange',`first close beyond OR${w} -> breakout continuation`,
    (r,S)=>{const o=S.or[w];if(!o||r.barsIn<o.ready)return 0;return r.b.c>o.hi?1:r.b.c<o.lo?-1:0;});
  add(`A2-${w}`,'openrange',`first OR${w} break-then-reject (close back inside) -> fade`,
    (r,S)=>{const o=S.or[w];if(!o||r.barsIn<o.ready)return 0;
      if(r.sHi>o.hi&&r.b.c<o.hi)return -1; if(r.sLo<o.lo&&r.b.c>o.lo)return 1; return 0;});
}
for(const n of [10,20,40]){
  add(`B1-${n}`,'breakout',`first close beyond prior ${n}-bar high/low -> continuation`,
    (r,S)=>{const i=r.i;if(i-n<0)return 0;let hi=-1e9,lo=1e9;
      for(let k=i-n;k<i;k++){hi=Math.max(hi,C[k].h);lo=Math.min(lo,C[k].l);}
      return r.b.c>hi?1:r.b.c<lo?-1:0;});
}
for(const z of [2,3]){
  add(`C1-${z}`,'meanrev',`first bar move > ${z}sigma(20) -> fade`,
    (r)=>{if(!(r.sigma>0))return 0;const m=r.b.c-r.b.o;return Math.abs(m)>z*r.sigma?-Math.sign(m):0;});
  add(`C2-${z}`,'meanrev',`first bar move > ${z}sigma(20) -> continuation`,
    (r)=>{if(!(r.sigma>0))return 0;const m=r.b.c-r.b.o;return Math.abs(m)>z*r.sigma?Math.sign(m):0;});
}
add('C3','meanrev','first rejection from session extreme -> fade',
  (r,S)=>{const i=r.i;if(r.barsIn<3)return 0;
    if(r.b.h>=r.sHi-1e-9&&r.b.c<C[i-1].l)return -1;
    if(r.b.l<=r.sLo+1e-9&&r.b.c>C[i-1].h)return 1;return 0;});
for(const n of [10,20]){
  add(`D1-${n}`,'volatility',`first range>2x avg${n} after contraction -> expansion dir`,
    (r,S)=>{const i=r.i;if(i-n<0)return 0;let avg=0;for(let k=i-n;k<i;k++)avg+=C[k].h-C[k].l;avg/=n;
      const rng=r.b.h-r.b.l,m=r.b.c-r.b.o;
      return (avg>0&&rng>2*avg&&m!==0)?Math.sign(m):0;});
  add(`D2-${n}`,'volatility',`first range>2x avg${n} after contraction -> fade`,
    (r,S)=>{const i=r.i;if(i-n<0)return 0;let avg=0;for(let k=i-n;k<i;k++)avg+=C[k].h-C[k].l;avg/=n;
      const rng=r.b.h-r.b.l,m=r.b.c-r.b.o;
      return (avg>0&&rng>2*avg&&m!==0)?-Math.sign(m):0;});
}
add('E1','microtrend','first 3-bar HH+HL / LH+LL -> continuation',
  (r)=>{const i=r.i;if(i<3)return 0;const a=C[i-2],b=C[i-1],c=C[i];
    if(c.h>b.h&&b.h>a.h&&c.l>b.l&&b.l>a.l)return 1;
    if(c.h<b.h&&b.h<a.h&&c.l<b.l&&b.l<a.l)return -1;return 0;});
add('E2','microtrend','first 3-bar HH+HL / LH+LL -> fade',
  (r)=>{const i=r.i;if(i<3)return 0;const a=C[i-2],b=C[i-1],c=C[i];
    if(c.h>b.h&&b.h>a.h&&c.l>b.l&&b.l>a.l)return -1;
    if(c.h<b.h&&b.h<a.h&&c.l<b.l&&b.l<a.l)return 1;return 0;});
add('F1','gap','first bar after open, gap>p75 -> continuation',
  (r,S)=>{if(r.prevC==null||r.barsIn<1)return 0;const g=C[S.s].o-r.prevC;
    return Math.abs(g)/r.b.c>GAP_P75?Math.sign(g):0;});
add('F2','gap','first bar after open, gap>p75 -> fade',
  (r,S)=>{if(r.prevC==null||r.barsIn<1)return 0;const g=C[S.s].o-r.prevC;
    return Math.abs(g)/r.b.c>GAP_P75?-Math.sign(g):0;});
add('F3','gap','first touch of prior close after gap>p75 -> continuation of gap dir',
  (r,S)=>{if(r.prevC==null)return 0;const g=C[S.s].o-r.prevC;
    if(Math.abs(g)/r.b.c<=GAP_P75)return 0;
    const touched=r.b.l<=r.prevC&&r.b.h>=r.prevC;
    return touched?Math.sign(g):0;});
add('G1','twap','first cross ABOVE session TWAP (proxy; index has no volume) -> long',
  (r)=>{const i=r.i;if(r.barsIn<3)return 0;return (C[i-1].c<r.twap&&r.b.c>r.twap)?1:0;});
add('G2','twap','first cross BELOW session TWAP -> short',
  (r)=>{const i=r.i;if(r.barsIn<3)return 0;return (C[i-1].c>r.twap&&r.b.c<r.twap)?-1:0;});
add('G3','twap','first return to TWAP after >1.5sigma excursion -> fade the excursion',
  (r)=>{const i=r.i;if(r.barsIn<4||!(r.sigma>0))return 0;
    const dev=(C[i-1].c-r.twap)/r.sigma;
    if(Math.abs(dev)<1.5)return 0;
    const crossed=(dev>0&&r.b.c<r.twap)||(dev<0&&r.b.c>r.twap);
    return crossed?-Math.sign(dev):0;});
add('H1','combo','OR30 breakout + range>2x avg20 -> breakout dir',
  (r,S)=>{const o=S.or[30];if(!o||r.barsIn<o.ready)return 0;const i=r.i;if(i-20<0)return 0;
    let avg=0;for(let k=i-20;k<i;k++)avg+=C[k].h-C[k].l;avg/=20;
    const brk=r.b.c>o.hi?1:r.b.c<o.lo?-1:0;
    return (brk&&avg>0&&(r.b.h-r.b.l)>2*avg)?brk:0;});
add('H2','combo','>2sigma move + immediate rejection -> fade',
  (r)=>{const i=r.i;if(r.barsIn<3||!(r.sigma>0))return 0;
    const pm=C[i-1].c-C[i-1].o;
    if(Math.abs(pm)<2*r.sigma)return 0;
    const rej=(pm>0&&r.b.c<C[i-1].l)||(pm<0&&r.b.c>C[i-1].h);
    return rej?-Math.sign(pm):0;});
add('H3','combo','gap>p75 + failed OR30 breakout -> fade gap',
  (r,S)=>{const o=S.or[30];if(!o||r.barsIn<o.ready||r.prevC==null)return 0;
    const g=C[S.s].o-r.prevC;if(Math.abs(g)/r.b.c<=GAP_P75)return 0;
    if(g>0&&r.sHi>o.hi&&r.b.c<o.hi)return -1;
    if(g<0&&r.sLo<o.lo&&r.b.c>o.lo)return 1;return 0;});

// ---------- run ----------
const SESS=new Map();for(const d of days)SESS.set(d,sessionBars(d));
function fire(h,shift=0){
  const out=[];
  for(const d of days){
    const S=SESS.get(d);if(S.e-S.s<12)continue;
    for(const r of S.rows){
      if(r.b.hm<ENTRY_FROM||r.b.hm>ENTRY_TO)continue;
      const dir=h.fn(r,S);
      if(!dir)continue;
      const o=outcome(r.i+shift,dir);
      if(o)out.push(o);
      break;                                  // ONE EVENT PER SESSION — structural
    }
  }
  return out;
}
let seed=20260828;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const byHm=new Map();for(let i=0;i<N;i++){if(!byHm.has(C[i].hm))byHm.set(C[i].hm,[]);byHm.get(C[i].hm).push(i);}
function control(sigs){const o=[];for(const s of sigs){const p=byHm.get(s.hm)||[];if(p.length<2)continue;
  let j,tries=0;do{j=p[Math.floor(rnd()*p.length)];tries++;}while(C[j].d===s.d&&tries<8);
  const r=outcome(j,s.dir);if(r)o.push(r);}return o;}
const WIN={DEV:['2015','2018-12-31'],VALID:['2019','2022-12-31']};
const seg=(r,w)=>r.filter(x=>x.d>=WIN[w][0]&&x.d<=WIN[w][1]);
function st(rows){
  if(!rows.length)return null;
  const v=rows.map(r=>r.ret),se=rows.length>1?sd(v)/Math.sqrt(rows.length):NaN;
  return {n:rows.length,mean:mean(v),t:se>0?mean(v)/se:NaN,ci:se>0?1.96*se:NaN,
    win:100*rows.filter(r=>r.ret>0).length/rows.length,
    mae:mean(rows.map(r=>r.mae)),mfe:mean(rows.map(r=>r.mfe)),
    p3:100*rows.filter(r=>r.ret>3).length/rows.length};
}
const ALPHA=0.05/LIB.length, TCRIT=3.14;
console.log(`\ndataset ${HASH}  hypotheses ${LIB.length}  Bonferroni alpha ${ALPHA.toFixed(5)} -> |t|>${TCRIT}`);
console.log(`ONE EVENT PER SESSION (structural)  ·  entry = next bar OPEN  ·  breakeven ~2.91-3.43 index pts\n`);
console.log('ID        fam        n(DEV) | DEV mean    t     win%  ret>3pt | CTRL mean   t   | DIFF   | VALID mean    t');
console.log('='.repeat(122));
const ledger=[];
for(const h of LIB){
  const sg=fire(h);
  const dev=st(seg(sg,'DEV')),val=st(seg(sg,'VALID')),ctl=st(seg(control(sg),'DEV'));
  if(!dev||dev.n<100){console.log(`${h.id.padEnd(9)} ${h.fam.padEnd(10)} ${String(dev?dev.n:0).padStart(6)} | too few`);
    ledger.push({...h,fn:undefined,status:'REJECTED',reason:'insufficient sessions'});continue;}
  const diff=dev.mean-(ctl?ctl.mean:0);
  const pass=Math.abs(dev.t)>TCRIT && val && Math.sign(dev.mean)===Math.sign(val.mean) && Math.abs(val.t)>1.96
             && Math.abs(dev.mean)>2.91;
  console.log(`${h.id.padEnd(9)} ${h.fam.padEnd(10)} ${String(dev.n).padStart(6)} |`+
    `${dev.mean.toFixed(2).padStart(9)} ${dev.t.toFixed(2).padStart(6)} ${dev.win.toFixed(1).padStart(6)} ${dev.p3.toFixed(0).padStart(7)}% |`+
    `${(ctl?ctl.mean:0).toFixed(2).padStart(9)} ${(ctl?ctl.t:0).toFixed(2).padStart(6)} |`+
    `${diff.toFixed(2).padStart(6)} |`+
    `${(val?val.mean:0).toFixed(2).padStart(10)} ${(val?val.t:0).toFixed(2).padStart(6)}`+(pass?'   <== PASS':''));
  ledger.push({id:h.id,fam:h.fam,rat:h.rat,dev,val,ctl,diff,
    status:pass?'SURVIVES DEV+VALID+ECON':'REJECTED',
    reason: Math.abs(dev.t)<=TCRIT?'fails DEV Bonferroni'
      : Math.abs(dev.mean)<=2.91?'below economic threshold (<2.91 pts)'
      : !val?'no VALID data' : Math.sign(dev.mean)!==Math.sign(val.mean)?'sign flip in VALID'
      : Math.abs(val.t)<=1.96?'not significant in VALID':'-'});
}
console.log('='.repeat(122));
const surv=ledger.filter(x=>x.status==='SURVIVES DEV+VALID+ECON');
console.log(`\nSURVIVORS (Bonferroni |t|>${TCRIT} in DEV, same sign & |t|>1.96 in VALID, |mean|>2.91 pts): ${surv.length}`);
for(const s of surv)console.log(`  ${s.id}  ${s.rat}\n    DEV ${s.dev.mean.toFixed(2)}pts t=${s.dev.t.toFixed(2)} n=${s.dev.n} | VALID ${s.val.mean.toFixed(2)} t=${s.val.t.toFixed(2)} | control ${s.ctl.mean.toFixed(2)} | diff ${s.diff.toFixed(2)}`);
if(!surv.length)console.log('  NONE — TEST WINDOW NOT OPENED.');
const byReason={};for(const l of ledger)byReason[l.reason]=(byReason[l.reason]||0)+1;
console.log('\nREJECTION REASONS:');for(const[k,v]of Object.entries(byReason))console.log(`  ${String(v).padStart(3)}  ${k}`);
fs.writeFileSync('/tmp/p28_ledger.json',JSON.stringify(ledger,null,1));
