'use strict';

/**
 * Generic MIS fill / stop / target / time-exit. Simulated only.
 */
const { toMin } = require('../orb-backtest/engine');

const ENGINE_VERSION = '1.3.164-pdh-live';
const RISK_FRACTION = 300 / 40000;
const BUY_POWER_MULT = 5;
const DEFAULT_SLIP = 0.0005;

function roundPaise(n) {
  return Math.round(n * 100) / 100;
}

function chargesRs(buyAmt, sellAmt) {
  const brk = (x) => Math.min(20, x * 0.0003);
  const brokerage = brk(buyAmt) + brk(sellAmt);
  const exchange = (buyAmt + sellAmt) * 0.0000297;
  const stt = sellAmt * 0.00025;
  const stamp = buyAmt * 0.00003;
  const sebi = (buyAmt + sellAmt) * 0.000001;
  return roundPaise(brokerage + exchange + stt + stamp + sebi + (brokerage + exchange + sebi) * 0.18);
}

function applySlip(px, side, slip) {
  return side === 'L' ? px * (1 + slip) : px * (1 - slip);
}

function sizeQty({ side, fill, stopPx, capital, maxStocks, sizing, buyPower }) {
  const riskPx = side === 'L' ? fill - stopPx : stopPx - fill;
  if (!(riskPx > 0)) return 0;
  let qty;
  if (sizing === 'equal') {
    qty = Math.max(1, Math.floor(capital / Math.max(1, maxStocks) / fill));
  } else {
    qty = Math.max(1, Math.floor((capital * RISK_FRACTION) / riskPx));
  }
  if (qty * fill > buyPower) return 0;
  return qty;
}

function walkSignal(bars5, signal, cfg) {
  const side = signal.side;
  const slip = cfg.slippage == null ? DEFAULT_SLIP : cfg.slippage;
  const timeExit = cfg.timeExit || '15:15';
  const entryEnd = cfg.entryEnd || '14:30';
  const after = bars5.filter((b) => toMin(b.t) > toMin(signal.signalT) && toMin(b.t) <= toMin(timeExit));
  if (!after.length) return null;
  if (toMin(signal.signalT) > toMin(entryEnd)) return null;

  let fill = null;
  let fillT = null;
  for (const b of after) {
    if (toMin(b.t) > toMin(entryEnd) && !fill) return null;
    const hit = side === 'L' ? b.h >= signal.entryPx : b.l <= signal.entryPx;
    if (!hit) continue;
    const raw = side === 'L' ? (b.o > signal.entryPx ? b.o : signal.entryPx) : b.o < signal.entryPx ? b.o : signal.entryPx;
    fill = applySlip(raw, side, slip);
    fillT = b.t;
    break;
  }
  if (!(fill > 0)) return null;

  const stopPx = signal.stopPx;
  const riskPx = side === 'L' ? fill - stopPx : stopPx - fill;
  if (!(riskPx > 0)) return null;
  const buyPower = cfg.buyPower || cfg.capital * BUY_POWER_MULT;
  const qty = sizeQty({
    side,
    fill,
    stopPx,
    capital: cfg.capital,
    maxStocks: cfg.maxStocksPerDay,
    sizing: cfg.sizing,
    buyPower,
  });
  if (!qty) return null;

  const tgtPx =
    cfg.targetR == null || cfg.targetR === ''
      ? null
      : side === 'L'
        ? fill + riskPx * Number(cfg.targetR)
        : fill - riskPx * Number(cfg.targetR);

  let extreme = fill;
  const rest = after.filter((b) => toMin(b.t) > toMin(fillT));
  for (const b of rest) {
    if (side === 'L') extreme = Math.max(extreme, b.h);
    else extreme = Math.min(extreme, b.l);

    const slHit = side === 'L' ? b.l <= stopPx : b.h >= stopPx;
    const tgtHit = tgtPx != null && (side === 'L' ? b.h >= tgtPx : b.l <= tgtPx);
    if (slHit && tgtHit) {
      return finish(signal, cfg, fill, fillT, qty, stopPx, b.t, 'SL', extreme, tgtPx, riskPx);
    }
    if (slHit) return finish(signal, cfg, fill, fillT, qty, stopPx, b.t, 'SL', extreme, tgtPx, riskPx);
    if (tgtHit) return finish(signal, cfg, fill, fillT, qty, tgtPx, b.t, 'TARGET', extreme, tgtPx, riskPx);
    if (b.t === timeExit) return finish(signal, cfg, fill, fillT, qty, b.c, b.t, 'EOD', extreme, tgtPx, riskPx);
  }
  const last = rest[rest.length - 1] || after[after.length - 1];
  const sessionDone = last && toMin(last.t) >= toMin(timeExit);
  const reason = !sessionDone && cfg.allowOpen ? 'OPEN' : 'EOD';
  return finish(signal, cfg, fill, fillT, qty, last.c, last.t, reason, extreme, tgtPx, riskPx);
}

function finish(signal, cfg, fill, fillT, qty, exitPx, exitT, reason, extreme, tgtPx, riskPx) {
  const side = signal.side;
  const pnl = (exitPx - fill) * qty * (side === 'L' ? 1 : -1);
  const chg = chargesRs(fill * qty, exitPx * qty);
  const fav = side === 'L' ? (extreme - fill) * qty : (fill - extreme) * qty;
  const riskRs = roundPaise(Math.abs(riskPx) * qty);
  const promisedRs = tgtPx != null ? roundPaise(Math.abs(tgtPx - fill) * qty) : 0;
  return {
    symbol: signal.symbol,
    day: signal.day,
    side,
    family: signal.family,
    reason: signal.reason,
    entryT: fillT,
    exitT,
    exitReason: reason,
    entryPx: roundPaise(fill),
    exitPx: roundPaise(exitPx),
    stopPx: roundPaise(signal.stopPx),
    tgtPx: tgtPx != null ? roundPaise(tgtPx) : null,
    qty,
    grossRs: roundPaise(pnl),
    chargesRs: chg,
    netRs: roundPaise(pnl - chg),
    notionalRs: roundPaise(fill * qty),
    maxWentRs: roundPaise(Math.max(0, fav)),
    signalT: signal.signalT,
    rankScore: signal.rankScore,
    allocatedRs: roundPaise(fill * qty),
    riskRs,
    promisedRs,
  };
}

module.exports = {
  ENGINE_VERSION,
  RISK_FRACTION,
  BUY_POWER_MULT,
  walkSignal,
  sizeQty,
  applySlip,
  roundPaise,
};
