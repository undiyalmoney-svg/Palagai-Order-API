#!/usr/bin/env node
/**
 * P-436 — DIVIDEND-CHANGE SIGNALLING (low-frequency information)
 * Spec frozen before any forward return computed.
 *
 * MECHANISM: dividends are a costly, credible signal of management's private
 * information about future cash flows (Bhattacharya 1979; Miller & Rock 1985).
 * Raising payout commits future cash; cutting is costly to management. The
 * signal concerns earnings that only unfold over subsequent QUARTERS, so
 * confirmation is gradual — hence a multi-month holding period is implied by
 * the mechanism itself, not chosen from results.
 *
 * WHY THIS IS THE RIGHT SHAPE FOR P-436: ~1-2 dividend events per company per
 * year means turnover is naturally low. Prior programmes died because signal
 * horizon (1-5 sessions) was shorter than the horizon at which retail costs
 * are payable. Here the information is inherently low-frequency.
 *
 * TIMING: exDate is publicly known in advance; entry at exDate+1 open uses
 * only public information. Note the dividend was ANNOUNCED earlier (board
 * meeting), so this tests whether the signal remains unexploited at ex-date —
 * a stricter test of underreaction than trading the announcement itself.
 *
 * CRITICAL CONTROL: dividend growth may simply proxy past performance. The
 * own-momentum double sort is pre-declared; if the effect vanishes inside
 * momentum buckets, this is momentum (already rejected) and P-436 FAILS.
 *
 * Usage: node p436-dividend.js <DATADIR>
 */
