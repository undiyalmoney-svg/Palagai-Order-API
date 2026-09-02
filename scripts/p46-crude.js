/** Recipe test on CRUDE OIL MINI (MCX). Session 09:00-23:25; hold-to-close =
 *  hold to last bar of day. entry>=ENTRY breaking pivot S/R; recipe filter
 *  big body>=BIG (+ optional entry cutoff). Compare club exit vs hold-to-close. */
const fs=require('fs');
const ENTRY=+(process.env.ENTRY||27), BIG=+(process.env.BIG||38), CLUB=+(process.env.CLUB||12), PIVOT=5, COST=+(process.env.COST||5);
const ENTRY_END=process.env.ENTRY_END||'22:00';
const raw=JSON.parse(fs.readFileSync('research-data/indexintra/crudemini5m.json','utf8'));
const b5=raw.map(r=>({t:r[0],d:r[0].slice(0,10),hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]}));
b5.sort((a,b)=>a.t<b.t?-1:1);
function bk(hm){const[H,M]=hm.split(':').map(Number);return H*60+Math.floor(M/15)*15;}
const by15=new Map();for(const b of b5){const k=b.d+'|'+bk(b.hm);let g=by15.get(k);if(!g){const mm=bk(b.hm);g={d:b.d,min:mm,hm:String(Math.floor(mm/60)).padStart(2,'0')+':'+String(mm%60).padStart(2,'0'),o:b.o,h:b.h,l:b.l,c:b.c};by15.set(k,g);}else{g.h=Math.max(g.h,b.h);g.l=Math.min(g.l,b.l);g.c=b.c;}}
const B=[...by15.values()].sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:a.min-b.min);
const d5=new Map();for(const b of b5){if(!d5.has(b.d))d5.set(b.d,[]);d5.get(b.d).push(b);}
const PH=new Array(B.length).fill(false),PL=new Array(B.length).fill(false);
for(let j=PIVOT;j<B.length-PIVOT;j++){let ph=true,pl=true;for(let k=j-PIVOT;k<=j+PIVOT;k++){if(k===j)continue;if(B[k].h>=B[j].h)ph=false;if(B[k].l<=B[j].l)pl=false;}PH[j]=ph;PL[j]=pl;}
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sum=a=>a.reduce((x,y)=>x+y,0);
function run(mode){
  let res=null,sup=null;const T=[];
  for(let i=0;i<B.length;i++){const j=i-PIVOT;if(j>=0){if(PH[j])res=B[j].h;if(PL[j])sup=B[j].l;}
    const b=B[i];if(b.hm<'09:30'||b.hm>ENTRY_END)continue;const body=b.c-b.o;let dir=0;
    if(body>=ENTRY&&res!=null&&b.c>res)dir=1;else if(-body>=ENTRY&&sup!=null&&b.c<sup)dir=-1;
    if(!dir)continue;
    if(mode==='C'&&Math.abs(body)<BIG)continue;
    const entry=b.c;const after=(d5.get(b.d)||[]).filter(x=>x.hm>b.hm);if(after.length<1)continue;
    let exit;
    if(mode==='A'){exit=null;for(let k=0;k+2<after.length;k+=3){const s=dir*((after[k].c-after[k].o)+(after[k+1].c-after[k+1].o)+(after[k+2].c-after[k+2].o));if(s<=CLUB){exit=after[k+2].c;break;}}if(exit==null)exit=after[after.length-1].c;}
    else exit=after[after.length-1].c;
    const g=dir*(exit-entry);T.push({net:g-COST,gross:g});
  }
  return T;
}
console.log(`CRUDE OIL MINI recipe test  (entry>=${ENTRY} big>=${BIG} cost ${COST}/barrel, 89 days May-Sep 2026)\n`);
console.log('  exit                        trades  gross/t  net/t   net(total)  win%');
for(const[lbl,m]of[['A club>'+CLUB,'A'],['B hold-to-close','B'],['C recipe (big+hold)','C']]){
  const T=run(m);if(!T.length){console.log('  '+lbl+' none');continue;}
  const g=mean(T.map(x=>x.gross)),n=mean(T.map(x=>x.net)),tot=sum(T.map(x=>x.net)),w=100*T.filter(x=>x.net>0).length/T.length;
  console.log(`  ${lbl.padEnd(26)} ${String(T.length).padStart(5)}  ${g.toFixed(1).padStart(6)}  ${n.toFixed(1).padStart(5)}  ${tot.toFixed(0).padStart(9)}  ${w.toFixed(0)}%`);
}
