#!/usr/bin/env node
/**
 * PROGRAM 431 — INFORMATION ARRIVAL -> PARTICIPATION -> PRICE CONFIRMATION
 * Specification frozen before any forward return was computed.
 *
 * MECHANISM: an information event draws abnormal participation; the initial
 * price move reveals which side informed flow is on (participation alone cannot
 * — H-428-C proved that); a close held high in the day's range indicates
 * one-sided absorption rather than two-sided noise; attention-constrained
 * investors then follow over subsequent sessions.
 *
 * SIGNAL (frozen):
 *   P = mean( z20[log(tradedValue)], z60[deliveryPct], residZ[abnTradeSize] )
 *   confirm = ret_t > 0 AND CLV_t >= 0.70
 *   trade if P in top quintile WITHIN liquidity bucket AND confirm
 *   entry = OPEN of t+1, exit = CLOSE of t+5
 *
 * Liquidity floor RAISED to Rs5cr median trailing-20 traded value: prior
 * hypotheses died in illiquid names, so the universe is restricted up-front to
 * the band a Rs2L account can actually execute in. Not adjustable after results.
 *
 * Usage: node p431-confirm.js <DATADIR>
 */
const fs=require('fs'),path=require('path');
const ETF_RE=/BEES|ETF|GOLD|LIQUID|NIFTY|SENSEX|INAV|SILVER/i;
const H_PRIMARY=5,HZ=[1,3,5,10],MIN_TV=5e7,MIN_PX=10,CLV_MIN=0.70,DP_RS=15*1.18;

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
function ols(X,y){const n=X.length,k=X[0].length;
 const A=Array.from({length:k},()=>new Float64Array(k)),B=new Float64Array(k);
 for(let i=0;i<n;i++){const x=X[i];for(let a=0;a<k;a++){B[a]+=x[a]*y[i];for(let b=0;b<k;b++)A[a][b]+=x[a]*x[b];}}
 for(let a=0;a<k;a++)A[a][a]+=1e-8;
 const M=A.map((r,i)=>Array.from(r).concat([B[i]]));
 for(let c=0;c<k;c++){let p=c;for(let r=c+1;r<k;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
  [M[c],M[p]]=[M[p],M[c]];if(Math.abs(M[c][c])<1e-12)return null;
  for(let r=0;r<k;r++){if(r===c)continue;const f=M[r][c]/M[c][c];for(let cc=c;cc<=k;cc++)M[r][cc]-=f*M[c][cc];}}
 return Array.from({length:k},(_,i)=>M[i][k]/M[i][i]);}
function parseMto(t){const o=[];for(const l of t.split(/\r?\n/)){if(!l.startsWith('20,'))continue;
 const c=l.split(',');if(c.length<7||(c[3]||'').trim()!=='EQ')continue;
 const s=(c[2]||'').trim(),q=+c[4],p=+c[6];if(!s||!(q>0)||!Number.isFinite(p))continue;o.push({sym:s,pct:p});}return o;}
function pL(t){const o=[];const L=t.split(/\r?\n/);
 for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<13||(c[1]||'').trim()!=='EQ')continue;
  o.push({sym:c[0].trim(),op:+c[2],hi:+c[3],lo:+c[4],cl:+c[5],val:+c[9],tr:+c[11]});}return o;}
function pN(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());const ix=n=>h.indexOf(n);
 const a=ix('TckrSymb'),b=ix('SctySrs'),o1=ix('OpnPric'),hh=ix('HghPric'),ll=ix('LwPric'),d=ix('ClsPric'),v=ix('TtlTrfVal'),n2=ix('TtlNbOfTxsExctd'),f=ix('FinInstrmTp');
 const o=[];for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;
  if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
  o.push({sym:(c[a]||'').trim(),op:+c[o1],hi:+c[hh],lo:+c[ll],cl:+c[d],val:+c[v],tr:+c[n2]});}return o;}

