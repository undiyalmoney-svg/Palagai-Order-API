/**
 * STOCK MOMENTUM DESK — Opening Range Breakout (ORB) backtest.
 * Target: ~₹600–700/day net on ₹40,000 capital, intraday equities (MIS).
 *
 * Strategy per liquid NSE stock:
 *  1. Opening Range = 09:15–09:45 high/low (ORH/ORL).
 *  2. Entry 09:50–14:30 when a 5m bar CLOSES above ORH (long) / below ORL (short),
 *     boost volume >= 1.2x OR avg, close-break >= 0.04%, OR width 0.2%–3%, gap < 2%.
 *  3. Trend filter: breakout on the EMA20 side.
 *  4. R = clamp(ORw*0.5, 0.30%, 0.60%). Target = 2R. Time exit 14:50.
 *  5. Desk: 1 open, 15-min cooldown, max 3 trades/day, stop <= -₹450 / lock >= ₹700.
 *  6. Sizing: risk ₹300/trade; notional capped ₹200k (5x MIS).
 *  7. Zerodha intraday charges + 0.05% fill slippage. Data: Yahoo 5m (Kite is IP-blocked locally).
 * Run: node scripts/stock-orb-backtest.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const CACHE = '/tmp/stock-data';
const STOCKS = [
  'RELIANCE', 'TCS', 'INFY', 'ICICIBANK', 'HDFCBANK', 'SBIN', 'ITC',
  'BHARTIARTL', 'BHEL', 'IREDA', 'LICI', 'RVNL', 'JIOFIN',
];

const num = (k, d) => (process.env[k] != null && isFinite(+process.env[k]) ? +process.env[k] : d);
const str = (k, d) => (process.env[k] != null ? String(process.env[k]) : d);
const CFG = {
  orStartHi: '09:45', entryStart: str('ENTRY_START', '09:50'), entryEnd: str('ENTRY_END', '14:30'), timeExit: str('TIME_EXIT', '14:50'),
  breakPct: 0.0004, volMult: 1.2, orMinPct: 0.002, orMaxPct: 0.03, maxGapPct: 0.02,
  rPctFloor: 0.003, rPctCeil: 0.006, rPctFromOr: 0.5,
  targetR: num('TARGET_R', 2.0),
  capital: 40000, riskPerTrade: num('RISK', 300), buyPower: 200000, slippage: 0.0005,
  cooldownMin: num('COOLDOWN', 15), maxTradesDay: num('MAX_TRADES', 3),
  profitLockRs: num('LOCK', 700), lossStopRs: num('LOSS_STOP', -450),
  longOnly: str('LONG_ONLY', '') === '1', shortOnly: str('SHORT_ONLY', '') === '1',
  indexFilter: str('INDEX_FILTER', '1') === '1',
};

const IST = 5 * 3600 + 30 * 60;
function istMin(ts) {
  const d = new Date((ts + IST) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
const dayOf = (ts) => new Date((ts + IST) * 1000).toISOString().slice(0, 10);
function toMin(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
function addMin(hm, m) {
  const t = toMin(hm) + m;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
function roundPaise(n) { return Math.round(n * 100) / 100; }

function chargesRs(buyAmt, sellAmt) {
  const brk = (x) => Math.min(20, x * 0.0003);
  const brokerage = brk(buyAmt) + brk(sellAmt);
  const exchange = (buyAmt + sellAmt) * 0.0000297;
  const stt = sellAmt * 0.00025;
  const stamp = buyAmt * 0.00003;
  const sebi = (buyAmt + sellAmt) * 0.000001;
  return roundPaise(brokerage + exchange + stt + stamp + sebi + (brokerage + exchange + sebi) * 0.18);
}

async function fetchStock(sym) {
  const file = path.join(CACHE, `${sym}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym.startsWith('^') ? sym : `${sym}.NS`}?interval=5m&range=1mo`;
  let res = null;
  for (let i = 0; i < 4 && !res; i += 1) {
    try {
      res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000, validateStatus: () => true });
    } catch { /* retry */ }
    if (!res || res.status !== 200) { res = null; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  if (!res) return null;
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(res.data));
  return res.data;
}

