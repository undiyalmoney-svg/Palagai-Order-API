#!/usr/bin/env node
/** PHASE 3.4 — OPTIONS-DERIVED STATE -> NIFTY DIRECTION. Research only, no broker imports.
 *  §5 OBSERVABILITY: F&O bhavcopy OI is END-OF-DAY. Therefore every option feature
 *  used here is computed from the PRIOR session's close and is observable throughout
 *  the following session. No same-day OI is ever used. Labelled DAILY OI, never
 *  "intraday order flow".
 *  Event: ONE per session — first bar at/after 09:45; entry = OPEN of next bar; hold 45m.
 *  DEV+VALID only. TEST NOT READ. */
const fs=require('fs'),readline=require('readline');
const EF='09:45',HOLD=9,MINF=3;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const MON={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
function expToIso(s){const[d,m,y]=s.split('-');return `${y}-${String(MON[m.toUpperCase()]+1).padStart(2,'0')}-${d}`;}
(async()=>{
const ALL=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const C=ALL.filter(r=>r.t<'2023-01-01').map(r=>({t:r.t,d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c}));
const N=C.length;const days=[];const di=new Map();
{let cur=null;for(let i=0;i<N;i++){if(C[i].d!==cur){cur=C[i].d;days.push(cur);di.set(cur,[i,i]);}else di.get(cur)[1]=i;}}
const TV=new Float64Array(N);
for(let i=0;i<N;i++){const r=[];for(let k=Math.max(1,i-19);k<=i;k++){if(C[k].d===C[i].d)r.push(C[k].c-C[k-1].c);}TV[i]=r.length>2?sd(r):NaN;}
const BND=JSON.parse(fs.readFileSync('/tmp/frozen_bounds.json','utf8')).bounds;
const dec=v=>{let lo=0;for(let d=0;d<9;d++)if(v>BND[d])lo=d+1;return lo;};
const closeOf=new Map();for(const d of days){const[,e]=di.get(d);closeOf.set(d,C[e].c);}

// ---- aggregate DAILY OI state per session, nearest expiry with DTE>=1 ----
const raw=new Map();   // date -> rows
await new Promise(res=>{
  const rl=readline.createInterface({input:fs.createReadStream(process.argv[3]),crlfDelay:Infinity});
  rl.on('line',l=>{const p=l.split('|');if(p.length<7)return;
    const d=p[0];if(!closeOf.has(d))return;
    const xp=expToIso(p[1]);if(xp<=d)return;          // only unexpired
    if(!raw.has(d))raw.set(d,[]);
    raw.get(d).push({xp,k:+p[2],ty:p[3],oi:+p[5]||0,chg:+p[6]||0});});
  rl.on('close',res);});
const STATE=new Map();
for(const[d,rows]of raw){
  const exps=[...new Set(rows.map(r=>r.xp))].sort();
  const near=exps[0]; if(!near)continue;
  const R=rows.filter(r=>r.xp===near);
  const spot=closeOf.get(d);
  let cOI=0,pOI=0,cChg=0,pChg=0,maxC=0,maxCk=null,maxP=0,maxPk=null,cAbove=0,pBelow=0;
  const atmK=Math.round(spot/50)*50;let atmC=0,atmP=0;
  for(const r of R){
    if(r.ty==='CE'){cOI+=r.oi;cChg+=r.chg;if(r.oi>maxC){maxC=r.oi;maxCk=r.k;}if(r.k>spot)cAbove+=r.oi;if(Math.abs(r.k-atmK)<=50)atmC+=r.oi;}
    else if(r.ty==='PE'){pOI+=r.oi;pChg+=r.chg;if(r.oi>maxP){maxP=r.oi;maxPk=r.k;}if(r.k<spot)pBelow+=r.oi;if(Math.abs(r.k-atmK)<=50)atmP+=r.oi;}
  }
  if(!(cOI>0&&pOI>0))continue;
  const dteDays=Math.round((new Date(near)-new Date(d))/864e5);
  STATE.set(d,{pcr:pOI/cOI,cOI,pOI,cChg,pChg,maxCk,maxPk,cAbove,pBelow,atmC,atmP,spot,dte:dteDays,
    netChg:(pChg-cChg)/Math.max(1,cOI+pOI)});
}
console.log(`daily OI state built for ${STATE.size} sessions (nearest unexpired expiry)`);
// prior-session features, observable during session T
const F=new Map();
for(let k=2;k<days.length;k++){
  const d=days[k],p1=STATE.get(days[k-1]),p2=STATE.get(days[k-2]);
  if(!p1)continue;
  F.set(d,{...p1, dPCR:p2?p1.pcr-p2.pcr:null, prevClose:closeOf.get(days[k-1])});
}
console.log(`sessions with prior-day observable OI features: ${F.size}\n`);

function fwd(i,dir){
  if(i+1>=N||C[i+1].d!==C[i].d)return null;
  const fill=C[i+1].o,day=C[i].d;let last=fill,bars=0,mae=0,mfe=0;
  for(let k=i+1;k<=Math.min(i+HOLD,N-1);k++){if(C[k].d!==day)break;
    const up=dir>0?C[k].h-fill:fill-C[k].l,dn=dir>0?fill-C[k].l:C[k].h-fill;
    if(dn>mae)mae=dn;if(up>mfe)mfe=up;last=C[k].c;bars=k-i;}
  if(bars<MINF)return null;
  return {d:day,hm:C[i].hm,dir,ret:dir*(last-fill),mae,mfe,vdec:dec(TV[i]),dte:F.get(day)?.dte??null};
}
// ---------- FROZEN LIBRARY: 22 conditions, each two-sided ----------
const L=[];const add=(id,fam,rat,fn)=>L.push({id,fam,rat,fn});
// f = prior-day OI state; s = spot at the entry bar (known)
add('P1','pcr','PCR > 1.2 -> bullish (contrarian: heavy put writing = support)',(f,s)=>f.pcr>1.2?1:0);
add('P2','pcr','PCR < 0.8 -> bearish (heavy call writing = resistance)',(f,s)=>f.pcr<0.8?-1:0);
add('P3','pcr','PCR extreme both tails, dir = contrarian',(f,s)=>f.pcr>1.4?1:f.pcr<0.7?-1:0);
add('P4','pcr','dPCR > +0.10 (put OI building) -> bullish',(f,s)=>f.dPCR!=null&&f.dPCR>0.10?1:0);
add('P5','pcr','dPCR < -0.10 (call OI building) -> bearish',(f,s)=>f.dPCR!=null&&f.dPCR<-0.10?-1:0);
add('O1','oichg','net OI change (put-call) positive -> bullish',(f,s)=>f.netChg>0.01?1:f.netChg<-0.01?-1:0);
add('O2','oichg','call OI rising faster than put OI -> bearish',(f,s)=>{const t=Math.max(1,f.cOI+f.pOI);
  return (f.cChg/t>0.01&&f.cChg>f.pChg)?-1:0;});
add('O3','oichg','put OI rising faster than call OI -> bullish',(f,s)=>{const t=Math.max(1,f.cOI+f.pOI);
  return (f.pChg/t>0.01&&f.pChg>f.cChg)?1:0;});
add('S1','struct','spot within 0.3% BELOW max-call-OI strike -> resistance, bearish',(f,s)=>{
  if(f.maxCk==null)return 0;const g=(f.maxCk-s)/s;return (g>0&&g<0.003)?-1:0;});
add('S2','struct','spot within 0.3% ABOVE max-put-OI strike -> support, bullish',(f,s)=>{
  if(f.maxPk==null)return 0;const g=(s-f.maxPk)/s;return (g>0&&g<0.003)?1:0;});
add('S3','struct','spot ABOVE max-call-OI strike (broken resistance) -> bullish',(f,s)=>{
  if(f.maxCk==null)return 0;return s>f.maxCk*1.002?1:0;});
add('S4','struct','spot BELOW max-put-OI strike (broken support) -> bearish',(f,s)=>{
  if(f.maxPk==null)return 0;return s<f.maxPk*0.998?-1:0;});
add('S5','struct','spot nearer max-put than max-call strike -> bullish',(f,s)=>{
  if(f.maxCk==null||f.maxPk==null)return 0;
  return Math.abs(s-f.maxPk)<Math.abs(s-f.maxCk)?1:-1;});
add('S6','struct','OI centre of mass above spot -> bullish',(f,s)=>{
  const com=(f.maxCk+f.maxPk)/2;if(!Number.isFinite(com))return 0;
  return com>s*1.002?1:com<s*0.998?-1:0;});
add('C1','conc','call OI above spot dominates -> bearish',(f,s)=>{
  const r=f.cAbove/Math.max(1,f.cOI);return r>0.8?-1:0;});
add('C2','conc','put OI below spot dominates -> bullish',(f,s)=>{
  const r=f.pBelow/Math.max(1,f.pOI);return r>0.8?1:0;});
add('C3','conc','ATM put OI > ATM call OI -> bullish',(f,s)=>f.atmC>0&&f.atmP/f.atmC>1.2?1:(f.atmC>0&&f.atmP/f.atmC<0.83?-1:0));
add('C4','conc','asymmetry: (pBelow-cAbove)/total -> dir',(f,s)=>{
  const t=Math.max(1,f.cOI+f.pOI);const a=(f.pBelow-f.cAbove)/t;return a>0.05?1:a<-0.05?-1:0;});
add('X1','expiry','DTE<=2 AND PCR>1.2 -> bullish (pin/support near expiry)',(f,s)=>(f.dte<=2&&f.pcr>1.2)?1:0);
add('X2','expiry','DTE>=5 AND PCR>1.2 -> bullish (far expiry)',(f,s)=>(f.dte>=5&&f.pcr>1.2)?1:0);
add('X3','expiry','DTE<=2 AND spot near max-call strike -> bearish',(f,s)=>{
  if(f.maxCk==null)return 0;const g=(f.maxCk-s)/s;return (f.dte<=2&&g>0&&g<0.004)?-1:0;});
add('V1','vixoi','PCR>1.2 AND prior-day gap-up -> bullish',(f,s)=>(f.pcr>1.2&&f.prevClose&&s>f.prevClose)?1:0);

const ALPHA=0.05/L.length, TCRIT=3.05;
const p='./live/charge-entry-gate.js';const src=fs.readFileSync(p,'utf8');
const mm=new module.constructor();mm._compile(src+'\nmodule.exports.__c=estimateRoundTripCharges;',p);
const hurdle=(mm.exports.__c({entryPrice:120,exitPrice:120,quantity:65}).totalRs+40)/(65*0.5);
console.log(`conditions ${L.length} (each two-sided)  Bonferroni ${ALPHA.toFixed(5)} -> |t|>${TCRIT}  hurdle ${hurdle.toFixed(2)} pts\n`);
function fire(fn){const out=[];
  for(const d of days){const f=F.get(d);if(!f)continue;const[s,e]=di.get(d);if(e-s<14)continue;
    for(let i=s;i<=e;i++){if(C[i].hm<EF)continue;
      const dir=fn(f,C[i].c);if(!dir)break;             // evaluated ONCE, at the first eligible bar
      const o=fwd(i,dir);if(o)out.push(o);break;}}
  return out;}
let seed=340034;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const bucket=new Map();
for(let i=0;i<N;i++){if(C[i].hm<EF)continue;if(!Number.isFinite(TV[i]))continue;
  const k=C[i].hm+'|'+dec(TV[i]);if(!bucket.has(k))bucket.set(k,[]);bucket.get(k).push(i);}
function ctrl(sg){const o=[];for(const s of sg){const p=bucket.get(s.hm+'|'+s.vdec)||[];if(p.length<3)continue;
  let j,t=0;do{j=p[Math.floor(rnd()*p.length)];t++;}while(C[j].d===s.d&&t<10);
  const r=fwd(j,s.dir);if(r)o.push(r);}return o;}
const W=(a,b)=>(a.length<10||b.length<10)?NaN:(mean(a)-mean(b))/Math.sqrt(sd(a)**2/a.length+sd(b)**2/b.length);
const seg=(r,f,t)=>r.filter(x=>x.d>=f&&x.d<=t);
console.log('ID  fam     n    long% | DEV sig  ctrl  DIFF    t    | VALID sig ctrl  DIFF    t    | econ');
console.log('='.repeat(112));
const LED=[];
for(const h of L){
  const sg=fire(h.fn);
  if(sg.length<150){console.log(`${h.id.padEnd(4)}${h.fam.padEnd(8)}${String(sg.length).padStart(4)}  too few`);
    LED.push({id:h.id,fam:h.fam,rat:h.rat,status:'REJECTED',reason:'insufficient sessions'});continue;}
  const ct=ctrl(sg);
  const dS=seg(sg,'2015','2018-12-31'),dC=seg(ct,'2015','2018-12-31');
  const vS=seg(sg,'2019','2022-12-31'),vC=seg(ct,'2019','2022-12-31');
  const dD=mean(dS.map(x=>x.ret))-mean(dC.map(x=>x.ret)), vD=mean(vS.map(x=>x.ret))-mean(vC.map(x=>x.ret));
  const dT=W(dS.map(x=>x.ret),dC.map(x=>x.ret)), vT=W(vS.map(x=>x.ret),vC.map(x=>x.ret));
  const lp=100*dS.filter(x=>x.dir>0).length/Math.max(1,dS.length);
  const econ=Math.abs(dD)>hurdle&&Math.abs(vD)>hurdle;
  const pass=Math.abs(dT)>TCRIT&&Math.sign(dD)===Math.sign(vD)&&Math.abs(vT)>1.96&&econ;
  console.log(`${h.id.padEnd(4)}${h.fam.padEnd(8)}${String(sg.length).padStart(4)} ${lp.toFixed(0).padStart(4)}% |`+
    `${mean(dS.map(x=>x.ret)).toFixed(2).padStart(7)}${mean(dC.map(x=>x.ret)).toFixed(2).padStart(6)}${dD.toFixed(2).padStart(7)}${dT.toFixed(2).padStart(6)} |`+
    `${mean(vS.map(x=>x.ret)).toFixed(2).padStart(8)}${mean(vC.map(x=>x.ret)).toFixed(2).padStart(6)}${vD.toFixed(2).padStart(7)}${vT.toFixed(2).padStart(6)} |`+
    `${econ?' YES':'  no'}`+(pass?'  <== PASS':''));
  LED.push({id:h.id,fam:h.fam,rat:h.rat,n:sg.length,lp,dD,dT,vD,vT,econ,status:pass?'SURVIVES':'REJECTED',
    reason:Math.abs(dT)<=TCRIT?'fails DEV Bonferroni':Math.sign(dD)!==Math.sign(vD)?'sign flip in VALID'
      :Math.abs(vT)<=1.96?'not significant in VALID':!econ?'below economic hurdle':'-'});
}
console.log('='.repeat(112));
const S=LED.filter(x=>x.status==='SURVIVES');
console.log(`\nSURVIVORS: ${S.length}`);
for(const s of S)console.log(`  ${s.id} ${s.rat}\n     DEV ${s.dD.toFixed(2)} t=${s.dT.toFixed(2)} | VALID ${s.vD.toFixed(2)} t=${s.vT.toFixed(2)}`);
if(!S.length)console.log('  NONE — TEST WINDOW NOT OPENED.');
const R={};for(const l of LED)R[l.reason]=(R[l.reason]||0)+1;
console.log('\nREJECTION REASONS:');for(const[k,v]of Object.entries(R))console.log(`  ${String(v).padStart(3)}  ${k}`);
fs.writeFileSync('/tmp/p34_ledger.json',JSON.stringify(LED,null,1));
})();
