#!/usr/bin/env node
/** PHASE 3.5 — NIFTY FUTURES MICROSTRUCTURE -> DIRECTION. Research only; no broker imports.
 *  §3 OBSERVABILITY: daily futures volume/OI/basis is END-OF-DAY. Every feature is
 *  therefore taken from session T-1's close and is observable throughout session T.
 *  No same-day futures volume, OI or basis is used anywhere.
 *  §9 EVENT-FIRST: the feature is constant through the session, so the condition is
 *  evaluated ONCE at the first bar at/after 09:45; entry = OPEN of next bar; hold 45m.
 *  DEV+VALID only. TEST NOT READ. */
const fs=require('fs'),readline=require('readline');
const EF='09:45',HOLD=9,MINF=3;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const MON={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
const toIso=s=>{const[d,m,y]=s.split('-');return `${y}-${String(MON[m.toUpperCase()]+1).padStart(2,'0')}-${d}`;};
(async()=>{
const ALL=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const C=ALL.filter(r=>r.t<'2023-01-01').map(r=>({t:r.t,d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c}));
const N=C.length;const days=[];const di=new Map();
{let cur=null;for(let i=0;i<N;i++){if(C[i].d!==cur){cur=C[i].d;days.push(cur);di.set(cur,[i,i]);}else di.get(cur)[1]=i;}}
const TV=new Float64Array(N);
for(let i=0;i<N;i++){const r=[];for(let k=Math.max(1,i-19);k<=i;k++){if(C[k].d===C[i].d)r.push(C[k].c-C[k-1].c);}TV[i]=r.length>2?sd(r):NaN;}
const BND=JSON.parse(fs.readFileSync('/tmp/frozen_bounds.json','utf8')).bounds;
const dec=v=>{let lo=0;for(let d=0;d<9;d++)if(v>BND[d])lo=d+1;return lo;};
const spotClose=new Map();for(const d of days){const[,e]=di.get(d);spotClose.set(d,C[e].c);}
// ---- daily futures state, FRONT (nearest unexpired) contract ----
const rows=new Map();
await new Promise(res=>{const rl=readline.createInterface({input:fs.createReadStream(process.argv[3]),crlfDelay:Infinity});
 rl.on('line',l=>{const p=l.split('|');if(p.length<6)return;const d=p[0];if(!spotClose.has(d))return;
  const xp=toIso(p[1]);if(xp<=d)return;
  if(!rows.has(d))rows.set(d,[]);rows.get(d).push({xp,close:+p[2],vol:+p[3]||0,oi:+p[4]||0,chg:+p[5]||0});});
 rl.on('close',res);});
const ST=new Map();
for(const[d,R]of rows){
  R.sort((a,b)=>a.xp.localeCompare(b.xp));
  const front=R[0]; if(!front||!(front.close>0))continue;
  const spot=spotClose.get(d);
  ST.set(d,{close:front.close,vol:front.vol,oi:front.oi,chg:front.chg,
    basis:front.close-spot, basisPct:(front.close-spot)/spot,
    dte:Math.round((new Date(front.xp)-new Date(d))/864e5),
    totVol:R.reduce((a,b)=>a+b.vol,0), totOI:R.reduce((a,b)=>a+b.oi,0)});
}
// features observable during session T, built ONLY from T-1 (and earlier)
const F=new Map();
for(let k=21;k<days.length;k++){
  const d=days[k],p1=ST.get(days[k-1]),p2=ST.get(days[k-2]);
  if(!p1||!p2)continue;
  const hist=[];for(let j=k-21;j<k;j++){const s=ST.get(days[j]);if(s)hist.push(s.vol);}
  if(hist.length<15)continue;
  const mv=med(hist);
  const pRet=spotClose.get(days[k-1])-spotClose.get(days[k-2]);
  F.set(d,{...p1, relVol:mv>0?p1.vol/mv:null, dOI:p1.oi-p2.oi, dOIpct:p2.oi>0?(p1.oi-p2.oi)/p2.oi:null,
    dBasis:p1.basisPct-p2.basisPct, pRet, prevClose:spotClose.get(days[k-1])});
}
console.log(`futures daily state: ${ST.size} sessions · observable feature sessions: ${F.size}\n`);
function fwd(i,dir){
  if(i+1>=N||C[i+1].d!==C[i].d)return null;
  const fill=C[i+1].o,day=C[i].d;let last=fill,bars=0,mae=0,mfe=0;
  for(let k=i+1;k<=Math.min(i+HOLD,N-1);k++){if(C[k].d!==day)break;
    const up=dir>0?C[k].h-fill:fill-C[k].l,dn=dir>0?fill-C[k].l:C[k].h-fill;
    if(dn>mae)mae=dn;if(up>mfe)mfe=up;last=C[k].c;bars=k-i;}
  if(bars<MINF)return null;
  return {d:day,hm:C[i].hm,dir,ret:dir*(last-fill),mae,mfe,vdec:dec(TV[i])};
}
// ---------- FROZEN LIBRARY: 20 conditions, each two-sided ----------
const L=[];const A=(id,fam,rat,fn)=>L.push({id,fam,rat,fn});
// classic F&O buildup framework (price direction x OI direction)
A('B1','buildup','prev price UP + OI UP (long buildup) -> bullish',   f=>(f.pRet>0&&f.dOI>0)?1:0);
A('B2','buildup','prev price DOWN + OI UP (short buildup) -> bearish', f=>(f.pRet<0&&f.dOI>0)?-1:0);
A('B3','buildup','prev price UP + OI DOWN (short covering) -> bearish',f=>(f.pRet>0&&f.dOI<0)?-1:0);
A('B4','buildup','prev price DOWN + OI DOWN (long unwind) -> bullish', f=>(f.pRet<0&&f.dOI<0)?1:0);
A('B5','buildup','strong long buildup: OI +2% and price up -> bullish',f=>(f.dOIpct!=null&&f.dOIpct>0.02&&f.pRet>0)?1:0);
A('B6','buildup','strong short buildup: OI +2% and price down -> bearish',f=>(f.dOIpct!=null&&f.dOIpct>0.02&&f.pRet<0)?-1:0);
A('V1','volume','futures volume > 1.5x 20d median -> continue prev dir',f=>(f.relVol!=null&&f.relVol>1.5&&f.pRet!==0)?Math.sign(f.pRet):0);
A('V2','volume','futures volume > 2.0x 20d median -> continue prev dir',f=>(f.relVol!=null&&f.relVol>2.0&&f.pRet!==0)?Math.sign(f.pRet):0);
A('V3','volume','futures volume < 0.7x 20d median -> continue prev dir',f=>(f.relVol!=null&&f.relVol<0.7&&f.pRet!==0)?Math.sign(f.pRet):0);
A('V4','volume','volume shock + OI up -> continue prev dir',           f=>(f.relVol!=null&&f.relVol>1.5&&f.dOI>0&&f.pRet!==0)?Math.sign(f.pRet):0);
A('S1','basis','futures PREMIUM > 0.10% -> bullish',                   f=>f.basisPct>0.0010?1:0);
A('S2','basis','futures DISCOUNT < -0.05% -> bearish',                 f=>f.basisPct<-0.0005?-1:0);
A('S3','basis','basis EXPANDING (dBasis>+0.05%) -> bullish',           f=>f.dBasis>0.0005?1:0);
A('S4','basis','basis CONTRACTING (dBasis<-0.05%) -> bearish',         f=>f.dBasis<-0.0005?-1:0);
A('S5','basis','basis sign as direction',                              f=>f.basisPct>0?1:f.basisPct<0?-1:0);
A('S6','basis','basis premium + OI up -> bullish',                     f=>(f.basisPct>0.0005&&f.dOI>0)?1:0);
A('O1','oi','OI change > +3% -> continue prev dir',                    f=>(f.dOIpct!=null&&f.dOIpct>0.03&&f.pRet!==0)?Math.sign(f.pRet):0);
A('O2','oi','OI change < -3% -> fade prev dir',                        f=>(f.dOIpct!=null&&f.dOIpct<-0.03&&f.pRet!==0)?-Math.sign(f.pRet):0);
A('X1','expiry','DTE<=3 + OI falling -> fade prev dir (rollover)',     f=>(f.dte<=3&&f.dOI<0&&f.pRet!==0)?-Math.sign(f.pRet):0);
A('X2','expiry','DTE>=10 + long buildup -> bullish',                   f=>(f.dte>=10&&f.pRet>0&&f.dOI>0)?1:0);

const ALPHA=0.05/L.length, TCRIT=3.05;
const cp='./live/charge-entry-gate.js';const src=fs.readFileSync(cp,'utf8');
const mm=new module.constructor();mm._compile(src+'\nmodule.exports.__c=estimateRoundTripCharges;',cp);
const hurdle=(mm.exports.__c({entryPrice:120,exitPrice:120,quantity:65}).totalRs+40)/(65*0.5);
console.log(`conditions ${L.length} (two-sided)  Bonferroni ${ALPHA.toFixed(5)} -> |t|>${TCRIT}  hurdle ${hurdle.toFixed(2)} pts\n`);
function fire(fn){const out=[];
 for(const d of days){const f=F.get(d);if(!f)continue;const[s,e]=di.get(d);if(e-s<14)continue;
  for(let i=s;i<=e;i++){if(C[i].hm<EF)continue;
   const dir=fn(f);if(!dir)break;
   const o=fwd(i,dir);if(o)out.push(o);break;}}
 return out;}
let seed=350035;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const bk=new Map();
for(let i=0;i<N;i++){if(C[i].hm<EF)continue;if(!Number.isFinite(TV[i]))continue;
 const k=C[i].hm+'|'+dec(TV[i]);if(!bk.has(k))bk.set(k,[]);bk.get(k).push(i);}
function ctrl(sg){const o=[];for(const s of sg){const p=bk.get(s.hm+'|'+s.vdec)||[];if(p.length<3)continue;
 let j,t=0;do{j=p[Math.floor(rnd()*p.length)];t++;}while(C[j].d===s.d&&t<10);
 const r=fwd(j,s.dir);if(r)o.push(r);}return o;}
const W=(a,b)=>(a.length<10||b.length<10)?NaN:(mean(a)-mean(b))/Math.sqrt(sd(a)**2/a.length+sd(b)**2/b.length);
const seg=(r,f,t)=>r.filter(x=>x.d>=f&&x.d<=t);
console.log('ID  fam      n    long% | DEV sig  ctrl  DIFF    t    | VALID sig ctrl  DIFF    t    | econ');
console.log('='.repeat(112));
const LED=[];
for(const h of L){
 const sg=fire(h.fn);
 if(sg.length<150){console.log(`${h.id.padEnd(4)}${h.fam.padEnd(9)}${String(sg.length).padStart(4)}  too few`);
  LED.push({id:h.id,fam:h.fam,rat:h.rat,status:'REJECTED',reason:'insufficient sessions'});continue;}
 const ct=ctrl(sg);
 const dS=seg(sg,'2015','2018-12-31'),dC=seg(ct,'2015','2018-12-31');
 const vS=seg(sg,'2019','2022-12-31'),vC=seg(ct,'2019','2022-12-31');
 const dD=mean(dS.map(x=>x.ret))-mean(dC.map(x=>x.ret)), vD=mean(vS.map(x=>x.ret))-mean(vC.map(x=>x.ret));
 const dT=W(dS.map(x=>x.ret),dC.map(x=>x.ret)), vT=W(vS.map(x=>x.ret),vC.map(x=>x.ret));
 const lp=100*dS.filter(x=>x.dir>0).length/Math.max(1,dS.length);
 const econ=Math.abs(dD)>hurdle&&Math.abs(vD)>hurdle;
 const pass=Math.abs(dT)>TCRIT&&Math.sign(dD)===Math.sign(vD)&&Math.abs(vT)>1.96&&econ;
 console.log(`${h.id.padEnd(4)}${h.fam.padEnd(9)}${String(sg.length).padStart(4)} ${lp.toFixed(0).padStart(4)}% |`+
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
const best=LED.filter(x=>Number.isFinite(x.dT)).sort((a,b)=>Math.abs(b.dT)-Math.abs(a.dT))[0];
if(best)console.log(`\nhighest DEV |t| in the phase: ${best.id} at ${Math.abs(best.dT).toFixed(2)} (threshold ${TCRIT})`);
fs.writeFileSync('/tmp/p35_ledger.json',JSON.stringify(LED,null,1));
})();
