#!/usr/bin/env node
/**
 * HYPOTHESIS LV-001 — LOW-VOLATILITY / BETTING-AGAINST-BETA
 *
 * MECHANISM: Most investors cannot lever (mandates, margin rules, retail
 * constraints). Seeking higher returns they bid up high-beta / lottery-like
 * stocks, systematically overpricing them and leaving low-volatility stocks
 * relatively cheap. Arbitrage is incomplete because correcting it requires
 * LEVERAGING low-beta stocks — which the same constraints prevent. (Black
 * 1972; Frazzini & Pedersen 2014.)
 *
 * PREDICTION: the lowest-trailing-volatility quintile earns returns >= the
 * equal-weight universe, with materially lower drawdown.
 *
 * FALSIFIED IF: low-vol underperforms equal-weight universe, or shows no
 * drawdown advantage, or works in only one window / one sector.
 *
 * THE CONTROL THAT MATTERS: the benchmark is the EQUAL-WEIGHT UNIVERSE, not
 * Nifty. My universe is survivorship-biased; both sides carry that bias
 * identically, so the comparison isolates the low-vol effect instead of
 * measuring the universe's luck. Nifty is reported alongside for context only.
 *
 * FROZEN SPEC (declared before running):
 *   rank      : trailing 252-day realised volatility of daily returns
 *   select    : lowest-volatility quintile
 *   rebalance : quarterly (low turnover — cost discipline)
 *   weighting : equal
 *   entry/exit: next session's OPEN after the ranking date
 * No optimisation of lookback, quintile size, or rebalance frequency.
 *
 * Usage: node scripts/lowvol-study.js
 */
const { fetchHistoricalCandles } = require('../live/kite-market');

const SECTOR = {
  HDFCBANK:'Financials',ICICIBANK:'Financials',SBIN:'Financials',KOTAKBANK:'Financials',
  AXISBANK:'Financials',INDUSINDBK:'Financials',BANKBARODA:'Financials',PNB:'Financials',
  IDFCFIRSTB:'Financials',RBLBANK:'Financials',BANDHANBNK:'Financials',YESBANK:'Financials',BAJFINANCE:'Financials',
  TCS:'IT',INFY:'IT',WIPRO:'IT',HCLTECH:'IT',TECHM:'IT',
  RELIANCE:'Energy',IOC:'Energy',BPCL:'Energy',ONGC:'Energy',RPOWER:'Energy',
  NTPC:'Utilities',POWERGRID:'Utilities',SUZLON:'Utilities',
  TATASTEEL:'Metals',JSWSTEEL:'Metals',HINDALCO:'Metals',VEDL:'Metals',
  MARUTI:'Auto',M_M:'Auto',BAJAJ_AUTO:'Auto',HEROMOTOCO:'Auto',
  ITC:'FMCG',HINDUNILVR:'FMCG',BRITANNIA:'FMCG',DABUR:'FMCG',MARICO:'FMCG',NESTLEIND:'FMCG',
  ULTRACEMCO:'Cement',SHREECEM:'Cement',AMBUJACEM:'Cement',
  SUNPHARMA:'Pharma',CIPLA:'Pharma',DRREDDY:'Pharma',LUPIN:'Pharma',AUROPHARMA:'Pharma',
  LT:'Industrials',ADANIPORTS:'Industrials',GMRAIRPORT:'Industrials',
  TITAN:'Consumer',ASIANPAINT:'Consumer',ZEEL:'Media',
  BHARTIARTL:'Telecom',IDEA:'Telecom',INDUSTOWER:'Telecom',
};
const UNIVERSE = {
  HDFCBANK:341249,ICICIBANK:1270529,SBIN:779521,KOTAKBANK:492033,AXISBANK:1510401,
  INDUSINDBK:1346049,BANKBARODA:1195009,TCS:2953217,INFY:408065,WIPRO:969473,
  HCLTECH:1850625,TECHM:3465729,RELIANCE:738561,IOC:415745,BPCL:134657,ONGC:633601,
  TATASTEEL:895745,JSWSTEEL:3001089,HINDALCO:348929,MARUTI:2815745,M_M:519937,
  BAJAJ_AUTO:4267265,HEROMOTOCO:345089,ITC:424961,HINDUNILVR:356865,BRITANNIA:140033,
  DABUR:197633,MARICO:1041153,ULTRACEMCO:2952193,SHREECEM:794369,AMBUJACEM:325121,
  SUNPHARMA:857857,CIPLA:177665,DRREDDY:225537,LUPIN:2672641,AUROPHARMA:70401,
  NTPC:2977281,POWERGRID:3834113,LT:2939649,ADANIPORTS:3861249,TITAN:897537,
  ASIANPAINT:60417,BHARTIARTL:2714625,BAJFINANCE:81153,NESTLEIND:4598529,
  YESBANK:3050241,IDEA:3677697,ZEEL:975873,SUZLON:3076609,RPOWER:3906305,
  PNB:2730497,IDFCFIRSTB:2863105,VEDL:784129,RBLBANK:4708097,INDUSTOWER:7458561,
  BANDHANBNK:579329,GMRAIRPORT:3463169,
};
const NIFTY = 256265;
const FROM='2013-06-03', DEV_TO='2019-12-31', VALID_TO='2022-12-31', TO='2026-08-21';
const VOL_LOOKBACK = 252;   // FROZEN
const REBAL_MONTHS = 3;     // FROZEN
const DP_RS = 15*1.18;

