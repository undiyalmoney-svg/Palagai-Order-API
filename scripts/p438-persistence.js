#!/usr/bin/env node
/**
 * P-438 — INFORMATION PERSISTENCE / HOLD-OR-EXIT TEST
 * Specification frozen before any forward return examined.
 *
 * NO NEW PREDICTOR. The entry condition is P-437 verbatim:
 *   LEADRET Q5 (industry leaders' 5-session return, follower excluded)
 *   AND CP Q5  (closing pressure (LAST-CLOSE)/CLOSE, quintile within liquidity)
 *
 * The question is NOT "which holding period earns most". It is whether the
 * information that justified entry remains directionally valid AFTER the first
 * five sessions, which would mean the 5-session exit creates avoidable turnover.
 *
 * THREE NON-OVERLAPPING DIAGNOSTIC SEGMENTS (not alternative strategies):
 *   H1  open(t+1)  -> close(t+5)
 *   H2  open(t+6)  -> close(t+10)   <- PRIMARY persistence window
 *   H3  open(t+11) -> close(t+20)   <- diagnostic only, NOT for selection
 *
 * Each segment benchmarked against the liquidity-bucket mean for the SAME
 * segment, so a persistent effect cannot be manufactured by market drift.
 *
 * RECONSTRUCTION CHECK: H1 must reproduce P-437 (DEV +0.311%, VALID +0.583%).
 * A material difference means the signal was not reconstructed and we STOP.
 *
 * Usage: node p438-persistence.js <DATADIR>
 */
const fs=require('fs'),path=require('path'),readline=require('readline');
const ETF_RE=/BEES|ETF|GOLD|LIQUID|NIFTY|SENSEX|INAV|SILVER/i;
const LOOK=5,MIN_TV=1e7,MIN_PX=10,MIN_IND=8,LEADER_FRAC=0.20,DP_RS=15*1.18;
// frozen diagnostic segments: [entryOffset, exitOffset]
const SEG={H1:[1,5],H2:[6,10],H3:[11,20]};

const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const med=a=>{const s=[...a].sort((x,y)=>x-y);const n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):0;};
function clusteredT(rows){const n=rows.length;if(n<20)return 0;const m=mean(rows.map(r=>r.v));
 const by=new Map();for(const r of rows)by.set(r.sym,(by.get(r.sym)||0)+(r.v-m));
 let meat=0;for(const[,s]of by)meat+=s*s;const se=Math.sqrt(meat)/n;return se>0?m/se:0;}
function pFromT(t){const z=Math.abs(t);const b=[0.319381530,-0.356563782,1.781477937,-1.821255978,1.330274429];
 const c=0.39894228*Math.exp(-z*z/2),tt=1/(1+0.2316419*z);
 return 2*c*tt*(b[0]+tt*(b[1]+tt*(b[2]+tt*(b[3]+tt*b[4]))));}
function pL(t){const o=[];const L=t.split(/\r?\n/);
 for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<13||(c[1]||'').trim()!=='EQ')continue;
  o.push({sym:c[0].trim(),op:+c[2],cl:+c[5],last:+c[6],val:+c[9]});}return o;}
function pN(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());const ix=n=>h.indexOf(n);
 const a=ix('TckrSymb'),b=ix('SctySrs'),o1=ix('OpnPric'),d=ix('ClsPric'),la=ix('LastPric'),v=ix('TtlTrfVal'),f=ix('FinInstrmTp');
 const o=[];for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;
  if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
  o.push({sym:(c[a]||'').trim(),op:+c[o1],cl:+c[d],last:+c[la],val:+c[v]});}return o;}

