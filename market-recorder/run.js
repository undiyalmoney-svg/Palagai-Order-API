'use strict';

// Standalone process: `pm2 start market-recorder/run.js --name palagai-recorder`.
// It never imports the order desk, any broker/order module, or any strategy code.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const config = require('./config');
const log = require('./log');
const raw = require('./raw');
const { open } = require('./db');
const { Recorder } = require('./recorder');
const { currentAuth } = require('./auth');
const { writeSummary } = require('./summary');
const { istDate, istMinute, istMinutesOfDay, msToNextMinute, istWeekday } = require('./time');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stopping = false;
process.on('SIGINT', () => (stopping = true));
process.on('SIGTERM', () => (stopping = true));
process.on('unhandledRejection', (e) => log.error('unhandledRejection', String(e?.message || e)));
process.on('uncaughtException', (e) => {
  log.error('uncaughtException', String(e?.message || e));
  process.exit(1); // pm2 restarts; state is all in sqlite so this is restart-safe
});

function heartbeat(extra) {
  try {
    fs.writeFileSync(config.heartbeatFile, JSON.stringify({ at: new Date().toISOString(), ist: istMinute(), version: config.RECORDER_VERSION, pid: process.pid, ...extra }));
  } catch {
    /* ignore */
  }
}

async function main() {
  const db = open(config.dbFile);
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)').run('recorder_version', config.RECORDER_VERSION);
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)').run('schema_version', String(config.SCHEMA_VERSION));
  const rec = new Recorder(db, { getAuth: () => { const a = currentAuth(); return a ? { header: a.header } : null; } });
  log.info('recorder started', { version: config.RECORDER_VERSION, dir: config.dir, pid: process.pid });

  let summarizedFor = null;
  let prevLevelsFor = null;
  let lastStatus = null;

  while (!stopping) {
    const now = new Date();
    const today = istDate(now);
    try {
      if (rec.inWindow(now)) {
        const r = await rec.tick(now);
        lastStatus = r.status;
        if (prevLevelsFor !== today) {
          const a = currentAuth();
          if (a) {
            await rec.fillPrevDayLevels(a.header, today).catch((e) => log.error('prev-levels', e.message));
            prevLevelsFor = today;
          }
        }
      } else if (istMinutesOfDay(now) > config.windowEndMin && summarizedFor !== today && istWeekday(now) >= 1 && istWeekday(now) <= 5) {
        const s = writeSummary(db, today);
        raw.compressOld(today);
        log.info('daily summary', { date: today, status: s.status, missing_pct: s.missing_pct, rows: s.rows, disk_free_mb: s.disk_free_mb });
        summarizedFor = today;
      }
      heartbeat({ lastStatus, inWindow: rec.inWindow(now), authFailedAt: rec.authFailedAt });
    } catch (e) {
      log.error('loop', String(e?.message || e));
    }
    await sleep(msToNextMinute(Date.now(), config.tickOffsetSec));
  }
  db.close();
  log.info('recorder stopped');
}

main().catch((e) => {
  log.error('fatal', String(e?.message || e));
  process.exit(1);
});
