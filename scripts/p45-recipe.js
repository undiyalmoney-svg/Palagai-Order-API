/** Confirm the winning recipe vs the club exit. Entry = big body breakout of S/R.
 *  Compare: (A) club exit; (B) hold-to-close; (C) hold-to-close + big-body + before 12:30. */
const fs=require('fs');
const ENTRY_PTS=+(process.env.ENTRY_PTS||90), CLUB_PTS=+(process.env.CLUB_PTS||12), PIVOT=5, COST=+(process.env.COST_PTS||12);
const BIG=+(process.env.BIG||150), CUT=process.env.CUT||'12:30';
const FILE=process.env.FILE||'research-data/indexintra/banknifty5m.json';
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return a.length<2?0:Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
const sum=a=>a.reduce((x,y)=>x+y,0);
const raw=JSON.parse(fs.readFileSync(FILE,'utf8'));
const b5=raw.map(r=>Array.isArray(r)?{t:r[0],d:r[0].slice(0,10),hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4]}:{t:r.t,d:r.t.slice(0,10),hm:r.t.slice(11,16),o:r.o,h:r.h,l:r.l,c:r.c});
b5.sort((a,b)=>a.t<b.t?-1:1);
function bk(hm){const[H,M]=hm.split(':').map(Number);return H*60+Math.floor(M/15)*15;}
const by15=new Map();for(const b of b5){const k=b.d+'|'+bk(b.hm);let g=by15.get(k);if(!g){const mm=bk(b.hm);g={d:b.d,min:mm,hm:String(Math.floor(mm/60)).padStart(2,'0')+':'+String(mm%60).padStart(2,'0'),o:b.o,h:b.h,l:b.l,c:b.c};by15.set(k,g);}else{g.h=Math.max(g.h,b.h);g.l=Math.min(g.l,b.l);g.c=b.c;}}
const B=[...by15.values()].sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:a.min-b.min);
const d5=new Map();for(const b of b5){if(!d5.has(b.d))d5.set(b.d,[]);d5.get(b.d).push(b);}
const PH=new Array(B.length).fill(false),PL=new Array(B.length).fill(false);
for(let j=PIVOT;j<B.length-PIVOT;j++){let ph=true,pl=true;for(let k=j-PIVOT;k<=j+PIVOT;k++){if(k===j)continue;if(B[k].h>=B[j].h)ph=false;if(B[k].l<=B[j].l)pl=false;}PH[j]=ph;PL[j]=pl;}
function run(mode){
  let res=null,sup=null;const T=[];
  for(let i=0;i<B.length;i++){const j=i-PIVOT;if(j>=0){if(PH[j])res=B[j].h;if(PL[j])sup=B[j].l;}
    const b=B[i];if(b.hm<'09:45'||b.hm>'14:30')continue;const body=b.c-b.o;let dir=0;
    if(body>=ENTRY_PTS&&res!=null&&b.c>res)dir=1;else if(-body>=ENTRY_PTS&&sup!=null&&b.c<sup)dir=-1;
    if(!dir)continue;
    if(mode==='C'&&(Math.abs(body)<BIG||b.hm>=CUT))continue;   // recipe filter
    const entry=b.c;const after=(d5.get(b.d)||[]).filter(x=>x.hm>b.hm&&x.hm<='15:15');if(after.length<1)continue;
    let exit=null;
    if(mode==='A'){for(let k=0;k+2<after.length;k+=3){const s=dir*((after[k].c-after[k].o)+(after[k+1].c-after[k+1].o)+(after[k+2].c-after[k+2].o));if(after[k+2].hm>='15:15')break;if(s<=CLUB_PTS){exit=after[k+2].c;break;}}if(exit==null)exit=after[after.length-1].c;}
    else{exit=after[after.length-1].c;}  // hold to close
    const g=dir*(exit-entry);T.push({d:b.d,net:g-COST,gross:g});
  }
  return T;
}
const seg=(T,lo,hi)=>T.filter(t=>t.d>=lo&&t.d<=hi);
const st=T=>{if(!T.length)return null;const g=sum(T.map(x=>x.gross)),n=sum(T.map(x=>x.net));const by=new Map();for(const t of T)by.set(t.d,(by.get(t.d)||0)+t.net);const dn=[...by.values()];return{n:T.length,gpt:g/T.length,npt:n/T.length,net:n,win:100*T.filter(x=>x.net>0).length/T.length,t:mean(dn)/(sd(dn)/Math.sqrt(dn.length))};};
console.log(`RECIPE CHECK  ${FILE.split('/').pop()}  entry>=${ENTRY_PTS} cost ${COST}pt  (recipe: big>=${BIG}pt, before ${CUT})\n`);
console.log('  exit                         trades  gross/t  net/t   net(ALL)  win%    ALLt   TESTt');
for(const[lbl,m]of[['A club>'+CLUB_PTS,'A'],['B hold-to-close','B'],['C recipe (big+early+hold)','C']]){
  const T=run(m);const ALL=st(T),Z=st(seg(T,'2023-01-01','2099'));
  if(!ALL){console.log('  '+lbl+' none');continue;}
  console.log(`  ${lbl.padEnd(28)} ${String(ALL.n).padStart(5)}  ${ALL.gpt.toFixed(1).padStart(6)}  ${ALL.npt.toFixed(1).padStart(5)}  ${ALL.net.toFixed(0).padStart(8)}  ${ALL.win.toFixed(0)}%  ${ALL.t.toFixed(2).padStart(5)}  ${Z?Z.t.toFixed(2):'-'}`);
}
