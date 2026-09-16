'use strict';
/**
 * When Live ran today, Paper Why + ₹ must show the Kite fill Live actually
 * took — not a later engine CLOSE/TIME row priced on 5m option close.
 */
const { optionRupees } = require('./sr-option-pnl');
const { LOT_UNITS } = require('./sr-strategy-config');

const ENGINE_WHY = new Set(['TARGET', 'TIME', 'FAIL', 'STOP', 'LOCK', 'GIVEUP', 'STRUCTURE']);

function clockOf(v) {
  const s = String(v || '');
  const iso = /T(\d{2}:\d{2})/.exec(s);
  if (iso) return iso[1];
  const hm = /^(\d{2}:\d{2})/.exec(s) || /(\d{2}:\d{2})/.exec(s);
  return hm ? hm[1] : '';
}

function hmToMin(hm) {
  const p = String(hm || '').split(':');
  const h = Number(p[0]);
  const m = Number(p[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function bookKey(row) {
  const s = `${row.instrumentId || ''} ${row.instrumentName || ''} ${row.optionSymbol || ''} ${row.tradingSymbol || ''}`.toLowerCase();
  if (s.includes('bank')) return 'bank';
  if (s.includes('crude')) return 'crude';
  if (s.includes('nifty') || s.includes('nifty-50')) return 'nifty';
  const id = String(row.instrumentId || '');
  if (id === 'bank-nifty' || id === 'banknifty') return 'bank';
  if (id === 'nifty-50' || id === 'nifty') return 'nifty';
  return id || 'nifty';
}

function liveWhy(fill, engineRow) {
  const closed = String(fill.closedBy || fill.exitReason || '').toLowerCase();
  if (closed === 'sl' || closed === 'stop') return 'STOP';
  const engine = String(engineRow?.exitReason || '').toUpperCase();
  if (ENGINE_WHY.has(engine)) return engine;
  if (closed === 'exit' || closed === 'flat') return engine || 'GIVEUP';
  const up = String(fill.exitReason || '').toUpperCase();
  if (ENGINE_WHY.has(up)) return up;
  return engine || fill.exitReason || 'flat';
}

function unitsOf(row) {
  const q = Number(row.quantity);
  if (q > 0) return q;
  const lots = Math.max(1, Number(row.lots) || 1);
  const key = bookKey(row);
  const per = key === 'bank' ? LOT_UNITS.banknifty : LOT_UNITS.nifty;
  return per * lots;
}

function liveFillsFromSnap(snap) {
  const broker = snap && snap.broker;
  if (!broker) return [];
  const out = [];
  for (const p of broker.closedLegs || []) {
    if (p && p.status !== 'error') out.push({ ...p, instrumentId: p.instrumentId });
  }
  for (const pair of broker.positions || []) {
    const id = Array.isArray(pair) ? pair[0] : pair?.instrumentId;
    const p = Array.isArray(pair) ? pair[1] : pair;
    if (!p || p.status === 'error') continue;
    if (p.status === 'flat' && out.some((x) => x.tradingSymbol === p.tradingSymbol && x.entryTime === p.entryTime)) {
      continue;
    }
    out.push({ ...p, instrumentId: id || p.instrumentId });
  }
  return out;
}

/**
 * Match a Paper engine row to the Live fill for that book.
 * Late join (11:30 vs 11:20) still maps onto the Paper entry bar.
 */
function matchLiveFill(row, fills, used) {
  const book = bookKey(row);
  const wantHm = clockOf(row.entryTime || row.entryHm);
  const wantMin = hmToMin(wantHm);
  const dir = String(row.direction || row.option || row.sideLabel || '').toUpperCase();
  let best = null;
  let bestScore = Infinity;
  for (const fill of fills) {
    if (used.has(fill)) continue;
    if (bookKey(fill) !== book) continue;
    const kind = String(fill.tradingSymbol || fill.optionSymbol || fill.direction || '').toUpperCase();
    if (/PE/.test(dir) && /CE/.test(kind) && !/PE/.test(kind)) continue;
    if (/CE/.test(dir) && /PE/.test(kind) && !/CE/.test(kind)) continue;
    const fillHm = clockOf(fill.entryTime);
    const fillMin = hmToMin(fillHm);
    let score;
    if (wantMin != null && fillMin != null) {
      if (fillMin + 2 < wantMin) continue;
      score = Math.abs(fillMin - wantMin);
      if (score > 20) continue;
    } else {
      score = 50;
    }
    if (score < bestScore) {
      bestScore = score;
      best = fill;
    }
  }
  return best;
}

function overlayRow(row, fill) {
  const open = fill.status === 'open' || fill.status === 'exiting' || fill.open === true;
  const entry = Number(fill.entryPremium || fill.optionEntryPremium) || 0;
  const exitPx = Number(fill.exitPremium || fill.optionExitPremium) || 0;
  const qty = unitsOf({ ...row, quantity: fill.quantity || row.quantity });
  const why = open ? (fill.slOn ? 'OPEN' : (fill.exitReason && String(fill.exitReason).startsWith('OPEN') ? fill.exitReason : 'OPEN')) : liveWhy(fill, row);
  const gross = !open && entry > 0 && exitPx > 0 ? optionRupees(entry, exitPx, qty, 1) : (fill.optionPnlRs != null ? Number(fill.optionPnlRs) : row.optionPnlRs);
  return {
    ...row,
    liveMatched: true,
    fillSource: 'kite',
    premiumSource: 'kite-fill',
    skipReason: undefined,
    open,
    exitReason: why,
    entryPrice: entry > 0 ? entry : row.entryPrice,
    optionEntryPremium: entry > 0 ? entry : row.optionEntryPremium,
    exitPrice: open
      ? (Number(fill.lastLtp) > 0 ? Number(fill.lastLtp) : row.exitPrice)
      : (exitPx > 0 ? exitPx : row.exitPrice),
    optionExitPremium: exitPx > 0 ? exitPx : row.optionExitPremium,
    optionPnlRs: gross,
    netOptionPnlRs: open ? row.netOptionPnlRs : (fill.netOptionPnlRs != null ? Number(fill.netOptionPnlRs) : gross),
    slTrigger: Number(fill.slTrigger) > 0 ? Number(fill.slTrigger) : row.slTrigger,
    slPrice: Number(fill.slTrigger) > 0 ? Number(fill.slTrigger) : row.slPrice,
    optionSymbol: fill.tradingSymbol || fill.optionSymbol || row.optionSymbol,
    selectedInstrument: fill.tradingSymbol || row.selectedInstrument,
  };
}

function overlayPaperWithLiveFills(trades, fills) {
  const list = Array.isArray(trades) ? trades : [];
  const legs = Array.isArray(fills) ? fills.filter((f) => f && (f.entryPremium > 0 || f.optionEntryPremium > 0 || f.status === 'open' || f.closedBy)) : [];
  if (!legs.length) return list;
  const used = new Set();
  const matchedBooks = new Set();
  const matchedWhy = new Map();
  const out = list.map((row) => {
    const fill = matchLiveFill(row, legs, used);
    if (!fill) return row;
    used.add(fill);
    const next = overlayRow(row, fill);
    const book = bookKey(row);
    matchedBooks.add(book);
    matchedWhy.set(book, `${clockOf(row.entryTime || row.entryHm)} ${next.exitReason}`);
    return next;
  });
  return out.map((row) => {
    if (row.liveMatched) return row;
    const book = bookKey(row);
    if (!matchedBooks.has(book)) return row;
    const prior = matchedWhy.get(book);
    return {
      ...row,
      liveMatched: false,
      open: false,
      optionPnlRs: null,
      netOptionPnlRs: 0,
      skipReason: prior
        ? `Live filled ${prior} — not this later ${row.exitReason || 'CLOSE'} row`
        : 'Live did not fill this Paper row',
    };
  });
}

function overlayDeskBooks(books, trades) {
  const byBook = new Map();
  for (const t of trades || []) {
    const k = bookKey(t);
    if (!byBook.has(k)) byBook.set(k, []);
    byBook.get(k).push(t);
  }
  return (books || []).map((b) => {
    const key = b.id === 'banknifty' || b.id === 'bank-nifty' ? 'bank' : b.id;
    const nextTrades = byBook.get(key);
    if (!nextTrades) return b;
    const copy = { ...b, trades: nextTrades };
    if (copy.chart && Array.isArray(copy.chart.trades)) {
      copy.chart = {
        ...copy.chart,
        trades: copy.chart.trades.map((ct) => {
          const hit = nextTrades.find((t) => clockOf(t.entryTime || t.entryHm) === clockOf(ct.entryTime));
          if (!hit) return ct;
          return { ...ct, exitReason: hit.skipReason || hit.exitReason, open: hit.open };
        }),
      };
    }
    return copy;
  });
}

module.exports = {
  clockOf,
  bookKey,
  liveWhy,
  liveFillsFromSnap,
  matchLiveFill,
  overlayPaperWithLiveFills,
  overlayDeskBooks,
};
