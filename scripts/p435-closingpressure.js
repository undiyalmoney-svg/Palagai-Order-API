#!/usr/bin/env node
/**
 * P-435 — CLOSING-PERIOD ORDER IMBALANCE  (LAST vs CLOSE)
 * Spec frozen before any forward return computed.
 *
 * NSE CLOSE = VWAP of final 30 minutes.  LAST = final traded price.
 * CP = (LAST - CLOSE)/CLOSE captures whether closing-moment order flow pushed
 * price away from the session-end average.
 *
 * TWO COMPETING HYPOTHESES, OPPOSITE SIGNS — this is what makes it sharp:
 *   H1 informed late trading  -> positive CP predicts CONTINUATION (Q5 > 0)
 *   H0 bid-ask bounce         -> LAST is a random bid/ask draw, predicts
 *                                mechanical REVERSAL (Q5 < 0)
 * A negative Q5 falsifies H1 and confirms the signal is microstructure noise.
 *
 * Primary horizon = 1 session: the mechanism's natural horizon, chosen for
 * economic reasoning and NOT for tradeability. Declared in advance that daily
 * turnover is almost certainly untradeable; existence and tradeability are
 * reported as separate verdicts.
 *
 * Usage: node p435-closingpressure.js <DATADIR>
 */
const fs=require('fs'),path=require('path');
const ETF_RE=/BEES|ETF|GOLD|LIQUID|NIFTY|SENSEX|INAV|SILVER/i;
const HZ=[1,3,5],H_PRIMARY=1,MIN_TV=1e7,MIN_PX=10,DP_RS=15*1.18;

const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const med=a=>{const s=[...a].sort((x,y)=>x-y);const n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):0;};
function clusteredT(rows){const n=rows.length;if(n<20)return 0;const m=mean(rows.map(r=>r.v));
 const by=new Map();for(const r of rows)by.set(r.sym,(by.get(r.sym)||0)+(r.v-m));
 let meat=0;for(const[,s]of by)meat+=s*s;const se=Math.sqrt(meat)/n;return se>0?m/se:0;}
function pFromT(t){const z=Math.abs(t);const b=[0.319381530,-0.356563782,1.781477937,-1.821255978,1.330274429];
 const c=0.39894228*Math.exp(-z*z/2),tt=1/(1+0.2316419*z);
 return 2*c*tt*(b[0]+tt*(b[1]+tt*(b[2]+tt*(b[3]+tt*b[4]))));}
function boot(a,it=2000){if(a.length<20)return[NaN,NaN];const m=[];
 for(let i=0;i<it;i++){let s=0;for(let k=0;k<a.length;k++)s+=a[(Math.random()*a.length)|0];m.push(s/a.length);}
 m.sort((x,y)=>x-y);return[m[(it*0.025)|0],m[(it*0.975)|0]];}
// legacy: SYMBOL,SERIES,OPEN,HIGH,LOW,CLOSE,LAST,PREVCLOSE,TOTTRDQTY,TOTTRDVAL,TIMESTAMP,TOTALTRADES,ISIN
function pL(t){const o=[];const L=t.split(/\r?\n/);
 for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<13||(c[1]||'').trim()!=='EQ')continue;
  o.push({sym:c[0].trim(),op:+c[2],cl:+c[5],last:+c[6],pc:+c[7],val:+c[9]});}return o;}
function pN(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());
 const ix=n=>h.indexOf(n);
 const a=ix('TckrSymb'),b=ix('SctySrs'),o1=ix('OpnPric'),d=ix('ClsPric'),la=ix('LastPric'),p=ix('PrvsClsgPric'),v=ix('TtlTrfVal'),f=ix('FinInstrmTp');
 const o=[];for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;
  if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
  o.push({sym:(c[a]||'').trim(),op:+c[o1],cl:+c[d],last:+c[la],pc:+c[p],val:+c[v]});}return o;}