function barsFromYahoo(data) {
  const r = data?.chart?.result?.[0];
  if (!r?.timestamp) return [];
  const q = r.indicators?.quote?.[0];
  const out = [];
  for (let i = 0; i < r.timestamp.length; i += 1) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
    out.push({ t: istMin(r.timestamp[i]), day: dayOf(r.timestamp[i]), o, h, l, c, v: q.volume[i] || 0 });
  }
  return out;
}
function ema(prev, price, n) {
  if (prev == null) return price;
  return price * (2 / (n + 1)) + prev * (1 - 2 / (n + 1));
}

function backtestStock(barsByDay, mk) {
  const trades = [];
  for (const [day, bars] of Object.entries(barsByDay)) {
    if (bars.length < 30) continue;
    const prevClose = bars[0].o === bars[0].c && bars[0].o === bars[0].l && bars[0].o === bars[0].h
      ? bars[0].o : (bars.find((b) => b.h !== b.l)?.o || bars[0].o);
    if (!(prevClose > 0) || Math.abs(bars[0].o - prevClose) / prevClose > CFG.maxGapPct) continue;

    const orr = bars.filter((b) => toMin(b.t) <= toMin(CFG.orStartHi));
    const orh = Math.max(...orr.map((b) => b.h));
    const orl = Math.min(...orr.map((b) => b.l));
    const orW = (orh - orl) / prevClose;
    if (orW < CFG.orMinPct || orW > CFG.orMaxPct) continue;
    const orAvgV = orr.reduce((s, b) => s + b.v, 0) / Math.max(1, orr.length);

    let ema20 = null;
    let position = null;
    const exitTrade = (b, price, reason) => {
      const pnl = (price - position.entryPx) * position.qty * (position.side === 'L' ? 1 : -1);
      const chg = chargesRs(position.entryPx * position.qty, price * position.qty);
      trades.push({
        day, side: position.side, entryT: position.entryT, exitT: b.t, exitReason: reason,
        entryPx: roundPaise(position.entryPx), exitPx: roundPaise(price), qty: position.qty,
        grossRs: roundPaise(pnl), chargesRs: chg, netRs: roundPaise(pnl - chg),
      });
      position = null;
    };

    for (const b of bars) {
      ema20 = ema(ema20, b.c, 20);
      const m = toMin(b.t);

      if (position) {
        let done = false;
        if (position.side === 'L') {
          if (b.l <= position.stopPx) { exitTrade(b, position.stopPx, 'SL'); done = true; }
          else if (b.h >= position.tgtPx) { exitTrade(b, position.tgtPx, 'TARGET'); done = true; }
        } else {
          if (b.h >= position.stopPx) { exitTrade(b, position.stopPx, 'SL'); done = true; }
          else if (b.l <= position.tgtPx) { exitTrade(b, position.tgtPx, 'TARGET'); done = true; }
        }
        if (!done && m >= toMin(CFG.timeExit)) { exitTrade(b, b.c, 'TIME'); }
        continue;
      }
      if (m < toMin(CFG.entryStart) || m > toMin(CFG.entryEnd)) continue;

      const carry = (side) => {
        if (CFG.longOnly && side !== 'L') return;
        if (CFG.shortOnly && side !== 'S') return;
        const levelPx = side === 'L' ? orh : orl;
        if (b.v < orAvgV * CFG.volMult || Math.abs(b.c - levelPx) / b.c < CFG.breakPct) return;
        if (side === 'L' ? b.c <= ema20 : b.c >= ema20) return;
        if (CFG.indexFilter) {
          const mdir = mk?.[day]?.[b.t];
          if (mdir != null && ((side === 'L' && mdir < 0) || (side === 'S' && mdir > 0))) return;
        }
        const rPct = Math.max(CFG.rPctFloor, Math.min(CFG.rPctCeil, orW * CFG.rPctFromOr));
        const riskPx = b.c * rPct;
        const qty = Math.max(1, Math.floor(CFG.riskPerTrade / riskPx));
        if (qty * b.c > CFG.buyPower) return;
        const entryPx = side === 'L' ? b.c * (1 + CFG.slippage) : b.c * (1 - CFG.slippage);
        const stopPx = side === 'L' ? entryPx - riskPx : entryPx + riskPx;
        const tgtPx = side === 'L' ? entryPx + riskPx * CFG.targetR : entryPx - riskPx * CFG.targetR;
        position = { side, entryPx, stopPx, tgtPx, qty, entryT: b.t };
      };
      if (b.c > orh && b.o <= orh) carry('L');
      else if (b.c < orl && b.o >= orl) carry('S');
    }
  }
  return trades;
}
function backtestRev(barsByDay, mk) {
  const trades = [];
  for (const [day, bars] of Object.entries(barsByDay)) {
    if (bars.length < 30) continue;
    const prevClose = bars[0].o === bars[0].c && bars[0].o === bars[0].l && bars[0].o === bars[0].h
      ? bars[0].o : (bars.find((b) => b.h !== b.l)?.o || bars[0].o);
    if (!(prevClose > 0) || Math.abs(bars[0].o - prevClose) / prevClose > CFG.maxGapPct) continue;
    const orr = bars.filter((b) => toMin(b.t) <= toMin(CFG.orStartHi));
    const orh = Math.max(...orr.map((b) => b.h));
    const orl = Math.min(...orr.map((b) => b.l));
    const orW = (orh - orl) / prevClose;
    if (orW < CFG.orMinPct || orW > CFG.orMaxPct) continue;

    let breach = null; // {side, px, spikeHigh/Low, atTime}
    let position = null;
    const exitTrade = (b, price, reason) => {
      const pnl = (price - position.entryPx) * position.qty * (position.side === 'L' ? 1 : -1);
      const chg = chargesRs(position.entryPx * position.qty, price * position.qty);
      trades.push({
        day, side: position.side, entryT: position.entryT, exitT: b.t, exitReason: reason,
        entryPx: roundPaise(position.entryPx), exitPx: roundPaise(price), qty: position.qty,
        grossRs: roundPaise(pnl), chargesRs: chg, netRs: roundPaise(pnl - chg),
      });
      position = null;
    };
    const rPctOf = (px) => Math.max(CFG.rPctFloor, Math.min(CFG.rPctCeil, orW * CFG.rPctFromOr));

    for (const b of bars) {
      const m = toMin(b.t);
      if (position) {
        let done = false;
        if (position.side === 'L') {
          if (b.l <= position.stopPx) { exitTrade(b, position.stopPx, 'SL'); done = true; }
          else if (b.h >= position.tgtPx) { exitTrade(b, position.tgtPx, 'TARGET'); done = true; }
        } else {
          if (b.h >= position.stopPx) { exitTrade(b, position.stopPx, 'SL'); done = true; }
          else if (b.l <= position.tgtPx) { exitTrade(b, position.tgtPx, 'TARGET'); done = true; }
        }
        if (!done && m >= toMin(CFG.timeExit)) { exitTrade(b, b.c, 'TIME'); }
        continue;
      }
      if (m < toMin(CFG.entryStart) || m > toMin(CFG.entryEnd)) continue;

      // track a fresh OOB breach (close beyond the opening range)
      if (!breach) {
        if (b.c > orh) breach = { side: 'S', px: orh, spike: b.h, t0: b.t };
        else if (b.c < orl) breach = { side: 'L', px: orl, spike: b.l, t0: b.t };
        continue;
      }
      // stale breach → drop (real breakout ran away, or too much time passed)
      if (toMin(b.t) - toMin(breach.t0) > 30 || Math.abs(b.c - breach.px) / breach.px > 0.012) {
        breach = null;
        continue;
      }
      // fade the failed breakout: price closes back through the level
      const failedS = breach.side === 'S' && b.c < breach.px;
      const failedL = breach.side === 'L' && b.c > breach.px;
      if (!failedS && !failedL) continue;
      const side = breach.side;
      if (CFG.longOnly && side !== 'L') { breach = null; continue; }
      if (CFG.shortOnly && side !== 'S') { breach = null; continue; }
      if (CFG.indexFilter) {
        const mdir = mk?.[day]?.[b.t];
        if (mdir != null && ((side === 'L' && mdir < 0) || (side === 'S' && mdir > 0))) { breach = null; continue; }
      }
      const rPct = rPctOf(b.c);
      const Rpx = b.c * rPct;
      const entryPx = side === 'L' ? b.c * (1 + CFG.slippage) : b.c * (1 - CFG.slippage);
      // LONG stop below the breakdown spike, SHORT stop above the spike high.
      const stopPx = side === 'L' ? Math.min(entryPx - Rpx, breach.spike) : Math.max(entryPx + Rpx, breach.spike);
      const tgtPx = side === 'L' ? entryPx + Rpx * CFG.targetR : entryPx - Rpx * CFG.targetR;
      const riskPx = Math.abs(entryPx - stopPx);
      if (!(riskPx > 0)) { breach = null; continue; }
      const qty = Math.max(1, Math.floor(CFG.riskPerTrade / riskPx));
      if (qty * entryPx <= CFG.buyPower) {
        position = { side, entryPx, stopPx, tgtPx, qty, entryT: b.t };
      }
      breach = null;
    }
  }
  return trades;
}
function summarize(trades) {
  const wins = trades.filter((t) => t.netRs > 0);
  const losses = trades.filter((t) => t.netRs < 0);
  const net = trades.reduce((s, t) => s + t.netRs, 0);
  return {
    trades: trades.length,
    wins: wins.length,
    winRate: trades.length ? Math.round((wins.length / trades.length) * 100) : 0,
    netRs: Math.round(net),
    avgWin: wins.length ? Math.round(wins.reduce((s, t) => s + t.netRs, 0) / wins.length) : 0,
    avgLoss: losses.length ? Math.round(losses.reduce((s, t) => s + t.netRs, 0) / losses.length) : 0,
  };
}

