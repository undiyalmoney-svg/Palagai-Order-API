#!/usr/bin/env node
/**
 * PHASE 2.9 — HORIZON DISCOVERY + CONDITIONAL BEHAVIOUR MAPPING
 * DEV+VALID ONLY (2015-2022). The 2023-2026 TEST window is CLOSED and this
 * script filters it out at load time so it cannot be read at all.
 * Events fire ONCE per session; entry = OPEN of bar i+1. Controls are
 * direction + time-of-day + different-session matched.
 */
const fs=require('fs'),crypto=require('crypto');
const EF='09:45',ET='14:45';
const HZ=[[1,'5m'],[2,'10m'],[3,'15m'],[6,'30m'],[9,'45m'],[12,'60m'],[18,'90m'],[24,'120m']];
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const pc=(a,f)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*f))];};
const FILE=process.argv[2];
const HASH=crypto.createHash('sha256').update(fs.readFileSync(FILE)).digest('hex').slice(0,16);
const all=JSON.parse(fs.readFileSync(FILE,'utf8'));
// HARD CUT: TEST WINDOW NEVER LOADED
const C=all.filter(r=>r.t<'2023-01-01').map(r=>({t:r.t,d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c}));
const N=C.length;const days=[];const di=new Map();
{let cur=null;for(let i=0;i<N;i++){if(C[i].d!==cur){cur=C[i].d;days.push(cur);di.set(cur,[i,i]);}else di.get(cur)[1]=i;}}
console.log(`dataset ${HASH}  DEV+VALID ONLY: ${C[0].d} -> ${C[N-1].d}  bars ${N}  sessions ${days.length}`);
console.log('TEST window 2023-2026 is filtered out at load — not readable by this script.\n');
const prevC=new Map(),gaps=[];
for(let k=1;k<days.length;k++){const[,pe]=di.get(days[k-1]);const[cs]=di.get(days[k]);
  prevC.set(days[k],C[pe].c);gaps.push(Math.abs(C[cs].o-C[pe].c)/C[pe].c);}
const GP75=pc(gaps,.75);

/** forward path from entry at bar i+1; returns per-horizon stats + threshold crossings */
function path(i,dir){
  if(i+1>=N||C[i+1].d!==C[i].d)return null;
  const fill=C[i+1].o,day=C[i].d;
  const out={hz:{},firstHit:{}};
  let mae=0,mfe=0,last=fill,bars=0;
  const thr=[1,2,3,5,10]; const hit={};
  for(const x of thr)hit[x]=null;
  for(let k=i+1;k<=Math.min(i+24,N-1);k++){
    if(C[k].d!==day)break;
    const up=dir>0?C[k].h-fill:fill-C[k].l;
    const dn=dir>0?C[k].l-fill:fill-C[k].h;
    if(dn<mae)mae=dn; if(up>mfe)mfe=up;
    last=C[k].c;bars=k-i;
    for(const x of thr){ if(hit[x]===null){ if(up>=x)hit[x]='+'; else if(-dn>=x)hit[x]='-'; } }
    for(const[hb,lbl]of HZ) if(bars===hb) out.hz[lbl]={ret:dir*(last-fill),mae:-mae,mfe};
  }
  if(bars<1)return null;
  for(const[hb,lbl]of HZ) if(!out.hz[lbl]&&bars>=1) out.hz[lbl]=null;  // truncated by session end
  out.firstHit=hit; out.bars=bars; out.d=day; out.hm=C[i].hm; out.dir=dir;
  return out;
}
// ---------- EVENT LIBRARY (established families only) ----------
const EV={};
EV['A extreme bar 3sig -> dir']=(r)=>{if(!(r.sigma>0))return 0;const m=r.b.c-r.b.o;return Math.abs(m)>3*r.sigma?Math.sign(m):0;};
EV['B OR30 breakout -> dir']=(r,S)=>{const o=S.or30;if(!o||r.barsIn<6)return 0;return r.b.c>o.hi?1:r.b.c<o.lo?-1:0;};
EV['C failed OR30 break -> fade']=(r,S)=>{const o=S.or30;if(!o||r.barsIn<6)return 0;
  if(r.sHi>o.hi&&r.b.c<o.hi)return -1;if(r.sLo<o.lo&&r.b.c>o.lo)return 1;return 0;};