async function main(){
  const DATA=process.argv[2],RAW=path.join(DATA,'full','raw');
  const ind=new Map();
  await new Promise((res,rej)=>{const rl=readline.createInterface({input:fs.createReadStream(path.join(DATA,'ann_full','announcements.ndjson')),crlfDelay:Infinity});
    rl.on('line',l=>{if(!l.trim())return;let o;try{o=JSON.parse(l)}catch(e){return}
      const s=(o.smIndustry||'').trim();
      if(o.symbol&&s&&s!=='-'&&s!=='Miscellaneous'&&!ind.has(o.symbol))ind.set(o.symbol,s);});
    rl.on('close',res);rl.on('error',rej);});
  const files=fs.readdirSync(RAW).filter(f=>f.endsWith('.csv')&&fs.statSync(path.join(RAW,f)).isFile()).sort();
  const dates=files.map(f=>f.replace('.csv',''));const T=dates.length;
  const px=new Map();
  for(let i=0;i<T;i++)for(const r of (dates[i]>'2024-06-30'?pN:pL)(fs.readFileSync(path.join(RAW,files[i]),'utf8'))){
    if(!r.sym||!(r.cl>0)||!(r.last>0))continue;if(!px.has(r.sym))px.set(r.sym,new Map());px.get(r.sym).set(i,r);}
  console.log('='.repeat(118));
  console.log('P-438 — INFORMATION PERSISTENCE  [P-437 entry rule unchanged; segments are diagnostic]');
  console.log('='.repeat(118));

  const obs=[];
  for(let i=25;i<T-25;i++){
    const byInd=new Map();const all=[];
    for(const[sym,m]of px){
      if(ETF_RE.test(sym))continue;
      const c=m.get(i);if(!c||!(c.cl>=MIN_PX)||!(c.last>0))continue;
      const a=m.get(i-LOOK);if(!a||!(a.cl>0))continue;
      const tv=[];for(let k=i-20;k<i;k++){const b=m.get(k);if(b)tv.push(b.val||0);}
      if(tv.length<14)continue;
      const mtv=med(tv);if(!(mtv>=MIN_TV))continue;
      const rec={sym,mtv,r5:(c.cl/a.cl-1)*100,cp:(c.last-c.cl)/c.cl*10000};
      all.push(rec);
      const sec=ind.get(sym);if(!sec)continue;
      if(!byInd.has(sec))byInd.set(sec,[]);byInd.get(sec).push(rec);
    }
    if(all.length<60)continue;
    const bl=[...all].sort((a,b)=>a.mtv-b.mtv);
    bl.forEach((c,k)=>{c.lq=Math.min(4,Math.floor(5*k/bl.length));});
    for(let L=0;L<5;L++){const g=all.filter(c=>c.lq===L).sort((a,b)=>a.cp-b.cp);
      if(g.length<10)continue;g.forEach((c,k)=>{c.qCP=Math.min(4,Math.floor(5*k/g.length));});}
    const rows=[];
    for(const[sec,mem]of byInd){
      if(mem.length<MIN_IND)continue;
      const srt=[...mem].sort((a,b)=>b.mtv-a.mtv);
      const nL=Math.max(1,Math.round(mem.length*LEADER_FRAC));
      const leaders=srt.slice(0,nL),followers=srt.slice(nL);
      if(!leaders.length||followers.length<3)continue;
      const lead=mean(leaders.map(c=>c.r5));
      for(const f of followers)if(f.qCP!==undefined)
        rows.push({sym:f.sym,i,lq:f.lq,qCP:f.qCP,lead,own:f.r5});
    }
    if(rows.length<20)continue;
    const bd=[...rows].sort((a,b)=>a.lead-b.lead);
    bd.forEach((c,k)=>{c.qLead=Math.min(4,Math.floor(5*k/bd.length));});
    for(const r of rows)obs.push(r);
  }
  // segment returns + per-segment liquidity benchmark
  const segRet=(sym,i,s)=>{const m=px.get(sym);if(!m)return null;
    const a=m.get(i+SEG[s][0]),b=m.get(i+SEG[s][1]);
    if(!a||!b||!(a.op>0)||!(b.cl>0))return null;return (b.cl/a.op-1)*100;};
  const acc=new Map();
  for(const r of obs)for(const s of Object.keys(SEG)){
    const v=segRet(r.sym,r.i,s);if(v==null)continue;
    r['raw_'+s]=v;
    const k=`${r.i}|${r.lq}|${s}`;if(!acc.has(k))acc.set(k,[]);acc.get(k).push(v);}
  const bm=new Map();for(const[k,a]of acc)if(a.length>=5)bm.set(k,mean(a));
  for(const r of obs){for(const s of Object.keys(SEG)){
    const v=r['raw_'+s];const b=bm.get(`${r.i}|${r.lq}|${s}`);
    r['ab_'+s]=(v!=null&&b!=null)?v-b:null;}
    r.win=dates[r.i]<='2018-12-31'?'DEV':dates[r.i]<='2022-12-31'?'VALID':'TEST';}
  console.log(`observations ${obs.length.toLocaleString()}`);

  const ARM={
    'Q5/Q5 combined':r=>r.qLead===4&&r.qCP===4,
    'Q5/Q1 opposite':r=>r.qLead===4&&r.qCP===0,
    'industry-only ':r=>r.qLead===4,
    'CP-only       ':r=>r.qCP===4,
  };
  // ---- reconstruction check ----
  console.log('\nRECONSTRUCTION CHECK — H1 must reproduce P-437 (DEV +0.311%, VALID +0.583%)');
  for(const w of ['DEV','VALID']){
    const v=obs.filter(r=>r.win===w&&ARM['Q5/Q5 combined'](r)&&r.ab_H1!=null).map(r=>r.ab_H1);
    console.log(`  ${w}: H1 abnormal ${mean(v).toFixed(3)}%  n=${v.length}`);
  }

  console.log('\n'+'='.repeat(118));
  console.log('PERSISTENCE — non-overlapping segments, abnormal % (raw in parentheses)');
  console.log('='.repeat(118));
  for(const s of ['H1','H2','H3']){
    console.log(`\n--- ${s}  (open t+${SEG[s][0]} -> close t+${SEG[s][1]}) ---`);
    console.log('Arm              Win       n     abn%     raw%    median%  win%  clustT      p');
    for(const[an,fn]of Object.entries(ARM)){
      for(const w of ['DEV','VALID','TEST']){
        const g=obs.filter(r=>r.win===w&&fn(r)&&r['ab_'+s]!=null);
        if(g.length<200)continue;
        const ab=g.map(r=>r['ab_'+s]),raw=g.map(r=>r['raw_'+s]);
        const t=clusteredT(g.map(r=>({sym:r.sym,v:r['ab_'+s]})));
        console.log(`${an} ${w.padEnd(6)} ${String(g.length).padStart(7)} ${mean(ab).toFixed(3).padStart(8)} ${mean(raw).toFixed(3).padStart(8)} `+
          `${med(ab).toFixed(3).padStart(8)} ${(100*ab.filter(x=>x>0).length/ab.length).toFixed(0).padStart(4)} ${t.toFixed(2).padStart(7)} ${pFromT(t).toExponential(1).padStart(9)}`);
      }
    }
  }

  console.log('\n'+'='.repeat(118));
  console.log('PRIMARY TEST — does Q5/Q5 retain advantage in H2 (+6..+10) in BOTH DEV and VALID?');
  console.log('='.repeat(118));
  let pass=true;
  for(const w of ['DEV','VALID']){
    const g=(fn)=>obs.filter(r=>r.win===w&&fn(r)&&r.ab_H2!=null).map(r=>r.ab_H2);
    const c=mean(g(ARM['Q5/Q5 combined'])),o=mean(g(ARM['Q5/Q1 opposite'])),i1=mean(g(ARM['industry-only ']));
    const okB=c>0,okO=c>o,okI=c>i1;
    if(!(okB&&okO&&okI))pass=false;
    console.log(`  ${w}: combined ${c.toFixed(3)}%  vs benchmark[>0 ${okB?'PASS':'FAIL'}]  vs Q5/Q1 ${o.toFixed(3)}%[${okO?'PASS':'FAIL'}]  vs industry-only ${i1.toFixed(3)}%[${okI?'PASS':'FAIL'}]`);
  }
  console.log(`\nSTOP RULE: Q5/Q5 retains positive directional advantage in H2 in BOTH windows -> ${pass?'PASSES':'FAILS'}`);
  {const v=obs.filter(r=>r.win==='TEST'&&ARM['Q5/Q5 combined'](r)&&r.ab_H2!=null).map(r=>r.ab_H2);
   if(v.length>200)console.log(`  TEST (diagnostic): H2 combined ${mean(v).toFixed(3)}%`);}

  console.log('\nROBUSTNESS on H2 (combined arm)');
  console.log('  tail removal:');
  for(const w of ['DEV','VALID','TEST']){
    const v=obs.filter(r=>r.win===w&&ARM['Q5/Q5 combined'](r)&&r.ab_H2!=null).map(r=>r.ab_H2).sort((a,b)=>b-a);
    if(v.length<200)continue;
    console.log(`    ${w.padEnd(6)} full ${mean(v).toFixed(3)}  -top1% ${mean(v.slice(Math.max(1,Math.floor(v.length*0.01)))).toFixed(3)}  -top5% ${mean(v.slice(Math.floor(v.length*0.05))).toFixed(3)}`);
  }
  console.log('  signed vs |abs|:');
  for(const w of ['DEV','VALID','TEST']){
    const g=obs.filter(r=>r.win===w&&ARM['Q5/Q5 combined'](r)&&r.ab_H2!=null).map(r=>r.ab_H2);
    const u=obs.filter(r=>r.win===w&&r.ab_H2!=null).map(r=>r.ab_H2);
    if(g.length<200)continue;
    console.log(`    ${w.padEnd(6)} signed ${mean(g).toFixed(3)}%  |abs| ${mean(g.map(Math.abs)).toFixed(3)}% vs universe ${mean(u.map(Math.abs)).toFixed(3)}%  lift ${((mean(g.map(Math.abs))/mean(u.map(Math.abs))-1)*100).toFixed(1)}%`);
  }
  console.log('  liquidity buckets (H2, all windows):');
  for(let L=0;L<5;L++){const v=obs.filter(r=>ARM['Q5/Q5 combined'](r)&&r.lq===L&&r.ab_H2!=null).map(r=>r.ab_H2);
    if(v.length<150)continue;
    console.log(`    lq${L} n=${String(v.length).padStart(6)} mean ${mean(v).toFixed(3).padStart(8)} median ${med(v).toFixed(3).padStart(8)} win% ${(100*v.filter(x=>x>0).length/v.length).toFixed(0)}`);}

  console.log('\nCOST IMPLICATION (only meaningful if H2 persists)');
  console.log('  5-session hold  -> ~50 round trips/yr');
  console.log('  10-session hold -> ~25 round trips/yr  (halves cost drag)');
  for(const pos of [20000,200000]){
    const p0=500,q=Math.floor(pos/p0),bt=p0*q,st=p0*1.01*q;
    const c=(bt+st)*0.001+(bt+st)*0.0000297+(bt+st)*0.000001+bt*0.00015+((bt+st)*0.0000297+(bt+st)*0.000001)*0.18+DP_RS;
    const pct=100*c/pos+0.2;
    console.log(`    Rs${String(pos).padStart(6)}: ${pct.toFixed(3)}%/trip -> 5-sess ${(pct*50).toFixed(1)}%/yr   10-sess ${(pct*25).toFixed(1)}%/yr`);
  }
  console.log('\n  CUMULATIVE raw return if held +1..+10 (combined arm) — what a 10-session hold actually earns:');
  for(const w of ['DEV','VALID','TEST']){
    const g=obs.filter(r=>r.win===w&&ARM['Q5/Q5 combined'](r)&&r.raw_H1!=null&&r.raw_H2!=null);
    if(g.length<200)continue;
    const cum=g.map(r=>((1+r.raw_H1/100)*(1+r.raw_H2/100)-1)*100);
    console.log(`    ${w.padEnd(6)} cumulative raw ${mean(cum).toFixed(3)}%  median ${med(cum).toFixed(3)}%`);
  }
}
main().catch(e=>{console.error('ERR',e.message,e.stack);process.exit(1);});