function runDesk(allTrades) {
  const byDay = {};
  for (const t of allTrades) (byDay[t.day] ||= []).push(t);
  const totalDays = Object.keys(byDay).length;
  const deskTrades = [];
  const days = [];
  for (const [day, list] of Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]))) {
    const dayTrades = [...list].sort((a, b) => a.entryT.localeCompare(b.entryT));
    let deskNet = 0;
    let count = 0;
    let cooldownUntil = '';
    for (const t of dayTrades) {
      if (count >= CFG.maxTradesDay || deskNet <= CFG.lossStopRs || deskNet >= CFG.profitLockRs) break;
      if (cooldownUntil && t.entryT < cooldownUntil) continue;
      deskNet += t.netRs;
      count += 1;
      cooldownUntil = addMin(t.exitT.slice(0, 5), CFG.cooldownMin);
      deskTrades.push(t);
    }
    days.push({ day, trades: count, netRs: Math.round(deskNet) });
  }
  const active = days.filter((d) => d.trades > 0);
  return {
    deskTrades, totalDays,
    days: active,
    avgDay: active.length ? Math.round(active.reduce((s, d) => s + d.netRs, 0) / active.length) : 0,
    greenDays: active.filter((d) => d.netRs > 0).length,
    redDays: active.filter((d) => d.netRs < 0).length,
  };
}

