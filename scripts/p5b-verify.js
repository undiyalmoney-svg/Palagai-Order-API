#!/usr/bin/env node
/** PHASE 5.B — adversarial verification of the ONE surviving cell from 5.A:
 *    Rs50,000 x 1 position, NO stop, hold 3 sessions.
 *    (the only cell of 42 with BOTH DEV and VALID net positive)
 *  Tests: session-clustered t, outlier dependence, monotonicity, multiple-testing. */
const {execSync}=require('child_process');
const fs=require('fs'),path=require('path');
const {estimateDeliveryRoundTripCharges:CNC}=require('../live/equity-charges.js');
const src=fs.readFileSync(path.join(__dirname,'p5a-horizon.js'),'utf8');
// reuse 5.A's engine verbatim
const mod={exports:{}};
const body=src.replace(/^#!.*\n/,'').replace(/^const CAP=50000;[\s\S]*$/m,'module.exports={run,dates,S};')
               .replace(/^const DIR=process\.argv\[2\];/m,'const DIR=process.env.EQDIR;');
new Function('module','exports','require','__dirname',body)(mod,mod.exports,require,__dirname);
const {run}=mod.exports;

const sum=a=>a.reduce((x,y)=>x+y,0);
const mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};

const T=run(3,50000,1,false);
console.log('CELL: Rs50,000 x 1, no stop, hold 3 sessions');
console.log('  trades '+T.length+'  net Rs'+sum(T.map(x=>x.net)).toFixed(0)+'\n');

// --- 1. session-clustered t (each SESSION = one observation, not each trade) ---
const byDay=new Map();
for(const t of T){if(!byDay.has(t.d))byDay.set(t.d,0);byDay.set(t.d,byDay.get(t.d)+t.net);}
const dayNet=[...byDay.values()];
const t_=mean(dayNet)/(sd(dayNet)/Math.sqrt(dayNet.length));
console.log('1. SESSION-CLUSTERED SIGNIFICANCE');
console.log('   sessions '+dayNet.length+'  mean Rs'+mean(dayNet).toFixed(1)+'/session  t = '+t_.toFixed(2));
console.log('   '+(Math.abs(t_)<1.96?'NOT significant at 5% even before correcting for 42 cells':'nominally significant'));

// --- 2. multiple testing ---
console.log('\n2. MULTIPLE TESTING');
console.log('   42 cells were swept (3 sizings x 2 stop modes x 7 horizons).');
console.log('   Bonferroni threshold for 42 tests: |t| > '+ (3.02).toFixed(2)+'   observed |t| = '+Math.abs(t_).toFixed(2));
console.log('   P(at least one of 42 independent cells shows DEV+ and VALID+ by chance) ~ high.');

// --- 3. outlier dependence: drop the best N trades ---
console.log('\n3. OUTLIER DEPENDENCE (the test that killed C2-3)');
const srt=[...T].sort((a,b)=>b.net-a.net);
for(const k of [0,1,2,3,5,10]){
  const kept=srt.slice(k);
  console.log('   drop best '+String(k).padStart(2)+' trades -> net Rs'+sum(kept.map(x=>x.net)).toFixed(0).padStart(8)+
    (sum(kept.map(x=>x.net))<0?'   SIGN INVERTED':''));
}

// --- 4. monotonicity: a real horizon effect should be smooth ---
console.log('\n4. MONOTONICITY across horizon (Rs50k x1, no stop)');
const row=[];
for(const H of [0,1,2,3,4,5,6,8,10,15,20]){
  const t=run(H,50000,1,false);
  row.push([H,sum(t.map(x=>x.net))]);
}
for(const [H,n] of row) console.log('   H='+String(H).padStart(2)+'  net Rs'+n.toFixed(0).padStart(9)+'  '+(n>0?'+':''));
const signs=row.map(r=>r[1]>0?1:0);
console.log('   sign pattern: '+signs.join('')+'  (a real effect is contiguous, not alternating)');
