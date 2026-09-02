#!/usr/bin/env node
/**
 * H-428-B ATTACK SUITE — Steps 10-16 of the protocol.
 * Purpose is to KILL the hypothesis, not to find more ways for it to pass.
 *
 * Primary survived DEV->VALID sign consistency, so attacks are now permitted.
 * Immediate concerns already visible and carried into every table below:
 *   - median NEGATIVE while mean positive, win rate 46-48%  -> tail dependence
 *   - DEV p=3.3e-3 FAILS the declared Bonferroni threshold p<0.001
 *   - effect ~0.10% / 5 sessions vs ~0.23% round-trip cost at Rs2L
 *
 * Usage: node h428b-attack.js <DATADIR>
 */
const fs = require('fs');
const path = require('path');

const TRAIL = 60, MIN_TV = 1e7, MIN_PX = 10, H = 5;
const ETF_RE = /BEES|ETF|GOLD|LIQUID|NIFTY|SENSEX|INAV|SILVER/i;
const DP_RS = 15 * 1.18;

const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const med=a=>{const s=[...a].sort((x,y)=>x-y);const n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):0;};
const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1));};
function clusteredT(rows){const n=rows.length;if(n<20)return 0;const m=mean(rows.map(r=>r.v));
 const by=new Map();for(const r of rows)by.set(r.sym,(by.get(r.sym)||0)+(r.v-m));
 let meat=0;for(const[,s]of by)meat+=s*s;const se=Math.sqrt(meat)/n;return se>0?m/se:0;}

function parseMto(t){const o=[];for(const l of t.split(/\r?\n/)){if(!l.startsWith('20,'))continue;
 const c=l.split(',');if(c.length<7||(c[3]||'').trim()!=='EQ')continue;
 const sym=(c[2]||'').trim(),qty=+c[4],pct=+c[6];
 if(!sym||!(qty>0)||!Number.isFinite(pct))continue;o.push({sym,pct});}return o;}
function parseLegacy(t){const o=[];const L=t.split(/\r?\n/);
 for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<13||(c[1]||'').trim()!=='EQ')continue;
  o.push({sym:c[0].trim(),op:+c[2],cl:+c[5],val:+c[9]});}return o;}
function parseNew(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());
 const ix=n=>h.indexOf(n);const a=ix('TckrSymb'),b=ix('SctySrs'),o1=ix('OpnPric'),d=ix('ClsPric'),v=ix('TtlTrfVal'),f=ix('FinInstrmTp');
 const o=[];for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;
  if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
  o.push({sym:(c[a]||'').trim(),op:+c[o1],cl:+c[d],val:+c[v]});}return o;}

