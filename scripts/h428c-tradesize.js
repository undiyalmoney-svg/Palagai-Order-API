#!/usr/bin/env node
/**
 * H-428-C — ABNORMAL AVERAGE TRADE SIZE / INSTITUTIONAL FOOTPRINT
 *
 * SIGNAL MODEL DECLARED BEFORE ANY FORWARD RETURN IS COMPUTED:
 *   tradeSize = tradedValue / numTrades           (both supplied by NSE)
 *   Because tradeSize is heavily right-skewed and mechanically driven by
 *   price and liquidity, the signal is a CROSS-SECTIONAL RESIDUAL estimated
 *   independently on each session:
 *
 *     log(tradeSize) ~ b0 + b1*log(price) + b2*log(tradedValue) + b3*vol20
 *     abnormal = residual, then z-scored within the session
 *
 *   Fitted per-session, so no future information and no full-sample fitting.
 *
 * THE KEY DIAGNOSTIC (declared in advance): four nested normalisations
 *   A raw tradeSize
 *   B price-normalised (tradeSize / price = average shares per trade)
 *   C liquidity-residualised (log value only)
 *   D fully residualised (price + value + vol)   <-- PRIMARY
 * If A works but D does not, the effect is a mechanical price/liquidity
 * artifact and the institutional-footprint hypothesis FAILS.
 *
 * PRIMARY horizon +5 sessions. Signal at close of t, ENTRY = OPEN of t+1.
 *
 * Usage: node h428c-tradesize.js <DATADIR>
 */
const fs=require('fs'),path=require('path');
const ETF_RE=/BEES|ETF|GOLD|LIQUID|NIFTY|SENSEX|INAV|SILVER/i;
const H_PRIMARY=5, HZ=[1,3,5,10,20], MIN_TV=1e7, MIN_PX=10, TRAIL=20, DP_RS=15*1.18;

const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const med=a=>{const s=[...a].sort((x,y)=>x-y);const n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):0;};
const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1));};
function clusteredT(rows){const n=rows.length;if(n<20)return 0;const m=mean(rows.map(r=>r.v));
 const by=new Map();for(const r of rows)by.set(r.sym,(by.get(r.sym)||0)+(r.v-m));
 let meat=0;for(const[,s]of by)meat+=s*s;const se=Math.sqrt(meat)/n;return se>0?m/se:0;}
function pFromT(t){const z=Math.abs(t);const b=[0.319381530,-0.356563782,1.781477937,-1.821255978,1.330274429];
 const c=0.39894228*Math.exp(-z*z/2),tt=1/(1+0.2316419*z);
 return 2*c*tt*(b[0]+tt*(b[1]+tt*(b[2]+tt*(b[3]+tt*b[4]))));}
function boot(a,it=2000){if(a.length<20)return[NaN,NaN];const m=[];
 for(let i=0;i<it;i++){let s=0;for(let k=0;k<a.length;k++)s+=a[(Math.random()*a.length)|0];m.push(s/a.length);}
 m.sort((x,y)=>x-y);return[m[(it*0.025)|0],m[(it*0.975)|0]];}
/** OLS with k regressors via normal equations + ridge for stability */
function ols(X,y){
  const n=X.length,k=X[0].length;
  const XtX=Array.from({length:k},()=>new Float64Array(k));
  const Xty=new Float64Array(k);
  for(let i=0;i<n;i++){const xi=X[i];
    for(let a=0;a<k;a++){Xty[a]+=xi[a]*y[i];for(let b=0;b<k;b++)XtX[a][b]+=xi[a]*xi[b];}}
  for(let a=0;a<k;a++)XtX[a][a]+=1e-8;
  // gaussian elimination
  const M=XtX.map((row,i)=>Array.from(row).concat([Xty[i]]));
  for(let c=0;c<k;c++){
    let p=c;for(let r=c+1;r<k;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
    [M[c],M[p]]=[M[p],M[c]];
    if(Math.abs(M[c][c])<1e-12)return null;
    for(let r=0;r<k;r++){if(r===c)continue;const f=M[r][c]/M[c][c];
      for(let cc=c;cc<=k;cc++)M[r][cc]-=f*M[c][cc];}}
  return Array.from({length:k},(_,i)=>M[i][k]/M[i][i]);
}
function parseLegacy(t){const o=[];const L=t.split(/\r?\n/);
 for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<13||(c[1]||'').trim()!=='EQ')continue;
  o.push({sym:c[0].trim(),op:+c[2],cl:+c[5],qty:+c[8],val:+c[9],trades:+c[11]});}return o;}
