'use strict';

const crypto = require('crypto');
const { JWT_SECRET } = require('../../auth/credentials');

const key = () => crypto.createHash('sha256').update(`momentum-broker:${process.env.MOMENTUM_SECRET || JWT_SECRET}`).digest();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

/** Per-user Kite session, encrypted at rest. Kite tokens expire daily. */
class BrokerSessions {
  constructor(store) {
    this.store = store;
  }

  save(userId, apiKey, accessToken) {
    this.store.saveBrokerSession(userId, String(apiKey).trim(), encrypt(String(accessToken).trim()));
  }

  clear(userId) {
    this.store.deleteBrokerSession(userId);
  }

  authorization(userId) {
    const row = this.store.getBrokerSession(userId);
    if (!row) return null;
    try {
      return `token ${row.apiKey}:${decrypt(row.tokenEnc)}`;
    } catch {
      return null;
    }
  }

  info(userId) {
    const row = this.store.getBrokerSession(userId);
    if (!row) return { configured: false };
    return { configured: true, apiKey: `${row.apiKey.slice(0, 4)}…`, updatedAt: row.updatedAt };
  }
}

module.exports = { BrokerSessions, encrypt, decrypt };
