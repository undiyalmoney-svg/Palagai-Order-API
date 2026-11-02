'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const AUTH_FILE = path.join(config.dir, 'auth.json');

/**
 * Where the Kite session comes from, newest wins:
 *  1. auth.json written by set-auth.js
 *  2. the session the site already saves when the owner opens Get Token / starts a desk
 *     (momentum.sqlite broker_sessions, opened READ-ONLY; nothing is written there)
 * Returns "token key:token" or null. Never logs the token.
 */
function fromFile() {
  try {
    const j = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    if (!j.apiKey || !j.accessToken) return null;
    return { header: `token ${j.apiKey}:${j.accessToken}`, updatedAt: j.updatedAt || null, source: 'auth.json' };
  } catch {
    return null;
  }
}

function fromSessionStore() {
  try {
    const Database = require('better-sqlite3');
    const file = process.env.MOMENTUM_DB_PATH || path.join(__dirname, '..', 'data', 'momentum', 'momentum.sqlite');
    if (!fs.existsSync(file)) return null;
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const row = db
        .prepare('SELECT api_key AS apiKey, token_enc AS tokenEnc, updated_at AS updatedAt FROM broker_sessions ORDER BY updated_at DESC LIMIT 1')
        .get();
      if (!row) return null;
      const { decrypt } = require('../momentum/broker/session-store');
      return { header: `token ${row.apiKey}:${decrypt(row.tokenEnc)}`, updatedAt: row.updatedAt, source: 'session-store' };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function currentAuth() {
  const a = fromFile();
  const b = fromSessionStore();
  if (a && b) return String(a.updatedAt || '') >= String(b.updatedAt || '') ? a : b;
  return a || b;
}

function saveAuthFile(apiKey, accessToken) {
  fs.mkdirSync(config.dir, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ apiKey, accessToken, updatedAt: new Date().toISOString() }), { mode: 0o600 });
}

module.exports = { currentAuth, saveAuthFile, AUTH_FILE };