function buyCost(t){ return t*0.001 + t*0.0000297 + t*0.000001 + t*0.00015 + (t*0.0000297+t*0.000001)*0.18; }
function sellCost(t){ return t*0.001 + t*0.0000297 + t*0.000001 + (t*0.0000297+t*0.000001)*0.18 + DP_RS; }
function addDays(d,n){const[y,m,dd]=d.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,dd));dt.setUTCDate(dt.getUTCDate()+n);return dt.toISOString().slice(0,10);}
async function fetchAll(auth,tok){const out=[];let cur=FROM;
  while(cur<=TO){const end=addDays(cur,1900)>TO?TO:addDays(cur,1900);
    out.push(...await fetchHistoricalCandles(auth,tok,cur,end,'day'));cur=addDays(end,1);}
  const seen=new Set();return out.filter(r=>(seen.has(r.date)?false:(seen.add(r.date),true))).sort((a,b)=>a.date.localeCompare(b.date));}
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sdev=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1));};

function metrics(curve){
  if(curve.length<30) return null;
  const s=curve[0].eq, e=curve[curve.length-1].eq;
  const yrs=(new Date(curve[curve.length-1].date)-new Date(curve[0].date))/(365.25*864e5);
  let peak=-Infinity,dd=0;
  for(const p of curve){peak=Math.max(peak,p.eq);dd=Math.min(dd,(p.eq-peak)/peak);}
  const byM={};for(const p of curve)byM[p.date.slice(0,7)]=p.eq;
  const ms=Object.keys(byM).sort(),mr=[];
  for(let i=1;i<ms.length;i++)mr.push(byM[ms[i]]/byM[ms[i-1]]-1);
  const dr=[];for(let i=1;i<curve.length;i++)dr.push(curve[i].eq/curve[i-1].eq-1);
  const ann=sdev(dr)*Math.sqrt(252)*100;
  const cagr=(Math.pow(e/s,1/yrs)-1)*100;
  const downside=dr.filter(x=>x<0);
  return {cagr, maxDD:dd*100, vol:ann,
    sharpe:ann>0?(cagr-6)/ann:0,
    sortino:downside.length?(cagr-6)/(sdev(downside)*Math.sqrt(252)*100):0,
    posMonths:mr.length?100*mr.filter(x=>x>0).length/mr.length:0,
    worstMonth:mr.length?Math.min(...mr)*100:0, endEq:e};
}

