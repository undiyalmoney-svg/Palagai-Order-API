'use strict';

const IST_OFFSET_MIN = 330;

function toIstParts(date) {
  const d = date instanceof Date ? date : new Date(date);
  const ist = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
    weekday: ist.getUTCDay(),
  };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD in IST. */
function istDate(date = new Date()) {
  const p = toIstParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function parseYmd(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatYmd(dt) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function addDays(ymd, n) {
  const dt = parseYmd(ymd);
  dt.setUTCDate(dt.getUTCDate() + n);
  return formatYmd(dt);
}

function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86_400_000);
}

function weekday(ymd) {
  return parseYmd(ymd).getUTCDay();
}

function isWeekend(ymd) {
  const w = weekday(ymd);
  return w === 0 || w === 6;
}

/** ISO week key, e.g. 2026-W40 (Monday-start weeks). */
function isoWeekKey(ymd) {
  const dt = parseYmd(ymd);
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86_400_000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${pad(week)}`;
}

function monthKey(ymd) {
  return String(ymd).slice(0, 7);
}

/**
 * Fixed-date NSE holidays that fall on weekdays. Real exchange holidays move
 * (Diwali, Holi, Eid...) — a live deployment uses the provider's calendar; the
 * simulated data set only needs a plausible, deterministic calendar.
 */
function isFixedHoliday(ymd) {
  const md = String(ymd).slice(5, 10);
  return md === '01-26' || md === '08-15' || md === '10-02' || md === '12-25';
}

function isTradingDay(ymd) {
  return !isWeekend(ymd) && !isFixedHoliday(ymd);
}

/** Inclusive list of trading days between two dates. */
function tradingDaysBetween(from, to) {
  const out = [];
  let cur = from;
  while (cur <= to) {
    if (isTradingDay(cur)) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

const MARKET_OPEN_MIN = 9 * 60 + 15;
const MARKET_CLOSE_MIN = 15 * 60 + 30;

/** NSE cash-market session status for a given instant. */
function marketStatus(now = new Date()) {
  const p = toIstParts(now);
  const ymd = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const minutes = p.hour * 60 + p.minute;
  if (!isTradingDay(ymd)) return { open: false, reason: 'Market closed (weekend/holiday)', date: ymd };
  if (minutes < MARKET_OPEN_MIN) return { open: false, reason: 'Market not open yet (opens 09:15 IST)', date: ymd };
  if (minutes >= MARKET_CLOSE_MIN) return { open: false, reason: 'Market closed for the day (closed 15:30 IST)', date: ymd };
  return { open: true, reason: 'Market open', date: ymd };
}

/** Last trading date whose daily bar is complete at `now` (IST). */
function lastCompletedTradingDate(now = new Date()) {
  const p = toIstParts(now);
  let ymd = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const minutes = p.hour * 60 + p.minute;
  const todayComplete = isTradingDay(ymd) && minutes >= MARKET_CLOSE_MIN + 30;
  if (!todayComplete) ymd = addDays(ymd, -1);
  while (!isTradingDay(ymd)) ymd = addDays(ymd, -1);
  return ymd;
}

module.exports = {
  toIstParts,
  istDate,
  parseYmd,
  formatYmd,
  addDays,
  daysBetween,
  weekday,
  isWeekend,
  isoWeekKey,
  monthKey,
  isTradingDay,
  tradingDaysBetween,
  marketStatus,
  lastCompletedTradingDate,
};
