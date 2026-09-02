/** Research-local historical fetcher that requests oi=1.
 *  Deliberately separate from live/kite-market.js: production code is NOT modified. */
const axios=require('axios');
async function fetchOI(auth,token,from,to,interval='5minute'){
  const r=await axios.get(`https://api.kite.trade/instruments/historical/${token}/${interval}`,
    {headers:{Authorization:auth,'X-Kite-Version':'3'},
     params:{from,to,oi:1},validateStatus:()=>true,timeout:60000});
  if(r.status>=400||r.data?.status==='error')throw new Error(r.data?.message||('HTTP '+r.status));
  return (r.data?.data?.candles||[]).map(c=>({date:String(c[0]),o:+c[1],h:+c[2],l:+c[3],c:+c[4],
    v:+c[5]||0,oi:c.length>6?+c[6]:null}));
}
async function nfoInstruments(auth){
  const r=await axios.get('https://api.kite.trade/instruments/NFO',
    {headers:{Authorization:auth,'X-Kite-Version':'3'},responseType:'text',timeout:120000});
  const L=r.data.split('\n');const h=L[0].split(',');
  const ix=n=>h.indexOf(n);
  const iT=ix('instrument_token'),iS=ix('tradingsymbol'),iN=ix('name'),iE=ix('expiry'),
        iI=ix('instrument_type'),iL=ix('lot_size');
  const out=[];
  for(let i=1;i<L.length;i++){const c=L[i].split(',');if(c.length<6)continue;
    const dq=v=>String(v||'').replace(/^"|"$/g,'').trim();
    out.push({tok:c[iT],sym:dq(c[iS]),name:dq(c[iN]),exp:dq(c[iE]),type:dq(c[iI]),lot:+c[iL]});}
  return out;
}
module.exports={fetchOI,nfoInstruments};
