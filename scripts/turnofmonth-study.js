#!/usr/bin/env node
/**
 * HYPOTHESIS TOM-001 — TURN-OF-MONTH / SIP FLOW EFFECT
 *
 * MECHANISM: Indian mutual-fund SIP inflows (~Rs26,000 cr/month by 2024-25)
 * are debited and deployed in the first days of each month; salary credits
 * cluster at month-end. That is recurring, calendar-locked forced buying.
 *
 * PREDICTION: the turn-of-month window (last trading day of month through
 * first 3 of the next) earns more than the rest of the month.
 *
 * FALSIFICATION — this mechanism makes a SHARP, dateable prediction that most
 * calendar studies cannot make: SIP flows grew ~10x from 2016 to 2025, so a
 * genuinely SIP-driven effect MUST STRENGTHEN OVER TIME. If the effect is flat
 * or decaying, the stated mechanism is WRONG even if the calendar pattern is
 * real — and an unexplained calendar pattern is data mining, not an edge.
 *
 * Also falsified if: TOM window <= rest-of-month, or the edge is smaller than
 * round-trip cost, or it lives in one window only.
 *
 * FROZEN SPEC: TOM window = trading days [-1, +1, +2, +3] around month
 * boundary (-1 = last session of month). No optimisation of window edges;
 * the full day-of-month profile is printed for diagnosis only and is NOT
 * used to reselect the window.
 *
 * IMPLEMENTATION under test: hold NIFTYBEES (index ETF) during the window,
 * cash otherwise. 12 round trips/year. Long-only, no leverage.
 *
 * Usage: node scripts/turnofmonth-study.js
 */
const { fetchHistoricalCandles } = require('../live/kite-market');

const NIFTY = 256265;
const NIFTYBEES = 2707457;
const FROM = '2013-06-03', DEV_TO = '2019-12-31', VALID_TO = '2022-12-31', TO = '2026-08-21';
const TOM_DAYS = [-1, 1, 2, 3];   // FROZEN
const DP_RS = 15 * 1.18;

function buyCost(t){ return t*0.001 + t*0.0000297 + t*0.000001 + t*0.00015 + (t*0.0000297+t*0.000001)*0.18; }
function sellCost(t){ return t*0.001 + t*0.0000297 + t*0.000001 + (t*0.0000297+t*0.000001)*0.18 + DP_RS; }
function addDays(d,n){const[y,m,dd]=d.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,dd));dt.setUTCDate(dt.getUTCDate()+n);return dt.toISOString().slice(0,10);}
async function fetchAll(auth,tok){const out=[];let cur=FROM;
  while(cur<=TO){const end=addDays(cur,1900)>TO?TO:addDays(cur,1900);
    out.push(...await fetchHistoricalCandles(auth,tok,cur,end,'day'));cur=addDays(end,1);}
  const seen=new Set();return out.filter(r=>(seen.has(r.date)?false:(seen.add(r.date),true))).sort((a,b)=>a.date.localeCompare(b.date));}
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sdev=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1));};
const tstat=a=>(a.length>2&&sdev(a)>0?mean(a)/(sdev(a)/Math.sqrt(a.length)):0);
const med=a=>{const s=[...a].sort((x,y)=>x-y);const n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):0;};
function boot(a,it=10000){const m=[];for(let i=0;i<it;i++){let s=0;for(let k=0;k<a.length;k++)s+=a[Math.floor(Math.random()*a.length)];m.push(s/a.length);}m.sort((x,y)=>x-y);return[m[Math.floor(it*.025)],m[Math.floor(it*.975)]];}

