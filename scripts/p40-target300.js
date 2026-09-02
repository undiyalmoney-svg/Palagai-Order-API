const fs=require('fs'),path=require('path');
const {estimateEquityRoundTripCharges:MIS}=require('../live/equity-charges.js');
const DIR='research-data/midintra',SLIP=0.05,RB=6,RP=2.5,VM=3.0,BR=2.3;
const CAP=30000, LEV=+(process.env.LEV||5), TARGET=300;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const S=new Map();
for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.json'))){const bs=new Map();
  for(const r of JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'))){const d=r[0].slice(0,10);if(!bs.has(d))bs.set(d,[]);
    bs.get(d).push({hm:r[0].slice(11,16),o:r[1],h:r[2],l:r[3],c:r[4],v:r[5]||0});}S.set(f,bs);}
const dates=[...new Set([].concat(...[...S.values()].map(m=>[...m.keys()])))].sort();
function atr(a,i){let t=0,n=0;for(let j=Math.max(1,i-13);j<=i;j++){t+=Math.max(a[j].h-a[j].l,Math.abs(a[j].h-a[j-1].c),Math.abs(a[j].l-a[j-1].c));n++;}return n?t/n:0;}
function sig(a){for(let i=25;i<a.length-1;i++){if(a[i].hm<'10:15'||a[i].hm>'14:30')continue;
  const run=(a[i].c-a[i-RB].c)/a[i-RB].c*100,av=mean(a.slice(i-20,i).map(x=>x.v));if(av<=0)continue;
  const rg=a[i].h-a[i].l;if(rg<=0)continue;const at=atr(a,i);if(at<=0||rg/at<BR||a[i].v/av<VM)continue;
  if(run>=RP&&(a[i].c-a[i].l)/rg<=0.34)return{i,dir:-1,run,at};
  if(run<=-RP&&(a[i].h-a[i].c)/rg<=0.34)return{i,dir:1,run:-run,at};}return null;}
let seed=99;const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const trades=[];
for(const d of dates){let cs=[];
  for(const[,bs]of S){const a=bs.get(d);if(a&&a.length>=45){const s=sig(a);if(s){s.a=a;cs.push(s);}}}
  if(!cs.length)continue;for(let k=cs.length-1;k>0;k--){const j=Math.floor(rnd()*(k+1));[cs[k],cs[j]]=[cs[j],cs[k]];}
  const c=cs[0],a=c.a,e=c.i+1;if(e>=a.length-1)continue;const dir=c.dir;
  const fill=a[e].o*(1+dir*SLIP/100),qty=Math.floor(CAP*LEV/fill);if(qty<1)continue;
  const stopD=2*c.at;let px=null;
  for(let j=e;j<a.length;j++){const b=a[j];const adv=dir*((dir>0?b.l:b.h)-fill);
    if(b.hm>='15:15'){px=b.c;break;}if(adv<=-stopD){px=fill-dir*stopD;break;}if(j===a.length-1)px=b.c;}
  const ex=px*(1-dir*SLIP/100),net=dir*(ex-fill)*qty-MIS({entryPrice:fill,exitPrice:ex,quantity:qty}).totalRs;
  trades.push(net);}
const wins=trades.filter(x=>x>0),hit300=trades.filter(x=>x>=TARGET),loss=trades.filter(x=>x<=0);
console.log('  capital Rs30,000 · '+LEV+'x MIS · notional ~Rs'+(CAP*LEV).toLocaleString('en-IN'));
console.log('  trades over 8.6yrs: '+trades.length+'  (~1 per '+(dates.length/trades.length).toFixed(0)+' days)');
console.log('  trades that made >= Rs300 : '+hit300.length+' ('+(100*hit300.length/trades.length).toFixed(0)+'%)');
console.log('  winning trades           : '+wins.length+' ('+(100*wins.length/trades.length).toFixed(0)+'%)  avg +Rs'+mean(wins).toFixed(0));
console.log('  losing trades            : '+loss.length+' ('+(100*loss.length/trades.length).toFixed(0)+'%)  avg Rs'+mean(loss).toFixed(0));
console.log('  avg per trade            : Rs'+mean(trades).toFixed(0)+'   total Rs'+trades.reduce((a,b)=>a+b,0).toFixed(0));
console.log('  --');
console.log('  reality: a WINNING trade averages Rs'+mean(wins).toFixed(0)+' (clears Rs300), a LOSER averages Rs'+mean(loss).toFixed(0));
console.log('  so ~1 trade/week; when it wins it usually beats Rs300, when it loses it loses ~'+Math.abs(mean(loss)).toFixed(0));
// export per-trade record for the UI
require('fs').writeFileSync('research/paper/target-data.json', JSON.stringify({
  baseCapital: CAP, leverage: LEV, notional: CAP*LEV,
  firstDate: dates[0], lastDate: dates[dates.length-1], sessions: dates.length,
  trades: trades.map(n=>Math.round(n)),
}));
console.log('  exported', trades.length, 'per-trade nets -> research/paper/target-data.json');
