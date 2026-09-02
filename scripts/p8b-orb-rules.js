#!/usr/bin/env node
/** PHASE 8.B — ORB entry/exit rules DERIVED from 8.A diagnostics.
 *  PRE-REGISTERED: OR in {60,90,120} min x 5 exits = 15 cells.
 *  Selection on DEV (<=2019) ONLY. VALID (2020-22) and TEST (>=2023) reported
 *  but NOT used to choose. Rs10,000 x 5 positions, MIS charges, slippage param. */
const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR=process.env.EQDIR, SLIP=+(process.env.SLIP??0.02), PER=+(process.env.PER??10000), MAXPOS=+(process.env.MAXPOS??5);
const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
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
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
function run(ORB,EXIT){
  const T=[];
  for(const d of dates){
    let taken=0;
    for(const [sym,bs] of S){
      if(taken>=MAXPOS) break;
      const a=bs.get(d); if(!a||a.length<ORB+12) continue;
      let H=-1e9,L=1e9;
      for(let k=0;k<ORB;k++){H=Math.max(H,a[k].h);L=Math.min(L,a[k].l);}
      if(!(H>L)) continue;
      const W=H-L;
      let bi=null,dir=0;
      for(let j=ORB;j<a.length-2;j++){
        if(a[j].hm>='14:45') break;
        if(a[j].c>H){bi=j;dir=+1;break;}
        if(a[j].c<L){bi=j;dir=-1;break;}
      }
      if(bi==null) continue;
      const e=bi+1; if(e>=a.length-1) continue;
      const raw=a[e].o; if(!(raw>0)) continue;
      const fill=raw*(1+dir*SLIP/100);
      const qty=Math.floor(PER/fill); if(qty<1) continue;
      const stopD = EXIT.stop!=null ? EXIT.stop*W : null;
      const tgtD  = EXIT.tgt !=null ? EXIT.tgt *W : null;
      let px=null,why=null,peak=0;
      for(let j=e;j<a.length;j++){
        if(a[j].hm>='15:15'){px=a[j].c;why='TIME';break;}
        const fav=dir*( (dir>0?a[j].h:a[j].l) - fill);
        const adv=dir*( (dir>0?a[j].l:a[j].h) - fill);
        if(stopD!=null && adv<=-stopD){px=fill-dir*stopD;why='STOP';break;}
        if(tgtD !=null && fav>= tgtD ){px=fill+dir*tgtD; why='TGT'; break;}
        peak=Math.max(peak,fav);
        if(EXIT.trail!=null && peak>=EXIT.trail*W && fav<=peak-EXIT.trail*W){px=a[j].c;why='TRAIL';break;}
        if(j===a.length-1){px=a[j].c;why='EOD';}
      }
      if(px==null) continue;
      const ex=px*(1-dir*SLIP/100);
      const gross=dir*(ex-fill)*qty;
      const chg=MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
      T.push({d,sym,gross,chg,net:gross-chg,why,notional:fill*qty});
      taken++;
    }
  }
  return T;
}
const EXITS=[
  {name:'E1 hold-to-close',        stop:null, tgt:null, trail:null},
  {name:'E2 stop1.0W hold',        stop:1.0,  tgt:null, trail:null},
  {name:'E3 stop1.0W tgt2.0W',     stop:1.0,  tgt:2.0,  trail:null},
  {name:'E4 stop1.5W hold',        stop:1.5,  tgt:null, trail:null},
  {name:'E5 trail1.0W',            stop:null, tgt:null, trail:1.0},
];
const seg=(T,lo,hi)=>T.filter(t=>t.d>=lo&&t.d<=hi);
const stat=X=>{ if(!X.length) return null;
  const n=sum(X.map(x=>x.net)); const days=new Map();
  for(const t of X) days.set(t.d,(days.get(t.d)||0)+t.net);
  const dn=[...days.values()];
  return {n,tr:X.length,t:mean(dn)/(sd(dn)/Math.sqrt(dn.length)),
          rate:100*sum(X.map(x=>x.chg))/sum(X.map(x=>x.notional))}; };
console.log(`PHASE 8.B - ORB DERIVED RULES   (slippage ${SLIP}%/side, Rs10k x5, MIS)\n`);
console.log('  OR    exit                 |        DEV (selection)        |       VALID (sealed)       |       TEST (sealed)');
console.log('  min                        |  trades      net      t       |  trades      net      t    |  trades      net      t');
const cells=[];
for(const ORB of [12,18,24]){
  for(const E of EXITS){
    const T=run(ORB,E);
    const D=stat(seg(T,'2000-01-01','2019-12-31'));
    const V=stat(seg(T,'2020-01-01','2022-12-31'));
    const Z=stat(seg(T,'2023-01-01','2099-12-31'));
    if(!D||!V||!Z) continue;
    cells.push({ORB,E,D,V,Z});
    console.log(`  ${String(ORB*5).padStart(3)}   ${E.name.padEnd(20)} | ${String(D.tr).padStart(6)}  ${D.n.toFixed(0).padStart(8)}  ${D.t.toFixed(2).padStart(6)}  | ${String(V.tr).padStart(6)}  ${V.n.toFixed(0).padStart(8)}  ${V.t.toFixed(2).padStart(5)} | ${String(Z.tr).padStart(6)}  ${Z.n.toFixed(0).padStart(8)}  ${Z.t.toFixed(2).padStart(5)}`);
  }
}
const best=cells.reduce((a,b)=>b.D.n>a.D.n?b:a);
console.log(`\n  DEV-SELECTED CELL: OR=${best.ORB*5}min  ${best.E.name}`);
console.log(`    DEV   net Rs${best.D.n.toFixed(0)}  t=${best.D.t.toFixed(2)}`);
console.log(`    VALID net Rs${best.V.n.toFixed(0)}  t=${best.V.t.toFixed(2)}   <- first look`);
console.log(`    TEST  net Rs${best.Z.n.toFixed(0)}  t=${best.Z.t.toFixed(2)}   <- holdout`);
console.log(`    charge rate ${best.D.rate.toFixed(4)}% of notional`);
console.log(`  15 cells -> Bonferroni |t| threshold 2.94`);