function main(){
  const DATA=process.argv[2];
  const BRAW=path.join(DATA,'full','raw'),MRAW=path.join(DATA,'mto','raw');
  const bFiles=fs.readdirSync(BRAW).filter(f=>f.endsWith('.csv')&&fs.statSync(path.join(BRAW,f)).isFile()).sort();
  const dates=bFiles.map(f=>f.replace('.csv',''));const T=dates.length;
  const px=new Map(),dl=new Map();
  for(let i=0;i<T;i++){const d=dates[i];
    for(const r of (d>'2024-06-30'?parseNew:parseLegacy)(fs.readFileSync(path.join(BRAW,`${d}.csv`),'utf8'))){
      if(!r.sym||!(r.cl>0))continue;if(!px.has(r.sym))px.set(r.sym,new Map());px.get(r.sym).set(i,r);}
    const mp=path.join(MRAW,`${d}.dat`);
    if(fs.existsSync(mp))for(const r of parseMto(fs.readFileSync(mp,'utf8'))){
      if(!dl.has(r.sym))dl.set(r.sym,new Map());dl.get(r.sym).set(i,r.pct);}}

  // rebuild Q5 observations (signal D, h=5) + a PLACEBO with shuffled delivery
  const obs=[],placebo=[];
  for(let i=TRAIL;i<T-21;i++){
    const rows=[];
    for(const[sym,dm]of dl){
      if(ETF_RE.test(sym))continue;
      const pm=px.get(sym);if(!pm)continue;
      const cur=pm.get(i);if(!cur||!(cur.cl>=MIN_PX))continue;
      const today=dm.get(i);if(today==null)continue;
      const hist=[],tv=[];
      for(let k=i-TRAIL;k<i;k++){const p=dm.get(k);if(p!=null)hist.push(p);const b=pm.get(k);if(b)tv.push(b.val||0);}
      if(hist.length<TRAIL*0.7||tv.length<TRAIL*0.7)continue;
      const mtv=med(tv);if(!(mtv>=MIN_TV))continue;
      const hm=mean(hist),hs=sd(hist);if(!(hs>0))continue;
      rows.push({sym,i,mtv,D:(today-hm)/hs});
    }
    if(rows.length<100)continue;
    rows.sort((a,b)=>a.mtv-b.mtv);rows.forEach((r,k)=>{r.lq=Math.min(4,Math.floor(5*k/rows.length));});
    // PLACEBO: shuffle D within the session (preserves distribution, destroys mapping)
    const shuffled=rows.map(r=>r.D);
    for(let k=shuffled.length-1;k>0;k--){const j=(Math.random()*(k+1))|0;[shuffled[k],shuffled[j]]=[shuffled[j],shuffled[k]];}
    rows.forEach((r,k)=>{r.Dp=shuffled[k];});
    for(let L=0;L<5;L++){
      const g=rows.filter(r=>r.lq===L);
      const v1=[...g].sort((a,b)=>a.D-b.D);v1.forEach((r,k)=>{r.q=Math.min(4,Math.floor(5*k/v1.length));});
      const v2=[...g].sort((a,b)=>a.Dp-b.Dp);v2.forEach((r,k)=>{r.qp=Math.min(4,Math.floor(5*k/v2.length));});
    }
    for(const r of rows){obs.push(r);}
  }
  // forward returns + bucket benchmark
  const fwd=(sym,i)=>{const pm=px.get(sym);if(!pm)return null;const a=pm.get(i+1),b=pm.get(i+1+H);
    if(!a||!b||!(a.op>0)||!(b.cl>0))return null;return (b.cl/a.op-1)*100;};
  const acc=new Map();
  for(const r of obs){const v=fwd(r.sym,r.i);if(v==null)continue;r.ret=v;
    const k=`${r.i}|${r.lq}`;if(!acc.has(k))acc.set(k,[]);acc.get(k).push(v);}
  const bm=new Map();for(const[k,a]of acc)if(a.length>=5)bm.set(k,mean(a));
  for(const r of obs){const b=bm.get(`${r.i}|${r.lq}`);r.ab=(r.ret!=null&&b!=null)?r.ret-b:null;}
  const win=i=>dates[i]<='2018-12-31'?'DEV':dates[i]<='2022-12-31'?'VALID':'TEST';
  for(const r of obs)r.win=win(r.i);

  const Q5=obs.filter(r=>r.q===4&&r.ab!=null);
  const Q5p=obs.filter(r=>r.qp===4&&r.ab!=null);
  console.log('='.repeat(116));
  console.log('H-428-B ATTACK SUITE  (Signal D, h=5, Q5 long-only abnormal %)');
  console.log('='.repeat(116));

  // 1. PLACEBO
  console.log('\n[1] PLACEBO — delivery signal shuffled within session');
  for(const w of ['DEV','VALID','TEST']){
    const real=Q5.filter(r=>r.win===w).map(r=>r.ab);
    const fake=Q5p.filter(r=>r.win===w).map(r=>r.ab);
    console.log(`  ${w.padEnd(6)} real ${mean(real).toFixed(4)}%   placebo ${mean(fake).toFixed(4)}%   diff ${(mean(real)-mean(fake)).toFixed(4)}%`);
  }

  // 2. TAIL REMOVAL
  console.log('\n[2] TAIL DEPENDENCE — remove top winners from Q5');
  for(const w of ['DEV','VALID','TEST']){
    const v=Q5.filter(r=>r.win===w).map(r=>r.ab).sort((a,b)=>b-a);
    const line=[0.01,0.05,0.10].map(f=>{const cut=Math.max(1,Math.floor(v.length*f));
      return `-top${(f*100).toFixed(0)}%: ${mean(v.slice(cut)).toFixed(4)}`;}).join('   ');
    console.log(`  ${w.padEnd(6)} full ${mean(v).toFixed(4)}   ${line}`);
  }

  // 3. TRIMMED / WINSORISED
  console.log('\n[3] ROBUST CENTRAL TENDENCY');
  for(const w of ['DEV','VALID','TEST']){
    const v=Q5.filter(r=>r.win===w).map(r=>r.ab).sort((a,b)=>a-b);
    const c=Math.floor(v.length*0.05);
    const trimmed=mean(v.slice(c,v.length-c));
    const wins=v.map(x=>Math.min(Math.max(x,v[c]),v[v.length-1-c]));
    console.log(`  ${w.padEnd(6)} mean ${mean(v).toFixed(4)}  median ${med(v).toFixed(4)}  trimmed5% ${trimmed.toFixed(4)}  winsor5% ${mean(wins).toFixed(4)}  win% ${(100*v.filter(x=>x>0).length/v.length).toFixed(1)}`);
  }

  // 4. CONCENTRATION
  console.log('\n[4] CONCENTRATION (all windows pooled)');
  const bySym=new Map();
  for(const r of Q5){bySym.set(r.sym,(bySym.get(r.sym)||0)+r.ab);}
  const tot=[...bySym.values()].reduce((a,b)=>a+b,0);
  const sorted=[...bySym.entries()].sort((a,b)=>b[1]-a[1]);
  console.log(`  total Q5 abnormal sum ${tot.toFixed(0)}  across ${bySym.size} companies`);
  console.log(`  top1 ${(100*sorted[0][1]/tot).toFixed(1)}%  top5 ${(100*sorted.slice(0,5).reduce((a,c)=>a+c[1],0)/tot).toFixed(1)}%  top10 ${(100*sorted.slice(0,10).reduce((a,c)=>a+c[1],0)/tot).toFixed(1)}%`);
  const v=Q5.map(r=>r.ab).sort((a,b)=>b-a);
  const s1=v.slice(0,Math.floor(v.length*0.01)).reduce((a,b)=>a+b,0);
  const s5=v.slice(0,Math.floor(v.length*0.05)).reduce((a,b)=>a+b,0);
  const sAll=v.reduce((a,b)=>a+b,0);
  console.log(`  top 1% of events = ${(100*s1/sAll).toFixed(0)}% of gross   top 5% = ${(100*s5/sAll).toFixed(0)}%`);

  // 5. YEAR BY YEAR
  console.log('\n[5] YEAR-BY-YEAR');
  const byYear=new Map();
  for(const r of Q5){const y=dates[r.i].slice(0,4);if(!byYear.has(y))byYear.set(y,[]);byYear.get(y).push(r.ab);}
  for(const y of [...byYear.keys()].sort()){const a=byYear.get(y);
    console.log(`  ${y}  n=${String(a.length).padStart(6)}  mean ${mean(a).toFixed(4)}  median ${med(a).toFixed(4)}  win% ${(100*a.filter(x=>x>0).length/a.length).toFixed(0)}`);}

  // 6. LIQUIDITY STRATIFICATION
  console.log('\n[6] LIQUIDITY STRATIFICATION (lq0=least liquid ... lq4=most)');
  for(let L=0;L<5;L++){
    const a=Q5.filter(r=>r.lq===L).map(r=>r.ab);
    if(a.length<500)continue;
    console.log(`  lq${L}  n=${String(a.length).padStart(6)}  mean ${mean(a).toFixed(4)}  median ${med(a).toFixed(4)}  win% ${(100*a.filter(x=>x>0).length/a.length).toFixed(0)}`);
  }

  // 7. RAW (not abnormal) + COSTS
  console.log('\n[7] ECONOMICS — raw return and cost hurdle');
  for(const w of ['DEV','VALID','TEST']){
    const g=Q5.filter(r=>r.win===w);
    const raw=g.map(r=>r.ret),ab=g.map(r=>r.ab);
    console.log(`  ${w.padEnd(6)} raw ${mean(raw).toFixed(4)}%   abnormal ${mean(ab).toFixed(4)}%`);
  }
  console.log('  round-trip CNC cost by position size (5-session hold):');
  for(const pos of [4000,10000,20000,40000,100000]){
    const px0=500,qty=Math.floor(pos/px0),bt=px0*qty,st=px0*1.001*qty;
    const stt=(bt+st)*0.001,exch=(bt+st)*0.0000297,sebi=(bt+st)*0.000001,stamp=bt*0.00015;
    const gst=(exch+sebi)*0.18,c=stt+exch+sebi+stamp+gst+DP_RS;
    console.log(`    Rs${String(pos).padStart(6)}: Rs${c.toFixed(1)} = ${(100*c/pos).toFixed(3)}% round trip`);
  }
  console.log('  NOTE: abnormal return is measured vs a same-liquidity-bucket benchmark that');
  console.log('  ALSO costs nothing to hold. The tradeable comparison is RAW return minus cost.');
}
main();
