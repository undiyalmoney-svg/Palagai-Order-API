#!/usr/bin/env node
/**
 * P-437 — INFORMATION-SOURCE AGREEMENT
 * Specification frozen by the research brief before any forward return examined.
 *
 * Two independently validated directional mechanisms:
 *   A  LEADRET  = industry leaders' 5-session return (H-432-A), excludes follower
 *   B  CP       = (LAST - CLOSE)/CLOSE, follower's own closing pressure (P-435)
 *
 * PRIMARY: long followers where LEADRET is Q5 AND CP is Q5.
 * Entry open t+1, exit close t+5, equal weight, long only.
 *
 * FOUR PRE-DECLARED ARMS (no others):
 *   1 industry alone            LEADRET Q5
 *   2 closing pressure alone    CP Q5
 *   3 combined                  Q5 / Q5
 *   4 OPPOSITE-AGREEMENT        Q5 / Q1   <- the critical control
 *
 * Arm 4 is what distinguishes genuine confirmation from a return-chasing
 * filter: if the two sources are confirming the SAME information, Q5/Q5 must
 * beat Q5/Q1. If both are similar, CP adds nothing directional.
 *
 * Usage: node p437-agreement.js <DATADIR>
 */
const fs=require('fs'),path=require('path'),readline=require('readline');
const ETF_RE=/BEES|ETF|GOLD|LIQUID|NIFTY|SENSEX|INAV|SILVER/i;
const LOOK=5,H=5,MIN_TV=1e7,MIN_PX=10,MIN_IND=8,LEADER_FRAC=0.20,DP_RS=15*1.18;

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
  console.log('='.repeat(116));
  console.log('P-437 — INFORMATION-SOURCE AGREEMENT  [spec frozen; 4 pre-declared arms]');
  console.log('='.repeat(116));

  const obs=[];
  for(let i=25;i<T-H-2;i++){
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
    // CP quintile within liquidity bucket (P-435 construction, unchanged)
    const bl=[...all].sort((a,b)=>a.mtv-b.mtv);
    bl.forEach((c,k)=>{c.lq=Math.min(4,Math.floor(5*k/bl.length));});
    for(let L=0;L<5;L++){const g=all.filter(c=>c.lq===L).sort((a,b)=>a.cp-b.cp);
      if(g.length<10)continue;g.forEach((c,k)=>{c.qCP=Math.min(4,Math.floor(5*k/g.length));});}
    // LEADRET per follower (H-432-A construction, unchanged)
    const rows=[];
    for(const[sec,mem]of byInd){
      if(mem.length<MIN_IND)continue;
      const srt=[...mem].sort((a,b)=>b.mtv-a.mtv);
      const nL=Math.max(1,Math.round(mem.length*LEADER_FRAC));
      const leaders=srt.slice(0,nL),followers=srt.slice(nL);
      if(!leaders.length||followers.length<3)continue;
      const lead=mean(leaders.map(c=>c.r5));
      for(const f of followers)if(f.qCP!==undefined)
        rows.push({sym:f.sym,i,sec,mtv:f.mtv,lq:f.lq,qCP:f.qCP,lead,own:f.r5});
    }
    if(rows.length<20)continue;
    const bd=[...rows].sort((a,b)=>a.lead-b.lead);
    bd.forEach((c,k)=>{c.qLead=Math.min(4,Math.floor(5*k/bd.length));});
    const bo=[...rows].sort((a,b)=>a.own-b.own);
    bo.forEach((c,k)=>{c.qOwn=Math.min(4,Math.floor(5*k/bo.length));});
    for(const r of rows)obs.push(r);
  }
  const fwd=(sym,i)=>{const m=px.get(sym);if(!m)return null;const a=m.get(i+1),b=m.get(i+1+H);
    if(!a||!b||!(a.op>0)||!(b.cl>0))return null;return (b.cl/a.op-1)*100;};
  const acc=new Map();
  for(const r of obs){const v=fwd(r.sym,r.i);if(v==null)continue;r.ret=v;
    const k=`${r.i}|${r.lq}`;if(!acc.has(k))acc.set(k,[]);acc.get(k).push(v);}
  const bm=new Map();for(const[k,a]of acc)if(a.length>=5)bm.set(k,mean(a));
  for(const r of obs){const b=bm.get(`${r.i}|${r.lq}`);r.ab=(r.ret!=null&&b!=null)?r.ret-b:null;
    r.win=dates[r.i]<='2018-12-31'?'DEV':dates[r.i]<='2022-12-31'?'VALID':'TEST';}
  const V=obs.filter(r=>r.ab!=null);
  console.log(`observations ${obs.length.toLocaleString()}  with returns ${V.length.toLocaleString()}`);

  const ARMS={
    '1 industry alone   (LEAD Q5)':r=>r.qLead===4,
    '2 closing pressure (CP Q5)  ':r=>r.qCP===4,
    '3 COMBINED         (Q5/Q5)  ':r=>r.qLead===4&&r.qCP===4,
    '4 OPPOSITE         (Q5/Q1)  ':r=>r.qLead===4&&r.qCP===0,
  };
  console.log('\n'+'='.repeat(116));
  console.log(`FOUR PRE-DECLARED ARMS — h=+${H}, signed returns`);
  console.log('='.repeat(116));
  console.log('Arm                            Win      n     uniqCos   RAW%     ABN%    median%  win%  clustT     p');
  const R={};
  for(const[name,fn]of Object.entries(ARMS)){
    R[name]={};
    for(const w of ['DEV','VALID','TEST']){
      const g=V.filter(r=>r.win===w&&fn(r));
      if(g.length<200){console.log(`${name} ${w.padEnd(6)} n=${g.length} INSUFFICIENT`);continue;}
      const ab=g.map(r=>r.ab),raw=g.map(r=>r.ret);
      const t=clusteredT(g.map(r=>({sym:r.sym,v:r.ab})));
      R[name][w]={ab:mean(ab),raw:mean(raw),n:g.length,t};
      console.log(`${name} ${w.padEnd(6)} ${String(g.length).padStart(6)} ${String(new Set(g.map(r=>r.sym)).size).padStart(8)} `+
        `${mean(raw).toFixed(3).padStart(8)} ${mean(ab).toFixed(3).padStart(8)} ${med(ab).toFixed(3).padStart(8)} `+
        `${(100*ab.filter(x=>x>0).length/ab.length).toFixed(0).padStart(4)} ${t.toFixed(2).padStart(7)} ${pFromT(t).toExponential(1).padStart(9)}`);
    }
    console.log('-'.repeat(116));
  }

  const A1='1 industry alone   (LEAD Q5)',A3='3 COMBINED         (Q5/Q5)  ',A4='4 OPPOSITE         (Q5/Q1)  ';
  console.log('PRIMARY MECHANISM TEST — both comparisons must hold in DEV and VALID');
  let pass=true;
  for(const w of ['DEV','VALID']){
    const c=R[A3][w],i1=R[A1][w],o=R[A4][w];
    if(!c||!i1||!o){console.log(`  ${w}: insufficient`);pass=false;continue;}
    const beatsIndustry=c.ab>i1.ab, beatsOpposite=c.ab>o.ab;
    if(!(beatsIndustry&&beatsOpposite&&c.ab>0))pass=false;
    console.log(`  ${w}: combined ${c.ab.toFixed(3)}%  vs industry-only ${i1.ab.toFixed(3)}% [${beatsIndustry?'PASS':'FAIL'}]  vs opposite ${o.ab.toFixed(3)}% [${beatsOpposite?'PASS':'FAIL'}]`);
  }
  console.log(`\nSTOP RULE: combined positive in BOTH DEV and VALID and beating both comparators -> ${pass?'PASSES':'FAILS'}`);
  if(R[A3].TEST)console.log(`  TEST (diagnostic): combined ${R[A3].TEST.ab.toFixed(3)}%  industry-only ${R[A1].TEST.ab.toFixed(3)}%  opposite ${R[A4].TEST.ab.toFixed(3)}%`);

  console.log('\n'+'='.repeat(116));
  console.log('INDEPENDENCE CONTROL — Q5/Q5 minus Q5/Q1 inside each own-momentum quintile (DEV+VALID)');
  console.log('='.repeat(116));
  console.log('ownQ    Q5/Q5      Q5/Q1      diff      n(Q5/Q5)');
  let posBuckets=0,tot=0;
  for(let o=0;o<5;o++){
    const g5=V.filter(r=>r.win!=='TEST'&&r.qOwn===o&&r.qLead===4&&r.qCP===4).map(r=>r.ab);
    const g1=V.filter(r=>r.win!=='TEST'&&r.qOwn===o&&r.qLead===4&&r.qCP===0).map(r=>r.ab);
    if(g5.length<50||g1.length<50)continue;
    tot++;if(mean(g5)-mean(g1)>0)posBuckets++;
    console.log(`  ${o}  ${mean(g5).toFixed(3).padStart(9)} ${mean(g1).toFixed(3).padStart(10)} ${(mean(g5)-mean(g1)).toFixed(3).padStart(9)} ${String(g5.length).padStart(9)}`);
  }
  console.log(`  positive in ${posBuckets}/${tot} own-momentum buckets`);

  console.log('\nROBUSTNESS (combined arm, pre-declared)');
  console.log('  tail removal:');
  for(const w of ['DEV','VALID','TEST']){
    const v=V.filter(r=>r.win===w&&r.qLead===4&&r.qCP===4).map(r=>r.ab).sort((a,b)=>b-a);
    if(v.length<200)continue;
    console.log(`    ${w.padEnd(6)} full ${mean(v).toFixed(3)}  -top1% ${mean(v.slice(Math.max(1,Math.floor(v.length*0.01)))).toFixed(3)}  -top5% ${mean(v.slice(Math.floor(v.length*0.05))).toFixed(3)}`);
  }
  console.log('  |return| vs signed (is the gain just higher volatility?):');
  for(const w of ['DEV','VALID','TEST']){
    const g=V.filter(r=>r.win===w&&r.qLead===4&&r.qCP===4).map(r=>r.ab);
    const u=V.filter(r=>r.win===w).map(r=>r.ab);
    if(g.length<200)continue;
    console.log(`    ${w.padEnd(6)} signed ${mean(g).toFixed(3)}%  |abs| ${mean(g.map(Math.abs)).toFixed(3)}% vs universe ${mean(u.map(Math.abs)).toFixed(3)}%  lift ${((mean(g.map(Math.abs))/mean(u.map(Math.abs))-1)*100).toFixed(1)}%`);
  }
  console.log('  liquidity buckets (combined, all windows):');
  for(let L=0;L<5;L++){const v=V.filter(r=>r.qLead===4&&r.qCP===4&&r.lq===L).map(r=>r.ab);
    if(v.length<150)continue;
    console.log(`    lq${L} n=${String(v.length).padStart(6)} mean ${mean(v).toFixed(3).padStart(8)} median ${med(v).toFixed(3).padStart(8)} win% ${(100*v.filter(x=>x>0).length/v.length).toFixed(0)}`);}

  console.log('\nCOSTS — combined arm, 5-session hold (~50 round trips/yr)');
  for(const w of ['DEV','VALID','TEST']){
    const g=V.filter(r=>r.win===w&&r.qLead===4&&r.qCP===4).map(r=>r.ret);
    if(g.length<200)continue;
    console.log(`  ${w.padEnd(6)} gross raw ${mean(g).toFixed(3)}%`);
  }
  for(const pos of [20000,200000]){
    const p0=500,q=Math.floor(pos/p0),bt=p0*q,st=p0*1.005*q;
    const c=(bt+st)*0.001+(bt+st)*0.0000297+(bt+st)*0.000001+bt*0.00015+((bt+st)*0.0000297+(bt+st)*0.000001)*0.18+DP_RS;
    console.log(`    Rs${String(pos).padStart(6)}: cost ${(100*c/pos).toFixed(3)}% +0.20% slip = ${(100*c/pos+0.2).toFixed(3)}% per round trip`);
  }
}
main().catch(e=>{console.error('ERR',e.message,e.stack);process.exit(1);});
