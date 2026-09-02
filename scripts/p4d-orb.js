#!/usr/bin/env node
/** PHASE 4.D — ORB + S/R PULLBACK. Spec f2d76428f1626046. Read-only; no broker imports.
 *  TEST (>=2023) PHYSICALLY EXCLUDED at load. */
const fs=require('fs'),path=require('path');
const EF='09:45',ET='14:45',PB=0.0015,SR=0.0030;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const med=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const STAT=100*MIS({entryPrice:1000,exitPrice:1000,quantity:50}).totalRs/50000;  // 0.106
const FULL=STAT+0.20;                                                            // 0.306
const DIR=process.argv[2];
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const s=f.replace('.json','');const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10);
    if(d>='2023-01-01')continue;                      // TEST PHYSICALLY EXCLUDED
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]});}
  S.set(s,bs);
}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
const dPos=new Map(dates.map((d,i)=>[d,i]));
console.log(`symbols ${S.size} · sessions ${dates.length} · ${dates[0]} -> ${dates[dates.length-1]} (TEST excluded)`);
console.log(`hurdles: statutory ${STAT.toFixed(3)}% · full ${FULL.toFixed(3)}%\n`);
const DEVf=d=>d<='2019-12-31', VALf=d=>d>='2020-01-01'&&d<='2022-12-31';
/** causal S/R levels: prior session H/L/C and prior-5-session H/L */
function srLevels(sym,d){
  const i=dPos.get(d); if(i<6)return null;
  const bs=S.get(sym); const out=[];
  const p=bs.get(dates[i-1]); if(!p||!p.length)return null;
  let ph=-1e9,pl=1e9;for(const b of p){ph=Math.max(ph,b.h);pl=Math.min(pl,b.l);}
  out.push(ph,pl,p[p.length-1].c);
  let h5=-1e9,l5=1e9,ok=0;
  for(let k=i-5;k<i;k++){const a=bs.get(dates[k]);if(!a||!a.length)continue;ok++;
    for(const b of a){h5=Math.max(h5,b.h);l5=Math.min(l5,b.l);}}
  if(ok>=3)out.push(h5,l5);
  return out;
}
/** one event per stock/session; returns {j,dir,level,confl} or null */
function orbEvent(arr,orN,sr,mode){
  if(arr.length<orN+6)return null;
  let orH=-1e9,orL=1e9;
  for(let k=0;k<orN;k++){orH=Math.max(orH,arr[k].h);orL=Math.min(orL,arr[k].l);}
  if(!(orH>orL))return null;
  let brk=null;                     // {dir,level,j}
  for(let j=orN;j<arr.length;j++){
    if(!brk){
      if(arr[j].c>orH)brk={dir:1,level:orH,j};
      else if(arr[j].c<orL)brk={dir:-1,level:orL,j};
      if(brk&&mode==='nopull'){
        if(arr[j].hm<EF||arr[j].hm>ET)return null;
        const confl=sr?sr.some(L=>Math.abs(brk.level-L)/brk.level<=SR):false;
        return {j:brk.j,dir:brk.dir,level:brk.level,confl};
      }
      continue;
    }
    // after breakout: look for pullback then confirmation
    if(!brk.pulled){
      const near=Math.abs(arr[j].l-brk.level)/brk.level<=PB || Math.abs(arr[j].h-brk.level)/brk.level<=PB
              || (brk.dir>0&&arr[j].l<=brk.level) || (brk.dir<0&&arr[j].h>=brk.level);
      if(near)brk.pulled=true;
      continue;
    }
    const confirmed=brk.dir>0?arr[j].c>brk.level:arr[j].c<brk.level;
    if(!confirmed)continue;
    if(arr[j].hm<EF||arr[j].hm>ET)return null;
    const confl=sr?sr.some(L=>Math.abs(brk.level-L)/brk.level<=SR):false;
    return {j,dir:brk.dir,level:brk.level,confl};
  }
  return null;
}
function exitPx(arr,j,hz){
  if(hz==='EOD')return arr[arr.length-1].c;
  const e=j+hz; if(e>=arr.length)return null; return arr[e].c;
}
function volBucket(arr,j){
  const r=[];for(let k=Math.max(1,j-20);k<j;k++)r.push((arr[k].c-arr[k-1].c)/arr[k-1].c*100);
  const v=sd(r); if(!(v>0))return null; return {v,vB:v>0.25?2:v>0.15?1:0};
}
const LIB=[
 ['V1',3,'pull',false,+1],['V2',6,'pull',false,+1],
 ['V3',3,'pull',true, +1],['V4',6,'pull',true, +1],
 ['V5',3,'pull',false,-1],['V6',6,'pull',false,-1],
 ['V7',3,'nopull',false,+1],['V8',6,'nopull',false,+1],
];
const HZ=[['30m',6],['60m',12],['EOD','EOD']];
const NT=LIB.length*HZ.length, TCRIT=3.06;
console.log(`tests ${NT} (8 frozen conditions x 3 horizons)  Bonferroni ${(0.05/NT).toFixed(5)} -> |t|>${TCRIT}\n`);
let seed=5054721;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
function run(orN,mode,needConfl,sign,hz){
  const sig=new Map(),ctl=new Map(),longs=[],shorts=[],all=[];
  for(const d of dates){
    const fired=[],pool=[];
    for(const [sym,bs] of S){
      const arr=bs.get(d); if(!arr||arr.length<30)continue;
      for(let j=21;j<arr.length;j++){
        if(arr[j].hm<EF||arr[j].hm>ET)continue;
        const vb=volBucket(arr,j); if(!vb)continue;
        pool.push({sym,arr,j,vB:vb.vB});
      }
      const sr=needConfl?srLevels(sym,d):null;
      if(needConfl&&!sr)continue;
      const ev=orbEvent(arr,orN,sr,mode);
      if(!ev)continue;
      if(needConfl&&!ev.confl)continue;
      if(ev.j+1>=arr.length)continue;
      const fill=arr[ev.j+1].o; if(!(fill>0))continue;
      const px=exitPx(arr,ev.j+1,hz); if(px==null||!(px>0))continue;
      const vb=volBucket(arr,ev.j); if(!vb)continue;
      const dir=sign*ev.dir;
      const r=dir*((px-fill)/fill*100);
      fired.push({sym,dir,r,vB:vb.vB,j:ev.j});
      all.push({d,r,dir});
      (ev.dir>0?longs:shorts).push({d,r:sign*((px-fill)/fill*100)*ev.dir/ev.dir});
    }
    if(!fired.length)continue;
    sig.set(d,fired.map(x=>x.r));
    const cr=[];
    for(const s of fired){
      const cand=pool.filter(p=>p.sym!==s.sym&&p.vB===s.vB&&Math.abs(p.j-s.j)<=3);
      if(!cand.length)continue;
      const p=cand[Math.floor(rnd()*cand.length)];
      if(p.j+1>=p.arr.length)continue;
      const f2=p.arr[p.j+1].o; if(!(f2>0))continue;
      const x2=exitPx(p.arr,p.j+1,hz); if(x2==null||!(x2>0))continue;
      cr.push(s.dir*((x2-f2)/f2*100));
    }
    if(cr.length)ctl.set(d,cr);
  }
  return {sig,ctl,all,longs,shorts};
}
const cl=(m,pr)=>{const v=[];for(const[d,a]of m)if(pr(d))v.push(mean(a));
  const se=v.length>1?sd(v)/Math.sqrt(v.length):NaN;return{n:v.length,mean:mean(v),t:se>0?mean(v)/se:NaN,v};};