function parseNew(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());
 const ix=n=>h.indexOf(n);
 const a=ix('TckrSymb'),b=ix('SctySrs'),o1=ix('OpnPric'),d=ix('ClsPric'),q=ix('TtlTradgVol'),v=ix('TtlTrfVal'),n2=ix('TtlNbOfTxsExctd'),f=ix('FinInstrmTp');
 const o=[];for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;
  if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
  o.push({sym:(c[a]||'').trim(),op:+c[o1],cl:+c[d],qty:+c[q],val:+c[v],trades:+c[n2]});}return o;}

function main(){
  const DATA=process.argv[2];const RAW=path.join(DATA,'full','raw');
  const files=fs.readdirSync(RAW).filter(f=>f.endsWith('.csv')&&fs.statSync(path.join(RAW,f)).isFile()).sort();
  const dates=files.map(f=>f.replace('.csv',''));const T=dates.length;

  // ================= DATA AUDIT (no forward returns) =================
  console.log('='.repeat(116));
  console.log('H-428-C — DATA AUDIT  [no forward returns computed in this section]');
  console.log('='.repeat(116));
  const px=new Map();
  let rows=0,zeroTrades=0,negTrades=0,zeroVal=0,valMismatch=0,missingTrades=0;
  let legacyRows=0,newRows=0;
  const tsByEra={legacy:[],neu:[]};
  for(let i=0;i<T;i++){
    const isNew=dates[i]>'2024-06-30';
    for(const r of (isNew?parseNew:parseLegacy)(fs.readFileSync(path.join(RAW,files[i]),'utf8'))){
      if(!r.sym||!(r.cl>0))continue;
      rows++; isNew?newRows++:legacyRows++;
      if(!Number.isFinite(r.trades)){missingTrades++;continue;}
      if(r.trades===0)zeroTrades++;
      if(r.trades<0)negTrades++;
      if(!(r.val>0))zeroVal++;
      // independent check: val should be ~ qty * avg price (within the day's range)
      if(r.qty>0&&r.val>0){const implied=r.val/r.qty;
        if(implied<r.cl*0.3||implied>r.cl*3)valMismatch++;}
      if(r.trades>0&&r.val>0){
        const ts=r.val/r.trades;
        (isNew?tsByEra.neu:tsByEra.legacy).push(ts);
      }
      if(!px.has(r.sym))px.set(r.sym,new Map());
      px.get(r.sym).set(i,r);
    }
  }
  console.log(`\nsessions ${T}   EQ records ${rows.toLocaleString()}   symbols ${px.size.toLocaleString()}`);
  console.log(`  legacy-format rows ${legacyRows.toLocaleString()}   new-format rows ${newRows.toLocaleString()}`);
  console.log(`  trade-count field missing : ${missingTrades}`);
  console.log(`  zero trade count          : ${zeroTrades.toLocaleString()}`);
  console.log(`  negative trade count      : ${negTrades}`);
  console.log(`  zero/absent traded value  : ${zeroVal.toLocaleString()}`);
  console.log(`  value/qty outside [0.3x,3x] close (sanity) : ${valMismatch.toLocaleString()} (${(100*valMismatch/rows).toFixed(3)}%)`);
  const lm=med(tsByEra.legacy.slice(0,400000)),nm=med(tsByEra.neu.slice(0,400000));
  console.log(`\nFORMAT CONTINUITY — median trade size`);
  console.log(`  legacy (TOTALTRADES)        : Rs${lm.toFixed(0)}`);
  console.log(`  new    (TtlNbOfTxsExctd)    : Rs${nm.toFixed(0)}`);
  console.log(`  ratio new/legacy: ${(nm/lm).toFixed(2)}  ${Math.abs(Math.log(nm/lm))<0.9?'-> comparable, no unit break':'-> *** UNIT/DEFINITION BREAK ***'}`);
  console.log(`  (a break would invalidate pooling DEV/VALID with TEST)`);

  // ================= SIGNAL CONSTRUCTION (model frozen above) =================
  console.log('\n'+'='.repeat(116));
  console.log('SIGNAL CONSTRUCTION — per-session cross-sectional residualisation');
  console.log('='.repeat(116));
  const obs=[];
  let skipETF=0,skipLiq=0,skipHist=0,fitFail=0;
  for(let i=TRAIL;i<T-21;i++){
    const cand=[];
    for(const[sym,m]of px){
      if(ETF_RE.test(sym)){skipETF++;continue;}
      const cur=m.get(i);
      if(!cur||!(cur.cl>=MIN_PX)||!(cur.trades>0)||!(cur.val>0)){continue;}
      const tv=[],rets=[];
      for(let k=i-TRAIL;k<i;k++){const b=m.get(k);if(b){tv.push(b.val||0);const p=m.get(k-1);if(p&&p.cl>0)rets.push(Math.log(b.cl/p.cl));}}
      if(tv.length<TRAIL*0.7||rets.length<10){skipHist++;continue;}
      const mtv=med(tv);
      if(!(mtv>=MIN_TV)){skipLiq++;continue;}
      cand.push({sym,i,ts:cur.val/cur.trades,pxLvl:cur.cl,val:cur.val,vol:sd(rets),mtv});
    }
    if(cand.length<80)continue;
    const y=cand.map(c=>Math.log(c.ts));
    const X=cand.map(c=>[1,Math.log(c.pxLvl),Math.log(c.val),c.vol]);
    const beta=ols(X,y);
    if(!beta){fitFail++;continue;}
    const resid=cand.map((c,k)=>y[k]-(beta[0]+beta[1]*X[k][1]+beta[2]*X[k][2]+beta[3]*X[k][3]));
    const rm=mean(resid),rs=sd(resid);
    // liquidity buckets for the RETURN benchmark
    const byLiq=[...cand].sort((a,b)=>a.mtv-b.mtv);
    byLiq.forEach((c,k)=>{c.lq=Math.min(4,Math.floor(5*k/byLiq.length));});
    cand.forEach((c,k)=>{
      c.D=rs>0?(resid[k]-rm)/rs:null;           // PRIMARY: fully residualised
      c.A=c.ts;                                  // raw
      c.B=c.ts/c.pxLvl;                          // price-normalised (shares/trade)
      c.C=Math.log(c.ts)-Math.log(c.val)*0.5;    // crude liquidity-only normalisation
    });
    // quintiles for each variant, WITHIN liquidity bucket for D
    for(const V of ['A','B','C']){
      const s=[...cand].filter(c=>c[V]!=null).sort((a,b)=>a[V]-b[V]);
      s.forEach((c,k)=>{c['q'+V]=Math.min(4,Math.floor(5*k/s.length));});
    }
    for(let L=0;L<5;L++){
      const g=cand.filter(c=>c.lq===L&&c.D!=null).sort((a,b)=>a.D-b.D);
      if(g.length<10)continue;
      g.forEach((c,k)=>{c.qD=Math.min(4,Math.floor(5*k/g.length));});
    }
    for(const c of cand)obs.push(c);
  }
  console.log(`observations: ${obs.length.toLocaleString()}   (skipped illiquid ${skipLiq.toLocaleString()}, short-hist ${skipHist.toLocaleString()}, fit failures ${fitFail})`);

  // forward returns, ENTRY = OPEN of t+1
  const fwd=(sym,i,h)=>{const m=px.get(sym);if(!m)return null;const a=m.get(i+1),b=m.get(i+1+h);
    if(!a||!b||!(a.op>0)||!(b.cl>0))return null;return (b.cl/a.op-1)*100;};
  const acc=new Map();
  for(const r of obs)for(const h of HZ){const v=fwd(r.sym,r.i,h);if(v==null)continue;
    const k=`${r.i}|${r.lq}|${h}`;if(!acc.has(k))acc.set(k,[]);acc.get(k).push(v);}
  const bm=new Map();for(const[k,a]of acc)if(a.length>=5)bm.set(k,mean(a));
  for(const r of obs){r.ret={};r.ab={};
    for(const h of HZ){const v=fwd(r.sym,r.i,h);r.ret[h]=v;
      const b=bm.get(`${r.i}|${r.lq}|${h}`);r.ab[h]=(v!=null&&b!=null)?v-b:null;}
    r.win=dates[r.i]<='2018-12-31'?'DEV':dates[r.i]<='2022-12-31'?'VALID':'TEST';}

  // ================= PRIMARY =================
  console.log('\n'+'='.repeat(116));
  console.log(`PRIMARY — signal D (fully residualised), Q5, h=+${H_PRIMARY}, matched-abnormal %`);
  console.log('='.repeat(116));
  console.log('Win     n        uniqCos   mean%    median%   win%   clustT     p         boot95CI');
  const prim={};
  for(const w of ['DEV','VALID','TEST']){
    const g=obs.filter(r=>r.win===w&&r.qD===4&&r.ab[H_PRIMARY]!=null);
    if(g.length<200){console.log(`${w}: n=${g.length} INSUFFICIENT`);continue;}
    const v=g.map(r=>r.ab[H_PRIMARY]);
    const t=clusteredT(g.map(r=>({sym:r.sym,v:r.ab[H_PRIMARY]})));
    const ci=boot(v);prim[w]=mean(v);
    console.log(`${w.padEnd(6)} ${String(v.length).padStart(7)} ${String(new Set(g.map(r=>r.sym)).size).padStart(9)} `+
      `${mean(v).toFixed(4).padStart(8)} ${med(v).toFixed(4).padStart(9)} ${(100*v.filter(x=>x>0).length/v.length).toFixed(0).padStart(5)} `+
      `${t.toFixed(2).padStart(8)} ${pFromT(t).toExponential(1).padStart(10)}  [${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]`);
  }
  console.log('\nSTOP RULE — DEV and VALID must BOTH be positive');
  if(prim.DEV!==undefined&&prim.VALID!==undefined)
    console.log(`  DEV ${prim.DEV.toFixed(4)}%   VALID ${prim.VALID.toFixed(4)}%  -> ${prim.DEV>0&&prim.VALID>0?'PASSES':'FAILS'}`);

  // ================= KEY DIAGNOSTIC A/B/C/D =================
  console.log('\n'+'='.repeat(116));
  console.log('KEY DIAGNOSTIC — nested normalisations (Q5 abnormal %, h=+5)');
  console.log('If A works but D does not, the effect is a mechanical price/liquidity artifact.');
  console.log('='.repeat(116));
  console.log('Variant                          DEV        VALID       TEST');
  for(const[V,label]of [['A','A raw trade size'],['B','B price-normalised'],['C','C liquidity-normalised'],['D','D FULLY RESIDUALISED']]){
    const row=['DEV','VALID','TEST'].map(w=>{
      const g=obs.filter(r=>r.win===w&&r['q'+V]===4&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]);
      return g.length>200?mean(g).toFixed(4).padStart(10):'      n/a ';});
    console.log(label.padEnd(32)+row.join(' '));
  }

  // ================= MONOTONICITY =================
  console.log('\nMONOTONICITY (signal D, h=+5)');
  console.log('Win      Q1        Q2        Q3        Q4        Q5');
  for(const w of ['DEV','VALID','TEST']){
    const row=[];for(let q=0;q<5;q++){
      const v=obs.filter(r=>r.win===w&&r.qD===q&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]);
      row.push(v.length>200?mean(v):NaN);}
    console.log(w.padEnd(7)+row.map(x=>isNaN(x)?'     n/a ':x.toFixed(4).padStart(9)).join(' '));
  }

  // ================= DIRECTIONALITY =================
  console.log('\n'+'='.repeat(116));
  console.log('DIRECTIONALITY TEST — does trade size predict DIRECTION or only MAGNITUDE?');
  console.log('='.repeat(116));
  console.log('Win     Q5 signed%   Q5 |abs|%   Q1 |abs|%   |abs| lift   -> interpretation');
  for(const w of ['DEV','VALID','TEST']){
    const q5=obs.filter(r=>r.win===w&&r.qD===4&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]);
    const q1=obs.filter(r=>r.win===w&&r.qD===0&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]);
    if(q5.length<200||q1.length<200)continue;
    const a5=mean(q5.map(Math.abs)),a1=mean(q1.map(Math.abs));
    console.log(`${w.padEnd(6)} ${mean(q5).toFixed(4).padStart(11)} ${a5.toFixed(4).padStart(11)} ${a1.toFixed(4).padStart(11)} ${((a5/a1-1)*100).toFixed(1).padStart(11)}%`);
  }
  console.log('  A large |abs| lift with a near-zero signed mean = predicts VOLATILITY, not direction.');

  fs.writeFileSync(path.join(DATA,'h428c_obs.json'),JSON.stringify(
    obs.filter(r=>r.qD===4).map(r=>({sym:r.sym,i:r.i,win:r.win,lq:r.lq,ab5:r.ab[5],ret5:r.ret[5]}))));
}
main();
