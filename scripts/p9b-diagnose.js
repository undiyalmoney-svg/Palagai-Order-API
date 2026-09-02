#!/usr/bin/env node
/** PHASE 9.B — WHY does the ORB edge invert after 2022? Year-by-year mechanism. */
const fs=require('fs'),path=require('path');
const DIR=process.env.EQDIR, ORB=24;
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const pctl=(a,p)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.floor(p*(s.length-1))];};
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){
  const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){
    const d=r[0].slice(0,10);
    if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]});
  }
  S.set(f.replace('.json',''),bs);
}
const Y={};
for(const [sym,bs] of S){
  for(const [d,a] of bs){
    if(a.length<ORB+12) continue;
    const y=d.slice(0,4);
    let H=-1e9,L=1e9;
    for(let k=0;k<ORB;k++){H=Math.max(H,a[k].h);L=Math.min(L,a[k].l);}
    if(!(H>L)) continue;
    const W=H-L;
    let bi=null,dir=0;
    for(let j=ORB;j<a.length-2;j++){
      if(a[j].hm>='14:45')break;
      if(a[j].c>H){bi=j;dir=+1;break;}
      if(a[j].c<L){bi=j;dir=-1;break;}
    }
    if(bi==null){ (Y[y]=Y[y]||{n:0,nb:0,mfe:[],mae:[],ret:[],L:[],Sh:[],orw:[]}).nb++; continue; }
    const e=bi+1; if(e>=a.length-1) continue;
    const entry=a[e].o; if(!(entry>0)) continue;
    let mfe=0,mae=0,ei=a.length-1;
    for(let j=e;j<a.length;j++){
      if(a[j].hm>='15:15'){ei=j;break;}
      mfe=Math.max(mfe,dir*((dir>0?a[j].h:a[j].l)-entry));
      mae=Math.min(mae,dir*((dir>0?a[j].l:a[j].h)-entry));
      ei=j;
    }
    const r=100*dir*(a[ei].c-entry)/entry;
    const o=(Y[y]=Y[y]||{n:0,nb:0,mfe:[],mae:[],ret:[],L:[],Sh:[],orw:[]});
    o.n++; o.mfe.push(mfe/W); o.mae.push(-mae/W); o.ret.push(r);
    o.orw.push(100*W/entry);
    (dir>0?o.L:o.Sh).push(r);
  }
}
console.log('PHASE 9.B - WHAT CHANGED?  ORB 120min, held to 15:15, no stop, no costs\n');
console.log('  year   breakouts  no-brk%   medMFE  medMAE  MFE/MAE   grossRet%   LONG%    SHORT%   ORwidth%');
for(const y of Object.keys(Y).sort()){
  const o=Y[y]; if(o.n<200) continue;
  const mf=pctl(o.mfe,.5), ma=pctl(o.mae,.5);
  console.log(`  ${y}   ${String(o.n).padStart(7)}   ${(100*o.nb/(o.n+o.nb)).toFixed(0).padStart(5)}%   ${mf.toFixed(3)}   ${ma.toFixed(3)}   ${(mf/ma).toFixed(3).padStart(6)}   ${mean(o.ret).toFixed(4).padStart(8)}  ${mean(o.L).toFixed(4).padStart(8)} ${mean(o.Sh).toFixed(4).padStart(8)}   ${pctl(o.orw,.5).toFixed(3)}`);
}
console.log('\n  cost to beat at Rs250k notional (5x leverage on Rs50k): 0.0541%');
console.log('  cost to beat at Rs10k notional:                          0.1061%');