const W=(x,y)=>(x.length<10||y.length<10)?NaN:(mean(x)-mean(y))/Math.sqrt(sd(x)**2/x.length+sd(y)**2/y.length);
console.log('cond  OR   mode    arm   hz    | DEV n  diff%     t   | VALID diff%     t   | net(full)  verdict');
console.log('='.repeat(112));
const LED=[];
for(const [id,orN,mode,confl,sign] of LIB){
  for(const [hname,hz] of HZ){
    const {sig,ctl,all}=run(orN,mode,confl,sign,hz);
    const ds=cl(sig,DEVf),dc=cl(ctl,DEVf),vs=cl(sig,VALf),vc=cl(ctl,VALf);
    const tag=`${id.padEnd(5)}OR${String(orN*5).padEnd(3)}${mode==='pull'?'pull ':'nopul'}${confl?'+SR':'   '} ${sign>0?'cont':'fade'} ${hname.padEnd(5)}`;
    if(ds.n<80){console.log(tag+`| too few dates (${ds.n})`);
      LED.push({id,hz:hname,status:'INSUFFICIENT'});continue;}
    const dD=ds.mean-dc.mean, vD=vs.mean-vc.mean;
    const dT=W(ds.v,dc.v), vT=W(vs.v,vc.v);
    const worst=Math.min(dD,vD);
    const netFull=worst-FULL;
    const statPass=Math.abs(dT)>TCRIT&&Math.sign(dD)===Math.sign(vD)&&Math.abs(vT)>1.96;
    const econPass=dD>FULL&&vD>FULL;
    const statutoryPass=dD>STAT&&vD>STAT;
    const verdict=(statPass&&econPass)?'CANDIDATE':(statPass?'stat only':!statutoryPass?'below statutory':'fails stat');
    console.log(tag+`|${String(ds.n).padStart(5)}${dD.toFixed(3).padStart(8)}${(Number.isFinite(dT)?dT.toFixed(2):'-').padStart(7)} |`+
      `${vD.toFixed(3).padStart(10)}${(Number.isFinite(vT)?vT.toFixed(2):'-').padStart(7)} |`+
      `${netFull.toFixed(3).padStart(9)}  ${verdict}`);
    LED.push({id,orN,mode,confl,sign,hz:hname,devN:ds.n,dD,dT,vD,vT,netFull,statPass,econPass,statutoryPass,verdict});
  }
}
console.log('='.repeat(112));
const C=LED.filter(x=>x.statPass&&x.econPass);
console.log(`\nCANDIDATES clearing stat gate AND full economic hurdle: ${C.length}`);
if(!C.length)console.log('  NONE — TEST REMAINS PHYSICALLY EXCLUDED.');
const so=LED.filter(x=>x.statPass&&!x.econPass);
console.log(`statistically significant but economically insufficient: ${so.length}`);
for(const s of so.slice(0,10))console.log(`  ${s.id} ${s.hz}: DEV ${s.dD.toFixed(3)}% t=${s.dT.toFixed(2)} · VALID ${s.vD.toFixed(3)}% t=${s.vT.toFixed(2)} · needs ${FULL.toFixed(3)}%`);
const best=LED.filter(x=>Number.isFinite(x.dT)).sort((a,b)=>Math.min(b.dD,b.vD)-Math.min(a.dD,a.vD))[0];
if(best)console.log(`\nlargest control-adjusted edge (worst of DEV/VALID): ${best.id} ${best.hz} = ${Math.min(best.dD,best.vD).toFixed(3)}%  (statutory ${STAT.toFixed(3)}%, full ${FULL.toFixed(3)}%)`);
// pullback incremental value: V1/V2 vs V7/V8
console.log('\nDOES THE PULLBACK ADD ANYTHING? (pullback vs no-pullback baseline, same OR, same horizon)');
for(const hz of ['30m','60m','EOD']){
  const a=LED.find(x=>x.id==='V1'&&x.hz===hz),b=LED.find(x=>x.id==='V7'&&x.hz===hz);
  const c=LED.find(x=>x.id==='V2'&&x.hz===hz),e=LED.find(x=>x.id==='V8'&&x.hz===hz);
  if(a&&b)console.log(`  OR15 ${hz.padEnd(4)} pullback DEV ${a.dD.toFixed(3)} / VALID ${a.vD.toFixed(3)}   vs   no-pullback DEV ${b.dD.toFixed(3)} / VALID ${b.vD.toFixed(3)}`);
  if(c&&e)console.log(`  OR30 ${hz.padEnd(4)} pullback DEV ${c.dD.toFixed(3)} / VALID ${c.vD.toFixed(3)}   vs   no-pullback DEV ${e.dD.toFixed(3)} / VALID ${e.vD.toFixed(3)}`);
}
fs.writeFileSync('/tmp/p4d_ledger.json',JSON.stringify(LED,null,1));
