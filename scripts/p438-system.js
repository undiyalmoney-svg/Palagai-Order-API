#!/usr/bin/env node
/**
 * PROGRAM 438 — COMPLETE TRADING-SYSTEM DISCOVERY
 *
 * THE CORRECTION THIS PROGRAM MAKES: prior programmes measured ABNORMAL return
 * versus a matched benchmark. For a long-only retail investor that is the wrong
 * objective — you cannot bank relative outperformance. This tests REAL
 * PORTFOLIOS on RAW return net of real costs, against the only alternative that
 * matters: owning the index.
 *
 * THREE PRE-REGISTERED CANDIDATES (frozen before any forward return):
 *   C1 industry momentum rotation   — between-industry selection (NOT H-432-A,
 *                                     which was within-industry transfer)
 *   C2 persistent delivery quality  — delivery LEVEL as characteristic
 *                                     (NOT H-428-B, which was delivery shocks)
 *   C3 attention growth             — persistent traded-value growth (untested)
 *
 * Frozen for all: 20 equal-weight positions, QUARTERLY rebalance (chosen from
 * the mechanisms — all are slow-moving characteristics), whole shares, real
 * Zerodha CNC costs, slippage swept 0.10/0.20/0.35/0.50%.
 *
 * Benchmarks: Nifty 50, and equal-weight liquid universe (same survivorship
 * treatment as the strategies, so the comparison is apples-to-apples).
 *
 * Usage: node p438-system.js <DATADIR>
 */
const fs=require('fs'),path=require('path'),readline=require('readline');
const ETF_RE=/BEES|ETF|GOLD|LIQUID|NIFTY|SENSEX|INAV|SILVER/i;
const NPOS=20,REBAL=63;const MIN_TV=+(process.env.MIN_TV||1e7),MIN_PX=10,DP_RS=15*1.18,START=1000000;

const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const med=a=>{const s=[...a].sort((x,y)=>x-y);const n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):0;};
const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1));};
function buyCost(t){return t*0.001+t*0.0000297+t*0.000001+t*0.00015+(t*0.0000297+t*0.000001)*0.18;}
function sellCost(t){return t*0.001+t*0.0000297+t*0.000001+(t*0.0000297+t*0.000001)*0.18+DP_RS;}
function pL(t){const o=[];const L=t.split(/\r?\n/);
 for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<13||(c[1]||'').trim()!=='EQ')continue;
  o.push({sym:c[0].trim(),op:+c[2],cl:+c[5],val:+c[9]});}return o;}
function pN(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());const ix=n=>h.indexOf(n);
 const a=ix('TckrSymb'),b=ix('SctySrs'),o1=ix('OpnPric'),d=ix('ClsPric'),v=ix('TtlTrfVal'),f=ix('FinInstrmTp');
 const o=[];for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;
  if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
  o.push({sym:(c[a]||'').trim(),op:+c[o1],cl:+c[d],val:+c[v]});}return o;}
function parseMto(t){const o=[];for(const l of t.split(/\r?\n/)){if(!l.startsWith('20,'))continue;
 const c=l.split(',');if(c.length<7||(c[3]||'').trim()!=='EQ')continue;
 const s=(c[2]||'').trim(),q=+c[4],p=+c[6];if(!s||!(q>0)||!Number.isFinite(p))continue;o.push({sym:s,pct:p});}return o;}

