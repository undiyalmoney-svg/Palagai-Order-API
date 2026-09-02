/** "Leave with decent profits": exit at a profit target T if reached; optional
 *  WIDE stop S (beyond the normal pullback) to cut losers; else close.
 *  Recipe entry: big body breakout of S/R, before CUT. Futures points. */
const fs=require('fs');
const ENTRY=+(process.env.ENTRY||90),BIG=+(process.env.BIG||150),P=5,COST=+(process.env.COST||12),CUT=process.env.CUT||'12:30';
const FILE=process.env.FILE||'research-data/indexintra/banknifty5m.json';
const raw=JSON.parse(fs.readFileSync(FILE,'utf8'));
const b5=raw.map(r=>Array.isArray(r)?{d:r[0].slice(0,10),hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]}:{d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c});
b5.sort((a,b)=>a.d+a.hm<b.d+b.hm?-1:1);
function bk(hm){const[H,M]=hm.split(':').map(Number);return H*60+Math.floor(M/15)*15;}
const by15=new Map();for(const b of b5){const k=b.d+'|'+bk(b.hm);let g=by15.get(k);if(!g){const mm=bk(b.hm);g={d:b.d,min:mm,hm:String(Math.floor(mm/60)).padStart(2,'0')+':'+String(mm%60).padStart(2,'0'),o:b.o,h:b.h,l:b.l,c:b.c};by15.set(k,g);}else{g.h=Math.max(g.h,b.h);g.l=Math.min(g.l,b.l);g.c=b.c;}}
const B=[...by15.values()].sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:a.min-b.min);
const d5=new Map();for(const b of b5){if(!d5.has(b.d))d5.set(b.d,[]);d5.get(b.d).push(b);}
const PH=new Array(B.length).fill(false),PL=new Array(B.length).fill(false);
for(let j=P;j<B.length-P;j++){let ph=true,pl=true;for(let k=j-P;k<=j+P;k++){if(k===j)continue;if(B[k].h>=B[j].h)ph=false;if(B[k].l<=B[j].l)pl=false;}PH[j]=ph;PL[j]=pl;}
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;const sum=a=>a.reduce((x,y)=>x+y,0);
function run(T,Sstop){
  let res=null,sup=null;const R=[];
  for(let i=0;i<B.length;i++){const j=i-P;if(j>=0){if(PH[j])res=B[j].h;if(PL[j])sup=B[j].l;}
    const b=B[i];if(b.hm<'09:45'||b.hm>'14:30')continue;const body=b.c-b.o;let dir=0;
    if(body>=ENTRY&&res!=null&&b.c>res)dir=1;else if(-body>=ENTRY&&sup!=null&&b.c<sup)dir=-1;
    if(!dir||Math.abs(body)<BIG||b.hm>=CUT)continue;
    const entry=b.c;const after=(d5.get(b.d)||[]).filter(x=>x.hm>b.hm&&x.hm<='15:15');if(!after.length)continue;
    let exit=after[after.length-1].c,why='CLOSE';
    for(const bar of after){const fav=dir*((dir>0?bar.h:bar.l)-entry),adv=dir*((dir>0?bar.l:bar.h)-entry);
      if(Sstop&&adv<=-Sstop){exit=entry-dir*Sstop;why='STOP';break;}
      if(fav>=T){exit=entry+dir*T;why='TGT';break;}}
    const g=dir*(exit-entry);R.push({net:g-COST,why});
  }
  return R;
}
const stat=R=>{const w=R.filter(x=>x.net>0);return{n:R.length,net:sum(R.map(x=>x.net)),npt:mean(R.map(x=>x.net)),win:100*w.length/R.length,tgt:100*R.filter(x=>x.why==='TGT').length/R.length};};
console.log(`"DECENT PROFIT" TARGET  ${FILE.split('/').pop()}  entry>=${ENTRY} big>=${BIG} cost ${COST}\n`);
console.log('  target   no stop            + wide stop');
console.log('  T pts    net/t  win%  %hit   net/t  win%');
const WS=BIG*1.5;
for(const T of [BIG,Math.round(BIG*1.5),BIG*2,BIG*3]){
  const a=stat(run(T,null)), b=stat(run(T,WS));
  console.log(`  ${String(T).padStart(4)}    ${a.npt.toFixed(1).padStart(5)}  ${a.win.toFixed(0)}%  ${a.tgt.toFixed(0)}%    ${b.npt.toFixed(1).padStart(5)}  ${b.win.toFixed(0)}%`);
}
console.log(`  (wide stop = ${WS} pts, beyond the normal pullback)`);
