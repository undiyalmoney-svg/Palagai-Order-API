'use strict';
/**
 * S/R box geometry — the same wall Paper and Live trade, drawn as:
 *   wall line, pink (against the break), teal (measured continuation).
 * Not a UI fake: runSrBreakout attaches this object to every trade.
 */

function round2(x) {
  return Math.round((Number(x) || 0) * 100) / 100;
}

function hhmm(d) {
  return String(d).slice(11, 16);
}

function ymd(d) {
  return String(d).slice(0, 10);
}

/**
 * @param {object} args
 * @param {1|-1} args.dir
 * @param {number} args.level broken wall
 * @param {number} args.wallHi
 * @param {number} args.wallLo
 * @param {number} [args.breakLow] 15m breakout low
 * @param {number} [args.breakHigh] 15m breakout high
 */
function structureOf(args) {
  const dir = args.dir > 0 ? 1 : -1;
  const wall = Number(args.level);
  const wallHi = Number(args.wallHi);
  const wallLo = Number(args.wallLo);
  if (!Number.isFinite(wall) || !Number.isFinite(wallHi) || !Number.isFinite(wallLo)) return null;
  const breakLow = Number(args.breakLow);
  const breakHigh = Number(args.breakHigh);
  const adverse = dir > 0
    ? Math.min(wallLo, Number.isFinite(breakLow) ? breakLow : wallLo)
    : Math.max(wallHi, Number.isFinite(breakHigh) ? breakHigh : wallHi);
  const height = dir > 0 ? wall - adverse : adverse - wall;
  if (!(height > 0) || !Number.isFinite(adverse)) return null;
  const measured = wall + dir * height;
  const entryHm = args.entryTime || null;
  const exitHm = args.exitTime || null;
  const breakoutTime = args.breakoutTime || entryHm;
  const confirmHm = args.confirmationTime || args.retestTime || null;
  const breakoutPrice = Number.isFinite(Number(args.breakoutPrice))
    ? round2(args.breakoutPrice)
    : round2(args.entryPrice);
  const confirmPrice = Number.isFinite(Number(args.confirmationPrice))
    ? round2(args.confirmationPrice)
    : round2(args.entryPrice);
  return {
    wall: round2(wall),
    wallHi: round2(wallHi),
    wallLo: round2(wallLo),
    support: round2(wallLo),
    resistance: round2(wallHi),
    dir,
    option: args.option || (dir > 0 ? 'CE' : 'PE'),
    height: round2(height),
    adverseExtreme: round2(adverse),
    measuredMove: round2(measured),
    pink: {
      lo: round2(dir > 0 ? adverse : wall),
      hi: round2(dir > 0 ? wall : adverse),
      fromHm: args.lookFromHm || null,
      toHm: entryHm || breakoutTime,
    },
    teal: {
      lo: round2(dir > 0 ? wall : measured),
      hi: round2(dir > 0 ? measured : wall),
      fromHm: entryHm || breakoutTime,
      toHm: exitHm,
    },
    breakout: { hm: breakoutTime, price: breakoutPrice },
    confirm: confirmHm ? { hm: confirmHm, price: confirmPrice } : null,
    entry: { hm: entryHm, price: round2(args.entryPrice) },
    exit: args.openAtFill
      ? null
      : { hm: exitHm, price: round2(args.exitPrice), reason: args.exitReason || null },
  };
}

function compactSessionBars(bars5, day, fromHm = '09:15', toHm = '15:30') {
  return (bars5 || [])
    .filter((b) => ymd(b.date) === day && hhmm(b.date) >= fromHm && hhmm(b.date) <= toHm)
    .map((b) => ({
      t: b.date,
      o: round2(b.open),
      h: round2(b.high),
      l: round2(b.low),
      c: round2(b.close),
    }));
}

function lastYmd(candles) {
  let d = '';
  for (const b of candles || []) {
    const x = ymd(b.date);
    if (x > d) d = x;
  }
  return d || null;
}

function chartPayload(candles, trades, meta = {}) {
  const days = {};
  const list = trades || [];
  const seen = new Set();
  const fromHm = meta.fromHm || '09:15';
  const toHm = meta.toHm || '15:30';
  for (const t of list) {
    const d = t.date || String(t.entryTime || '').slice(0, 10);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    days[d] = compactSessionBars(candles, d, fromHm, toHm);
  }
  const sessionDay = meta.sessionDay || lastYmd(candles);
  if (sessionDay && !days[sessionDay]) {
    days[sessionDay] = compactSessionBars(candles, sessionDay, fromHm, toHm);
  }
  return {
    id: meta.id || null,
    label: meta.label || meta.name || null,
    sessionDay: sessionDay || null,
    days,
  };
}

function tradeChartRow(t) {
  const confirmationTime = t.confirmationTime || t.retestTime || null;
  const confirmationPrice = t.confirmationPrice != null
    ? Number(t.confirmationPrice)
    : (t.level != null ? Number(t.level) : null);
  const wallHi = t.wallHi != null ? Number(t.wallHi) : null;
  const wallLo = t.wallLo != null ? Number(t.wallLo) : null;
  return {
    date: t.date,
    breakoutTime: t.breakoutTime || null,
    breakoutPrice: t.breakoutPrice != null ? Number(t.breakoutPrice) : null,
    confirmationTime,
    confirmationPrice,
    retestTime: t.retestTime || confirmationTime,
    entryTime: t.entryTime,
    entryPrice: t.entryPrice,
    exitTime: t.exitTime,
    exitPrice: t.exitPrice,
    exitReason: t.exitReason,
    openAtFill: !!t.openAtFill,
    side: t.side,
    option: t.option,
    level: t.level,
    wallHi,
    wallLo,
    resistance: wallHi,
    support: wallLo,
    structure: t.structure || null,
  };
}

function hmMark(hm, price, extra) {
  if (!hm || price == null || !Number.isFinite(Number(price))) return null;
  return extra ? { hm, price: Number(price), ...extra } : { hm, price: Number(price) };
}

/** Same book-chart shape for Paper desk and Live status. */
function bookChartPayload(candles, trades, meta = {}) {
  const chart = chartPayload(candles, trades, meta);
  const rows = (trades || []).map(tradeChartRow);
  chart.trades = rows;
  const day = chart.sessionDay;
  const focus = [...rows].reverse().find((t) => t.date === day) || rows[rows.length - 1] || null;
  chart.candles = (day && chart.days[day]) || [];
  chart.resistance = focus ? focus.resistance : null;
  chart.support = focus ? focus.support : null;
  chart.breakout = focus ? hmMark(focus.breakoutTime, focus.breakoutPrice) : null;
  chart.confirmation = focus ? hmMark(focus.confirmationTime, focus.confirmationPrice) : null;
  chart.entry = focus ? hmMark(focus.entryTime, focus.entryPrice, { option: focus.option || null }) : null;
  if (focus && focus.structure && focus.structure.exit == null) {
    chart.exit = null;
  } else {
    chart.exit = focus ? hmMark(focus.exitTime, focus.exitPrice, { reason: focus.exitReason || null }) : null;
  }
  chart.option = focus ? focus.option || null : null;
  return chart;
}

module.exports = {
  structureOf, compactSessionBars, chartPayload, bookChartPayload, tradeChartRow,
  round2, hhmm, ymd,
};