async function main() {
  const stratFn = process.env.STRAT === 'rev' ? backtestRev : backtestStock;
  console.log(`\n=== Stock ${process.env.STRAT === 'rev' ? 'REVERSION (failed-break)' : 'ORB'} Desk — ₹40,000 capital · target ₹${CFG.profitLockRs}/day · TARGET_R=${CFG.targetR} RISK=${CFG.riskPerTrade} IDX=${CFG.indexFilter} ===`);
  const mk = {};
  if (CFG.indexFilter) {
    const rawN = await fetchStock('^NSEI');
    if (rawN) {
      const byD = {};
      for (const b of barsFromYahoo(rawN)) (byD[b.day] ||= []).push(b);
      for (const [day, bs] of Object.entries(byD)) {
        let cumPV = 0, cumV = 0;
        const m = {};
        for (const b of bs) {
          cumPV += b.c * b.v; cumV += b.v;
          const vwap = cumV > 0 ? cumPV / cumV : b.c;
          m[b.t] = b.c > vwap ? 1 : b.c < vwap ? -1 : 0;
        }
        mk[day] = m;
      }
      console.log(`  index filter: ^NSEI loaded (${Object.keys(mk).length} days)`);
    } else {
      console.log('  WARN: ^NSEI not available — running without index filter');
    }
  }
  const all = [];
  for (const sym of STOCKS) {
    const raw = await fetchStock(sym);
    if (!raw) { console.log(`  ${sym.padEnd(12)} no data`); continue; }
    const byDay = {};
    for (const b of barsFromYahoo(raw)) (byDay[b.day] ||= []).push(b);
    const trades = stratFn(byDay, mk);
    trades.forEach((t) => { t.sym = sym; all.push(t); });
    const s = summarize(trades);
    console.log(`  ${sym.padEnd(12)} trades=${String(s.trades).padStart(3)}  win=${String(s.winRate).padStart(3)}%  net=₹${s.netRs}`);
  }
  console.log(`\n--- ALL raw (before desk rules) ---`);
  console.log(summarize(all));

  const d = runDesk(all);
  const s = summarize(d.deskTrades);
  console.log(`\n--- DESK (₹${CFG.riskPerTrade}/trade · 1 open · ${CFG.cooldownMin}min cooldown · max ${CFG.maxTradesDay}/day · lock ₹${CFG.profitLockRs}/stop ₹${CFG.lossStopRs}) ---`);
  console.log(`  sample days     = ${d.totalDays} (${d.days.length} with ≥1 trade)`);
  console.log(`  desk trades     = ${s.trades}`);
  console.log(`  win rate        = ${s.winRate}%  (${s.wins}W / ${s.trades - s.wins}L)`);
  console.log(`  avg win / loss  = ₹${s.avgWin} / ₹${s.avgLoss}`);
  console.log(`  total net       = ₹${s.netRs}`);
  console.log(`  avg net/day     = ₹${d.avgDay} (over ${d.days.length} active days)`);
  console.log(`  green/red/flat  = ${d.greenDays}G / ${d.redDays}R / ${d.days.length - d.greenDays - d.redDays}F`);
  if (d.days.length) {
    const best = d.days.reduce((x, y) => (y.netRs > x.netRs ? y : x));
    const worst = d.days.reduce((x, y) => (y.netRs < x.netRs ? y : x));
    console.log(`  best/worst day  = ₹${best.netRs} (${best.day}) / ₹${worst.netRs} (${worst.day})`);
  }
  console.log(`\n  Desk by day:`);
  d.days.sort((a, b) => a.day.localeCompare(b.day)).forEach((x) => console.log(`    ${x.day}  ${x.trades} trade(s)  ₹${x.netRs}`));

  if (process.env.DUMP === '1') {
    const reasons = {};
    for (const t of all) {
      const r = (reasons[t.exitReason] ||= { n: 0, wn: 0, net: 0 });
      r.n += 1; if (t.netRs > 0) r.wn += 1; r.net += t.netRs;
    }
    console.log(`\n--- EXIT-REASON BREAKDOWN (all ${all.length} raw trades) ---`);
    Object.entries(reasons).forEach(([k, v]) =>
      console.log(`  ${k.padEnd(7)} n=${String(v.n).padStart(3)}  wins=${v.wn}  net=₹${Math.round(v.net)}`));
    const byHour = {};
    for (const t of all) {
      const h = t.entryT.slice(0, 5);
      const r = (byHour[h] ||= { n: 0, wn: 0, net: 0 });
      r.n += 1; if (t.netRs > 0) r.wn += 1; r.net += t.netRs;
    }
    console.log(`\n--- RAW TRADES BY ENTRY TIME ---`);
    Object.entries(byHour).forEach(([k, v]) =>
      console.log(`  ${k}  n=${String(v.n).padStart(3)}  win=${String(v.wn).padStart(2)}  net=₹${Math.round(v.net)}`));
    const tot = all.length;
    console.log(`  avg notional/trade = ₹${Math.round(all.reduce((s, t) => s + t.entryPx * t.qty, 0) / tot).toLocaleString('en-IN')}  (cap ₹${CFG.buyPower.toLocaleString('en-IN')})`);
    console.log(`  avg qty/trade      = ${Math.round(all.reduce((s, t) => s + t.qty, 0) / tot).toLocaleString('en-IN')}   avg entry = ₹${Math.round(all.reduce((s, t) => s + t.entryPx, 0) / tot)}  avg charges = ₹${Math.round(all.reduce((s, t) => s + t.chargesRs, 0) / tot)}`);
    console.log(`  slippage+charges share check: gross avg +₹${Math.round(all.reduce((s, t) => s + t.grossRs, 0) / tot)} → net avg +₹${Math.round(all.reduce((s, t) => s + t.netRs, 0) / tot)}`);
    console.log(`\n--- DESK TRADE LIST (${d.deskTrades.length} trades) ---`);
    console.log(`  DAY          SYMBOL       s  ENTRY  EXIT  WHY    ENTRY_PX  EXIT_PX    QTY   NOTIONAL   CHG      NET`);
    for (const t of d.deskTrades) {
      console.log(
        `  ${t.day}  ${t.sym.padEnd(11)} ${t.side}  ${t.entryT}  ${t.exitT.slice(0, 5)}  ${t.exitReason.padEnd(6)} ${String(t.entryPx).padStart(8)} ${String(t.exitPx).padStart(8)} ${String(t.qty).padStart(6)} ${String(Math.round(t.entryPx * t.qty)).padStart(9)} ${String(Math.round(t.chargesRs)).padStart(5)} ${String(Math.round(t.netRs)).padStart(8)}`,
      );
    }
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });