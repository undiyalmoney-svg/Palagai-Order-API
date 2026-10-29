'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNseEqMap, startJob, startLiveJob, resetJobs, NIFTY_50_TOKEN, namesFromCapital } = require('./jobs');

const NSE_CSV = `instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange
738561,2885,RELIANCE,RELIANCE,0,,,,1,EQ,NSE,NSE
256265,256265,NIFTY 50,NIFTY 50,0,,,,1,INDEX,NSE,NSE
2953217,11536,TCS,TCS,0,,,,1,EQ,NSE,NSE
260105,260105,NIFTY BANK,NIFTY BANK,0,,,,1,INDEX,NSE,NSE
`;

test('parseNseEqMap keeps Nifty 500 EQ tokens and drops index rows', () => {
  const map = parseNseEqMap(NSE_CSV, ['RELIANCE', 'TCS', 'NIFTY 50']);
  assert.equal(map.size, 2);
  assert.equal(map.get('RELIANCE').instrumentToken, 738561);
  assert.equal(map.get('TCS').instrumentToken, 2953217);
  assert.equal(map.has('NIFTY 50'), false);
  assert.equal(NIFTY_50_TOKEN, 256265);
});

test('startJob rejects a missing date, a future end, and a range longer than 60 days', () => {
  resetJobs();
  assert.throws(() => startJob({ headers: {} }, {}), (err) => err.status === 400);
  assert.throws(
    () => startJob({ headers: {} }, { from: '2026-10-16', to: '2099-01-01' }),
    (err) => err.status === 400 && /future/i.test(err.message),
  );
  assert.throws(
    () => startJob({ headers: {} }, { from: '2026-01-01', to: '2026-04-01' }),
    (err) => err.status === 400 && /60/i.test(err.message),
  );
});

test('startJob returns 409 while another historical backtest is running', () => {
  resetJobs();
  const first = startJob({ headers: {} }, { from: '2026-10-16', to: '2026-10-16' });
  assert.equal(first.status, 'running');
  assert.equal(first.simulated, true);
  assert.equal(first.liveOrders, false);
  assert.throws(
    () => startJob({ headers: {} }, { from: '2026-10-16', to: '2026-10-16' }),
    (err) => err.status === 409 && err.jobId === first.id,
  );
  resetJobs();
});

test('startJob locks the prior-day follow desk and auto-picks names from capital', () => {
  resetJobs();
  const job = startJob({ headers: {} }, { from: '2026-10-16', to: '2026-10-16', capital: 10000 });
  assert.equal(job.input.preset, 'pdh-follow');
  assert.equal(job.input.family, 'pdh_break');
  assert.equal(job.input.capital, 10000);
  assert.equal(job.input.maxStocksPerDay, 5);
  assert.equal(job.input.rankBy, 'stopPct');
  assert.equal(job.input.crowdFilter, 'follow');
  assert.equal(job.input.entryEnd, '14:30');
  assert.equal(job.input.timeExit, '15:15');
  assert.equal(job.liveOrders, false);
  resetJobs();
});

test('₹40k capital auto-trades 8 names and ignores an old maxStocks field', () => {
  resetJobs();
  const job = startJob(
    { headers: {} },
    { from: '2026-10-16', to: '2026-10-16', capital: 40000, maxStocksPerDay: 3, preset: 'winner' },
  );
  assert.equal(job.input.preset, 'pdh-follow');
  assert.equal(job.input.capital, 40000);
  assert.equal(job.input.maxStocksPerDay, namesFromCapital(40000));
  assert.equal(job.input.maxStocksPerDay, 8);
  assert.equal(job.input.crowdFilter, 'follow');
  resetJobs();
});

test('startLiveJob is 1 name, 1R lock, Kite-cash sized, and never live orders', () => {
  resetJobs();
  const job = startLiveJob({ headers: {} }, { capital: 100000 });
  assert.equal(job.status, 'running');
  assert.equal(job.simulated, true);
  assert.equal(job.liveOrders, false);
  assert.equal(job.input.liveToday, true);
  assert.equal(job.input.preset, 'pdh-follow-live-lock');
  assert.equal(job.input.family, 'pdh_break');
  assert.equal(job.input.maxStocksPerDay, 1);
  assert.equal(job.input.targetR, 1);
  assert.equal(job.input.capital, 0);
  assert.notEqual(job.input.capital, 100000);
  resetJobs();
});
