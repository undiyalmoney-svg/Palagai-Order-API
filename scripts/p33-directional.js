#!/usr/bin/env node
/** PHASE 3.3 — DIRECTIONAL EDGE DISCOVERY.  Research only; imports no broker module.
 *  RULE A event-first (one per session, FIRST occurrence, structural)
 *  RULE B entry = OPEN of bar i+1
 *  RULE C control matched on direction + time-of-day + pre-event vol decile
 *  RULE D economic gate from the repo cost model
 *  DEV+VALID only in this run. TEST NOT READ.
 *  EXCLUDED BY DESIGN: single-bar |close-open|>3sigma continuation (= C2-3,
 *  already taken to TEST in Phase 2.8 and failed; TEST is contaminated for it).
 */
const fs=require('fs'),crypto=require('crypto');
const EF='09:45',ET='14:45',HOLD=9,MINF=3;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const FILE=process.argv[2];
const HASH=crypto.createHash('sha256').update(fs.readFileSync(FILE)).digest('hex').slice(0,16);
const ALL=JSON.parse(fs.readFileSync(FILE,'utf8'));
const C=ALL.filter(r=>r.t<'2023-01-01').map(r=>({t:r.t,d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c}));
const N=C.length;const days=[];const di=new Map();
{let cur=null;for(let i=0;i<N;i++){if(C[i].d!==cur){cur=C[i].d;days.push(cur);di.set(cur,[i,i]);}else di.get(cur)[1]=i;}}
const TV=new Float64Array(N);
for(let i=0;i<N;i++){const r=[];for(let k=Math.max(1,i-19);k<=i;k++){if(C[k].d===C[i].d)r.push(C[k].c-C[k-1].c);}TV[i]=r.length>2?sd(r):NaN;}
const BND=JSON.parse(fs.readFileSync('/tmp/frozen_bounds.json','utf8')).bounds;
const dec=v=>{let lo=0;for(let d=0;d<9;d++)if(v>BND[d])lo=d+1;return lo;};
const prevC=new Map();
for(let k=1;k<days.length;k++){const[,pe]=di.get(days[k-1]);prevC.set(days[k],C[pe].c);}

/** per-bar causal features, bars <= i only */
function feat(i,s){
  const b=C[i],barsIn=i-s;
  let sma=0,n1=0;for(let k=Math.max(0,i-19);k<=i;k++){sma+=C[k].c;n1++;}sma/=n1;
  let atr=0,n2=0;for(let k=Math.max(1,i-19);k<=i;k++){atr+=Math.max(C[k].h-C[k].l,Math.abs(C[k].h-C[k-1].c),Math.abs(C[k].l-C[k-1].c));n2++;}
  atr=n2?atr/n2:0;
  let avgR=0,n3=0;for(let k=Math.max(0,i-20);k<i;k++){avgR+=C[k].h-C[k].l;n3++;}avgR=n3?avgR/n3:0;
  let rhi=-1e9,rlo=1e9;for(let k=Math.max(0,i-19);k<=i;k++){rhi=Math.max(rhi,C[k].h);rlo=Math.min(rlo,C[k].l);}
  let sHi=-1e9,sLo=1e9,tw=0,tn=0;for(let k=s;k<=i;k++){sHi=Math.max(sHi,C[k].h);sLo=Math.min(sLo,C[k].l);tw+=(C[k].h+C[k].l+C[k].c)/3;tn++;}
  const rng=b.h-b.l, body=b.c-b.o;
  const clv=rng>0?(b.c-b.l)/rng:0.5;                  // close location value 0..1
  const upW=rng>0?(b.h-Math.max(b.o,b.c))/rng:0, dnW=rng>0?(Math.min(b.o,b.c)-b.l)/rng:0;
  let cons=0;{const d0=Math.sign(C[i].c-C[i].o);if(d0){cons=1;for(let k=i-1;k>=Math.max(0,i-5);k--){if(Math.sign(C[k].c-C[k].o)===d0)cons++;else break;}cons*=d0;}}
  const r3=i-3>=0?b.c-C[i-3].c:null, r6=i-6>=0?b.c-C[i-6].c:null, r12=i-12>=0?b.c-C[i-12].c:null;
  const sig=TV[i];
  let or30=null;if(barsIn>=6){let hi=-1e9,lo=1e9;for(let k=s;k<s+6;k++){hi=Math.max(hi,C[k].h);lo=Math.min(lo,C[k].l);}or30={hi,lo};}
  return {b,i,barsIn,sma,atr,avgR,rhi,rlo,sHi,sLo,twap:tn?tw/tn:b.c,rng,body,clv,upW,dnW,cons,r3,r6,r12,sig,or30,
    sOpen:C[s].o,prevC:prevC.get(C[i].d)??null,tv:TV[i]};
}
function fwd(i,dir){
  if(i+1>=N||C[i+1].d!==C[i].d)return null;
  const fill=C[i+1].o,day=C[i].d;let last=fill,bars=0,mae=0,mfe=0;
  for(let k=i+1;k<=Math.min(i+HOLD,N-1);k++){if(C[k].d!==day)break;
    const up=dir>0?C[k].h-fill:fill-C[k].l,dn=dir>0?fill-C[k].l:C[k].h-fill;
    if(dn>mae)mae=dn;if(up>mfe)mfe=up;last=C[k].c;bars=k-i;}
  if(bars<MINF)return null;
  return {d:day,hm:C[i].hm,dir,ret:dir*(last-fill),mae,mfe,tv:TV[i],vdec:dec(TV[i])};
}
// ---------- LOOK-AHEAD CORRUPTION (RULE / trap 1) ----------
(function(){let fail=0;
 for(const idx of [30000,60000,90000,120000,140000]){
  const s=(()=>{const d=C[idx].d;return di.get(d)[0];})();
  const before=JSON.stringify(feat(idx,s));
  const sv=[];for(let k=idx+1;k<Math.min(N,idx+40);k++){sv.push({...C[k]});C[k].o*=1.5;C[k].h*=1.6;C[k].l*=0.4;C[k].c*=1.5;}
  const after=JSON.stringify(feat(idx,s));
  for(let k=idx+1,j=0;k<Math.min(N,idx+40);k++,j++)Object.assign(C[k],sv[j]);
  if(before!==after){console.error('LEAK at',idx);fail++;}}
 if(fail){console.error('LOOK-AHEAD TEST FAILED — ABORT');process.exit(1);}
 console.log('look-ahead corruption test: PASS (5 probes, o*1.5 h*1.6 l*0.4 c*1.5 on all future bars)');})();

