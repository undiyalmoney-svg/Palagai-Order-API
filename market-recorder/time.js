'use strict';

const IST_OFFSET_MIN = 330;

function toIst(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MIN * 60000);
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

/** 'YYYY-MM-DD' in IST. */
function istDate(date = new Date()) {
  const d = toIst(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 'YYYY-MM-DD HH:MM' in IST (minute key). */
function istMinute(date = new Date()) {
  const d = toIst(date);
  return `${istDate(date)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 'YYYY-MM-DD HH:MM:SS.mmm' in IST. */
function istStamp(date = new Date()) {
  const d = toIst(date);
  return `${istMinute(date)}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

function istMinutesOfDay(date = new Date()) {
  const d = toIst(date);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function istWeekday(date = new Date()) {
  return toIst(date).getUTCDay();
}

/** Parse Kite quote timestamps ('YYYY-MM-DD HH:MM:SS', already IST) -> epoch ms treating it as IST. */
function parseKiteStamp(s) {
  if (!s || typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - IST_OFFSET_MIN * 60000;
}

function msToNextMinute(now = Date.now(), offsetSec = 0) {
  const next = Math.floor(now / 60000) * 60000 + 60000 + offsetSec * 1000;
  return Math.max(next - now, 0);
}

module.exports = { istDate, istMinute, istStamp, istMinutesOfDay, istWeekday, parseKiteStamp, msToNextMinute, IST_OFFSET_MIN };