function metrics(curve,dates0){
  if(curve.length<50)return null;
  const s=curve[0].eq,e=curve[curve.length-1].eq;
  const yrs=(new Date(curve[curve.length-1].d)-new Date(curve[0].d))/(365.25*864e5);
  let pk=-Infinity,dd=0;for(const p of curve){pk=Math.max(pk,p.eq);dd=Math.min(dd,(p.eq-pk)/pk);}
  const dr=[];for(let i=1;i<curve.length;i++)dr.push(curve[i].eq/curve[i-1].eq-1);
  const vol=sd(dr)*Math.sqrt(252)*100;
  const cagr=(Math.pow(e/s,1/yrs)-1)*100;
  const down=dr.filter(x=>x<0);
  const byM={};for(const p of curve)byM[p.d.slice(0,7)]=p.eq;
  const ms=Object.keys(byM).sort();const mr=[];
  for(let i=1;i<ms.length;i++)mr.push(byM[ms[i]]/byM[ms[i-1]]-1);
  return {cagr,maxDD:dd*100,vol,
    sharpe:vol>0?(cagr-6)/vol:0,
    sortino:down.length?(cagr-6)/(sd(down)*Math.sqrt(252)*100):0,
    posMonths:mr.length?100*mr.filter(x=>x>0).length/mr.length:0,
    worstMonth:mr.length?Math.min(...mr)*100:0,
    endEq:e};
}

