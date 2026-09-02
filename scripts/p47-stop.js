/** Does hold-to-close give big losses? Measure win/loss sizes on the recipe,
 *  and test whether a protective stop helps (or gets shaken out on the pullback). */
const fs=require('fs');
const ENTRY=+(process.env.ENTRY||90), BIG=+(process.env.BIG||150), P=5, COST=+(process.env.COST||12), CUT=process.env.CUT||'12:30';
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
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sum=a=>a.reduce((x,y)=>x+y,0);
function run(stopPts){       // stopPts=null => hold to close, else protective stop
  let res=null,sup=null;const T=[];
  for(let i=0;i<B.length;i++){const j=i-P;if(j>=0){if(PH[j])res=B[j].h;if(PL[j])sup=B[j].l;}
    const b=B[i];if(b.hm<'09:45'||b.hm>'14:30')continue;const body=b.c-b.o;let dir=0;
    if(body>=ENTRY&&res!=null&&b.c>res)dir=1;else if(-body>=ENTRY&&sup!=null&&b.c<sup)dir=-1;
    if(!dir||Math.abs(body)<BIG||b.hm>=CUT)continue;
    const entry=b.c;const after=(d5.get(b.d)||[]).filter(x=>x.hm>b.hm&&x.hm<='15:15');if(!after.length)continue;
    let exit=after[after.length-1].c;
    if(stopPts!=null){for(const bar of after){const adv=dir*((dir>0?bar.l:bar.h)-entry);if(adv<=-stopPts){exit=entry-dir*stopPts;break;}}}
    const g=dir*(exit-entry);T.push({net:g-COST,gross:g});
  }
  return T;
}
console.log(`LOSS CHECK  ${FILE.split('/').pop()}  entry>=${ENTRY} big>=${BIG} cost ${COST}\n`);
console.log('  exit                 trades  win%  avgWin  avgLoss  worst   net(total)  net/t');
for(const[lbl,sp]of[['hold to close',null],['stop 1x body',BIG],['stop 0.6x body',Math.round(BIG*0.6)],['stop 0.3x body',Math.round(BIG*0.3)]]){
  const T=run(sp);if(!T.length){console.log('  '+lbl+' none');continue;}
  const w=T.filter(x=>x.net>0),l=T.filter(x=>x.net<=0);
  console.log(`  ${lbl.padEnd(18)} ${String(T.length).padStart(5)}  ${(100*w.length/T.length).toFixed(0)}%  ${mean(w.map(x=>x.net)).toFixed(0).padStart(6)}  ${mean(l.map(x=>x.net)).toFixed(0).padStart(7)}  ${Math.min(...T.map(x=>x.net)).toFixed(0).padStart(6)}  ${sum(T.map(x=>x.net)).toFixed(0).padStart(9)}  ${mean(T.map(x=>x.net)).toFixed(1).padStart(6)}`);
}
