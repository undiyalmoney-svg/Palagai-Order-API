'use strict';
/**
 * Spoken Nifty / Bank announcer from the same 5m chart payload Paper and Live draw.
 * Dedicated field — do not push identical sentences into the event log every tick.
 */

const NEAR = { nifty: 12, banknifty: 30 };
const FAR = { nifty: 40, banknifty: 120 };
const LOOKBACK = 3;
const TREND_BARS = 20;
const MAX_RETEST = 2;
const ENTRY_START = '09:45';
const ENTRY_END = '14:30';
const SQUARE_OFF = '15:15';
const DONE = new Set(['TARGET', 'TIME', 'FAIL', 'STOP', 'LOCK', 'GIVEUP', 'STRUCTURE']);

function round2(x) {
  return Math.round((Number(x) || 0) * 100) / 100;
}

function hhmmOf(v) {
  const s = String(v || '');
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  return s.slice(11, 16);
}

function hmToMin(hm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function addHm(hm, addMin) {
  const n = hmToMin(hm);
  if (n == null) return hm;
  const x = n + addMin;
  const h = Math.floor(((x % (24 * 60)) + (24 * 60)) % (24 * 60) / 60);
  const m = ((x % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function barTime(b) {
  return b.t || b.date || b.time || '';
}

function barO(b) { return Number(b.o != null ? b.o : b.open); }
function barH(b) { return Number(b.h != null ? b.h : b.high); }
function barL(b) { return Number(b.l != null ? b.l : b.low); }
function barC(b) { return Number(b.c != null ? b.c : b.close); }

function to15(bars5) {
  const by = new Map();
  for (const b of bars5 || []) {
    const hm = hhmmOf(barTime(b));
    const [H, M] = hm.split(':').map(Number);
    if (!Number.isFinite(H)) continue;
    const mm = H * 60 + Math.floor(M / 15) * 15;
    const key = `${String(barTime(b)).slice(0, 10)}|${mm}`;
    const stamp = `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
    let g = by.get(key);
    if (!g) {
      g = { d: String(barTime(b)).slice(0, 10), hm: stamp, o: barO(b), h: barH(b), l: barL(b), c: barC(b), n: 1 };
      by.set(key, g);
    } else {
      g.h = Math.max(g.h, barH(b));
      g.l = Math.min(g.l, barL(b));
      g.c = barC(b);
      g.n += 1;
    }
  }
  return [...by.values()];
}

function bookScale(book) {
  const k = announcerKey({ id: book, label: book });
  return {
    near: NEAR[k] || NEAR.nifty,
    far: FAR[k] || FAR.nifty,
  };
}

function announcerKey(book) {
  const blob = `${(book && book.id) || ''} ${(book && book.label) || ''} ${book || ''}`.toLowerCase();
  if (blob.includes('bank')) return 'banknifty';
  if (blob.includes('nifty')) return 'nifty';
  if (blob === 'nifty' || blob.includes('nifty-50')) return 'nifty';
  return null;
}

function wallLine(spot, wallHi, wallLo, scale) {
  const bits = [];
  const up = Number(wallHi) - Number(spot);
  const dn = Number(spot) - Number(wallLo);
  const say = (kind, dist) => {
    if (!Number.isFinite(dist)) return null;
    const abs = Math.round(Math.abs(dist));
    if (abs <= scale.near) return `${kind} is there`;
    if (abs >= scale.far) return `${kind} is far away`;
    return `${kind} is ${abs} pts away`;
  };
  const res = say('Resistance', up);
  const sup = say('Support', dn);
  if (Number.isFinite(up) && Number.isFinite(dn)) {
    if (up <= dn) {
      if (res) bits.push(res);
      if (sup && (dn >= scale.far || up <= scale.near)) bits.push(sup);
    } else {
      if (sup) bits.push(sup);
      if (res && (up >= scale.far || dn <= scale.near)) bits.push(res);
    }
  } else {
    if (res) bits.push(res);
    if (sup) bits.push(sup);
  }
  return bits.slice(0, 2).join('. ');
}

function lastSpot(chart, fallback) {
  if (Number.isFinite(Number(fallback))) return Number(fallback);
  const bars = chart.candles && chart.candles.length ? chart.candles : [];
  if (!bars.length) return null;
  const c = barC(bars[bars.length - 1]);
  return Number.isFinite(c) ? c : null;
}

function nowFromChart(chart, nowHm) {
  if (nowHm) return nowHm;
  const bars = chart.candles || [];
  if (!bars.length) return null;
  return addHm(hhmmOf(barTime(bars[bars.length - 1])), 5);
}

function tradeOpen(t, nowHm) {
  if (!t) return false;
  if (t.openAtFill || (t.structure && t.structure.exit == null)) return true;
  const reason = t.exitReason || (t.structure && t.structure.exit && t.structure.exit.reason);
  const exitHm = hhmmOf(t.exitTime || (t.structure && t.structure.exit && t.structure.exit.hm));
  const now = hmToMin(nowHm);
  const exit = hmToMin(exitHm);
  if (t.open) return true;
  return !(DONE.has(reason) && exit != null && now != null && exit <= now);
}

function focusTrade(chart, nowHm) {
  const rows = (chart.trades || []).slice();
  const open = [...rows].reverse().find((t) => tradeOpen(t, nowHm));
  if (open) return open;
  return rows[rows.length - 1] || null;
}

function wallsNow(chart) {
  const bars15 = to15(chart.candles || []);
  if (bars15.length < LOOKBACK + 1) {
    return {
      wallHi: chart.resistance != null ? Number(chart.resistance) : null,
      wallLo: chart.support != null ? Number(chart.support) : null,
      last15: bars15[bars15.length - 1] || null,
      completed15: bars15[bars15.length - 1] || null,
      bars15,
    };
  }
  const last = bars15[bars15.length - 1];
  // Same as Live: the latest 15m bucket includes the forming 5m stitch.
  const i = bars15.length - 1;
  let wallHi = -Infinity;
  let wallLo = Infinity;
  for (let k = i - LOOKBACK; k < i; k++) {
    if (!bars15[k]) continue;
    wallHi = Math.max(wallHi, bars15[k].h);
    wallLo = Math.min(wallLo, bars15[k].l);
  }
  if (!Number.isFinite(wallHi) || wallHi === -Infinity) {
    wallHi = chart.resistance != null ? Number(chart.resistance) : null;
    wallLo = chart.support != null ? Number(chart.support) : null;
  }
  return {
    wallHi: wallHi == null ? null : round2(wallHi),
    wallLo: wallLo == null ? null : round2(wallLo),
    last15: last,
    completed15: last,
    bars15,
  };
}

function trendAt(bars15, i) {
  if (i < TREND_BARS) return 0;
  const now = bars15[i].c;
  const then = bars15[i - TREND_BARS].c;
  if (now > then) return 1;
  if (now < then) return -1;
  return 0;
}

function sessionTrend(bars15, i) {
  if (i >= TREND_BARS) return trendAt(bars15, i);
  if (i < 1) return 0;
  const now = bars15[i].c;
  const then = bars15[0].c;
  if (now > then) return 1;
  if (now < then) return -1;
  return 0;
}

function pendingBreakout(chart, walls, nowHm) {
  const bars15 = walls.bars15 || [];
  const b = walls.completed15;
  if (!b || !walls.wallHi || !walls.wallLo) return null;
  if (b.hm < ENTRY_START || b.hm > ENTRY_END) return null;
  const i = bars15.indexOf(b);
  if (i < LOOKBACK) return null;
  const trend = sessionTrend(bars15, i);
  let dir = 0;
  if (b.c > walls.wallHi && trend > 0) dir = 1;
  else if (b.c < walls.wallLo && trend < 0) dir = -1;
  if (!dir) return null;
  const trades = chart.trades || [];
  if (trades.some((t) => hhmmOf(t.breakoutTime) === b.hm)) return null;
  const afterHm = addHm(b.hm, 10);
  const now = hmToMin(nowHm) || hmToMin(addHm(b.hm, 15));
  const firstConfirm = hmToMin(addHm(afterHm, 5)) || hmToMin(addHm(b.hm, 15));
  const staleAt = (firstConfirm || 0) + MAX_RETEST * 5;
  if (now > staleAt) return null;
  return { dir, option: dir > 0 ? 'CE' : 'PE', hm: b.hm };
}

function whyWord(reason) {
  if (!reason) return null;
  const r = String(reason).toUpperCase();
  if (r === 'TIME') return 'TIME';
  if (r === 'STOP') return 'stop';
  if (r === 'GIVEUP') return 'give-up';
  if (r === 'TARGET') return 'target';
  if (r === 'LOCK') return 'lock';
  if (r === 'FAIL') return 'fail';
  if (r === 'STRUCTURE') return 'structure';
  if (r === 'CLOSE') return null;
  return reason;
}

/**
 * @returns {{ at: string, text: string, state: string }}
 */
function announceFromChart(chart, opts = {}) {
  const at = opts.at || new Date().toISOString();
  const book = announcerKey(chart) || opts.book || 'nifty';
  const scale = bookScale(book);
  const nowHm = nowFromChart(chart, opts.nowHm);
  const spot = lastSpot(chart, opts.spot);
  const walls = wallsNow(chart);
  const wallHi = walls.wallHi != null ? walls.wallHi : (chart.resistance != null ? Number(chart.resistance) : null);
  const wallLo = walls.wallLo != null ? walls.wallLo : (chart.support != null ? Number(chart.support) : null);
  const wallsSpeak = (spot != null && (wallHi != null || wallLo != null))
    ? wallLine(spot, wallHi, wallLo, scale)
    : '';
  const trades = chart.trades || [];
  const focus = focusTrade(chart, nowHm);
  const open = focus && tradeOpen(focus, nowHm);
  const pending = pendingBreakout(chart, { ...walls, wallHi, wallLo }, nowHm)
    || (chart.breakout && !chart.confirmation && !chart.entry
      ? { option: chart.option || 'CE', hm: chart.breakout.hm }
      : null);
  const sessionOver = nowHm && nowHm >= SQUARE_OFF;
  const pastEntries = nowHm && nowHm > ENTRY_END;

  if (open) {
    const opt = focus.option || chart.option || (focus.side === 'SELL' ? 'PE' : 'CE');
    return { at, text: `Entered ${opt}.`, state: 'in_trade' };
  }

  if (pending && !sessionOver) {
    return { at, text: 'Waiting for confirm / retest.', state: 'wait_confirm' };
  }

  if (focus && !open) {
    const why = whyWord(focus.exitReason);
    const out = why ? `Out ${why}.` : 'Out.';
    if (sessionOver || pastEntries) {
      return { at, text: out, state: 'out' };
    }
    const wait = wallsSpeak ? `Waiting for breakout. ${wallsSpeak}.` : 'Waiting for breakout.';
    return { at, text: `${out} ${wait}`.replace(/\.\./g, '.').trim(), state: 'wait_breakout' };
  }

  if (!trades.length) {
    const core = wallsSpeak ? `No setups yet this session. ${wallsSpeak}.` : 'No setups yet this session.';
    if (sessionOver) return { at, text: core, state: 'no_setup' };
    const wait = wallsSpeak ? `Waiting for breakout. ${wallsSpeak}.` : 'Waiting for breakout.';
    // Prefer the waiting line once the tape is moving; keep "no setups" when
    // we still have nothing to hang a wall on.
    return { at, text: wallsSpeak ? wait : core, state: wallsSpeak ? 'wait_breakout' : 'no_setup' };
  }

  const wait = wallsSpeak ? `Waiting for breakout. ${wallsSpeak}.` : 'Waiting for breakout.';
  return { at, text: wait, state: 'wait_breakout' };
}

function emptyLine(book, at) {
  return {
    at: at || new Date().toISOString(),
    text: 'No setups yet this session.',
    state: 'no_setup',
  };
}

function announcerFromDesk(deskChart, opts = {}) {
  const at = opts.at || new Date().toISOString();
  const books = (deskChart && deskChart.books) || [];
  const pick = (want) => books.find((b) => announcerKey(b) === want) || null;
  const niftyChart = pick('nifty');
  const bankChart = pick('banknifty');
  return {
    nifty: niftyChart
      ? announceFromChart(niftyChart, { ...opts, at, book: 'nifty' })
      : emptyLine('nifty', at),
    banknifty: bankChart
      ? announceFromChart(bankChart, { ...opts, at, book: 'banknifty' })
      : emptyLine('banknifty', at),
  };
}

const ANNOUNCE_HOLD_MS = 60_000;

function mergeAnnouncer(prev, next, nowMs = Date.now()) {
  const out = {};
  for (const key of ['nifty', 'banknifty']) {
    const n = (next && next[key]) || emptyLine(key);
    const p = (prev && prev[key]) || null;
    const changed = !p || p.text !== n.text || p.state !== n.state;
    const age = p && p.at ? nowMs - Date.parse(p.at) : ANNOUNCE_HOLD_MS;
    const aged = !Number.isFinite(age) || age >= ANNOUNCE_HOLD_MS;
    if (changed || aged || !p) {
      out[key] = { at: n.at || new Date(nowMs).toISOString(), text: n.text, state: n.state };
    } else {
      out[key] = { at: p.at, text: p.text, state: p.state };
    }
  }
  return out;
}

module.exports = {
  announceFromChart,
  announcerFromDesk,
  mergeAnnouncer,
  announcerKey,
  wallLine,
  ANNOUNCE_HOLD_MS,
  NEAR,
  FAR,
};