async function main(){
  const DATA=process.argv[2],RAW=path.join(DATA,'full','raw'),MRAW=path.join(DATA,'mto','raw');
  const ind=new Map();
  await new Promise((res,rej)=>{const rl=readline.createInterface({input:fs.createReadStream(path.join(DATA,'ann_full','announcements.ndjson')),crlfDelay:Infinity});
    rl.on('line',l=>{if(!l.trim())return;let o;try{o=JSON.parse(l)}catch(e){return}
      const s=(o.smIndustry||'').trim();
      if(o.symbol&&s&&s!=='-'&&s!=='Miscellaneous'&&!ind.has(o.symbol))ind.set(o.symbol,s);});
    rl.on('close',res);rl.on('error',rej);});
  const CO=new Set(JSON.parse(fs.readFileSync(path.join(DATA,'company_universe.json'),'utf8')));
  console.log(`[universe] company symbols (non-ETF): ${CO.size}   liquidity floor: Rs ${(MIN_TV/1e7).toFixed(1)} cr median 20d value`);
  const files=fs.readdirSync(RAW).filter(f=>f.endsWith('.csv')&&fs.statSync(path.join(RAW,f)).isFile()).sort();
  const dates=files.map(f=>f.replace('.csv',''));const T=dates.length;
  const px=new Map(),dl=new Map();
  for(let i=0;i<T;i++){
    for(const r of (dates[i]>'2024-06-30'?pN:pL)(fs.readFileSync(path.join(RAW,files[i]),'utf8'))){
      if(!r.sym||!(r.cl>0))continue;if(!px.has(r.sym))px.set(r.sym,new Map());px.get(r.sym).set(i,r);}
    const mp=path.join(MRAW,`${dates[i]}.dat`);
    if(fs.existsSync(mp))for(const r of parseMto(fs.readFileSync(mp,'utf8'))){
      if(!dl.has(r.sym))dl.set(r.sym,new Map());dl.get(r.sym).set(i,r.pct);}}
  // nifty
  let nifty=null;
  {const f=path.join(DATA,'nifty.json');
   if(fs.existsSync(f))nifty=JSON.parse(fs.readFileSync(f,'utf8'));}
  console.log('='.repeat(120));
  console.log('PROGRAM 438 — COMPLETE TRADING-SYSTEM DISCOVERY  [3 candidates frozen before results]');
  console.log(`RAW long-only portfolio returns net of real costs. ${NPOS} equal-weight positions, quarterly rebalance.`);
  console.log('='.repeat(120));

  // ---------- candidate signal functions: computed from PRE-SIGNAL data only ----------
  function characteristics(i){
    const out=[];
    for(const[sym,m]of px){
      if(ETF_RE.test(sym)||!CO.has(sym))continue;
      const c=m.get(i);if(!c||!(c.cl>=MIN_PX))continue;
      const tv=[];for(let k=i-20;k<i;k++){const b=m.get(k);if(b)tv.push(b.val||0);}
      if(tv.length<14)continue;
      const mtv=med(tv);if(!(mtv>=MIN_TV))continue;
      // C1 industry 6-month return
      const a126=m.get(i-126);
      const r126=(a126&&a126.cl>0)?c.cl/a126.cl-1:null;
      // C2 delivery: 252-day average delivery %
      const dm=dl.get(sym);let dsum=0,dn=0;
      if(dm)for(let k=i-252;k<i;k+=1){const p=dm.get(k);if(p!=null){dsum+=p;dn++;}}
      const delAvg=dn>=150?dsum/dn:null;
      // C3 attention growth: median value last 63d vs prior 189d
      const recent=[],older=[];
      for(let k=i-63;k<i;k++){const b=m.get(k);if(b)recent.push(b.val||0);}
      for(let k=i-252;k<i-63;k++){const b=m.get(k);if(b)older.push(b.val||0);}
      const attn=(recent.length>=40&&older.length>=120&&med(older)>0)?med(recent)/med(older)-1:null;
      out.push({sym,mtv,px:c.cl,sec:ind.get(sym)||null,r126,delAvg,attn});
    }
    return out;
  }
  const SEL={
    C1_industryRotation:(ch)=>{
      const bySec=new Map();
      for(const c of ch){if(!c.sec||c.r126==null)continue;
        if(!bySec.has(c.sec))bySec.set(c.sec,[]);bySec.get(c.sec).push(c);}
      const secR=[...bySec.entries()].filter(([,a])=>a.length>=5)
        .map(([s,a])=>({s,r:mean(a.map(x=>x.r126))})).sort((a,b)=>b.r-a.r);
      const top=secR.slice(0,3).map(x=>x.s);
      const pool=ch.filter(c=>top.includes(c.sec));
      return pool.sort((a,b)=>b.mtv-a.mtv).slice(0,NPOS);   // most liquid inside hot industries
    },
    C2_deliveryQuality:(ch)=>ch.filter(c=>c.delAvg!=null).sort((a,b)=>b.delAvg-a.delAvg).slice(0,NPOS),
    C3_attentionGrowth:(ch)=>ch.filter(c=>c.attn!=null).sort((a,b)=>b.attn-a.attn).slice(0,NPOS),
    B1_equalWeightUniverse:(ch)=>ch.sort((a,b)=>b.mtv-a.mtv).slice(0,100),  // broad liquid benchmark
    // ---- CONTROLS for C2 (decide: delivery-quality effect, or microcap beta?) ----
    X2_LOWdeliveryOpposite:(ch)=>ch.filter(c=>c.delAvg!=null).sort((a,b)=>a.delAvg-b.delAvg).slice(0,NPOS),
    X2_sizeMatchedRandom:(ch)=>{
      const pool=ch.filter(c=>c.delAvg!=null).sort((a,b)=>b.delAvg-a.delAvg);
      if(!pool.length)return[];
      // same liquidity band as the C2 book, deterministic pseudo-random draw
      const top=pool.slice(0,NPOS);const lo=Math.min(...top.map(x=>x.mtv)),hi=Math.max(...top.map(x=>x.mtv));
      const band=pool.filter(c=>c.mtv>=lo&&c.mtv<=hi);
      let h=(band.length*2654435761)>>>0;const pick=[];const used=new Set();
      while(pick.length<NPOS&&used.size<band.length){h=(h*1664525+1013904223)>>>0;
        const j=h%band.length;if(used.has(j)){used.add(j);continue;}used.add(j);pick.push(band[j]);}
      return pick;},
  };

  const grid=[];for(let i=260;i<T-2;i+=REBAL)grid.push(i);
  const charCache=new Map();
  for(const i of grid)charCache.set(i,characteristics(i));

  function runPortfolio(selFn,slip,from,to){
    let cash=START,hold={},curve=[],trades=0,costs=0;
    const val=i=>{let v=cash;for(const[s,q]of Object.entries(hold)){const r=px.get(s)?.get(i);if(r)v+=r.cl*q;}return v;};
    const startIdx=grid.find(i=>dates[i]>=from);
    if(startIdx===undefined)return null;
    for(let gi=grid.indexOf(startIdx);gi<grid.length;gi++){
      const i=grid[gi];if(dates[i]>to)break;
      const nextI=(gi+1<grid.length)?Math.min(grid[gi+1],T-1):T-1;
      const target=selFn(charCache.get(i)).map(c=>c.sym);
      // sell
      for(const s of Object.keys(hold)){
        if(target.includes(s))continue;
        const r=px.get(s)?.get(i);if(!r)continue;
        const fill=r.cl*(1-slip),to2=fill*hold[s],c=sellCost(to2);
        cash+=to2-c;costs+=c;trades++;delete hold[s];}
      // buy
      const held=Object.keys(hold);const toBuy=target.filter(s=>!held.includes(s));
      if(toBuy.length){
        const per=val(i)/Math.max(1,target.length);
        for(const s of toBuy){
          const r=px.get(s)?.get(i);if(!r)continue;
          const fill=r.cl*(1+slip);
          let q=Math.floor(Math.min(per,cash*0.98)/fill);
          if(q<1)continue;
          let to2=fill*q,c=buyCost(to2);
          while(to2+c>cash&&q>0){q--;to2=fill*q;c=buyCost(to2);}
          if(q<1)continue;
          cash-=to2+c;costs+=c;trades++;hold[s]=q;}}
      for(let d=i;d<nextI;d++){if(dates[d]>to)break;curve.push({d:dates[d],eq:val(d)});}
    }
    return {curve,trades,costs};
  }

  const WINS=[['DEV','2015-01-01','2018-12-31'],['VALID','2019-01-01','2022-12-31'],['TEST','2023-01-01','2026-08-21']];
  for(const slip of [0.001,0.002,0.0035,0.005]){
    console.log(`\n${'='.repeat(120)}`);
    console.log(`SLIPPAGE ${(slip*100).toFixed(2)}% per leg  ·  RAW net-of-cost portfolio returns`);
    console.log('='.repeat(120));
    console.log('Candidate                 Win     CAGR%   MaxDD%   Vol%   Sharpe  Sortino  PosMo%  WorstMo%  Trades  Costs%');
    for(const[name,fn]of Object.entries(SEL)){
      for(const[wn,wf,wt]of WINS){
        const r=runPortfolio(fn,slip,wf,wt);
        if(!r){console.log(`${name.padEnd(24)} ${wn} (no data)`);continue;}
        const m=metrics(r.curve);if(!m)continue;
        console.log(`${(wn==='DEV'?name:'').padEnd(24)} ${wn.padEnd(6)} `+
          `${m.cagr.toFixed(1).padStart(7)} ${m.maxDD.toFixed(1).padStart(8)} ${m.vol.toFixed(1).padStart(6)} `+
          `${m.sharpe.toFixed(2).padStart(7)} ${m.sortino.toFixed(2).padStart(8)} ${m.posMonths.toFixed(0).padStart(7)} `+
          `${m.worstMonth.toFixed(1).padStart(9)} ${String(r.trades).padStart(7)} ${(100*r.costs/START).toFixed(2).padStart(7)}`);
      }
      console.log('-'.repeat(120));
    }
    if(nifty){
      for(const[wn,wf,wt]of WINS){
        const seg=nifty.filter(x=>x.d>=wf&&x.d<=wt).map(x=>({d:x.d,eq:x.c}));
        const m=metrics(seg);if(!m)continue;
        console.log(`${(wn==='DEV'?'NIFTY 50 (price)':'').padEnd(24)} ${wn.padEnd(6)} `+
          `${m.cagr.toFixed(1).padStart(7)} ${m.maxDD.toFixed(1).padStart(8)} ${m.vol.toFixed(1).padStart(6)} `+
          `${m.sharpe.toFixed(2).padStart(7)} ${m.sortino.toFixed(2).padStart(8)} ${m.posMonths.toFixed(0).padStart(7)} ${m.worstMonth.toFixed(1).padStart(9)}`);
      }
      console.log('  (Nifty TRI ~ price + 1.3%/yr dividends)');
    }
  }
}
main().catch(e=>{console.error('ERR',e.message,e.stack);process.exit(1);});