function main(){
  const DATA=process.argv[2],RAW=path.join(DATA,'full','raw'),MRAW=path.join(DATA,'mto','raw');
  const files=fs.readdirSync(RAW).filter(f=>f.endsWith('.csv')&&fs.statSync(path.join(RAW,f)).isFile()).sort();
  const dates=files.map(f=>f.replace('.csv',''));const T=dates.length;
  const px=new Map(),dl=new Map();
  for(let i=0;i<T;i++){const d=dates[i];
    for(const r of (d>'2024-06-30'?pN:pL)(fs.readFileSync(path.join(RAW,files[i]),'utf8'))){
      if(!r.sym||!(r.cl>0))continue;if(!px.has(r.sym))px.set(r.sym,new Map());px.get(r.sym).set(i,r);}
    const mp=path.join(MRAW,`${d}.dat`);
    if(fs.existsSync(mp))for(const r of parseMto(fs.readFileSync(mp,'utf8'))){
      if(!dl.has(r.sym))dl.set(r.sym,new Map());dl.get(r.sym).set(i,r.pct);}}
  console.log('='.repeat(116));
  console.log('PROGRAM 431 — PARTICIPATION + PRICE CONFIRMATION  [spec frozen before results]');
  console.log('='.repeat(116));
  console.log(`sessions ${T}  price syms ${px.size}  delivery syms ${dl.size}  liquidity floor Rs${(MIN_TV/1e7).toFixed(0)}cr`);

  const obs=[];
  for(let i=60;i<T-21;i++){
    const cand=[];
    for(const[sym,m]of px){
      if(ETF_RE.test(sym))continue;
      const c=m.get(i);if(!c||!(c.cl>=MIN_PX)||!(c.tr>0)||!(c.val>0)||!(c.hi>c.lo))continue;
      const dm=dl.get(sym);if(!dm)continue;const dpct=dm.get(i);if(dpct==null)continue;
      const tv=[],lv=[],rets=[],dh=[];
      for(let k=i-20;k<i;k++){const b=m.get(k);if(b){tv.push(b.val||0);lv.push(Math.log(Math.max(1,b.val)));
        const p=m.get(k-1);if(p&&p.cl>0)rets.push(Math.log(b.cl/p.cl));}}
      for(let k=i-60;k<i;k++){const p=dm.get(k);if(p!=null)dh.push(p);}
      if(tv.length<14||lv.length<14||rets.length<10||dh.length<40)continue;
      const mtv=med(tv);if(!(mtv>=MIN_TV))continue;
      const lm=mean(lv),ls=sd(lv);if(!(ls>0))continue;
      const dm2=mean(dh),ds=sd(dh);if(!(ds>0))continue;
      const prev=m.get(i-1);if(!prev||!(prev.cl>0))continue;
      cand.push({sym,i,mtv,
        zVal:(Math.log(Math.max(1,c.val))-lm)/ls,
        zDel:(dpct-dm2)/ds,
        ts:c.val/c.tr, pxLvl:c.cl, val:c.val, vol:sd(rets),
        ret:(c.cl/prev.cl-1)*100,
        clv:(c.cl-c.lo)/(c.hi-c.lo)});
    }
    if(cand.length<60)continue;
    // abnormal trade size residual (same model as H-428-C, frozen)
    const y=cand.map(c=>Math.log(c.ts));
    const X=cand.map(c=>[1,Math.log(c.pxLvl),Math.log(c.val),c.vol]);
    const beta=ols(X,y);if(!beta)continue;
    const res=cand.map((c,k)=>y[k]-(beta[0]+beta[1]*X[k][1]+beta[2]*X[k][2]+beta[3]*X[k][3]));
    const rm=mean(res),rs=sd(res);if(!(rs>0))continue;
    cand.forEach((c,k)=>{c.zTs=(res[k]-rm)/rs;
      c.P=(c.zVal+c.zDel+c.zTs)/3;
      c.confirm=(c.ret>0&&c.clv>=CLV_MIN);});
    // liquidity buckets, then P-quintile WITHIN bucket
    const bl=[...cand].sort((a,b)=>a.mtv-b.mtv);
    bl.forEach((c,k)=>{c.lq=Math.min(4,Math.floor(5*k/bl.length));});
    for(let L=0;L<5;L++){const g=cand.filter(c=>c.lq===L).sort((a,b)=>a.P-b.P);
      if(g.length<10)continue;g.forEach((c,k)=>{c.qP=Math.min(4,Math.floor(5*k/g.length));});}
    for(const c of cand)obs.push(c);
  }
  const fwd=(sym,i,h)=>{const m=px.get(sym);if(!m)return null;const a=m.get(i+1),b=m.get(i+1+h);
    if(!a||!b||!(a.op>0)||!(b.cl>0))return null;return (b.cl/a.op-1)*100;};
  const acc=new Map();
  for(const r of obs)for(const h of HZ){const v=fwd(r.sym,r.i,h);if(v==null)continue;
    const k=`${r.i}|${r.lq}|${h}`;if(!acc.has(k))acc.set(k,[]);acc.get(k).push(v);}
  const bm=new Map();for(const[k,a]of acc)if(a.length>=5)bm.set(k,mean(a));
  for(const r of obs){r.ret5={};r.ab={};
    for(const h of HZ){const v=fwd(r.sym,r.i,h);r.ret5[h]=v;
      const b=bm.get(`${r.i}|${r.lq}|${h}`);r.ab[h]=(v!=null&&b!=null)?v-b:null;}
    r.win=dates[r.i]<='2018-12-31'?'DEV':dates[r.i]<='2022-12-31'?'VALID':'TEST';}
  console.log(`observations ${obs.length.toLocaleString()}`);

  const arm={
    'COMBINED (primary)':r=>r.qP===4&&r.confirm,
    'participation only':r=>r.qP===4,
    'confirmation only':r=>r.confirm,
  };
  console.log('\n'+'='.repeat(116));
  console.log(`PRIMARY + DIAGNOSTIC ARMS — h=+${H_PRIMARY}, matched-abnormal % (arms are controls, NOT selectable)`);
  console.log('='.repeat(116));
  console.log('Arm                    Win      n      uniqCos   mean%    median%  win%   clustT     p        boot95CI');
  const prim={};
  for(const[name,fn]of Object.entries(arm)){
    for(const w of ['DEV','VALID','TEST']){
      const g=obs.filter(r=>r.win===w&&fn(r)&&r.ab[H_PRIMARY]!=null);
      if(g.length<500){console.log(`${name.padEnd(22)} ${w.padEnd(6)} n=${g.length} INSUFFICIENT`);continue;}
      const v=g.map(r=>r.ab[H_PRIMARY]);
      const t=clusteredT(g.map(r=>({sym:r.sym,v:r.ab[H_PRIMARY]})));
      const ci=boot(v);
      if(name.startsWith('COMBINED'))prim[w]={m:mean(v),md:med(v),t,n:v.length};
      console.log(`${name.padEnd(22)} ${w.padEnd(6)} ${String(v.length).padStart(6)} ${String(new Set(g.map(r=>r.sym)).size).padStart(8)} `+
        `${mean(v).toFixed(4).padStart(8)} ${med(v).toFixed(4).padStart(8)} ${(100*v.filter(x=>x>0).length/v.length).toFixed(0).padStart(5)} `+
        `${t.toFixed(2).padStart(8)} ${pFromT(t).toExponential(1).padStart(9)} [${ci[0].toFixed(3)},${ci[1].toFixed(3)}]`);
    }
    console.log('-'.repeat(116));
  }
  console.log('STOP RULE — DEV and VALID both positive on COMBINED');
  if(prim.DEV&&prim.VALID)
    console.log(`  DEV ${prim.DEV.m.toFixed(4)}%  VALID ${prim.VALID.m.toFixed(4)}%  -> ${prim.DEV.m>0&&prim.VALID.m>0?'PASSES':'FAILS'}`);

  // liquidity + raw + costs
  console.log('\nLIQUIDITY BUCKET (combined arm, all windows) — lq4 = most liquid');
  for(let L=0;L<5;L++){
    const v=obs.filter(r=>r.qP===4&&r.confirm&&r.lq===L&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]);
    if(v.length<200)continue;
    console.log(`  lq${L} n=${String(v.length).padStart(6)} mean ${mean(v).toFixed(4).padStart(8)} median ${med(v).toFixed(4).padStart(8)} win% ${(100*v.filter(x=>x>0).length/v.length).toFixed(0)}`);
  }
  console.log('\nRAW return (combined arm) and cost hurdle');
  for(const w of ['DEV','VALID','TEST']){
    const g=obs.filter(r=>r.win===w&&r.qP===4&&r.confirm&&r.ret5[H_PRIMARY]!=null).map(r=>r.ret5[H_PRIMARY]);
    if(g.length<500)continue;
    console.log(`  ${w.padEnd(6)} raw ${mean(g).toFixed(4)}%  median ${med(g).toFixed(4)}%`);
  }
  for(const pos of [20000,50000,100000,200000]){
    const p0=500,q=Math.floor(pos/p0),bt=p0*q,st=p0*1.005*q;
    const c=(bt+st)*0.001+(bt+st)*0.0000297+(bt+st)*0.000001+bt*0.00015+((bt+st)*0.0000297+(bt+st)*0.000001)*0.18+DP_RS;
    console.log(`    Rs${String(pos).padStart(6)}: cost ${(100*c/pos).toFixed(3)}%  +0.20% slip => hurdle ${(100*c/pos+0.2).toFixed(3)}%`);
  }
  // tail + placebo
  console.log('\nTAIL DEPENDENCE (combined arm)');
  for(const w of ['DEV','VALID','TEST']){
    const v=obs.filter(r=>r.win===w&&r.qP===4&&r.confirm&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]).sort((a,b)=>b-a);
    if(v.length<500)continue;
    console.log(`  ${w.padEnd(6)} full ${mean(v).toFixed(4)}  -top1% ${mean(v.slice(Math.floor(v.length*0.01))).toFixed(4)}  -top5% ${mean(v.slice(Math.floor(v.length*0.05))).toFixed(4)}`);
  }
  console.log('\nDIRECTION vs MAGNITUDE (combined arm)');
  for(const w of ['DEV','VALID','TEST']){
    const g=obs.filter(r=>r.win===w&&r.qP===4&&r.confirm&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]);
    const b=obs.filter(r=>r.win===w&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]);
    if(g.length<500)continue;
    console.log(`  ${w.padEnd(6)} signed ${mean(g).toFixed(4)}%   |abs| ${mean(g.map(Math.abs)).toFixed(4)}% vs universe ${mean(b.map(Math.abs)).toFixed(4)}%  lift ${((mean(g.map(Math.abs))/mean(b.map(Math.abs))-1)*100).toFixed(1)}%`);
  }
}
main();
