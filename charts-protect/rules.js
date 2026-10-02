/**
 * Charts Protect capital rules — same gates as palagai chart-protect.util.ts.
 * The droplet uses this to decide WHETHER to send the proven ATM path.
 */
'use strict';

const INDEX_PROTECT_FROM = '09:50';
const INDEX_PROTECT_UNTIL = '15:15';
const CRUDE_PROTECT_FROM = '15:30';
const CRUDE_PROTECT_UNTIL = '21:00';

const NSE_OPEN = '09:15';
const NSE_CLOSE = '15:30';
const MCX_OPEN = '09:00';
const MCX_CLOSE = '23:30';

const RS_PER_LOT = 40_000;
const CRUDE_LOTS_PER_BAND = 3;
const MAX_DESK_LOTS = 10;
const MAX_CRUDE_LOTS = MAX_DESK_LOTS * CRUDE_LOTS_PER_BAND;

function minutesOfDay(hhMm) {
  const [hours, minutes] = String(hhMm || '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function istClockParts(now = new Date()) {
  const stamp = now.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' });
  const [date, clock = '00:00:00'] = stamp.replace('T', ' ').split(' ');
  return {
    date,
    time: clock.slice(0, 5),
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
  };
}

function formatIstDateTime(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

function isIndexBook(book) {
  return book === 'nifty' || book === 'bank';
}

function inProtectWindow(book, istTime) {
  const now = minutesOfDay(istTime);
  if (book === 'crude') {
    return now >= minutesOfDay(CRUDE_PROTECT_FROM) && now < minutesOfDay(CRUDE_PROTECT_UNTIL);
  }
  return now >= minutesOfDay(INDEX_PROTECT_FROM) && now < minutesOfDay(INDEX_PROTECT_UNTIL);
}

function htfAllowsProtect(type, htfTrend) {
  if (type === 'BUY') return htfTrend === 'bullish';
  if (type === 'SELL') return htfTrend === 'bearish';
  return false;
}

function optionSideForAlert(type) {
  if (type === 'BUY') return 'CE';
  if (type === 'SELL') return 'PE';
  return null;
}

function lotsFromAvailableFunds(capitalRs, book = 'index') {
  const c = Math.max(0, Math.floor(Number(capitalRs) || 0));
  const nifty = !(c > 0) ? 1 : Math.min(MAX_DESK_LOTS, Math.max(1, Math.floor(c / RS_PER_LOT)));
  if (book !== 'crude') return nifty;
  return Math.min(MAX_CRUDE_LOTS, Math.max(CRUDE_LOTS_PER_BAND, nifty * CRUDE_LOTS_PER_BAND));
}

function lotsForChartBook(book, equityCash) {
  return lotsFromAvailableFunds(equityCash, book === 'crude' ? 'crude' : 'index');
}

function marketIsOpen(book, now = new Date()) {
  const { time, weekday } = istClockParts(now);
  if (weekday === 0 || weekday === 6) return false;
  const nowMin = minutesOfDay(time);
  if (book === 'crude') {
    return nowMin >= minutesOfDay(MCX_OPEN) && nowMin < minutesOfDay(MCX_CLOSE);
  }
  return nowMin >= minutesOfDay(NSE_OPEN) && nowMin < minutesOfDay(NSE_CLOSE);
}

function decideProtectAuto(opts) {
  if (!opts.liveDay) return deny('not the live session');
  if (!opts.marketOpen) return deny('market closed');
  if (opts.busy) return deny('already working');
  if (optionSideForAlert(opts.type) == null) return deny('not a BUY or SELL');
  if ((opts.openBooks || []).length) return deny('a fill is already open — no second trade');
  if (opts.day.done[opts.book] || opts.day.placed[opts.book]) {
    return deny(`${labelOf(opts.book)} already took today's Protect fill`);
  }
  if (isIndexBook(opts.book) && opts.day.nseBook && opts.day.nseBook !== opts.book) {
    return deny(`${labelOf(opts.day.nseBook)} already used the NSE slot`);
  }
  if (!inProtectWindow(opts.book, opts.istTime)) {
    return deny(
      opts.book === 'crude'
        ? `Crude waits ${CRUDE_PROTECT_FROM}–${CRUDE_PROTECT_UNTIL}`
        : `index waits ${INDEX_PROTECT_FROM}–${INDEX_PROTECT_UNTIL}`,
    );
  }
  if (!htfAllowsProtect(opts.type, opts.htfTrend)) {
    if (opts.htfTrend === 'bullish' || opts.htfTrend === 'bearish') {
      return deny(`5m is ${opts.htfTrend} — skip this ${opts.type}`);
    }
    return deny('5m sideways — sitting out');
  }
  return { allow: true, reason: 'Protect fill' };
}

function dayFromState(state) {
  return {
    date: state.date,
    nseBook: state.nseBook || null,
    placed: { nifty: !!state.placed?.nifty, bank: !!state.placed?.bank, crude: !!state.placed?.crude },
    done: { nifty: !!state.done?.nifty, bank: !!state.done?.bank, crude: !!state.done?.crude },
  };
}

function booksInWindow(istTime) {
  return ['nifty', 'bank', 'crude'].filter((book) => inProtectWindow(book, istTime));
}

function deny(reason) {
  return { allow: false, reason };
}

function labelOf(book) {
  if (book === 'bank') return 'Bank';
  if (book === 'crude') return 'Crude';
  return 'Nifty';
}

module.exports = {
  INDEX_PROTECT_FROM,
  INDEX_PROTECT_UNTIL,
  CRUDE_PROTECT_FROM,
  CRUDE_PROTECT_UNTIL,
  RS_PER_LOT,
  minutesOfDay,
  istClockParts,
  formatIstDateTime,
  inProtectWindow,
  htfAllowsProtect,
  optionSideForAlert,
  lotsFromAvailableFunds,
  lotsForChartBook,
  marketIsOpen,
  decideProtectAuto,
  dayFromState,
  booksInWindow,
  labelOf,
};
