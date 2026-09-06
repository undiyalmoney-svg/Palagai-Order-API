/** PHASE 53 — strategy on REAL option premiums. For each Nifty break-with-trend
 *  signal, resolve the ATM monthly-Sep option (CE bullish / PE bearish), fetch
 *  its real 5-min OHLC from Kite, and simulate the actual premium P&L.
 *  Entry = option close at signal 15-min bar; exit = +TGT premium pts or 15:15.
 *  Env: KAPI, KTOK.  Window Aug 13 - Sep 2 (where monthly-Sep option data exists). */
const https = require('https');
const AUTH = `token ${process.env.KAPI}:${process.env.KTOK}`;
const TGT = +(process.env.TGT || 0);   // premium-point target; 0 = hold to close
const P = 5, TREND_N = 20, LOT = 65;
const getText = p => new Promise((res, rej) => { https.get({ hostname: 'api.kite.trade', path: p, headers: { 'X-Kite-Version': '3', Authorization: AUTH } }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej); });
const getJson = async p => { try { return JSON.parse(await getText(p)); } catch (e) { return { raw: 'parse' }; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // 1. NFO map: strike|type -> token for NIFTY26SEP options
  const csv = await getText('/instruments/NFO');
  const optTok = new Map();
  for (const l of csv.split('\n')) { const q = l.split(','); if (/^NIFTY26SEP\d+(CE|PE)$/.test(q[2])) optTok.set(q[2], q[0]); }
  console.log('  NIFTY26SEP options mapped:', optTok.size);

  // 2. Nifty 5-min + 15-min + pivots
  const nj = await getJson('/instruments/historical/256265/5minute?from=2026-07-25&to=2026-09-03');
  const b5 = nj.data.candles.map(x => ({ d: x[0].slice(0, 10), hm: x[0].slice(11, 16), o: x[1], h: x[2], l: x[3], c: x[4] }));
  const by = new Map();
  for (const b of b5) { const [H, M] = b.hm.split(':').map(Number); const mm = H * 60 + Math.floor(M / 15) * 15; const k = b.d + '|' + mm; let g = by.get(k); if (!g) { g = { d: b.d, mm, hm: String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0'), o: b.o, h: b.h, l: b.l, c: b.c }; by.set(k, g); } else { g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); g.c = b.c; } }
  const B = [...by.values()].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.mm - b.mm);
  const isPH = Array(B.length).fill(0), isPL = Array(B.length).fill(0);
  for (let j = P; j < B.length - P; j++) { let ph = 1, pl = 1; for (let k = j - P; k <= j + P; k++) { if (k === j) continue; if (B[k].h >= B[j].h) ph = 0; if (B[k].l <= B[j].l) pl = 0; } isPH[j] = ph; isPL[j] = pl; }

  // 3. signals: break with-trend, Aug 13 - Sep 2
  const sigs = []; let res = null, sup = null;
  for (let i = 0; i < B.length; i++) {
    const j = i - P; if (j >= 0) { if (isPH[j]) res = B[j].h; if (isPL[j]) sup = B[j].l; }
    const b = B[i];
    if (b.hm < '09:45' || b.hm > '14:30' || res == null || sup == null || i < TREND_N) continue;
    if (b.d < '2026-08-03') continue;
    const body = b.c - b.o, trend = b.c - B[i - TREND_N].c;
    let dir = 0; if (body >= 27 && b.c > res) dir = 1; else if (-body >= 27 && b.c < sup) dir = -1;
    if (!dir) continue; if (process.env.TREND==='1' && !((dir>0&&trend>0)||(dir<0&&trend<0))) continue;
    const strike = Math.round(b.c / 50) * 50;
    const sym = `NIFTY26SEP${strike}${dir > 0 ? 'CE' : 'PE'}`;
    sigs.push({ d: b.d, hm: b.hm, dir, spot: b.c, strike, sym });
  }
  console.log('  break-with-trend signals (Aug 13 - Sep 2):', sigs.length, '\n');

  // 4. fetch each option, simulate real premium P&L
  const cache = new Map();
  let net = 0, wins = 0;
  console.log('  date   time   option              entryPrem  exitPrem  prem-pts    Rs(x65)');
  for (const s of sigs) {
    const tok = optTok.get(s.sym); if (!tok) { console.log('  ' + s.d.slice(5) + ' ' + s.hm + '  ' + s.sym.padEnd(18) + ' no token'); continue; }
    if (!cache.has(tok)) { const oj = await getJson(`/instruments/historical/${tok}/5minute?from=${s.d}&to=${s.d}`); cache.set(tok, oj.data ? oj.data.candles : []); await sleep(300); }
    const oc = cache.get(tok);
    // option candles for the day, at/after signal time
    const after = oc.filter(x => x[0].slice(11, 16) >= s.hm);
    if (after.length < 2) { console.log('  ' + s.d.slice(5) + ' ' + s.hm + '  ' + s.sym.padEnd(18) + ' no option data'); continue; }
    const entry = after[0][4];               // premium at signal bar close
    let exit = after[after.length - 1][4], why = 'CLOSE';
    if (TGT > 0) { for (const x of after) { if (x[2] - entry >= TGT) { exit = entry + TGT; why = 'TGT'; break; } } }  // option high reaches +TGT
    const premPts = exit - entry, rs = Math.round(premPts * LOT);
    net += rs; if (rs > 0) wins++;
    console.log('  ' + s.d.slice(5) + ' ' + s.hm + '  ' + s.sym.padEnd(18) + ' ' + entry.toFixed(1).padStart(8) + '  ' + exit.toFixed(1).padStart(7) + '  ' + premPts.toFixed(1).padStart(7) + '   ' + String(rs).padStart(8) + ' ' + why);
  }
  // weekly breakdown
  function weekKey(d){const dt=new Date(d);const day=(dt.getUTCDay()+6)%7;const mon=new Date(dt);mon.setUTCDate(dt.getUTCDate()-day);return mon.toISOString().slice(5,10);}
  const wk={};
  for(const s of sigs){const tok=optTok.get(s.sym);if(!tok)continue;const oc=cache.get(tok)||[];const after=oc.filter(x=>x[0].slice(11,16)>=s.hm);if(after.length<2)continue;
    const entry=after[0][4];let exit=after[after.length-1][4];if(TGT>0){for(const x of after){if(x[2]-entry>=TGT){exit=entry+TGT;break;}}}
    const rs=Math.round((exit-entry)*LOT);const k='wk '+weekKey(s.d);if(!wk[k])wk[k]={n:0,net:0,w:0};wk[k].n++;wk[k].net+=rs;if(rs>0)wk[k].w++;}
  console.log('\n  WEEK-BY-WEEK (Mon start):');
  for(const k of Object.keys(wk).sort()){const w=wk[k];console.log('    '+k+':  '+w.n+' trades  win '+(100*w.w/w.n).toFixed(0)+'%  net Rs'+w.net+(w.net>=0?'  POSITIVE':'  negative'));}
  const done = sigs.filter(s => optTok.get(s.sym));
  console.log('\n  ===== REAL OPTION P&L: ' + done.length + ' trades | win ' + (done.length ? (100 * wins / done.length).toFixed(0) : 0) + '% | NET Rs' + net + ' (1 lot) =====');
})().catch(e => console.log('  ERR', e.message));
