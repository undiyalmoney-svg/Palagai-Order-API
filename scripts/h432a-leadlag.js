#!/usr/bin/env node
/**
 * H-432-A — INDUSTRY LEAD-LAG INFORMATION DIFFUSION
 * Frozen before any forward return was computed.
 *
 * WHY THIS IS STRUCTURALLY NEW: every prior hypothesis in the registry derived
 * its signal from the SAME stock's own price/order-flow history. This one uses
 * a DIFFERENT set of securities (industry leaders) to predict a follower's
 * return — cross-sectional information transfer, not own-history.
 *
 * MECHANISM: coverage and attention concentrate in large industry names, so
 * industry information reaches leader prices first; less-covered peers follow
 * with delay.
 *
 * CRITICAL CONTROL: the follower's OWN trailing return is a pre-declared arm
 * and a double-sort dimension. If the effect vanishes after conditioning on it,
 * this is own-momentum (already rejected) and the hypothesis FAILS.
 *
 * DIRECTION vs MAGNITUDE is reported explicitly — four prior programmes found
 * magnitude effects masquerading as edges.
 *
 * Usage: node h432a-leadlag.js <DATADIR>
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
function boot(a,it=2000){if(a.length<20)return[NaN,NaN];const m=[];
 for(let i=0;i<it;i++){let s=0;for(let k=0;k<a.length;k++)s+=a[(Math.random()*a.length)|0];m.push(s/a.length);}
 m.sort((x,y)=>x-y);return[m[(it*0.025)|0],m[(it*0.975)|0]];}
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
  // industry map
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
    if(!r.sym||!(r.cl>0))continue;if(!px.has(r.sym))px.set(r.sym,new Map());px.get(r.sym).set(i,r);}
  console.log('='.repeat(116));
  console.log('H-432-A — INDUSTRY LEAD-LAG INFORMATION DIFFUSION  [frozen before results]');
  console.log('='.repeat(116));
  console.log(`sessions ${T}  symbols ${px.size}  industries mapped ${new Set(ind.values()).size}  symbols with industry ${ind.size}`);

  const obs=[];
  for(let i=25;i<T-H-2;i++){
    // build per-industry member lists with pre-signal liquidity
    const byInd=new Map();
    for(const[sym,m]of px){
      if(ETF_RE.test(sym))continue;
      const sec=ind.get(sym);if(!sec)continue;
      const c=m.get(i);if(!c||!(c.cl>=MIN_PX))continue;
      const a=m.get(i-LOOK);if(!a||!(a.cl>0))continue;
      const tv=[];for(let k=i-20;k<i;k++){const b=m.get(k);if(b)tv.push(b.val||0);}
      if(tv.length<14)continue;
      const mtv=med(tv);if(!(mtv>=MIN_TV))continue;
      if(!byInd.has(sec))byInd.set(sec,[]);
      byInd.get(sec).push({sym,mtv,r5:(c.cl/a.cl-1)*100});
    }
    for(const[sec,members]of byInd){
      if(members.length<MIN_IND)continue;
      const srt=[...members].sort((a,b)=>b.mtv-a.mtv);
      const nLead=Math.max(1,Math.round(members.length*LEADER_FRAC));
      const leaders=srt.slice(0,nLead), followers=srt.slice(nLead);
      if(!leaders.length||followers.length<3)continue;
      const leadSum=leaders.reduce((a,c)=>a+c.r5,0);
      for(const f of followers){
        // leader return EXCLUDES the follower by construction (disjoint sets)
        obs.push({sym:f.sym,i,sec,mtv:f.mtv,lead:leadSum/leaders.length,own:f.r5,nLead:leaders.length});
      }
    }
  }
  console.log(`observations ${obs.length.toLocaleString()}`);

  // liquidity buckets + quintiles per session
  const bySess=new Map();
  for(const r of obs){if(!bySess.has(r.i))bySess.set(r.i,[]);bySess.get(r.i).push(r);}
  for(const[,g]of bySess){
    const bl=[...g].sort((a,b)=>a.mtv-b.mtv);bl.forEach((c,k)=>{c.lq=Math.min(4,Math.floor(5*k/bl.length));});
    const bLead=[...g].sort((a,b)=>a.lead-b.lead);bLead.forEach((c,k)=>{c.qLead=Math.min(4,Math.floor(5*k/bLead.length));});
    const bOwn=[...g].sort((a,b)=>a.own-b.own);bOwn.forEach((c,k)=>{c.qOwn=Math.min(4,Math.floor(5*k/bOwn.length));});
  }
  const fwd=(sym,i)=>{const m=px.get(sym);if(!m)return null;const a=m.get(i+1),b=m.get(i+1+H);
    if(!a||!b||!(a.op>0)||!(b.cl>0))return null;return (b.cl/a.op-1)*100;};
  const acc=new Map();
  for(const r of obs){const v=fwd(r.sym,r.i);if(v==null)continue;r.ret=v;
    const k=`${r.i}|${r.lq}`;if(!acc.has(k))acc.set(k,[]);acc.get(k).push(v);}
  const bm=new Map();for(const[k,a]of acc)if(a.length>=5)bm.set(k,mean(a));
  for(const r of obs){const b=bm.get(`${r.i}|${r.lq}`);r.ab=(r.ret!=null&&b!=null)?r.ret-b:null;
    r.win=dates[r.i]<='2018-12-31'?'DEV':dates[r.i]<='2022-12-31'?'VALID':'TEST';}

  const valid=obs.filter(r=>r.ab!=null);
  console.log(`with forward returns ${valid.length.toLocaleString()}`);

  console.log('\n'+'='.repeat(116));
  console.log(`PRIMARY — followers in top-quintile LEADER return, h=+${H}, matched-abnormal %`);
  console.log('='.repeat(116));
  console.log('Win      n       uniqCos   mean%    median%  win%   clustT    p         boot95CI');
  const prim={};
  for(const w of ['DEV','VALID','TEST']){
    const g=valid.filter(r=>r.win===w&&r.qLead===4);
    if(g.length<500){console.log(`${w}: n=${g.length} INSUFFICIENT`);continue;}
    const v=g.map(r=>r.ab);const t=clusteredT(g.map(r=>({sym:r.sym,v:r.ab})));const ci=boot(v);
    prim[w]=mean(v);
    console.log(`${w.padEnd(6)} ${String(v.length).padStart(7)} ${String(new Set(g.map(r=>r.sym)).size).padStart(8)} `+
      `${mean(v).toFixed(4).padStart(8)} ${med(v).toFixed(4).padStart(8)} ${(100*v.filter(x=>x>0).length/v.length).toFixed(0).padStart(5)} `+
      `${t.toFixed(2).padStart(7)} ${pFromT(t).toExponential(1).padStart(9)} [${ci[0].toFixed(3)},${ci[1].toFixed(3)}]`);
  }
  console.log('\nSTOP RULE — DEV and VALID both positive');
  if(prim.DEV!==undefined&&prim.VALID!==undefined)
    console.log(`  DEV ${prim.DEV.toFixed(4)}%  VALID ${prim.VALID.toFixed(4)}%  -> ${prim.DEV>0&&prim.VALID>0?'PASSES':'FAILS'}`);

  console.log('\nQUINTILE DOSE-RESPONSE (leader return quintile)');
  console.log('Win      Q1        Q2        Q3        Q4        Q5     |  Q5-Q1');
  for(const w of ['DEV','VALID','TEST']){
    const row=[];for(let q=0;q<5;q++){const v=valid.filter(r=>r.win===w&&r.qLead===q).map(r=>r.ab);
      row.push(v.length>300?mean(v):NaN);}
    console.log(w.padEnd(7)+row.map(x=>isNaN(x)?'     n/a ':x.toFixed(4).padStart(9)).join(' ')+'  |  '+(row[4]-row[0]).toFixed(4));
  }

  console.log('\n'+'='.repeat(116));
  console.log('CRITICAL CONTROL — is this LEAD-LAG or just the follower OWN momentum?');
  console.log('='.repeat(116));
  console.log('Own-momentum arm alone (qOwn quintiles):');
  console.log('Win      Q1        Q2        Q3        Q4        Q5');
  for(const w of ['DEV','VALID','TEST']){
    const row=[];for(let q=0;q<5;q++){const v=valid.filter(r=>r.win===w&&r.qOwn===q).map(r=>r.ab);
      row.push(v.length>300?mean(v):NaN);}
    console.log(w.padEnd(7)+row.map(x=>isNaN(x)?'     n/a ':x.toFixed(4).padStart(9)).join(' '));
  }
  console.log('\nDOUBLE SORT — leader quintile WITHIN own-momentum quintile (DEV+VALID pooled)');
  console.log('  If lead-lag is real, Q5-lead should beat Q1-lead inside EVERY own-momentum bucket.');
  console.log('ownQ    leadQ1    leadQ5    diff');
  for(let o=0;o<5;o++){
    const g1=valid.filter(r=>r.win!=='TEST'&&r.qOwn===o&&r.qLead===0).map(r=>r.ab);
    const g5=valid.filter(r=>r.win!=='TEST'&&r.qOwn===o&&r.qLead===4).map(r=>r.ab);
    if(g1.length<200||g5.length<200)continue;
    console.log(`  ${o}   ${mean(g1).toFixed(4).padStart(9)} ${mean(g5).toFixed(4).padStart(9)} ${(mean(g5)-mean(g1)).toFixed(4).padStart(8)}`);
  }

  console.log('\n'+'='.repeat(116));
  console.log('DIRECTION vs MAGNITUDE (the trap of the last four programmes)');
  console.log('='.repeat(116));
  for(const w of ['DEV','VALID','TEST']){
    const g=valid.filter(r=>r.win===w&&r.qLead===4).map(r=>r.ab);
    const u=valid.filter(r=>r.win===w).map(r=>r.ab);
    if(g.length<500)continue;
    console.log(`  ${w.padEnd(6)} signed ${mean(g).toFixed(4)}%   |abs| ${mean(g.map(Math.abs)).toFixed(4)}% vs universe ${mean(u.map(Math.abs)).toFixed(4)}%  lift ${((mean(g.map(Math.abs))/mean(u.map(Math.abs))-1)*100).toFixed(1)}%`);
  }

  console.log('\nLIQUIDITY BUCKET (Q5 lead, all windows)');
  for(let L=0;L<5;L++){
    const v=valid.filter(r=>r.qLead===4&&r.lq===L).map(r=>r.ab);
    if(v.length<300)continue;
    console.log(`  lq${L} n=${String(v.length).padStart(6)} mean ${mean(v).toFixed(4).padStart(8)} median ${med(v).toFixed(4).padStart(8)} win% ${(100*v.filter(x=>x>0).length/v.length).toFixed(0)}`);
  }
  console.log('\nTAIL DEPENDENCE (Q5 lead)');
  for(const w of ['DEV','VALID','TEST']){
    const v=valid.filter(r=>r.win===w&&r.qLead===4).map(r=>r.ab).sort((a,b)=>b-a);
    if(v.length<500)continue;
    console.log(`  ${w.padEnd(6)} full ${mean(v).toFixed(4)}  -top1% ${mean(v.slice(Math.floor(v.length*0.01))).toFixed(4)}  -top5% ${mean(v.slice(Math.floor(v.length*0.05))).toFixed(4)}`);
  }
  console.log('\nRAW return + cost hurdle (Q5 lead)');
  for(const w of ['DEV','VALID','TEST']){
    const g=valid.filter(r=>r.win===w&&r.qLead===4).map(r=>r.ret);
    if(g.length<500)continue;
    console.log(`  ${w.padEnd(6)} raw ${mean(g).toFixed(4)}%  median ${med(g).toFixed(4)}%`);
  }
  for(const pos of [20000,200000,1000000]){
    const p0=500,q=Math.floor(pos/p0),bt=p0*q,st=p0*1.005*q;
    const c=(bt+st)*0.001+(bt+st)*0.0000297+(bt+st)*0.000001+bt*0.00015+((bt+st)*0.0000297+(bt+st)*0.000001)*0.18+DP_RS;
    console.log(`    Rs${String(pos).padStart(7)}: cost ${(100*c/pos).toFixed(3)}% +0.20% slip => hurdle ${(100*c/pos+0.2).toFixed(3)}%`);
  }
}
main().catch(e=>{console.error('ERR',e.message,e.stack);process.exit(1);});
