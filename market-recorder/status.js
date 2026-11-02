'use strict';

// node market-recorder/status.js [YYYY-MM-DD]  -> prints heartbeat + the day's completeness summary
const fs = require('fs');
const config = require('./config');
const { open } = require('./db');
const { summarize } = require('./summary');
const { istDate } = require('./time');

const date = process.argv[2] || istDate();
let hb = null;
try {
  hb = JSON.parse(fs.readFileSync(config.heartbeatFile, 'utf8'));
} catch {
  /* not running yet */
}
const db = open(config.dbFile);
const s = summarize(db, date);
const short = { ...s, groups: Object.fromEntries(Object.entries(s.groups).map(([k, v]) => { const { per_instrument: p, ...rest } = v; return [k, { ...rest, instruments: p.length }]; })) };
console.log(JSON.stringify({ heartbeat: hb, summary: short }, null, 2));
const total = db.prepare('SELECT COUNT(*) c, MIN(minute_key) a, MAX(minute_key) b FROM quotes').get();
console.log(JSON.stringify({ all_rows: total }));
