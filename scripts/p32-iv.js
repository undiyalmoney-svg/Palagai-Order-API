#!/usr/bin/env node
/** PHASE 3.2 — IV MISPRICING / INCREMENTAL INFORMATION. Research only.
 *  Imports NO broker order module. DEV+VALID only (TEST filtered at load). */
const fs=require('fs');
const EF='09:45',ET='14:45',LOOK=20,MULT=2.0,HOLD=9,MINF=3;
const SESS_FRAC=45/375, YEAR=250;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const A=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const C=A.filter(r=>r.t<'2023-01-01').map(r=>({t:r.t,d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c}));
const V=new Map();for(const r of JSON.parse(fs.readFileSync(process.argv[3],'utf8')))V.set(r.t,r.c);
const N=C.length;const days=[];const di=new Map();
{let cur=null;for(let i=0;i<N;i++){if(C[i].d!==cur){cur=C[i].d;days.push(cur);di.set(cur,[i,i]);}else di.get(cur)[1]=i;}}
const TV=new Float64Array(N);
for(let i=0;i<N;i++){const r=[];for(let k=Math.max(1,i-19);k<=i;k++){if(C[k].d===C[i].d)r.push(C[k].c-C[k-1].c);}TV[i]=r.length>2?sd(r):NaN;}
const tvAll=[...TV].filter(Number.isFinite).sort((a,b)=>a-b);
const BND=[];for(let d=1;d<10;d++)BND.push(tvAll[Math.floor(tvAll.length*d/10)]);
const dec=v=>{let lo=0;for(let d=0;d<9;d++)if(v>BND[d])lo=d+1;return lo;};
/** observation at bar i: pre-event IV (VIX at i), forward realised move, forward dVIX */
function obs(i,dir,isEvent){
  if(i+1>=N||C[i+1].d!==C[i].d)return null;
  const iv0=V.get(C[i].t); if(iv0==null)return null;
  const fill=C[i+1].o,day=C[i].d;let last=fill,bars=0,endIdx=i;
  for(let k=i+1;k<=Math.min(i+HOLD,N-1);k++){if(C[k].d!==day)break;last=C[k].c;bars=k-i;endIdx=k;}
  if(bars<MINF)return null;
  const iv1=V.get(C[endIdx].t); if(iv1==null)return null;
  const S=fill;
  const impliedSigma=S*(iv0/100)*Math.sqrt(SESS_FRAC/YEAR);
  const impliedEabs=impliedSigma*Math.sqrt(2/Math.PI);
  const absRet=Math.abs(last-fill);
  return {d:day,hm:C[i].hm,dir,ev:isEvent?1:0,iv0,iv1,dIV:iv1-iv0,
    absRet,impliedEabs,ratio:absRet/impliedEabs,tv:TV[i],vdec:dec(TV[i])};
}
/** first compression event per session */
const EVENTS=[];
for(const d of days){const[s,e]=di.get(d);if(e-s<12)continue;
 for(let i=s;i<=e;i++){const hm=C[i].hm;if(hm<EF||hm>ET)continue;if(i-LOOK<0)continue;
  let a=0;for(let k=i-LOOK;k<i;k++)a+=C[k].h-C[k].l;a/=LOOK;
  const rg=C[i].h-C[i].l,m=C[i].c-C[i].o;
  if(!(a>0&&rg>MULT*a&&m!==0))continue;
  const o=obs(i,Math.sign(m),true);if(o)EVENTS.push(o);break;}}
/** matched control: same time-of-day + vol decile + direction, different session */
let seed=32032;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const bucket=new Map();
for(let i=0;i<N;i++){const hm=C[i].hm;if(hm<EF||hm>ET)continue;if(!Number.isFinite(TV[i]))continue;
 const k=hm+'|'+dec(TV[i]);if(!bucket.has(k))bucket.set(k,[]);bucket.get(k).push(i);}
const CTRL=[];
for(const s of EVENTS){const p=bucket.get(s.hm+'|'+s.vdec)||[];if(p.length<3)continue;
 let j,t=0;do{j=p[Math.floor(rnd()*p.length)];t++;}while(C[j].d===s.d&&t<10);
 const o=obs(j,s.dir,false);if(o)CTRL.push(o);}
const W=(a,b)=>(a.length<10||b.length<10)?NaN:(mean(a)-mean(b))/Math.sqrt(sd(a)**2/a.length+sd(b)**2/b.length);
const seg=(r,f,t)=>r.filter(x=>x.d>=f&&x.d<=t);
const TC=2.39;
console.log(`events ${EVENTS.length}  matched controls ${CTRL.length}  (DEV+VALID only)\n`);

