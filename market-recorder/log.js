'use strict';

const fs = require('fs');
const config = require('./config');
const { istStamp } = require('./time');

function line(level, msg, extra) {
  const rec = `${istStamp()} ${level} ${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`;
  try {
    fs.appendFileSync(config.logFile, rec);
  } catch {
    /* logging must never take the collector down */
  }
  if (process.env.RECORDER_STDOUT) process.stdout.write(rec);
}

function error(kind, message, extra = {}) {
  line('ERROR', `${kind}: ${message}`, extra);
  try {
    fs.appendFileSync(config.errorFile, `${JSON.stringify({ ts: istStamp(), kind, message, ...extra })}\n`);
  } catch {
    /* ignore */
  }
}

module.exports = { info: (m, e) => line('INFO', m, e), warn: (m, e) => line('WARN', m, e), error };