// ---------- FROZEN LIBRARY: 22 distinct conditions, each tested TWO-SIDED ----------
// direction returned = the CONTINUATION reading. A negative mean means the
// REVERSAL reading is the tradeable one. Counted as ONE test, not two.
const L=[];const add=(id,fam,rat,fn)=>L.push({id,fam,rat,fn});
add('A1','extremes','|close-sma20| > 2*ATR, dir = away from mean',      f=>f.atr>0&&Math.abs(f.b.c-f.sma)>2*f.atr?Math.sign(f.b.c-f.sma):0);
add('A2','extremes','close in top/bottom 5% of 20-bar range',           f=>{const w=f.rhi-f.rlo;if(!(w>0))return 0;const p=(f.b.c-f.rlo)/w;return p>0.95?1:p<0.05?-1:0;});
add('A3','extremes','3-bar cumulative move > 2*sigma',                  f=>f.sig>0&&f.r3!=null&&Math.abs(f.r3)>2*f.sig?Math.sign(f.r3):0);
add('A4','extremes','6-bar cumulative move > 2.5*sigma',                f=>f.sig>0&&f.r6!=null&&Math.abs(f.r6)>2.5*f.sig?Math.sign(f.r6):0);
add('B1','range','range>2*avg20 AND close in outer 25% of bar',         f=>{if(!(f.avgR>0&&f.rng>2*f.avgR))return 0;return f.clv>0.75?1:f.clv<0.25?-1:0;});
add('B2','range','range>3*avg20 (vol shock), dir = bar body',           f=>f.avgR>0&&f.rng>3*f.avgR&&f.body!==0?Math.sign(f.body):0);
add('B3','range','compression(atr<avgR) then range>2*avg, dir = body',  f=>f.avgR>0&&f.atr<f.avgR&&f.rng>2*f.avgR&&f.body!==0?Math.sign(f.body):0);
add('C1','multiTF','5m body agrees with 30m(6-bar) direction',          f=>{if(f.r6==null||f.body===0)return 0;return Math.sign(f.body)===Math.sign(f.r6)&&Math.abs(f.r6)>f.atr?Math.sign(f.body):0;});
add('C2','multiTF','5m body OPPOSES 60m(12-bar) trend',                 f=>{if(f.r12==null||f.body===0)return 0;return Math.sign(f.body)!==Math.sign(f.r12)&&Math.abs(f.r12)>1.5*f.atr?Math.sign(f.body):0;});
add('C3','multiTF','large 5m move WITH 60m trend',                      f=>{if(f.r12==null||!(f.sig>0))return 0;const m=f.body;
      return Math.abs(m)>1.5*f.sig&&Math.sign(m)===Math.sign(f.r12)?Math.sign(m):0;});
