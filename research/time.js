'use strict';

/** Session clock is Asia/Kolkata. Stored timestamps stay UTC. */

function parts(input) {
  const date = input instanceof Date ? input : new Date(input);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bag = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') bag[p.type] = p.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: bag.year,
    month: bag.month,
    day: bag.day,
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

function sessionDate(input) {
  const p = parts(input);
  return `${p.year}-${p.month}-${p.day}`;
}

function minutesOfDay(input) {
  const p = parts(input);
  return p.hour * 60 + p.minute;
}

/** Build a UTC Date from an IST calendar clock. */
function istDate(day, hour, minute) {
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - (5 * 60 + 30) * 60 * 1000);
}

function floorMinute(input) {
  const p = parts(input);
  return istDate(`${p.year}-${p.month}-${p.day}`, p.hour, p.minute);
}

const OPEN_MIN = 9 * 60 + 15;
const CLOSE_MIN = 15 * 60 + 30;

function inSession(input, openMin = OPEN_MIN, closeMin = CLOSE_MIN) {
  const m = minutesOfDay(input);
  return m >= openMin && m < closeMin;
}

module.exports = {
  parts,
  sessionDate,
  minutesOfDay,
  istDate,
  floorMinute,
  OPEN_MIN,
  CLOSE_MIN,
  inSession,
};
