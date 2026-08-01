/**
 * Vault secrets — encrypted values in Mongo; unlock password is NOT in Mongo
 * (see auth/credentials.js VAULT_PASSWORD).
 */
const crypto = require('crypto');
const { getDb } = require('../live/live.mongo');
const { VAULT_PASSWORD } = require('./credentials');

const COL = 'vault_secrets';

function encKey() {
  return crypto.createHash('sha256').update(String(VAULT_PASSWORD)).digest();
}

function encrypt(plain) {
  const key = encKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encBuf = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encBuf]).toString('base64');
}

function decrypt(payload) {
  const buf = Buffer.from(String(payload), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function assertVaultPassword(password) {
  if (String(password || '') !== VAULT_PASSWORD) {
    const err = new Error('Wrong vault password');
    err.status = 401;
    throw err;
  }
}

async function listSecrets(password) {
  assertVaultPassword(password);
  const db = getDb();
  if (!db) return [];
  const rows = await db.collection(COL).find({}).sort({ key: 1 }).toArray();
  return rows.map((r) => ({
    id: String(r._id),
    key: r.key,
    value: decrypt(r.valueEnc),
    updatedAt: r.updatedAt,
  }));
}

async function upsertSecret(password, { key, value }) {
  assertVaultPassword(password);
  const db = getDb();
  if (!db) {
    const err = new Error('Mongo required');
    err.status = 503;
    throw err;
  }
  const k = String(key || '').trim();
  if (!k) {
    const err = new Error('key required');
    err.status = 400;
    throw err;
  }
  const now = new Date().toISOString();
  await db.collection(COL).updateOne(
    { key: k },
    {
      $set: {
        key: k,
        valueEnc: encrypt(value ?? ''),
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
  return { ok: true, key: k, updatedAt: now };
}

async function removeSecret(password, key) {
  assertVaultPassword(password);
  const db = getDb();
  if (!db) return { ok: true };
  await db.collection(COL).deleteOne({ key: String(key || '').trim() });
  return { ok: true };
}

async function seedDefaults(password) {
  assertVaultPassword(password);
  const { ADMIN, OWNER_SEED, VAULT_PASSWORD: vaultPwd } = require('./credentials');
  const defaults = [
    { key: 'STATIC_IP', value: '168.144.28.89' },
    { key: 'ORDER_API_URL', value: 'http://168.144.28.89:3000' },
    { key: 'MONGODB_URI', value: process.env.MONGODB_URI || '' },
    { key: 'MONGODB_DB', value: process.env.MONGODB_DB || 'palagai' },
    { key: 'SITE_USERNAME_DEVIL', value: OWNER_SEED.username },
    { key: 'SITE_PASSWORD_DEVIL', value: OWNER_SEED.password },
    { key: 'ADMIN_USERNAME_ANGEL', value: ADMIN.username },
    { key: 'ADMIN_PASSWORD_ANGEL', value: ADMIN.password },
    { key: 'VAULT_UNLOCK_PASSWORD', value: vaultPwd },
    { key: 'NOTES', value: 'Owner vault — friends cannot see this' },
  ];
  for (const row of defaults) {
    const db = getDb();
    if (!db) break;
    // Always refresh login/vault password keys; other keys only if missing
    const force =
      row.key.includes('DEVIL') ||
      row.key.includes('ANGEL') ||
      row.key === 'VAULT_UNLOCK_PASSWORD';
    const exists = await db.collection(COL).findOne({ key: row.key });
    if (force || (!exists && row.value)) {
      await upsertSecret(password, row);
    }
  }
  return listSecrets(password);
}

function loginCards() {
  const { ADMIN, OWNER_SEED, VAULT_PASSWORD: vaultPwd } = require('./credentials');
  return [
    {
      id: 'devil',
      label: 'Site login (Devil)',
      username: OWNER_SEED.username,
      password: OWNER_SEED.password,
      hint: 'palagai.app /login',
    },
    {
      id: 'angel',
      label: 'Admin login (angel)',
      username: ADMIN.username,
      password: ADMIN.password,
      hint: 'palagai.app/admin/login',
    },
    {
      id: 'vault',
      label: 'Vault unlock password',
      username: '—',
      password: vaultPwd,
      hint: 'Unlock this vault page',
    },
  ];
}

module.exports = {
  listSecrets,
  upsertSecret,
  removeSecret,
  seedDefaults,
  assertVaultPassword,
  loginCards,
};