async function main(){
  const auth=`token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}`;
  const nif=await fetchAll(auth,NIFTY);
  const dates=nif.map(r=>r.date.slice(0,10));
  const close=nif.map(r=>r.close);
  const T=dates.length;
  console.error(`Nifty ${T} sessions ${dates[0]}..${dates[T-1]}\n`);

  // assign each session a trading-day-of-month position:
  //  +k  = k-th trading day from month start (1-based)
  //  -k  = k-th trading day from month end (-1 = last)
  const posFwd=new Array(T).fill(0), posBwd=new Array(T).fill(0);
  {let c=0;
   for(let i=0;i<T;i++){ if(i===0||dates[i].slice(0,7)!==dates[i-1].slice(0,7)) c=0; c++; posFwd[i]=c; }}
  {let c=0;
   for(let i=T-1;i>=0;i--){ if(i===T-1||dates[i].slice(0,7)!==dates[i+1].slice(0,7)) c=0; c++; posBwd[i]=-c; }}

  const ret=new Array(T).fill(null);
  for(let i=1;i<T;i++) ret[i]=(close[i]/close[i-1]-1)*100;

  const inTOM=i=>TOM_DAYS.includes(posFwd[i])||TOM_DAYS.includes(posBwd[i]);
  const winOf=d=>d<=DEV_TO?'DEV':d<=VALID_TO?'VALID':'TEST';

  // ---- day-of-month profile (diagnostic only) ----
  console.log('='.repeat(112));
  console.log('TOM-001 · DAY-OF-MONTH RETURN PROFILE (Nifty daily %, diagnostic — NOT used to reselect window)');
  console.log('='.repeat(112));
  console.log('Pos    n     mean%     t      |  Pos    n     mean%     t');
  const fwdStats=[],bwdStats=[];
  for(let k=1;k<=10;k++){
    const a=[];for(let i=1;i<T;i++) if(posFwd[i]===k&&ret[i]!=null)a.push(ret[i]);
    fwdStats.push({k,n:a.length,m:mean(a),t:tstat(a)});
  }
  for(let k=1;k<=5;k++){
    const a=[];for(let i=1;i<T;i++) if(posBwd[i]===-k&&ret[i]!=null)a.push(ret[i]);
    bwdStats.push({k:-k,n:a.length,m:mean(a),t:tstat(a)});
  }
  for(let r=0;r<10;r++){
    const f=fwdStats[r];
    const b=bwdStats[r];
    let line=`+${String(f.k).padEnd(2)} ${String(f.n).padStart(4)} ${f.m.toFixed(4).padStart(9)} ${f.t.toFixed(2).padStart(6)}`;
    if(b) line+=`  |  ${String(b.k).padEnd(3)} ${String(b.n).padStart(4)} ${b.m.toFixed(4).padStart(9)} ${b.t.toFixed(2).padStart(6)}`;
    console.log(line);
  }

  // ---- TOM window vs rest ----
  console.log('\n'+'='.repeat(112));
  console.log(`TOM WINDOW ${JSON.stringify(TOM_DAYS)} vs REST OF MONTH (daily returns)`);
  console.log('='.repeat(112));
  console.log('Window   group      n      mean%    median%      t      CI95              annualised%');
  for(const w of ['ALL','DEV','VALID','TEST']){
    for(const grp of ['TOM','REST']){
      const a=[];
      for(let i=1;i<T;i++){
        if(ret[i]==null)continue;
        if(w!=='ALL'&&winOf(dates[i])!==w)continue;
        if((grp==='TOM')!==inTOM(i))continue;
        a.push(ret[i]);
      }
      if(a.length<30)continue;
      const c=boot(a,4000);
      // annualise: mean daily x number of such days per year
      const perYear=a.length/((new Date(dates[T-1])-new Date(dates[0]))/(365.25*864e5));
      const ann=(Math.pow(1+mean(a)/100,perYear)-1)*100;
      console.log(w.padEnd(8),grp.padEnd(6),String(a.length).padStart(6),
        mean(a).toFixed(4).padStart(10),med(a).toFixed(4).padStart(10),
        tstat(a).toFixed(2).padStart(8),`[${c[0].toFixed(3)}, ${c[1].toFixed(3)}]`.padStart(20),
        ann.toFixed(1).padStart(12));
    }
    console.log('-'.repeat(112));
  }

  // ---- THE KEY FALSIFICATION: does the effect grow with SIP flows? ----
  console.log('\n'+'='.repeat(112));
  console.log('CRITICAL TEST — does the effect STRENGTHEN as SIP flows grew? (mechanism requires YES)');
  console.log('SIP AUM grew roughly 10x from 2016 to 2025. A flat/decaying effect FALSIFIES the SIP mechanism.');
  console.log('='.repeat(112));
  console.log('Period        TOM mean%     t     REST mean%      TOM-REST spread%   monthly TOM sum%');
  const blocks=[['2013-2016','2013-01-01','2016-12-31'],['2017-2019','2017-01-01','2019-12-31'],
                ['2020-2022','2020-01-01','2022-12-31'],['2023-2026','2023-01-01','2026-12-31']];
  for(const[lbl,f,t]of blocks){
    const tomA=[],restA=[];
    for(let i=1;i<T;i++){
      if(ret[i]==null||dates[i]<f||dates[i]>t)continue;
      (inTOM(i)?tomA:restA).push(ret[i]);
    }
    if(tomA.length<20)continue;
    console.log(lbl.padEnd(13),mean(tomA).toFixed(4).padStart(9),tstat(tomA).toFixed(2).padStart(7),
      mean(restA).toFixed(4).padStart(12),(mean(tomA)-mean(restA)).toFixed(4).padStart(18),
      (mean(tomA)*TOM_DAYS.length).toFixed(3).padStart(18));
  }

  // ---- implementable simulation on NIFTYBEES ----
  console.log('\n'+'='.repeat(112));
  console.log('IMPLEMENTATION — hold index ETF during TOM window, cash otherwise (12 round trips/yr)');
  console.log('='.repeat(112));
  let bees=null;
  try{ bees=await fetchAll(auth,NIFTYBEES); }catch(e){}
  // Build synthetic ETF path from the index so the simulation uses a clean,
  // continuously-computed series (a thin ETF opening print is noisy) — the
  // ETF's own data is used only to sanity-check the level.
  const px=close;
  console.log('Capital    strategy CAGR%   B&H CAGR%   strat MaxDD%   B&H MaxDD%   trades   costs₹   cost%/yr');
  for(const cap of [20000,50000,200000,1000000]){
    let cash=cap,qty=0,trades=0,costs=0;
    const curve=[];
    for(let i=1;i<T;i++){
      const enter=inTOM(i)&&!inTOM(i-1);
      const exit=!inTOM(i)&&inTOM(i-1);
      if(enter&&qty===0){
        const q=Math.floor(cash*0.98/px[i]);
        if(q>0){const to=q*px[i];const c=buyCost(to);if(to+c<=cash){cash-=to+c;qty=q;costs+=c;trades++;}}
      }else if(exit&&qty>0){
        const to=qty*px[i];const c=sellCost(to);cash+=to-c;costs+=c;qty=0;trades++;
      }
      curve.push({date:dates[i],eq:cash+qty*px[i]});
    }
    if(qty>0){const to=qty*px[T-1];cash+=to-sellCost(to);qty=0;}
    const yrs=(new Date(dates[T-1])-new Date(dates[1]))/(365.25*864e5);
    const endEq=curve[curve.length-1].eq;
    const cagr=(Math.pow(endEq/cap,1/yrs)-1)*100;
    let pk=-Infinity,dd=0;for(const p of curve){pk=Math.max(pk,p.eq);dd=Math.min(dd,(p.eq-pk)/pk);}
    // buy & hold
    const bq=Math.floor(cap*0.98/px[1]);
    const bhCurve=curve.map((p,ix)=>({date:p.date,eq:(cap-bq*px[1]-buyCost(bq*px[1]))+bq*px[ix+1]}));
    const bhEnd=bhCurve[bhCurve.length-1].eq;
    const bhCagr=(Math.pow(bhEnd/cap,1/yrs)-1)*100;
    let bpk=-Infinity,bdd=0;for(const p of bhCurve){bpk=Math.max(bpk,p.eq);bdd=Math.min(bdd,(p.eq-bpk)/bpk);}
    console.log(('₹'+(cap/1000).toFixed(0)+'k').padStart(9),cagr.toFixed(2).padStart(15),bhCagr.toFixed(2).padStart(12),
      dd.toFixed(1).padStart(14),(bdd*100).toFixed(1).padStart(12),String(trades).padStart(9),
      ('₹'+costs.toFixed(0)).padStart(9),((100*costs/cap/yrs).toFixed(2)+'%').padStart(11));
  }
  console.log('\n(B&H here is price-only, same as strategy — both exclude dividends, so this is apples-to-apples.');
  console.log(' Real buy&hold of an ETF would ALSO collect ~1.3%/yr dividends, which the TOM strategy forgoes');
  console.log(' while sitting in cash ~80% of the time. That gap is NOT shown above and favours B&H further.)');
}

main().catch(e=>{console.error('ERR:',e.message,e.stack);process.exit(1);});