console.log('=== PRIMARY — FAMILY D: does compression add information BEYOND pre-event IV? ===');
console.log('Model A: |ret45| ~ b0 + b1*impliedMove      Model B: + b2*compressionDummy');
console.log('FIT on DEV 2015-2018, EVALUATE out-of-sample on VALID 2019-2022\n');
const pool=[...EVENTS,...CTRL];
const dev=seg(pool,'2015','2018-12-31'), val=seg(pool,'2019','2022-12-31');
function ols(rows,withEv){
  const X=rows.map(r=>withEv?[1,r.impliedEabs,r.ev]:[1,r.impliedEabs]);
  const y=rows.map(r=>r.absRet);const k=X[0].length;
  const XtX=Array.from({length:k},()=>new Array(k).fill(0)),Xty=new Array(k).fill(0);
  for(let n=0;n<X.length;n++){for(let a=0;a<k;a++){Xty[a]+=X[n][a]*y[n];for(let b=0;b<k;b++)XtX[a][b]+=X[n][a]*X[n][b];}}
  // gaussian elimination
  const M=XtX.map((r,i)=>[...r,Xty[i]]);
  for(let c=0;c<k;c++){let p=c;for(let r2=c+1;r2<k;r2++)if(Math.abs(M[r2][c])>Math.abs(M[p][c]))p=r2;
    [M[c],M[p]]=[M[p],M[c]];
    for(let r2=0;r2<k;r2++){if(r2===c)continue;const f=M[r2][c]/M[c][c];for(let cc=c;cc<=k;cc++)M[r2][cc]-=f*M[c][cc];}}
  const beta=[];for(let i=0;i<k;i++)beta.push(M[i][k]/M[i][i]);   // FIX: diagonal is M[i][i], not r[i][i]
  // standard errors
  const res=rows.map((r,n)=>y[n]-X[n].reduce((s,v,a)=>s+v*beta[a],0));
  const s2=res.reduce((a,b)=>a+b*b,0)/(rows.length-k);
  return {beta,s2,k,predict:(r)=>{const x=withEv?[1,r.impliedEabs,r.ev]:[1,r.impliedEabs];
    return x.reduce((s,v,a)=>s+v*beta[a],0);}};
}
const mA=ols(dev,false), mB=ols(dev,true);
const errA=val.map(r=>r.absRet-mA.predict(r)), errB=val.map(r=>r.absRet-mB.predict(r));
const maeA=mean(errA.map(Math.abs)), maeB=mean(errB.map(Math.abs));
const yv=val.map(r=>r.absRet),ybar=mean(yv);
const sst=yv.reduce((a,b)=>a+(b-ybar)**2,0);
const r2=(e)=>1-e.reduce((a,b)=>a+b*b,0)/sst;
console.log(`  DEV coefficients  Model B: b0=${mB.beta[0].toFixed(3)}  b1(impliedMove)=${mB.beta[1].toFixed(4)}  b2(compression)=${mB.beta[2].toFixed(3)}`);
console.log('');
console.log('  OUT-OF-SAMPLE on VALID:            Model A (IV only)   Model B (IV + compression)');
console.log(`    MAE                              ${maeA.toFixed(4).padStart(12)}   ${maeB.toFixed(4).padStart(14)}`);
console.log(`    R2                               ${r2(errA).toFixed(4).padStart(12)}   ${r2(errB).toFixed(4).padStart(14)}`);
console.log(`    MAE improvement from compression ${(100*(maeA-maeB)/maeA).toFixed(3)}%`);
// direct t on b2 via signal-vs-control residual from Model A
const rDevA=dev.map(r=>r.absRet-mA.predict(r));
const evRes=dev.filter((r,i)=>r.ev===1).map((r)=>r.absRet-mA.predict(r));
const ctRes=dev.filter((r,i)=>r.ev===0).map((r)=>r.absRet-mA.predict(r));
console.log(`    residual of Model A: events ${mean(evRes).toFixed(3)} vs controls ${mean(ctRes).toFixed(3)}  t=${W(evRes,ctRes).toFixed(2)}  [Bonferroni |t|>${TC}]`);

console.log('\n=== SECONDARY — FAMILY C: realised/implied ratio, signal vs matched control ===');
for(const[l,f,t] of [['DEV','2015','2018-12-31'],['VALID','2019','2022-12-31'],['BOTH','2015','2022-12-31']]){
  const a=seg(EVENTS,f,t).map(x=>x.ratio), b=seg(CTRL,f,t).map(x=>x.ratio);
  console.log(`  ${l.padEnd(6)} events ${mean(a).toFixed(3)} (med ${med(a).toFixed(3)}, n=${a.length})  control ${mean(b).toFixed(3)} (med ${med(b).toFixed(3)}, n=${b.length})  diff ${(mean(a)-mean(b)).toFixed(3)}  t=${W(a,b).toFixed(2)}`);
}
console.log('\n=== SECONDARY — FAMILY A/B/E: change in India VIX over the 45-min window ===');
for(const[l,f,t] of [['DEV','2015','2018-12-31'],['VALID','2019','2022-12-31'],['BOTH','2015','2022-12-31']]){
  const a=seg(EVENTS,f,t).map(x=>x.dIV), b=seg(CTRL,f,t).map(x=>x.dIV);
  console.log(`  ${l.padEnd(6)} events ${mean(a).toFixed(4)} vol pts  control ${mean(b).toFixed(4)}  diff ${(mean(a)-mean(b)).toFixed(4)}  t=${W(a,b).toFixed(2)}`);
}
console.log('\n=== PRE-EVENT IV LEVEL (is compression just a low-IV state?) ===');
console.log(`  events   mean VIX at entry ${mean(EVENTS.map(x=>x.iv0)).toFixed(2)}`);
console.log(`  controls mean VIX at entry ${mean(CTRL.map(x=>x.iv0)).toFixed(2)}`);