add('D1','opening','first close beyond OR30, vol-conditioned',          f=>{if(!f.or30||f.barsIn<6)return 0;return f.b.c>f.or30.hi?1:f.b.c<f.or30.lo?-1:0;});
add('D2','opening','OR30 break then close back inside (rejection)',     f=>{if(!f.or30||f.barsIn<6)return 0;
      if(f.sHi>f.or30.hi&&f.b.c<f.or30.hi)return -1;if(f.sLo<f.or30.lo&&f.b.c>f.or30.lo)return 1;return 0;});
add('D3','opening','gap>1*sigma from prior close, dir = gap',           f=>{if(f.prevC==null||!(f.sig>0))return 0;const g=f.sOpen-f.prevC;
      return Math.abs(g)>1*f.sig*Math.sqrt(20)?Math.sign(g):0;});
add('E1','location','|close - session TWAP| > 1.5*sigma',               f=>f.sig>0&&Math.abs(f.b.c-f.twap)>1.5*f.sig?Math.sign(f.b.c-f.twap):0);
add('E2','location','|close - session open| > 2*sigma',                 f=>f.sig>0&&Math.abs(f.b.c-f.sOpen)>2*f.sig?Math.sign(f.b.c-f.sOpen):0);
add('E3','location','|close - prior session close| > 2*sigma',          f=>{if(f.prevC==null||!(f.sig>0))return 0;const x=f.b.c-f.prevC;
      return Math.abs(x)>2*f.sig*Math.sqrt(20)?Math.sign(x):0;});
add('E4','location','close at session extreme (new session hi/lo)',     f=>{if(f.barsIn<6)return 0;
      if(f.b.c>=f.sHi-1e-9)return 1;if(f.b.c<=f.sLo+1e-9)return -1;return 0;});
add('F1','micro','strong body: |body|/range > 0.8 and range>avg20',     f=>{if(!(f.rng>0&&f.avgR>0))return 0;
      return (Math.abs(f.body)/f.rng>0.8&&f.rng>f.avgR&&f.body!==0)?Math.sign(f.body):0;});
add('F2','micro','long wick > 0.6 of range, dir = AWAY from wick',      f=>{if(!(f.rng>0))return 0;
      if(f.upW>0.6)return -1;if(f.dnW>0.6)return 1;return 0;});
add('F3','micro','4+ consecutive directional bars',                     f=>Math.abs(f.cons)>=4?Math.sign(f.cons):0);
add('F4','micro','range acceleration: range > 1.5x prior bar range x2',  f=>{const i=f.i;if(i<2)return 0;
      const r0=C[i].h-C[i].l,r1=C[i-1].h-C[i-1].l,r2=C[i-2].h-C[i-2].l;
      return (r0>1.5*r1&&r1>1.5*r2&&f.body!==0)?Math.sign(f.body):0;});
add('G1','interact','2sig move then rejection bar (fade prior bar)',    f=>{const i=f.i;if(f.barsIn<3||!(f.sig>0))return 0;
      const pm=C[i-1].c-C[i-1].o;if(Math.abs(pm)<2*f.sig)return 0;
      const rej=(pm>0&&f.b.c<C[i-1].l)||(pm<0&&f.b.c>C[i-1].h);return rej?-Math.sign(pm):0;});

console.log(`\ndataset ${HASH}  DEV+VALID ${C[0].d}..${C[N-1].d}  conditions ${L.length} (each two-sided)`);
const TC=Math.abs(2.807);  // Bonferroni 0.05/22 two-sided ~ |t|>3.05; computed below
const ALPHA=0.05/L.length;
const TCRIT=3.05;
console.log(`Bonferroni alpha ${ALPHA.toFixed(5)} -> |t| > ${TCRIT}`);
// economic hurdle from repo cost model
const p='./live/charge-entry-gate.js';const src=fs.readFileSync(p,'utf8');
const mm=new module.constructor();mm._compile(src+'\nmodule.exports.__c=estimateRoundTripCharges;',p);
const CHG=mm.exports.__c;
const hurdle=(CHG({entryPrice:120,exitPrice:120,quantity:65}).totalRs+40)/(65*0.5);
console.log(`economic hurdle (repo cost model, +Rs40 theta, delta 0.5, lot 65): ${hurdle.toFixed(2)} index pts\n`);

function fire(fn,shift=0){const out=[];
 for(const d of days){const[s,e]=di.get(d);if(e-s<14)continue;
  for(let i=s+21;i<=e;i++){const hm=C[i].hm;if(hm<EF||hm>ET)continue;
   const dir=fn(feat(i,s));if(!dir)continue;
   const o=fwd(i+shift,dir);if(o)out.push(o);break;}}
 return out;}
