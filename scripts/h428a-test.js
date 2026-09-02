#!/usr/bin/env node
/**
 * H-428-A — SPLIT/BONUS NOMINAL-PRICE ILLUSION. Primary test + attack suite.
 *
 * Treatment is BINARY (event vs no event). No ratio bins, no price thresholds,
 * no horizon search — +20 sessions is primary, declared before running.
 *
 * PRICE HANDLING (proved in the audit): the bhavcopy series is UNADJUSTED, so
 * entry is the session OPEN AFTER the ex-date and exit is the close of +20.
 * Both sit in the post-split price basis, so the mechanical adjustment is
 * removed structurally rather than by applying a factor.
 *
 * CONTROLS: characteristic-matched on pre-event information only —
 * liquidity tercile x momentum tercile x nominal-price tercile, excluding any
 * stock with its own corporate action in the window. abnormal = event - peers.
 *
 * Usage: node h428a-test.js <DATADIR>
 */
const fs=require('fs'),path=require('path'),readline=require('readline');
const MON={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
const caIso=s=>{const m=/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec((s||'').trim());
 if(!m)return null;const mo=MON[m[2].toUpperCase()];
 return mo===undefined?null:`${m[3]}-${String(mo+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;};
const ETF_RE=/BEES|ETF|GOLD|LIQUID|NIFTY|SENSEX|INAV|SILVER/i;
const H_PRIMARY=20, HZ=[1,3,5,10,20], MIN_PEERS=5, DP_RS=15*1.18;

const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const med=a=>{const s=[...a].sort((x,y)=>x-y);const n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):0;};
const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1));};
function clusteredT(rows){const n=rows.length;if(n<10)return 0;const m=mean(rows.map(r=>r.v));
 const by=new Map();for(const r of rows)by.set(r.sym,(by.get(r.sym)||0)+(r.v-m));
 let meat=0;for(const[,s]of by)meat+=s*s;const se=Math.sqrt(meat)/n;return se>0?m/se:0;}
function pFromT(t){const z=Math.abs(t);const b=[0.319381530,-0.356563782,1.781477937,-1.821255978,1.330274429];
 const c=0.39894228*Math.exp(-z*z/2),tt=1/(1+0.2316419*z);
 return 2*c*tt*(b[0]+tt*(b[1]+tt*(b[2]+tt*(b[3]+tt*b[4]))));}
function boot(a,it=5000){if(a.length<10)return[NaN,NaN];const m=[];
 for(let i=0;i<it;i++){let s=0;for(let k=0;k<a.length;k++)s+=a[(Math.random()*a.length)|0];m.push(s/a.length);}
 m.sort((x,y)=>x-y);return[m[(it*0.025)|0],m[(it*0.975)|0]];}
function stream(f,cb){return new Promise((res,rej)=>{const rl=readline.createInterface({input:fs.createReadStream(f),crlfDelay:Infinity});
 rl.on('line',l=>{if(l.trim()){try{cb(JSON.parse(l))}catch(e){}}});rl.on('close',res);rl.on('error',rej);});}
function parseLegacy(t){const o=[];const L=t.split(/\r?\n/);
 for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<13||(c[1]||'').trim()!=='EQ')continue;
  o.push({sym:c[0].trim(),op:+c[2],cl:+c[5],val:+c[9]});}return o;}
function parseNew(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());
 const ix=n=>h.indexOf(n);const a=ix('TckrSymb'),b=ix('SctySrs'),o1=ix('OpnPric'),d=ix('ClsPric'),v=ix('TtlTrfVal'),f=ix('FinInstrmTp');
 const o=[];for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;
  if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
  o.push({sym:(c[a]||'').trim(),op:+c[o1],cl:+c[d],val:+c[v]});}return o;}

async function main(){
  const DATA=process.argv[2];
  const RAW=path.join(DATA,'full','raw');
  const events=JSON.parse(fs.readFileSync(path.join(DATA,'h428a_events.json'),'utf8'));

  // CA index for excluding contaminated CONTROLS
  const caBySym=new Map();
  for(const f of [path.join(DATA,'ca_sym','ca_persymbol.ndjson'),path.join(DATA,'ca_full','corpactions.ndjson')]){
    if(!fs.existsSync(f))continue;
    await stream(f,r=>{if(r.__sym)return;const iso=caIso(r.exDate);if(!iso||!r.symbol)return;
      const s=(r.subject||'').toLowerCase();
      if(/dividend/.test(s)&&!/split|bonus|rights|merger|demerger/.test(s))return; // dividends ok
      if(!caBySym.has(r.symbol))caBySym.set(r.symbol,[]);caBySym.get(r.symbol).push(iso);});}

  // sector map
  const sector=new Map();
  await stream(path.join(DATA,'ann_full','announcements.ndjson'),o=>{
    const s=(o.smIndustry||'').trim();
    if(o.symbol&&s&&s!=='-'&&!sector.has(o.symbol))sector.set(o.symbol,s);});

  const files=fs.readdirSync(RAW).filter(f=>f.endsWith('.csv')&&fs.statSync(path.join(RAW,f)).isFile()).sort();
  const dates=files.map(f=>f.replace('.csv',''));const dIdx=new Map(dates.map((d,i)=>[d,i]));const T=dates.length;
  const px=new Map();
  for(let i=0;i<T;i++)for(const r of (dates[i]>'2024-06-30'?parseNew:parseLegacy)(fs.readFileSync(path.join(RAW,files[i]),'utf8'))){
    if(!r.sym||!(r.cl>0))continue;if(!px.has(r.sym))px.set(r.sym,new Map());px.get(r.sym).set(i,r);}
  const caIdxBySym=new Map();
  for(const[s,arr]of caBySym)caIdxBySym.set(s,new Set(arr.map(x=>dIdx.get(x)).filter(x=>x!==undefined)));

  const retFn=(sym,i,h)=>{const m=px.get(sym);if(!m)return null;
    const a=m.get(i+1),b=m.get(i+1+h);   // ENTRY = OPEN of i+1 (session after ex-date)
    if(!a||!b||!(a.op>0)||!(b.cl>0))return null;return (b.cl/a.op-1)*100;};

  console.log('='.repeat(116));
  console.log('H-428-A — PRIMARY TEST  (binary treatment, +20 sessions, entry = open after ex-date)');
  console.log('='.repeat(116));

  // ---- build matched controls per event ----
  const out=[];let noPeers=0;
  const sessionCache=new Map();
  for(const e of events){
    const i=e.i;
    if(!sessionCache.has(i)){
      const chars=[];
      for(const[sym,m]of px){
        if(ETF_RE.test(sym))continue;
        const pre=m.get(i-1);if(!pre||!(pre.cl>=10))continue;
        const tv=[],momA=m.get(i-61),momB=m.get(i-6);
        for(let k=i-21;k<i;k++){const b=m.get(k);if(b)tv.push(b.val||0);}
        if(tv.length<14||!momA||!momB||!(momA.cl>0))continue;
        chars.push({sym,tv:med(tv),mom:momB.cl/momA.cl-1,pxLvl:pre.cl});
      }
      if(chars.length<50){sessionCache.set(i,null);}
      else{
        const bt=(arr,key)=>{const s=[...arr].sort((a,b)=>a[key]-b[key]);s.forEach((c,k)=>{c[key+'T']=Math.min(2,Math.floor(3*k/s.length));});};
        bt(chars,'tv');bt(chars,'mom');bt(chars,'pxLvl');
        const map=new Map(chars.map(c=>[c.sym,c]));
        sessionCache.set(i,{chars,map});
      }
    }
    const sc=sessionCache.get(i);
    if(!sc){noPeers++;continue;}
    const me=sc.map.get(e.sym);
    if(!me){noPeers++;continue;}
    const pool=sc.chars.filter(c=>c.sym!==e.sym&&c.tvT===me.tvT&&c.momT===me.momT&&c.pxLvlT===me.pxLvlT
      &&!(caIdxBySym.get(c.sym)&&[...caIdxBySym.get(c.sym)].some(x=>x>=i-5&&x<=i+25)));
    if(pool.length<MIN_PEERS){noPeers++;continue;}
    const rec={sym:e.sym,iso:e.iso,cls:e.cls,i,sec:sector.get(e.sym)||'UNKNOWN',
      tvT:me.tvT,pxLvl:me.pxLvl,peers:pool.length,
      win:e.iso<='2018-12-31'?'DEV':e.iso<='2022-12-31'?'VALID':'TEST',ab:{},raw:{}};
    let any=false;
    for(const h of HZ){
      const ev=retFn(e.sym,i,h);
      if(ev==null){rec.ab[h]=null;rec.raw[h]=null;continue;}
      const pr=pool.map(p=>retFn(p.sym,i,h)).filter(x=>x!=null);
      if(pr.length<MIN_PEERS){rec.ab[h]=null;rec.raw[h]=ev;continue;}
      rec.raw[h]=ev;rec.ab[h]=ev-mean(pr);any=true;
    }
    if(!any){noPeers++;continue;}
    out.push(rec);
  }
  console.log(`matched events: ${out.length}   excluded (insufficient peers): ${noPeers}`);
  const matchRate=100*out.length/(out.length+noPeers);
  console.log(`match rate: ${matchRate.toFixed(1)}%`);

  // ---- PRIMARY ----
  console.log(`\nPRIMARY — h=+${H_PRIMARY}, matched-abnormal %`);
  console.log('Win     n    uniqCos   mean%    median%   win%    clustT     p        boot95CI');
  const prim={};
  for(const w of ['DEV','VALID','TEST']){
    const g=out.filter(r=>r.win===w&&r.ab[H_PRIMARY]!=null);
    if(g.length<20){console.log(`${w}: n=${g.length} INSUFFICIENT`);continue;}
    const v=g.map(r=>r.ab[H_PRIMARY]);
    const t=clusteredT(g.map(r=>({sym:r.sym,v:r.ab[H_PRIMARY]})));
    const ci=boot(v);
    prim[w]={m:mean(v),md:med(v),t,n:v.length};
    console.log(`${w.padEnd(6)} ${String(v.length).padStart(4)} ${String(new Set(g.map(r=>r.sym)).size).padStart(8)} `+
      `${mean(v).toFixed(3).padStart(8)} ${med(v).toFixed(3).padStart(9)} ${(100*v.filter(x=>x>0).length/v.length).toFixed(0).padStart(6)} `+
      `${t.toFixed(2).padStart(8)} ${pFromT(t).toExponential(1).padStart(9)}  [${ci[0].toFixed(2)}, ${ci[1].toFixed(2)}]`);
  }
  console.log('\nSTOP RULE — DEV and VALID must BOTH be positive');
  if(prim.DEV&&prim.VALID){
    const ok=prim.DEV.m>0&&prim.VALID.m>0;
    console.log(`  DEV ${prim.DEV.m.toFixed(3)}%   VALID ${prim.VALID.m.toFixed(3)}%   -> ${ok?'PASSES':'FAILS'}`);
  }

  // ---- raw vs abnormal vs nifty-free ----
  console.log('\nRAW vs ABNORMAL (all horizons, mean %)');
  console.log('Win     h=1            h=3            h=5            h=10           h=20');
  for(const w of ['DEV','VALID','TEST']){
    const row=HZ.map(h=>{const g=out.filter(r=>r.win===w&&r.ab[h]!=null);
      if(g.length<20)return '   n/a       ';
      const rw=mean(g.map(r=>r.raw[h])),ab=mean(g.map(r=>r.ab[h]));
      return `${rw.toFixed(2).padStart(6)}/${ab.toFixed(2).padStart(6)}`;}).join(' ');
    console.log(w.padEnd(7)+row);
  }
  console.log('  (format: raw/abnormal)');

  // ---- ATTACKS ----
  console.log('\n'+'='.repeat(116));
  console.log('ATTACK SUITE');
  console.log('='.repeat(116));
  const all=out.filter(r=>r.ab[H_PRIMARY]!=null);
  const V=all.map(r=>r.ab[H_PRIMARY]);

  console.log('\n[A] PRE-EVENT PLACEBO WINDOW (-25..-5, should show NO effect if event-driven)');
  for(const w of ['DEV','VALID','TEST']){
    const g=out.filter(r=>r.win===w);
    const pre=[];
    for(const r of g){const m=px.get(r.sym);if(!m)continue;
      const a=m.get(r.i-25),b=m.get(r.i-5);if(!a||!b||!(a.op>0))continue;pre.push((b.cl/a.op-1)*100);}
    if(pre.length>20)console.log(`  ${w.padEnd(6)} pre-event raw mean ${mean(pre).toFixed(3)}%  median ${med(pre).toFixed(3)}%`);
  }

  console.log('\n[B] TAIL DEPENDENCE');
  for(const w of ['DEV','VALID','TEST']){
    const v=out.filter(r=>r.win===w&&r.ab[H_PRIMARY]!=null).map(r=>r.ab[H_PRIMARY]).sort((a,b)=>b-a);
    if(v.length<20)continue;
    const c1=Math.max(1,Math.floor(v.length*0.01)),c5=Math.max(1,Math.floor(v.length*0.05));
    console.log(`  ${w.padEnd(6)} full ${mean(v).toFixed(3)}  -top1% ${mean(v.slice(c1)).toFixed(3)}  -top5% ${mean(v.slice(c5)).toFixed(3)}  -top10% ${mean(v.slice(Math.floor(v.length*0.1))).toFixed(3)}`);
  }

  console.log('\n[C] SPLIT vs BONUS decomposition');
  for(const c of ['SPLIT','BONUS']){
    for(const w of ['DEV','VALID','TEST']){
      const v=all.filter(r=>r.cls===c&&r.win===w).map(r=>r.ab[H_PRIMARY]);
      if(v.length<15)continue;
      console.log(`  ${c.padEnd(6)} ${w.padEnd(6)} n=${String(v.length).padStart(4)} mean ${mean(v).toFixed(3)}  median ${med(v).toFixed(3)}  win% ${(100*v.filter(x=>x>0).length/v.length).toFixed(0)}`);
    }
  }

  console.log('\n[D] LIQUIDITY TERCILE (tv0=least liquid)');
  for(let t2=0;t2<3;t2++){
    const v=all.filter(r=>r.tvT===t2).map(r=>r.ab[H_PRIMARY]);
    if(v.length<20)continue;
    console.log(`  tv${t2}  n=${String(v.length).padStart(4)}  mean ${mean(v).toFixed(3)}  median ${med(v).toFixed(3)}  win% ${(100*v.filter(x=>x>0).length/v.length).toFixed(0)}`);
  }

  console.log('\n[E] CONCENTRATION');
  const bySym=new Map();for(const r of all)bySym.set(r.sym,(bySym.get(r.sym)||0)+r.ab[H_PRIMARY]);
  const tot=[...bySym.values()].reduce((a,b)=>a+b,0);
  const srt=[...bySym.entries()].sort((a,b)=>b[1]-a[1]);
  console.log(`  companies ${bySym.size}  total abn sum ${tot.toFixed(1)}`);
  if(Math.abs(tot)>1e-9)
    console.log(`  top1 ${(100*srt[0][1]/tot).toFixed(1)}%  top5 ${(100*srt.slice(0,5).reduce((a,c)=>a+c[1],0)/tot).toFixed(1)}%  top10 ${(100*srt.slice(0,10).reduce((a,c)=>a+c[1],0)/tot).toFixed(1)}%`);
  const bySec=new Map();for(const r of all)bySec.set(r.sec,(bySec.get(r.sec)||0)+r.ab[H_PRIMARY]);
  const ss=[...bySec.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3);
  console.log(`  top sectors: ${ss.map(([k,v])=>`${k}(${(100*v/tot).toFixed(0)}%)`).join('  ')}`);

  console.log('\n[F] YEAR-BY-YEAR');
  const byY=new Map();for(const r of all){const y=r.iso.slice(0,4);if(!byY.has(y))byY.set(y,[]);byY.get(y).push(r.ab[H_PRIMARY]);}
  for(const y of [...byY.keys()].sort()){const v=byY.get(y);
    console.log(`  ${y} n=${String(v.length).padStart(3)} mean ${mean(v).toFixed(3).padStart(8)} median ${med(v).toFixed(3).padStart(8)} win% ${(100*v.filter(x=>x>0).length/v.length).toFixed(0)}`);}

  console.log('\n[G] COSTS — gross to net at realistic position sizes (single round trip, 20-session hold)');
  const grossAll=mean(all.map(r=>r.raw[H_PRIMARY]));
  console.log(`  mean RAW return over +20 sessions: ${grossAll.toFixed(3)}%`);
  for(const pos of [20000,50000,100000,200000]){
    const p0=500,q=Math.floor(pos/p0),bt=p0*q,st=p0*1.01*q;
    const stt=(bt+st)*0.001,ex=(bt+st)*0.0000297,se=(bt+st)*0.000001,stp=bt*0.00015,gst=(ex+se)*0.18;
    const c=stt+ex+se+stp+gst+DP_RS, pct=100*c/pos;
    console.log(`    Rs${String(pos).padStart(6)}: cost ${pct.toFixed(3)}%  slippage 0.20%  -> NET ${(grossAll-pct-0.2).toFixed(3)}%`);
  }
}
main().catch(e=>{console.error('ERR',e.message,e.stack);process.exit(1);});
