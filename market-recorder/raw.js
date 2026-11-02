'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('./config');

/** Append-only raw responses, one NDJSON file per IST date. Previous days are gzipped, never rewritten. */
function append(date, record) {
  fs.mkdirSync(config.rawDir, { recursive: true });
  fs.appendFileSync(path.join(config.rawDir, `${date}.ndjson`), `${JSON.stringify(record)}\n`);
}

function compressOld(today) {
  if (!fs.existsSync(config.rawDir)) return [];
  const done = [];
  for (const f of fs.readdirSync(config.rawDir)) {
    const m = /^(\d{4}-\d{2}-\d{2})\.ndjson$/.exec(f);
    if (!m || m[1] >= today) continue;
    const src = path.join(config.rawDir, f);
    const dst = `${src}.gz`;
    if (fs.existsSync(dst)) continue;
    fs.writeFileSync(dst, zlib.gzipSync(fs.readFileSync(src), { level: 9 }));
    fs.unlinkSync(src);
    done.push(f);
  }
  return done;
}

module.exports = { append, compressOld };