EV['D sweep/reject session extreme']=(r)=>{const i=r.i;if(r.barsIn<3)return 0;
  if(r.b.h>=r.sHi-1e-9&&r.b.c<C[i-1].l)return -1;
  if(r.b.l<=r.sLo+1e-9&&r.b.c>C[i-1].h)return 1;return 0;};
EV['E compression -> expansion']=(r)=>{const i=r.i;if(i-20<0)return 0;let a=0;for(let k=i-20;k<i;k++)a+=C[k].h-C[k].l;a/=20;
  const rg=r.b.h-r.b.l,m=r.b.c-r.b.o;return (a>0&&rg>2*a&&m!==0)?Math.sign(m):0;};
EV['F 2sig move + rejection']=(r)=>{const i=r.i;if(r.barsIn<3||!(r.sigma>0))return 0;
  const pm=C[i-1].c-C[i-1].o;if(Math.abs(pm)<2*r.sigma)return 0;
  const rej=(pm>0&&r.b.c<C[i-1].l)||(pm<0&&r.b.c>C[i-1].h);return rej?-Math.sign(pm):0;};
EV['G gap>p75 first bar -> dir']=(r,S)=>{if(r.prevC==null||r.barsIn<1)return 0;
  const g=C[S.s].o-r.prevC;return Math.abs(g)/r.b.c>GP75?Math.sign(g):0;};
EV['H trend break (3-bar)']=(r)=>{const i=r.i;if(i<3)return 0;const a=C[i-2],b=C[i-1],c=C[i];
  if(c.h<b.h&&b.h>a.h&&c.l<b.l&&b.l>a.l)return -1;
  if(c.h>b.h&&b.h<a.h&&c.l>b.l&&b.l<a.l)return 1;return 0;};

function sessionRows(d){
  const[s,e]=di.get(d);const rows=[];let sHi=-1e9,sLo=1e9;const rets=[];
  let or30=null;
  if(e-s>=6){let hi=-1e9,lo=1e9;for(let j=s;j<s+6;j++){hi=Math.max(hi,C[j].h);lo=Math.min(lo,C[j].l);}or30={hi,lo};}
  for(let i=s;i<=e;i++){sHi=Math.max(sHi,C[i].h);sLo=Math.min(sLo,C[i].l);
    if(i>s)rets.push(C[i].c-C[i-1].c);
    rows.push({i,b:C[i],barsIn:i-s,sHi,sLo,sigma:sd(rets.slice(-20)),prevC:prevC.get(d)??null});}
  return {rows,or30,s,e};
}
const SESS=new Map();for(const d of days)SESS.set(d,sessionRows(d));
function fire(fn,shift=0){const out=[];
  for(const d of days){const S=SESS.get(d);if(S.e-S.s<26)continue;
    for(const r of S.rows){if(r.b.hm<EF||r.b.hm>ET)continue;
      const dir=fn(r,S);if(!dir)continue;
      const p=path(r.i+shift,dir);if(p)out.push(p);break;}}
  return out;}
let seed=29082026;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const byHm=new Map();for(let i=0;i<N;i++){if(!byHm.has(C[i].hm))byHm.set(C[i].hm,[]);byHm.get(C[i].hm).push(i);}
function ctrl(sg){const o=[];for(const s of sg){const p=byHm.get(s.hm)||[];if(p.length<2)continue;
  let j,t=0;do{j=p[Math.floor(rnd()*p.length)];t++;}while(C[j].d===s.d&&t<8);
  const r=path(j,s.dir);if(r)o.push(r);}return o;}
const getH=(rows,lbl,f)=>rows.map(r=>r.hz[lbl]).filter(x=>x).map(f);
function tt(a,b){ // Welch
  if(a.length<10||b.length<10)return NaN;
  const va=sd(a)**2/a.length, vb=sd(b)**2/b.length;
  return (mean(a)-mean(b))/Math.sqrt(va+vb);
}
// ---------- A. UNCONDITIONAL BASELINE ----------
console.log('A. UNCONDITIONAL FORWARD MOVEMENT (all bars 09:45-14:45, long-side convention)');
console.log('hz     n      mean    sd     p5      p25     p75     p95   | P|r|>1  >2   >3   >5   >10');
{const samp=[];for(let i=0;i<N-25;i+=7){if(C[i].hm<EF||C[i].hm>ET)continue;const p=path(i,1);if(p)samp.push(p);}
 for(const[hb,lbl]of HZ){const v=getH(samp,lbl,x=>x.ret);if(v.length<50)continue;
   const ab=v.map(Math.abs);
   console.log(`${lbl.padEnd(6)}${String(v.length).padStart(6)}${mean(v).toFixed(2).padStart(9)}${sd(v).toFixed(1).padStart(7)}`+
     `${pc(v,.05).toFixed(1).padStart(8)}${pc(v,.25).toFixed(1).padStart(8)}${pc(v,.75).toFixed(1).padStart(8)}${pc(v,.95).toFixed(1).padStart(8)} |`+
     [1,2,3,5,10].map(x=>(100*ab.filter(y=>y>x).length/ab.length).toFixed(0).padStart(5)).join(''));}}

