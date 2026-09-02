#!/usr/bin/env node
/** Fetch 5-min intraday history for the mid-cap universe. Resumable, rate-limited.
 *  READ-ONLY w.r.t. broker state: only /instruments and /historical GETs. */
const https=require('https'),fs=require('fs'),path=require('path');
const KAPI=process.env.KAPI, KTOK=process.env.KTOK;
const OUT='research-data/midintra';
const FROM=process.env.FROM||'2018-01-01', TO=process.env.TO||'2026-08-28';
const AUTH={'X-Kite-Version':'3','Authorization':`token ${KAPI}:${KTOK}`};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function get(p,raw){return new Promise((res,rej)=>{
  https.get({hostname:'api.kite.trade',path:p,headers:AUTH},r=>{
    let b='';r.on('data',c=>b+=c);r.on('end',()=>{
      if(raw)return res(b);
      try{res(JSON.parse(b));}catch(e){rej(new Error('bad json '+b.slice(0,120)));}
    });}).on('error',rej);});}
const addD=(d,n)=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
(async()=>{
  const syms=JSON.parse(fs.readFileSync('research-data/midcap-universe.json','utf8'));
  console.log('universe: '+syms.length+' symbols   window '+FROM+' .. '+TO);
  // instrument tokens
  let dump=fs.existsSync(OUT+'/_instruments.csv')?fs.readFileSync(OUT+'/_instruments.csv','utf8')
          :await get('/instruments/NSE',true);
  fs.writeFileSync(OUT+'/_instruments.csv',dump);
  const tok=new Map();
  for(const line of dump.split('\n').slice(1)){
    const p=line.split(',');
    if(p.length<12) continue;
    const ts=(p[2]||'').replace(/"/g,''), seg=(p[11]||'').replace(/"/g,'');
    if(seg==='NSE') tok.set(ts,(p[0]||'').replace(/"/g,''));
  }
  console.log('instrument tokens loaded: '+tok.size);
  const missing=syms.filter(s=>!tok.has(s));
  if(missing.length) console.log('NO TOKEN for: '+missing.join(' '));
  let done=0,skipped=0,failed=[];
  for(const sym of syms){
    const f=OUT+'/'+sym+'.json';
    if(fs.existsSync(f)){ skipped++; continue; }
    const it=tok.get(sym); if(!it){ failed.push(sym+':notoken'); continue; }
    const bars=[];
    let cur=FROM, err=null;
    while(cur<=TO){
      const end=addD(cur,99)>TO?TO:addD(cur,99);
      let ok=false;
      for(let attempt=0;attempt<4&&!ok;attempt++){
        try{
          const j=await get(`/instruments/historical/${it}/5minute?from=${cur}&to=${end}`);
          if(j.status==='success'){ for(const c of j.data.candles) bars.push(c); ok=true; }
          else if(/too many|rate/i.test(j.message||'')){ await sleep(1500); }
          else { err=j.message; ok=true; }
        }catch(e){ await sleep(1200); }
        await sleep(360);
      }
      if(!ok){ err=err||'retries exhausted'; break; }
      cur=addD(end,1);
    }
    if(bars.length){
      fs.writeFileSync(f,JSON.stringify(bars));
      done++;
      console.log(`  ${sym.padEnd(13)} ${String(bars.length).padStart(7)} bars  ${bars[0][0].slice(0,10)} -> ${bars[bars.length-1][0].slice(0,10)}`);
    } else { failed.push(sym+':'+(err||'nodata')); console.log(`  ${sym.padEnd(13)} FAILED ${err||''}`); }
  }
  console.log(`\nfetched ${done}, already had ${skipped}, failed ${failed.length}`);
  if(failed.length) console.log('failed: '+failed.join('  '));
})();