async function main(){
  const auth=`token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}`;
  const raw={};
  for(const[s,t]of Object.entries(UNIVERSE)){
    try{process.stderr.write(`${s} `);const r=await fetchAll(auth,t);if(r.length>1200)raw[s]=r;}catch(e){}}
  const nifty=await fetchAll(auth,NIFTY);
  const symbols=Object.keys(raw);
  const dates=nifty.map(r=>r.date.slice(0,10));
  const nClose=nifty.map(r=>r.close);
  const T=dates.length;
  const C={},O={},real={};
  for(const s of symbols){
    const m=new Map(raw[s].map(r=>[r.date.slice(0,10),r]));
    let last=null;C[s]=[];O[s]=[];real[s]=[];
    for(const d of dates){const has=m.has(d);if(has)last=m.get(d);
      real[s].push(has);C[s].push(last?last.close:null);O[s].push(has?last.open:null);}}
  console.error(`\n${symbols.length} symbols, ${T} sessions.\n`);

  // trailing realised vol
  const VOL={};
  for(const s of symbols){
    const v=[];
    for(let i=0;i<T;i++){
      if(i<VOL_LOOKBACK){v.push(null);continue;}
      const r=[];let ok=true;
      for(let k=i-VOL_LOOKBACK+1;k<=i;k++){
        if(C[s][k]==null||C[s][k-1]==null||!(C[s][k-1]>0)){ok=false;break;}
        r.push(Math.log(C[s][k]/C[s][k-1]));}
      v.push(ok?sdev(r)*Math.sqrt(252)*100:null);}
    VOL[s]=v;}

  const monthStarts=[];
  for(let i=1;i<T;i++) if(dates[i].slice(0,7)!==dates[i-1].slice(0,7)) monthStarts.push(i);

  /** run a quintile portfolio. pick='low'|'high'|'all' */
  function run(pick, capital, slip){
    let cash=capital, hold={}, curve=[], trades=0, costs=0;
    const val=i=>{let v=cash;for(const[s,q]of Object.entries(hold))if(C[s][i]!=null)v+=C[s][i]*q;return v;};
    let rebalCount=0;
    for(let m=0;m<monthStarts.length;m++){
      const i=monthStarts[m];
      const nextI=m+1<monthStarts.length?monthStarts[m+1]:T;
      if(m%REBAL_MONTHS!==0){for(let d=i;d<nextI;d++)curve.push({date:dates[d],eq:val(d)});continue;}
      const rankAt=i-1;
      const scored=[];
      for(const s of symbols){const v=VOL[s][rankAt];if(v!=null&&C[s][i]!=null)scored.push({s,v});}
      if(scored.length<20){for(let d=i;d<nextI;d++)curve.push({date:dates[d],eq:val(d)});continue;}
      scored.sort((a,b)=>a.v-b.v);
      const k=Math.max(3,Math.floor(scored.length/5));
      let target;
      if(pick==='low') target=scored.slice(0,k).map(x=>x.s);
      else if(pick==='high') target=scored.slice(-k).map(x=>x.s);
      else target=scored.map(x=>x.s);
      rebalCount++;
      for(const s of Object.keys(hold)){
        if(target.includes(s))continue;
        const p=C[s][i];if(p==null)continue;
        const fill=p*(1-slip),to=fill*hold[s],c=sellCost(to);
        cash+=to-c;costs+=c;trades++;delete hold[s];}
      const held=Object.keys(hold);
      const toBuy=target.filter(s=>!held.includes(s));
      if(toBuy.length){
        const per=val(i)/Math.max(1,target.length);
        for(const s of toBuy){
          const p=O[s][i]!=null?O[s][i]:C[s][i];if(p==null)continue;
          const fill=p*(1+slip);
          let q=Math.floor(Math.min(per,cash*0.98)/fill);
          if(q<1)continue;
          let to=fill*q,c=buyCost(to);
          while(to+c>cash&&q>0){q--;to=fill*q;c=buyCost(to);}
          if(q<1)continue;
          cash-=to+c;costs+=c;trades++;hold[s]=q;}}
      for(let d=i;d<nextI;d++)curve.push({date:dates[d],eq:val(d)});}
    return {curve,trades,costs,rebalCount};
  }

  const WINS=[['DEV',FROM,DEV_TO],['VALID',addDays(DEV_TO,1),VALID_TO],['TEST',addDays(VALID_TO,1),TO]];
  const seg=(c,f,t)=>c.filter(p=>p.date>=f&&p.date<=t);

  console.log('='.repeat(126));
  console.log('HYPOTHESIS LV-001 — LOW-VOLATILITY ANOMALY (frozen: 252d vol, lowest quintile, quarterly, equal-weight)');
  console.log(`Universe ${symbols.length} incl. fallen angels · SURVIVORSHIP-LIMITED (delisted names absent)`);
  console.log('CONTROL = equal-weight ALL universe (same survivorship bias on both sides)');
  console.log('='.repeat(126));

  for(const slip of [0.001,0.002]){
    console.log(`\n### slippage ${(slip*100).toFixed(2)}%/leg · capital ₹2,00,000`);
    console.log('Portfolio        Win     CAGR%   MaxDD%    Vol%   Sharpe  Sortino  Pos.Mo%  WorstMo%  Trades   Costs₹');
    console.log('-'.repeat(126));
    const runs={LOW:run('low',200000,slip),HIGH:run('high',200000,slip),ALL:run('all',200000,slip)};
    for(const[lbl,r]of Object.entries(runs)){
      for(const[wn,wf,wt]of WINS){
        const mm=metrics(seg(r.curve,wf,wt));if(!mm)continue;
        console.log((wn==='DEV'?lbl:'').padEnd(16),wn.padEnd(7),
          mm.cagr.toFixed(1).padStart(7),mm.maxDD.toFixed(1).padStart(8),mm.vol.toFixed(1).padStart(8),
          mm.sharpe.toFixed(2).padStart(8),mm.sortino.toFixed(2).padStart(8),
          mm.posMonths.toFixed(0).padStart(8),mm.worstMonth.toFixed(1).padStart(9),
          (wn==='DEV'?String(r.trades):'').padStart(7),(wn==='DEV'?'₹'+r.costs.toFixed(0):'').padStart(9));
      }
      console.log('-'.repeat(126));
    }
    // Nifty price benchmark
    for(const[wn,wf,wt]of WINS){
      const c=dates.map((d,i)=>({date:d,eq:nClose[i]})).filter(p=>p.date>=wf&&p.date<=wt);
      const mm=metrics(c);if(!mm)continue;
      console.log((wn==='DEV'?'NIFTY(price)':'').padEnd(16),wn.padEnd(7),
        mm.cagr.toFixed(1).padStart(7),mm.maxDD.toFixed(1).padStart(8),mm.vol.toFixed(1).padStart(8),
        mm.sharpe.toFixed(2).padStart(8),mm.sortino.toFixed(2).padStart(8),
        mm.posMonths.toFixed(0).padStart(8),mm.worstMonth.toFixed(1).padStart(9));
    }
    console.log('  (Nifty TRI ≈ price CAGR + ~1.3%/yr dividends — approximate, flagged)');
  }

  // capital sensitivity
  console.log(`\n${'='.repeat(126)}`);
  console.log('CAPITAL FEASIBILITY — low-vol quintile, 0.10% slippage');
  console.log('Capital      TEST CAGR%   TEST MaxDD%   Trades   Costs₹   Cost%ofCap   Positions held');
  console.log('-'.repeat(126));
  for(const cap of [20000,50000,100000,200000,500000,1000000]){
    const r=run('low',cap,0.001);
    const mm=metrics(seg(r.curve,addDays(VALID_TO,1),TO));
    if(!mm)continue;
    // count avg positions in final rebalance
    console.log(('₹'+(cap/1000).toFixed(0)+'k').padStart(9),
      mm.cagr.toFixed(1).padStart(12),mm.maxDD.toFixed(1).padStart(13),
      String(r.trades).padStart(8),('₹'+r.costs.toFixed(0)).padStart(9),
      ((100*r.costs/cap).toFixed(1)+'%').padStart(12));
  }

  // sector concentration of the low-vol selection
  console.log(`\nSECTOR MIX of low-vol quintile (final rebalance):`);
  const rankAt=T-2;const sc=[];
  for(const s of symbols){const v=VOL[s][rankAt];if(v!=null)sc.push({s,v});}
  sc.sort((a,b)=>a.v-b.v);
  const kk=Math.max(3,Math.floor(sc.length/5));
  const secCount={};
  for(const x of sc.slice(0,kk)){const se=SECTOR[x.s]||'Other';secCount[se]=(secCount[se]||0)+1;}
  console.log('  '+sc.slice(0,kk).map(x=>`${x.s}(${x.v.toFixed(0)}%)`).join(' '));
  console.log('  sectors: '+Object.entries(secCount).map(([k,v])=>`${k}:${v}`).join('  '));
}

main().catch(e=>{console.error('ERR:',e.message,e.stack);process.exit(1);});