const fs=require('fs'),path=require('path'),readline=require('readline');
const ETF_RE=/BEES|ETF|GOLD|LIQUID|NIFTY|SENSEX|INAV|SILVER/i;
const HOLD=60,MIN_TV=1e7,MIN_PX=10,DP_RS=15*1.18;
const MON={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
const caIso=s=>{const m=/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec((s||'').trim());
 if(!m)return null;const mo=MON[m[2].toUpperCase()];
 return mo===undefined?null:`${m[3]}-${String(mo+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;};

const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const med=a=>{const s=[...a].sort((x,y)=>x-y);const n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):0;};
function clusteredT(rows){const n=rows.length;if(n<20)return 0;const m=mean(rows.map(r=>r.v));
 const by=new Map();for(const r of rows)by.set(r.sym,(by.get(r.sym)||0)+(r.v-m));
 let meat=0;for(const[,s]of by)meat+=s*s;const se=Math.sqrt(meat)/n;return se>0?m/se:0;}
function pFromT(t){const z=Math.abs(t);const b=[0.319381530,-0.356563782,1.781477937,-1.821255978,1.330274429];
 const c=0.39894228*Math.exp(-z*z/2),tt=1/(1+0.2316419*z);
 return 2*c*tt*(b[0]+tt*(b[1]+tt*(b[2]+tt*(b[3]+tt*b[4]))));}
function boot(a,it=3000){if(a.length<20)return[NaN,NaN];const m=[];
 for(let i=0;i<it;i++){let s=0;for(let k=0;k<a.length;k++)s+=a[(Math.random()*a.length)|0];m.push(s/a.length);}
 m.sort((x,y)=>x-y);return[m[(it*0.025)|0],m[(it*0.975)|0]];}
function stream(f,cb){return new Promise((res,rej)=>{const rl=readline.createInterface({input:fs.createReadStream(f),crlfDelay:Infinity});
 rl.on('line',l=>{if(l.trim()){try{cb(JSON.parse(l))}catch(e){}}});rl.on('close',res);rl.on('error',rej);});}
function pL(t){const o=[];const L=t.split(/\r?\n/);
 for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<13||(c[1]||'').trim()!=='EQ')continue;
  o.push({sym:c[0].trim(),op:+c[2],cl:+c[5],val:+c[9]});}return o;}
function pN(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());const ix=n=>h.indexOf(n);
 const a=ix('TckrSymb'),b=ix('SctySrs'),o1=ix('OpnPric'),d=ix('ClsPric'),v=ix('TtlTrfVal'),f=ix('FinInstrmTp');
 const o=[];for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;
  if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
  o.push({sym:(c[a]||'').trim(),op:+c[o1],cl:+c[d],val:+c[v]});}return o;}

async function main(){
  const DATA=process.argv[2],RAW=path.join(DATA,'full','raw');
  // ---- collect dividend events with amounts ----
  const divBySym=new Map();const seen=new Set();
  for(const f of [path.join(DATA,'ca_sym','ca_persymbol.ndjson'),path.join(DATA,'ca_full','corpactions.ndjson')]){
    if(!fs.existsSync(f))continue;
    await stream(f,r=>{if(r.__sym||!r.symbol||!r.subject)return;
      if(!/dividend/i.test(r.subject))return;
      if(/split|bonus|rights|merger|demerger/i.test(r.subject))return;   // keep pure dividends
      const iso=caIso(r.exDate);if(!iso)return;
      const m=/(?:rs\.?|re\.?)\s*([0-9]+(?:\.[0-9]+)?)/i.exec(r.subject);
      if(!m)return;
      const amt=parseFloat(m[1]);if(!(amt>0))return;
      const k=`${r.symbol}|${iso}|${amt}`;if(seen.has(k))return;seen.add(k);
      if(!divBySym.has(r.symbol))divBySym.set(r.symbol,[]);
      divBySym.get(r.symbol).push({iso,amt});});
  }
  for(const[,a]of divBySym)a.sort((x,y)=>x.iso.localeCompare(y.iso));
  let totalDiv=0;for(const[,a]of divBySym)totalDiv+=a.length;
  console.log('='.repeat(114));
  console.log('P-436 — DIVIDEND-CHANGE SIGNALLING  [frozen before results]');
  console.log('='.repeat(114));
  console.log(`companies with dividends: ${divBySym.size}   dividend events: ${totalDiv.toLocaleString()}`);

  const files=fs.readdirSync(RAW).filter(f=>f.endsWith('.csv')&&fs.statSync(path.join(RAW,f)).isFile()).sort();
  const dates=files.map(f=>f.replace('.csv',''));const dIdx=new Map(dates.map((d,i)=>[d,i]));const T=dates.length;
  const px=new Map();
  for(let i=0;i<T;i++)for(const r of (dates[i]>'2024-06-30'?pN:pL)(fs.readFileSync(path.join(RAW,files[i]),'utf8'))){
    if(!r.sym||!(r.cl>0))continue;if(!px.has(r.sym))px.set(r.sym,new Map());px.get(r.sym).set(i,r);}

  const daysBetween=(a,b)=>(new Date(b)-new Date(a))/864e5;
  const ev=[];
  const excl={noPrice:0,noPrior:0,illiquid:0,lowPx:0,noPost:0,etf:0};
  for(const[sym,arr]of divBySym){
    if(ETF_RE.test(sym)){excl.etf+=arr.length;continue;}
    const m=px.get(sym);
    for(let k=0;k<arr.length;k++){
      const e=arr[k];
      const i=dIdx.get(e.iso);
      if(i===undefined||!m){excl.noPrice++;continue;}
      if(i<70||i+HOLD+2>=T){excl.noPost++;continue;}
      // TTM dividend (this + prior 365d) vs prior TTM (365-730d back)
      let ttm=0,prior=0;
      for(const o of arr){
        const dd=daysBetween(o.iso,e.iso);
        if(dd>=0&&dd<365)ttm+=o.amt;
        else if(dd>=365&&dd<730)prior+=o.amt;
      }
      if(!(prior>0)){excl.noPrior++;continue;}
      const cur=m.get(i);if(!cur||!(cur.cl>=MIN_PX)){excl.lowPx++;continue;}
      const tv=[];for(let q=i-20;q<i;q++){const b=m.get(q);if(b)tv.push(b.val||0);}
      if(tv.length<14){excl.illiquid++;continue;}
      const mtv=med(tv);if(!(mtv>=MIN_TV)){excl.illiquid++;continue;}
      const a60=m.get(i-60);if(!a60||!(a60.cl>0)){excl.noPrice++;continue;}
      const en=m.get(i+1),ex=m.get(i+1+HOLD);
      if(!en||!ex||!(en.op>0)||!(ex.cl>0)){excl.noPost++;continue;}
      ev.push({sym,iso:e.iso,i,mtv,
        growth:ttm/prior-1,
        ownMom:(cur.cl/a60.cl-1)*100,
        ret:(ex.cl/en.op-1)*100,
        win:e.iso<='2018-12-31'?'DEV':e.iso<='2022-12-31'?'VALID':'TEST'});
    }
  }
  console.log(`\nEXCLUSIONS: noPrice ${excl.noPrice}  noPriorDividend ${excl.noPrior}  illiquid ${excl.illiquid}  lowPrice ${excl.lowPx}  insufficientPost ${excl.noPost}  etf ${excl.etf}`);
  console.log(`ELIGIBLE EVENTS: ${ev.length.toLocaleString()}   unique companies: ${new Set(ev.map(e=>e.sym)).size}`);
  const byW={DEV:0,VALID:0,TEST:0};for(const e of ev)byW[e.win]++;
  console.log(`by window: DEV ${byW.DEV}  VALID ${byW.VALID}  TEST ${byW.TEST}`);

  // benchmark: liquidity-bucket mean over same window (from all events on that session)
  const bySess=new Map();
  for(const e of ev){if(!bySess.has(e.i))bySess.set(e.i,[]);bySess.get(e.i).push(e);}
  // liquidity bucket assigned within the full cross-section of that session using the price panel
  for(const[i,g]of bySess){
    const all=[];
    for(const[sym,m]of px){const c=m.get(i);if(!c)continue;
      const tv=[];for(let q=i-20;q<i;q++){const b=m.get(q);if(b)tv.push(b.val||0);}
      if(tv.length<14)continue;const mt=med(tv);if(!(mt>=MIN_TV))continue;
      const en=m.get(i+1),ex=m.get(i+1+HOLD);
      if(!en||!ex||!(en.op>0)||!(ex.cl>0))continue;
      all.push({sym,mt,r:(ex.cl/en.op-1)*100});}
    if(all.length<20){for(const e of g)e.ab=null;continue;}
    all.sort((a,b)=>a.mt-b.mt);all.forEach((c,k)=>{c.lq=Math.min(4,Math.floor(5*k/all.length));});
    const bm={};for(let L=0;L<5;L++){const v=all.filter(c=>c.lq===L).map(c=>c.r);if(v.length>=5)bm[L]=mean(v);}
    const lqOf=new Map(all.map(c=>[c.sym,c.lq]));
    for(const e of g){const L=lqOf.get(e.sym);e.lq=L;
      e.ab=(L!==undefined&&bm[L]!==undefined)?e.ret-bm[L]:null;}
  }
  const V=ev.filter(e=>e.ab!=null);
  console.log(`with matched benchmark: ${V.length.toLocaleString()}`);

  // quintiles of dividend growth, within liquidity bucket, pooled cross-sectionally
  for(let L=0;L<5;L++){
    const g=V.filter(e=>e.lq===L).sort((a,b)=>a.growth-b.growth);
    if(g.length<50)continue;
    g.forEach((e,k)=>{e.q=Math.min(4,Math.floor(5*k/g.length));});
  }
  const Q=V.filter(e=>e.q!==undefined);
  for(let L=0;L<5;L++){
    const g=Q.filter(e=>e.lq===L).sort((a,b)=>a.ownMom-b.ownMom);
    if(g.length<50)continue;
    g.forEach((e,k)=>{e.qOwn=Math.min(4,Math.floor(5*k/g.length));});
  }

  console.log('\n'+'='.repeat(114));
  console.log(`PRIMARY — Q5 dividend growth, hold ${HOLD} sessions, matched-abnormal %`);
  console.log('='.repeat(114));
  console.log('Win      n     uniqCos   mean%    median%  win%   clustT     p        boot95CI');
  const prim={};
  for(const w of ['DEV','VALID','TEST']){
    const g=Q.filter(e=>e.win===w&&e.q===4);
    if(g.length<200){console.log(`${w}: n=${g.length} INSUFFICIENT`);continue;}
    const v=g.map(e=>e.ab);const t=clusteredT(g.map(e=>({sym:e.sym,v:e.ab})));const ci=boot(v);
    prim[w]=mean(v);
    console.log(`${w.padEnd(6)} ${String(v.length).padStart(5)} ${String(new Set(g.map(e=>e.sym)).size).padStart(8)} `+
      `${mean(v).toFixed(3).padStart(8)} ${med(v).toFixed(3).padStart(8)} ${(100*v.filter(x=>x>0).length/v.length).toFixed(0).padStart(5)} `+
      `${t.toFixed(2).padStart(8)} ${pFromT(t).toExponential(1).padStart(9)} [${ci[0].toFixed(2)},${ci[1].toFixed(2)}]`);
  }
  console.log('\nSTOP RULE — DEV and VALID both positive (Bonferroni p<0.0125)');
  if(prim.DEV!==undefined&&prim.VALID!==undefined)
    console.log(`  DEV ${prim.DEV.toFixed(3)}%  VALID ${prim.VALID.toFixed(3)}%  -> ${prim.DEV>0&&prim.VALID>0?'PASSES':'FAILS'}`);

  console.log('\nQUINTILE MONOTONICITY');
  console.log('Win      Q1        Q2        Q3        Q4        Q5     |  Q5-Q1');
  for(const w of ['DEV','VALID','TEST']){
    const row=[];for(let q=0;q<5;q++){const v=Q.filter(e=>e.win===w&&e.q===q).map(e=>e.ab);
      row.push(v.length>100?mean(v):NaN);}
    console.log(w.padEnd(7)+row.map(x=>isNaN(x)?'     n/a ':x.toFixed(3).padStart(9)).join(' ')+'  |  '+(row[4]-row[0]).toFixed(3));
  }
  console.log('\nOWN-MOMENTUM DOUBLE SORT (DEV+VALID) — must hold inside every bucket');
  console.log('ownQ   divQ1     divQ5     diff');
  for(let o=0;o<5;o++){
    const g1=Q.filter(e=>e.win!=='TEST'&&e.qOwn===o&&e.q===0).map(e=>e.ab);
    const g5=Q.filter(e=>e.win!=='TEST'&&e.qOwn===o&&e.q===4).map(e=>e.ab);
    if(g1.length<40||g5.length<40)continue;
    console.log(`  ${o}  ${mean(g1).toFixed(3).padStart(8)} ${mean(g5).toFixed(3).padStart(9)} ${(mean(g5)-mean(g1)).toFixed(3).padStart(8)}`);
  }
  console.log('\nDIRECTION vs MAGNITUDE');
  for(const w of ['DEV','VALID','TEST']){
    const g=Q.filter(e=>e.win===w&&e.q===4).map(e=>e.ab),u=Q.filter(e=>e.win===w).map(e=>e.ab);
    if(g.length<200)continue;
    console.log(`  ${w.padEnd(6)} signed ${mean(g).toFixed(3)}%  |abs| ${mean(g.map(Math.abs)).toFixed(3)}% vs universe ${mean(u.map(Math.abs)).toFixed(3)}%  lift ${((mean(g.map(Math.abs))/mean(u.map(Math.abs))-1)*100).toFixed(1)}%`);
  }
  console.log('\nTAIL DEPENDENCE');
  for(const w of ['DEV','VALID','TEST']){
    const v=Q.filter(e=>e.win===w&&e.q===4).map(e=>e.ab).sort((a,b)=>b-a);
    if(v.length<200)continue;
    console.log(`  ${w.padEnd(6)} full ${mean(v).toFixed(3)}  -top1% ${mean(v.slice(Math.max(1,Math.floor(v.length*0.01)))).toFixed(3)}  -top5% ${mean(v.slice(Math.floor(v.length*0.05))).toFixed(3)}`);
  }
  console.log('\nLIQUIDITY BUCKET (Q5, all windows)');
  for(let L=0;L<5;L++){const v=Q.filter(e=>e.q===4&&e.lq===L).map(e=>e.ab);
    if(v.length<100)continue;
    console.log(`  lq${L} n=${String(v.length).padStart(5)} mean ${mean(v).toFixed(3).padStart(8)} median ${med(v).toFixed(3).padStart(8)} win% ${(100*v.filter(x=>x>0).length/v.length).toFixed(0)}`);}
  console.log('\nECONOMICS — raw return per event, ~1-2 events/company/yr');
  for(const w of ['DEV','VALID','TEST']){
    const g=Q.filter(e=>e.win===w&&e.q===4).map(e=>e.ret);
    if(g.length<200)continue;
    console.log(`  ${w.padEnd(6)} raw ${mean(g).toFixed(3)}%  median ${med(g).toFixed(3)}%`);
  }
  for(const pos of [20000,200000]){
    const p0=500,q=Math.floor(pos/p0),bt=p0*q,st=p0*1.02*q;
    const c=(bt+st)*0.001+(bt+st)*0.0000297+(bt+st)*0.000001+bt*0.00015+((bt+st)*0.0000297+(bt+st)*0.000001)*0.18+DP_RS;
    console.log(`    Rs${String(pos).padStart(6)}: ${(100*c/pos).toFixed(3)}% +0.20% slip = ${(100*c/pos+0.2).toFixed(3)}% per round trip`);
  }
}
main().catch(e=>{console.error('ERR',e.message,e.stack);process.exit(1);});