let seed=330033;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const bucket=new Map();
for(let i=0;i<N;i++){const hm=C[i].hm;if(hm<EF||hm>ET)continue;if(!Number.isFinite(TV[i]))continue;
 const k=hm+'|'+dec(TV[i]);if(!bucket.has(k))bucket.set(k,[]);bucket.get(k).push(i);}
function ctrl(sg){const o=[];for(const s of sg){const p=bucket.get(s.hm+'|'+s.vdec)||[];if(p.length<3)continue;
 let j,t=0;do{j=p[Math.floor(rnd()*p.length)];t++;}while(C[j].d===s.d&&t<10);
 const r=fwd(j,s.dir);if(r)o.push(r);}return o;}
const W=(a,b)=>(a.length<10||b.length<10)?NaN:(mean(a)-mean(b))/Math.sqrt(sd(a)**2/a.length+sd(b)**2/b.length);
const seg=(r,f,t)=>r.filter(x=>x.d>=f&&x.d<=t);
console.log('ID  fam        n    long% | DEV sig  ctrl   DIFF    t    | VALID sig ctrl  DIFF    t    | econ?');
console.log('='.repeat(118));
const LED=[];
for(const h of L){
  const sg=fire(h.fn);
  if(sg.length<150){console.log(`${h.id.padEnd(4)}${h.fam.padEnd(11)}${String(sg.length).padStart(4)}  too few`);
    LED.push({...h,fn:undefined,status:'REJECTED',reason:'insufficient sessions'});continue;}
  const ct=ctrl(sg);
  const dS=seg(sg,'2015','2018-12-31'),dC=seg(ct,'2015','2018-12-31');
  const vS=seg(sg,'2019','2022-12-31'),vC=seg(ct,'2019','2022-12-31');
  const dD=mean(dS.map(x=>x.ret))-mean(dC.map(x=>x.ret));
  const vD=mean(vS.map(x=>x.ret))-mean(vC.map(x=>x.ret));
  const dT=W(dS.map(x=>x.ret),dC.map(x=>x.ret)), vT=W(vS.map(x=>x.ret),vC.map(x=>x.ret));
  const longPct=100*dS.filter(x=>x.dir>0).length/Math.max(1,dS.length);
  const econ=Math.abs(dD)>hurdle&&Math.abs(vD)>hurdle;
  const pass=Math.abs(dT)>TCRIT&&Math.sign(dD)===Math.sign(vD)&&Math.abs(vT)>1.96&&econ;
  console.log(`${h.id.padEnd(4)}${h.fam.padEnd(11)}${String(sg.length).padStart(4)} ${longPct.toFixed(0).padStart(4)}% |`+
    `${mean(dS.map(x=>x.ret)).toFixed(2).padStart(7)}${mean(dC.map(x=>x.ret)).toFixed(2).padStart(7)}${dD.toFixed(2).padStart(7)}${dT.toFixed(2).padStart(6)} |`+
    `${mean(vS.map(x=>x.ret)).toFixed(2).padStart(8)}${mean(vC.map(x=>x.ret)).toFixed(2).padStart(6)}${vD.toFixed(2).padStart(7)}${vT.toFixed(2).padStart(6)} |`+
    `${econ?' YES':'  no'}`+(pass?'  <== PASS':''));
  LED.push({id:h.id,fam:h.fam,rat:h.rat,n:sg.length,longPct,dD,dT,vD,vT,econ,
    status:pass?'SURVIVES':'REJECTED',
    reason:Math.abs(dT)<=TCRIT?'fails DEV Bonferroni':Math.sign(dD)!==Math.sign(vD)?'sign flip in VALID'
      :Math.abs(vT)<=1.96?'not significant in VALID':!econ?'below economic hurdle':'-'});
}
console.log('='.repeat(118));
const S=LED.filter(x=>x.status==='SURVIVES');
console.log(`\nSURVIVORS (DEV |t|>${TCRIT}, VALID same sign & |t|>1.96, |diff| > ${hurdle.toFixed(2)} pts in BOTH): ${S.length}`);
for(const s of S)console.log(`  ${s.id} ${s.rat}\n     DEV diff ${s.dD.toFixed(2)} t=${s.dT.toFixed(2)} | VALID diff ${s.vD.toFixed(2)} t=${s.vT.toFixed(2)}`);
if(!S.length)console.log('  NONE — TEST WINDOW NOT OPENED.');
const R={};for(const l of LED)R[l.reason]=(R[l.reason]||0)+1;
console.log('\nREJECTION REASONS:');for(const[k,v]of Object.entries(R))console.log(`  ${String(v).padStart(3)}  ${k}`);
fs.writeFileSync('/tmp/p33_ledger.json',JSON.stringify(LED,null,1));
