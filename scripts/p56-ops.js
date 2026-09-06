/** Ops params: trades/day distribution + daily profit percentiles per instrument. */
const fs=require('fs');const P=5,TREND_N=20;
const FILE=process.argv[2],ENTRY=+process.argv[3],TARGET=+process.argv[4],LOT=+process.argv[5],eEnd=process.argv[6],sqOff=process.argv[7];
const raw=JSON.parse(fs.readFileSync(FILE,'utf8'));
const b5=raw.map(r=>Array.isArray(r)?{d:r[0].slice(0,10),hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]}:{d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c});
const by=new Map();for(const b of b5){const[H,M]=b.hm.split(':').map(Number);const mm=H*60+Math.floor(M/15)*15;const k=b.d+'|'+mm;let g=by.get(k);if(!g){g={d:b.d,mm,hm:String(Math.floor(mm/60)).padStart(2,'0')+':'+String(mm%60).padStart(2,'0'),o:b.o,h:b.h,l:b.l,c:b.c};by.set(k,g);}else{g.h=Math.max(g.h,b.h);g.l=Math.min(g.l,b.l);g.c=b.c;}}
const B=[...by.values()].sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:a.mm-b.mm);
const day5=new Map();for(const b of b5){if(!day5.has(b.d))day5.set(b.d,[]);day5.get(b.d).push(b);}
const isPH=Array(B.length).fill(0),isPL=Array(B.length).fill(0);
for(let j=P;j<B.length-P;j++){let ph=1,pl=1;for(let k=j-P;k<=j+P;k++){if(k===j)continue;if(B[k].h>=B[j].h)ph=0;if(B[k].l<=B[j].l)pl=0;}isPH[j]=ph;isPL[j]=pl;}
const perDay={};let res=null,sup=null;
for(let i=0;i<B.length;i++){const j=i-P;if(j>=0){if(isPH[j])res=B[j].h;if(isPL[j])sup=B[j].l;}
  const b=B[i];if(b.hm<'09:45'||b.hm>eEnd||res==null||sup==null||i<TREND_N)continue;
  const body=b.c-b.o,trend=b.c-B[i-TREND_N].c;let dir=0;if(body>=ENTRY&&b.c>res)dir=1;else if(-body>=ENTRY&&b.c<sup)dir=-1;
  if(!dir||!((dir>0&&trend>0)||(dir<0&&trend<0)))continue;
  const after=(day5.get(b.d)||[]).filter(x=>x.hm>b.hm&&x.hm<=sqOff);if(!after.length)continue;
  let pts=null;for(const x of after){if(dir*((dir>0?x.h:x.l)-b.c)>=TARGET){pts=TARGET;break;}}if(pts==null)pts=dir*(after[after.length-1].c-b.c);
  if(!perDay[b.d])perDay[b.d]=[];perDay[b.d].push(pts);}
const days=Object.keys(perDay);
const counts=days.map(d=>perDay[d].length);
const dailyRs=days.map(d=>Math.round(perDay[d].reduce((a,x)=>a+x,0)*LOT));
const cntDist={};for(const c of counts)cntDist[c]=(cntDist[c]||0)+1;
dailyRs.sort((a,b)=>a-b);
const pc=p=>dailyRs[Math.floor(p*(dailyRs.length-1))];
const name=FILE.split('/').pop().replace('5m.json','').replace('.json','');
console.log('  '+name.toUpperCase()+'  (lot '+LOT+', target '+TARGET+'pts, hold losers to close)');
console.log('    trades/day on active days: '+Object.entries(cntDist).map(([k,v])=>k+'tr:'+(100*v/days.length).toFixed(0)+'%').join('  '));
console.log('    daily Rs (winning-day median +Rs'+pc(0.7)+', typical range Rs'+pc(0.25)+' to Rs'+pc(0.75)+', worst-10% Rs'+pc(0.1)+')');
console.log('    max profit day +Rs'+dailyRs[dailyRs.length-1]+'   worst day Rs'+dailyRs[0]);