function main(){
  const DATA=process.argv[2],RAW=path.join(DATA,'full','raw');
  const files=fs.readdirSync(RAW).filter(f=>f.endsWith('.csv')&&fs.statSync(path.join(RAW,f)).isFile()).sort();
  const dates=files.map(f=>f.replace('.csv',''));const T=dates.length;
  const px=new Map();
  let nonzero=0,total=0;
  for(let i=0;i<T;i++)for(const r of (dates[i]>'2024-06-30'?pN:pL)(fs.readFileSync(path.join(RAW,files[i]),'utf8'))){
    if(!r.sym||!(r.cl>0)||!(r.last>0))continue;
    total++;if(Math.abs(r.last-r.cl)>1e-9)nonzero++;
    if(!px.has(r.sym))px.set(r.sym,new Map());px.get(r.sym).set(i,r);}
  console.log('='.repeat(114));
  console.log('P-435 — CLOSING-PERIOD ORDER IMBALANCE (LAST vs CLOSE)  [frozen before results]');
  console.log('='.repeat(114));
  console.log(`sessions ${T}  symbols ${px.size}  records ${total.toLocaleString()}`);
  console.log(`records where LAST != CLOSE: ${nonzero.toLocaleString()} (${(100*nonzero/total).toFixed(1)}%)  <- signal has variation`);

  const obs=[];
  for(let i=20;i<T-6;i++){
    const cand=[];
    for(const[sym,m]of px){
      if(ETF_RE.test(sym))continue;
      const c=m.get(i);if(!c||!(c.cl>=MIN_PX)||!(c.last>0))continue;
      const tv=[];for(let k=i-20;k<i;k++){const b=m.get(k);if(b)tv.push(b.val||0);}
      if(tv.length<14)continue;
      const mtv=med(tv);if(!(mtv>=MIN_TV))continue;
      const prev=m.get(i-1);if(!prev||!(prev.cl>0))continue;
      cand.push({sym,i,mtv,
        cp:(c.last-c.cl)/c.cl*10000,          // basis points
        ownRet:(c.cl/prev.cl-1)*100});
    }
    if(cand.length<60)continue;
    const bl=[...cand].sort((a,b)=>a.mtv-b.mtv);
    bl.forEach((c,k)=>{c.lq=Math.min(4,Math.floor(5*k/bl.length));});
    for(let L=0;L<5;L++){
      const g=cand.filter(c=>c.lq===L).sort((a,b)=>a.cp-b.cp);
      if(g.length<10)continue;
      g.forEach((c,k)=>{c.q=Math.min(4,Math.floor(5*k/g.length));});
      const go=[...g].sort((a,b)=>a.ownRet-b.ownRet);
      go.forEach((c,k)=>{c.qOwn=Math.min(4,Math.floor(5*k/go.length));});
    }
    for(const c of cand)if(c.q!==undefined)obs.push(c);
  }
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
  console.log(`observations ${obs.length.toLocaleString()}`);
  const cps=obs.map(r=>r.cp).sort((a,b)=>a-b);
  console.log(`CP distribution (bps): p5 ${cps[(cps.length*0.05)|0].toFixed(1)}  median ${med(cps).toFixed(1)}  p95 ${cps[(cps.length*0.95)|0].toFixed(1)}`);

  console.log('\n'+'='.repeat(114));
  console.log(`PRIMARY — Q5 closing pressure, h=+${H_PRIMARY}, matched-abnormal %`);
  console.log('H1 informed flow => POSITIVE.  H0 bid-ask bounce => NEGATIVE.');
  console.log('='.repeat(114));
  console.log('Win      n       uniqCos   mean%    median%  win%   clustT     p         boot95CI');
  const prim={};
  for(const w of ['DEV','VALID','TEST']){
    const g=obs.filter(r=>r.win===w&&r.q===4&&r.ab[H_PRIMARY]!=null);
    if(g.length<5000){console.log(`${w}: n=${g.length} INSUFFICIENT`);continue;}
    const v=g.map(r=>r.ab[H_PRIMARY]);
    const t=clusteredT(g.map(r=>({sym:r.sym,v:r.ab[H_PRIMARY]})));const ci=boot(v);
    prim[w]=mean(v);
    console.log(`${w.padEnd(6)} ${String(v.length).padStart(7)} ${String(new Set(g.map(r=>r.sym)).size).padStart(8)} `+
      `${mean(v).toFixed(4).padStart(8)} ${med(v).toFixed(4).padStart(8)} ${(100*v.filter(x=>x>0).length/v.length).toFixed(0).padStart(5)} `+
      `${t.toFixed(2).padStart(8)} ${pFromT(t).toExponential(1).padStart(9)} [${ci[0].toFixed(3)},${ci[1].toFixed(3)}]`);
  }
  console.log('\nSTOP RULE / FALSIFICATION');
  if(prim.DEV!==undefined&&prim.VALID!==undefined){
    const pass=prim.DEV>0&&prim.VALID>0;
    console.log(`  DEV ${prim.DEV.toFixed(4)}%  VALID ${prim.VALID.toFixed(4)}%  -> ${pass?'H1 SUPPORTED (continuation)':'H1 FALSIFIED'}`);
    if(!pass)console.log('  Negative Q5 = bid-ask bounce (H0). Signal is microstructure noise, not informed flow.');
  }

  console.log('\nQUINTILE MONOTONICITY (h=+1)');
  console.log('Win      Q1        Q2        Q3        Q4        Q5     |  Q5-Q1');
  for(const w of ['DEV','VALID','TEST']){
    const row=[];for(let q=0;q<5;q++){const v=obs.filter(r=>r.win===w&&r.q===q&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]);
      row.push(v.length>2000?mean(v):NaN);}
    console.log(w.padEnd(7)+row.map(x=>isNaN(x)?'     n/a ':x.toFixed(4).padStart(9)).join(' ')+'  |  '+(row[4]-row[0]).toFixed(4));
  }

  console.log('\nSECONDARY HORIZONS (Q5 abnormal %) — declared, not selectable');
  console.log('Win        h=1        h=3        h=5');
  for(const w of ['DEV','VALID','TEST']){
    const row=HZ.map(h=>{const v=obs.filter(r=>r.win===w&&r.q===4&&r.ab[h]!=null).map(r=>r.ab[h]);
      return v.length>2000?mean(v).toFixed(4).padStart(10):'     n/a  ';}).join(' ');
    console.log(w.padEnd(9)+row);
  }

  console.log('\nOWN-RETURN CONTROL — is CP independent of the day\'s own move?');
  console.log('ownQ   cpQ1      cpQ5     diff   (DEV+VALID pooled)');
  for(let o=0;o<5;o++){
    const g1=obs.filter(r=>r.win!=='TEST'&&r.qOwn===o&&r.q===0&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]);
    const g5=obs.filter(r=>r.win!=='TEST'&&r.qOwn===o&&r.q===4&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]);
    if(g1.length<1000||g5.length<1000)continue;
    console.log(`  ${o}  ${mean(g1).toFixed(4).padStart(9)} ${mean(g5).toFixed(4).padStart(9)} ${(mean(g5)-mean(g1)).toFixed(4).padStart(8)}`);
  }

  console.log('\nDIRECTION vs MAGNITUDE');
  for(const w of ['DEV','VALID','TEST']){
    const g=obs.filter(r=>r.win===w&&r.q===4&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]);
    const u=obs.filter(r=>r.win===w&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]);
    if(g.length<5000)continue;
    console.log(`  ${w.padEnd(6)} signed ${mean(g).toFixed(4)}%  |abs| ${mean(g.map(Math.abs)).toFixed(4)}% vs universe ${mean(u.map(Math.abs)).toFixed(4)}%  lift ${((mean(g.map(Math.abs))/mean(u.map(Math.abs))-1)*100).toFixed(1)}%`);
  }
  console.log('\nLIQUIDITY BUCKET (Q5, h=+1, all windows)');
  for(let L=0;L<5;L++){const v=obs.filter(r=>r.q===4&&r.lq===L&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]);
    if(v.length<2000)continue;
    console.log(`  lq${L} n=${String(v.length).padStart(7)} mean ${mean(v).toFixed(4).padStart(8)} median ${med(v).toFixed(4).padStart(8)} win% ${(100*v.filter(x=>x>0).length/v.length).toFixed(0)}`);}
  console.log('\nECONOMICS (h=+1, ~250 round trips/yr)');
  for(const w of ['DEV','VALID','TEST']){
    const g=obs.filter(r=>r.win===w&&r.q===4&&r.ret[H_PRIMARY]!=null).map(r=>r.ret[H_PRIMARY]);
    if(g.length<5000)continue;
    console.log(`  ${w.padEnd(6)} raw ${mean(g).toFixed(4)}%`);
  }
  for(const pos of [20000,200000]){
    const p0=500,q=Math.floor(pos/p0),bt=p0*q,st=p0*1.002*q;
    const c=(bt+st)*0.001+(bt+st)*0.0000297+(bt+st)*0.000001+bt*0.00015+((bt+st)*0.0000297+(bt+st)*0.000001)*0.18+DP_RS;
    console.log(`    Rs${String(pos).padStart(6)}: ${(100*c/pos).toFixed(3)}% +0.20% slip = ${(100*c/pos+0.2).toFixed(3)}% per trade`);
  }
}
main();