// ---------- B. HORIZON MATRIX: SIGNAL - CONTROL (signed return) ----------
const NTEST=Object.keys(EV).length*HZ.length*2;
const TCRIT=3.65;
console.log(`\nB. DIRECTIONAL: signal minus matched control, index points  [${Object.keys(EV).length} events x ${HZ.length} horizons x 2 outcomes = ${NTEST} tests; Bonferroni |t|>${TCRIT}]`);
console.log('event                          n     5m     10m    15m    30m    45m    60m    90m   120m');
const LED=[];
const FIRED={},CTRLS={};
for(const[name,fn]of Object.entries(EV)){
  const sg=fire(fn);FIRED[name]=sg;const ct=ctrl(sg);CTRLS[name]=ct;
  if(sg.length<150){console.log(`${name.padEnd(30)}${String(sg.length).padStart(5)}  (too few)`);continue;}
  let row=`${name.padEnd(30)}${String(sg.length).padStart(5)}`;
  for(const[hb,lbl]of HZ){
    const a=getH(sg,lbl,x=>x.ret),b=getH(ct,lbl,x=>x.ret);
    if(a.length<100){row+='     -';continue;}
    const d=mean(a)-mean(b),t=tt(a,b);
    row+=`${d.toFixed(2).padStart(7)}${Math.abs(t)>TCRIT?'*':' '}`;
    LED.push({ev:name,hz:lbl,kind:'direction',n:a.length,diff:d,t});
  }
  console.log(row);
}
console.log('  * = passes Bonferroni |t|>3.65 vs matched control');

// ---------- C. MAGNITUDE / VOLATILITY ----------
console.log(`\nC. MAGNITUDE: E[|return|] ratio signal/control  (>1 = event predicts BIGGER moves, no direction implied)`);
console.log('event                          n     5m     10m    15m    30m    45m    60m    90m   120m');
for(const[name,sg]of Object.entries(FIRED)){
  const ct=CTRLS[name];if(sg.length<150)continue;
  let row=`${name.padEnd(30)}${String(sg.length).padStart(5)}`;
  for(const[hb,lbl]of HZ){
    const a=getH(sg,lbl,x=>Math.abs(x.ret)),b=getH(ct,lbl,x=>Math.abs(x.ret));
    if(a.length<100||!mean(b)){row+='     -';continue;}
    const ratio=mean(a)/mean(b),t=tt(a,b);
    row+=`${ratio.toFixed(2).padStart(7)}${Math.abs(t)>TCRIT?'*':' '}`;
    LED.push({ev:name,hz:lbl,kind:'magnitude',n:a.length,ratio,t});
  }
  console.log(row);
}
console.log('  * = passes Bonferroni |t|>3.65 vs matched control');

// ---------- D. THRESHOLD CROSSING ----------
console.log(`\nD. THRESHOLD CROSSING within 120 min: P(+X before -X), signal vs control  [break-even region 2.91-3.43 pts]`);
console.log('event                          n   | +1/-1  ctrl | +3/-3  ctrl | +5/-5  ctrl | +10/-10 ctrl');
for(const[name,sg]of Object.entries(FIRED)){
  const ct=CTRLS[name];if(sg.length<150)continue;
  let row=`${name.padEnd(30)}${String(sg.length).padStart(4)}  |`;
  for(const x of [1,3,5,10]){
    const f=(rs)=>{const h=rs.map(r=>r.firstHit[x]).filter(v=>v);return h.length?100*h.filter(v=>v==='+').length/h.length:NaN;};
    row+=`${f(sg).toFixed(1).padStart(6)}${f(ct).toFixed(1).padStart(6)} |`;
  }
  console.log(row);
}
console.log('  50.0 = coin flip. Values are % of resolved cases where +X was reached before -X.');
fs.writeFileSync('/tmp/p29_ledger.json',JSON.stringify(LED,null,1));
console.log(`\ntotal tests recorded: ${LED.length}`);
