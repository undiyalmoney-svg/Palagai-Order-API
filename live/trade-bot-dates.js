'use strict';

function truthy(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function istToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * Trade Bot window: From/To dates, Today autofill, Live money → realOrders.
 * Paper and live use the same engine; liveMoney is the only order switch.
 */
function parseTradeBotWindow(body = {}, now = new Date()) {
  const today = istToday(now);
  const todayFlag = truthy(body.today);
  const fromDate = todayFlag ? today : String(body.fromDate || '').slice(0, 10);
  const toDate = todayFlag ? today : String(body.toDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    const err = new Error('From date and To date are required (YYYY-MM-DD), or check Today');
    err.status = 400;
    throw err;
  }
  if (fromDate > toDate) {
    const err = new Error('From date must be on or before To date');
    err.status = 400;
    throw err;
  }
  const liveMoney = truthy(body.liveMoney);
  if (liveMoney && (today < fromDate || today > toDate)) {
    const err = new Error(
      'Live money only places orders when the date range includes today. Uncheck Live money for past dates.',
    );
    err.status = 400;
    throw err;
  }
  return {
    fromDate,
    toDate,
    today: todayFlag,
    liveMoney,
    realOrders: liveMoney,
  };
}

function addCalendarYears(iso, deltaYears) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y + deltaYears, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

/**
 * Paper P&L follows the From/To the user picked.
 * Today (or a single day) uses the last 1 year ending that day.
 */
function paperPnlWindow(window, _lastFound, now = new Date()) {
  if (!window) return window;
  const single = !!window.today || window.fromDate === window.toDate;
  if (!single) {
    return { ...window, usedFindWindow: false };
  }
  const today = window.toDate || istToday(now);
  return {
    ...window,
    fromDate: addCalendarYears(today, -1),
    toDate: today,
    usedFindWindow: true,
  };
}

module.exports = { truthy, istToday, parseTradeBotWindow, paperPnlWindow };
