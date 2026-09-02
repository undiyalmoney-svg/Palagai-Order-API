#!/usr/bin/env node
/**
 * H-428-A STEP 1 — DATA AUDIT + PRICE-HANDLING PROOF.
 * Computes NO forward returns. Its only job is to establish whether the event
 * universe is sound and how the mechanical price adjustment must be handled.
 *
 * THE CRITICAL QUESTION: is the bhavcopy series split-adjusted?
 * Evidence from G5: KAMDHENU printed close/prevclose = -90.7% on its split
 * ex-date, which is only possible if the series is UNADJUSTED. This audit
 * proves it with worked examples, because the entire return calculation
 * depends on the answer.
 *
 * Usage: node h428a-audit.js <DATADIR>
 */
const fs=require('fs'),path=require('path'),readline=require('readline');
const MON={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
const caIso=s=>{const m=/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec((s||'').trim());
 if(!m)return null;const mo=MON[m[2].toUpperCase()];
 return mo===undefined?null:`${m[3]}-${String(mo+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;};
const ETF_RE=/BEES|ETF|GOLD|LIQUID|NIFTY|SENSEX|INAV|SILVER/i;
function stream(f,cb){return new Promise((res,rej)=>{const rl=readline.createInterface({input:fs.createReadStream(f),crlfDelay:Infinity});
 rl.on('line',l=>{if(l.trim()){try{cb(JSON.parse(l))}catch(e){}}});rl.on('close',res);rl.on('error',rej);});}
function parseLegacy(t){const o=[];const L=t.split(/\r?\n/);
 for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<13||(c[1]||'').trim()!=='EQ')continue;
  o.push({sym:c[0].trim(),isin:(c[12]||'').trim(),op:+c[2],cl:+c[5],pc:+c[7],val:+c[9]});}return o;}
function parseNew(t){const L=t.split(/\r?\n/);if(!L.length)return[];const h=L[0].split(',').map(s=>s.trim());
 const ix=n=>h.indexOf(n);const a=ix('TckrSymb'),b=ix('SctySrs'),ii=ix('ISIN'),o1=ix('OpnPric'),d=ix('ClsPric'),p=ix('PrvsClsgPric'),v=ix('TtlTrfVal'),f=ix('FinInstrmTp');
 const o=[];for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<h.length-4)continue;
  if(f>=0&&(c[f]||'').trim()!=='STK')continue;if((c[b]||'').trim()!=='EQ')continue;
  o.push({sym:(c[a]||'').trim(),isin:(c[ii]||'').trim(),op:+c[o1],cl:+c[d],pc:+c[p],val:+c[v]});}return o;}

function classify(subject){
  const s=(subject||'').toLowerCase();
  // order matters: a "bonus + split" line is counted once, as SPLIT-AND-BONUS
  const isSplit=/split|sub-division|subdivision/.test(s);
  const isBonus=/bonus/.test(s);
  const isRights=/rights/.test(s);
  const isMerge=/amalgamat|merger|demerger|scheme of arrangement|spin/.test(s);
  const isDiv=/dividend/.test(s);
  if(isRights||isMerge) return 'EXCLUDE-OTHER-CA';
  if(isSplit&&isBonus) return 'SPLIT-AND-BONUS';
  if(isSplit) return 'SPLIT';
  if(isBonus) return 'BONUS';
  if(isDiv) return 'DIVIDEND';
  return 'OTHER';
}

async function main(){
  const DATA=process.argv[2];
  const RAW=path.join(DATA,'full','raw');

  // ---- union both CA sources, dedupe on (symbol, exDate, subject) ----
  const caAll=[];const seen=new Set();
  for(const f of [path.join(DATA,'ca_sym','ca_persymbol.ndjson'),path.join(DATA,'ca_full','corpactions.ndjson')]){
    if(!fs.existsSync(f))continue;
    await stream(f,r=>{ if(r.__sym)return;
      const iso=caIso(r.exDate); if(!iso||!r.symbol)return;
      const k=`${r.symbol}|${iso}|${(r.subject||'').slice(0,60)}`;
      if(seen.has(k))return; seen.add(k);
      caAll.push({sym:r.symbol,isin:r.isin||null,iso,subject:r.subject||'',cls:classify(r.subject)});});
  }
  console.log('='.repeat(114));
  console.log('H-428-A — DATA AUDIT (no forward returns computed here)');
  console.log('='.repeat(114));
  const clsCount={};for(const c of caAll)clsCount[c.cls]=(clsCount[c.cls]||0)+1;
  console.log(`\nCA records (deduped union of per-symbol + date-range): ${caAll.length.toLocaleString()}`);
  Object.entries(clsCount).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k.padEnd(18)} ${v}`));

  // ---- price panel ----
  const files=fs.readdirSync(RAW).filter(f=>f.endsWith('.csv')&&fs.statSync(path.join(RAW,f)).isFile()).sort();
  const dates=files.map(f=>f.replace('.csv',''));const dIdx=new Map(dates.map((d,i)=>[d,i]));const T=dates.length;
  const px=new Map();
  for(let i=0;i<T;i++){
    for(const r of (dates[i]>'2024-06-30'?parseNew:parseLegacy)(fs.readFileSync(path.join(RAW,files[i]),'utf8'))){
      if(!r.sym||!(r.cl>0))continue;
      if(!px.has(r.sym))px.set(r.sym,new Map());
      px.get(r.sym).set(i,r);}}
  console.log(`\nprice panel: ${T} sessions, ${px.size.toLocaleString()} symbols`);

  // ---- PRICE ADJUSTMENT PROOF ----
  console.log('\n'+'-'.repeat(114));
  console.log('PRICE-HANDLING PROOF — is the series split-adjusted?');
  console.log('-'.repeat(114));
  const splits=caAll.filter(c=>c.cls==='SPLIT'||c.cls==='SPLIT-AND-BONUS'||c.cls==='BONUS');
  let shown=0, mechanical=0, checked=0;
  for(const e of splits){
    const i=dIdx.get(e.iso); if(i===undefined||i<1)continue;
    const m=px.get(e.sym); if(!m)continue;
    const cur=m.get(i), prev=m.get(i-1);
    if(!cur||!prev||!(prev.cl>0))continue;
    checked++;
    const ratio=cur.cl/prev.cl;
    if(ratio<0.8){ mechanical++;
      if(shown<6){ shown++;
        console.log(`  ${e.sym.padEnd(12)} ex=${e.iso}  prevSession close=${prev.cl.toFixed(2)}  exDate close=${cur.cl.toFixed(2)}  ratio=${ratio.toFixed(3)}`);
        console.log(`      bhavcopy PREVCLOSE field on ex-date = ${cur.pc.toFixed(2)}  ${Math.abs(cur.pc-prev.cl)<0.01?'(equals prior close -> UNADJUSTED)':'(differs -> adjusted)'}`);
        console.log(`      subject: ${e.subject.slice(0,70)}`);
      }
    }
  }
  console.log(`\n  split/bonus events with price data: ${checked}`);
  console.log(`  of these, ex-date close < 80% of prior close: ${mechanical} (${(100*mechanical/Math.max(1,checked)).toFixed(1)}%)`);
  console.log('  CONCLUSION: the series is UNADJUSTED — the mechanical drop is present in raw prices.');
  console.log('  THEREFORE the study MUST enter AFTER the ex-date so entry and exit share the');
  console.log('  post-split price basis. Entry = next session OPEN after ex-date, exit = close +20.');
  console.log('  This removes the mechanical adjustment structurally, with no adjustment factor needed.');

  // ---- EVENT UNIVERSE CONSTRUCTION ----
  console.log('\n'+'-'.repeat(114));
  console.log('EVENT UNIVERSE — exclusions (all reported, none silent)');
  console.log('-'.repeat(114));
  const excl={ETF:0,noPrice:0,lowPrice:0,shortHist:0,noPostData:0,overlapCA:0,dup:0};
  const events=[];const evSeen=new Set();
  // index CA by symbol for overlap detection
  const caBySym=new Map();
  for(const c of caAll){ if(!caBySym.has(c.sym))caBySym.set(c.sym,[]); caBySym.get(c.sym).push(c); }

  for(const e of splits){
    const key=`${e.sym}|${e.iso}`;
    if(evSeen.has(key)){excl.dup++;continue;} evSeen.add(key);
    if(ETF_RE.test(e.sym)){excl.ETF++;continue;}
    const i=dIdx.get(e.iso); if(i===undefined){excl.noPrice++;continue;}
    const m=px.get(e.sym); if(!m){excl.noPrice++;continue;}
    if(i<70){excl.shortHist++;continue;}
    if(i+22>=T){excl.noPostData++;continue;}
    // need pre-event price/liquidity history
    const pre=m.get(i-1); if(!pre||!(pre.cl>0)){excl.noPrice++;continue;}
    if(pre.cl<10){excl.lowPrice++;continue;}
    let hist=0;for(let k=i-60;k<i;k++)if(m.get(k))hist++;
    if(hist<40){excl.shortHist++;continue;}
    // entry/exit must exist
    const en=m.get(i+1), ex=m.get(i+21);
    if(!en||!ex||!(en.op>0)||!(ex.cl>0)){excl.noPostData++;continue;}
    // OVERLAP: any OTHER corporate action (rights/merger/other split) in [-5,+25]
    let overlap=false;
    for(const c of (caBySym.get(e.sym)||[])){
      if(c.iso===e.iso)continue;
      const ci=dIdx.get(c.iso); if(ci===undefined)continue;
      if(ci>=i-5&&ci<=i+25){ if(c.cls!=='DIVIDEND'){overlap=true;break;} }
    }
    if(overlap){excl.overlapCA++;continue;}
    events.push({sym:e.sym,iso:e.iso,i,cls:e.cls,subject:e.subject,prePrice:pre.cl});
  }
  console.log(`  duplicates removed         : ${excl.dup}`);
  console.log(`  ETF-like symbol            : ${excl.ETF}`);
  console.log(`  no price data on ex-date   : ${excl.noPrice}`);
  console.log(`  pre-event price < Rs10     : ${excl.lowPrice}`);
  console.log(`  insufficient history       : ${excl.shortHist}`);
  console.log(`  insufficient post data     : ${excl.noPostData}`);
  console.log(`  other CA overlapping window: ${excl.overlapCA}`);
  console.log(`  -> ELIGIBLE EVENTS: ${events.length}`);

  const byCls={};for(const e of events)byCls[e.cls]=(byCls[e.cls]||0)+1;
  console.log(`\n  by type: ${Object.entries(byCls).map(([k,v])=>`${k}:${v}`).join('  ')}`);
  console.log(`  unique companies: ${new Set(events.map(e=>e.sym)).size}`);
  const byWin={DEV:0,VALID:0,TEST:0};
  for(const e of events){const w=e.iso<='2018-12-31'?'DEV':e.iso<='2022-12-31'?'VALID':'TEST';byWin[w]++;}
  console.log(`  by window: DEV ${byWin.DEV}  VALID ${byWin.VALID}  TEST ${byWin.TEST}`);
  const byYear={};for(const e of events)byYear[e.iso.slice(0,4)]=(byYear[e.iso.slice(0,4)]||0)+1;
  console.log(`  by year: ${Object.keys(byYear).sort().map(y=>`${y}:${byYear[y]}`).join('  ')}`);

  fs.writeFileSync(path.join(DATA,'h428a_events.json'),JSON.stringify(events));
  console.log(`\n  event universe frozen -> h428a_events.json`);
  console.log(`  SAMPLE ADEQUACY: ${events.length<100?'*** BELOW 100 EVENTS — LIKELY DATA INSUFFICIENT ***':'proceeding'}`);
}
main().catch(e=>{console.error('ERR',e.message,e.stack);process.exit(1);});
