#!/usr/bin/env node
/** Estimate effective bid-ask spread with the Corwin-Schultz (2012) high-low
 *  estimator, on daily bars built from the 5-min data. This is what a market
 *  order actually pays; half of it is the minimum realistic slippage per side. */
const fs=require('fs'),path=require('path');
const med=x=>{if(!x.length)return NaN;const s=[...x].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];};
function cs(days){
  const out=[];
  for(let i=1;i<days.length;i++){
    const H1=days[i-1].h,L1=days[i-1].l,H2=days[i].h,L2=days[i].l;
    if(!(H1>0&&L1>0&&H2>0&&L2>0)) continue;
    const b=Math.pow(Math.log(H1/L1),2)+Math.pow(Math.log(H2/L2),2);
    const Hc=Math.max(H1,H2), Lc=Math.min(L1,L2);
    const g=Math.pow(Math.log(Hc/Lc),2);
    const k=3-2*Math.sqrt(2);
    const a=(Math.sqrt(2*b)-Math.sqrt(b))/k - Math.sqrt(g/k);
    const s=2*(Math.exp(a)-1)/(1+Math.exp(a));
    if(isFinite(s)&&s>0&&s<0.2) out.push(100*s);
  }
  return out;
}
function run(dir,label,from){
  const per=[];
  for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.json'))){
    const a=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
    const byD=new Map();
    for(const r of a){
      const d=r[0].slice(0,10); if(d<from) continue;
      if(!byD.has(d)) byD.set(d,{h:r[2],l:r[3]});
      const b=byD.get(d); b.h=Math.max(b.h,r[2]); b.l=Math.min(b.l,r[3]);
    }
    const days=[...byD.entries()].sort().map(x=>x[1]);
    if(days.length<100) continue;
    const s=cs(days); if(s.length) per.push({sym:f.replace('.json',''),spread:med(s)});
  }
  per.sort((a,b)=>a.spread-b.spread);
  console.log(`  ${label}  (n=${per.length} symbols, from ${from})`);
  console.log(`    median effective spread : ${med(per.map(p=>p.spread)).toFixed(4)}%`);
  console.log(`    -> half-spread per side : ${(med(per.map(p=>p.spread))/2).toFixed(4)}%`);
  console.log(`    tightest 5: ${per.slice(0,5).map(p=>p.sym+' '+p.spread.toFixed(3)).join('  ')}`);
  console.log(`    widest   5: ${per.slice(-5).map(p=>p.sym+' '+p.spread.toFixed(3)).join('  ')}`);
  return per;
}
console.log('EFFECTIVE SPREAD (Corwin-Schultz), 2023-2026 only\n');
const lc=run('research-data/eqintra','LARGE-CAP (26)','2023-01-01');
console.log();
const mc=run('research-data/midintra','MID-CAP (55)','2023-01-01');
console.log('\n  ratio mid/large: '+(med(mc.map(p=>p.spread))/med(lc.map(p=>p.spread))).toFixed(2)+'x');
fs.writeFileSync('research-data/midcap-spreads.json',JSON.stringify(mc));
console.log('\n  NOTE: Corwin-Schultz OVERSTATES for volatile stocks. Treat as an upper bound.');
console.log('  Realistic market-order slippage per side is roughly half-spread, plus impact.');
