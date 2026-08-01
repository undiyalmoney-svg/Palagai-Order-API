/**
 * Mongo users for site login (friends + owner).
 * Passwords stored as bcrypt hashes only.
 */
const bcrypt = require('bcryptjs');
const { getDb } = require('../live/live.mongo');
const {
  OWNER_SEED,
  FRIEND_MODULES,
  OWNER_ONLY_MODULES,
  ALL_MODULES,
} = require('./credentials');

const COL = 'users';

function publicUser(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    username: doc.username,
    role: doc.role || 'friend',
    modules: Array.isArray(doc.modules) ? doc.modules : [],
    blocked: !!doc.blocked,
    kiteApiKey: doc.kiteApiKey || '',
    note: doc.note || '',
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

function normalizeModules(modules, role) {
  const allowed =
    role === 'owner' ? ALL_MODULES : FRIEND_MODULES;
  const set = new Set(
    (Array.isArray(modules) ? modules : [])
      .map((m) => String(m).toLowerCase())
      .filter((m) => allowed.includes(m)),
  );
  if (role === 'owner') {
    for (const m of OWNER_ONLY_MODULES) set.add(m);
    for (const m of ALL_MODULES) set.add(m);
  }
  return [...set];
}

async function ensureOwnerSeed() {
  const db = getDb();
  if (!db) return;
  const passwordHash = await bcrypt.hash(OWNER_SEED.password, 10);
  const now = new Date().toISOString();
  const existing = await db.collection(COL).findOne({
    username: OWNER_SEED.username,
  });
  if (!existing) {
    await db.collection(COL).insertOne({
      username: OWNER_SEED.username,
      passwordHash,
      role: 'owner',
      modules: OWNER_SEED.modules,
      blocked: false,
      kiteApiKey: '',
      note: 'Owner',
      createdAt: now,
      updatedAt: now,
    });
    console.log('[auth] seeded owner user', OWNER_SEED.username);
    return;
  }
  // Keep owner password in sync with credentials.js (fixes stale Mongo hashes)
  await db.collection(COL).updateOne(
    { _id: existing._id },
    {
      $set: {
        passwordHash,
        role: 'owner',
        modules: normalizeModules(OWNER_SEED.modules, 'owner'),
        blocked: false,
        updatedAt: now,
      },
    },
  );
  console.log('[auth] synced owner password from credentials', OWNER_SEED.username);
}

async function findByUsername(username) {
  const db = getDb();
  if (!db) return null;
  const u = String(username || '').trim();
  if (!u) return null;
  // Exact match first, then case-insensitive (Devil / devil)
  const exact = await db.collection(COL).findOne({ username: u });
  if (exact) return exact;
  return db.collection(COL).findOne({
    username: { $regex: `^${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
  });
}

async function findById(id) {
  const db = getDb();
  if (!db) return null;
  const { ObjectId } = require('mongodb');
  try {
    return db.collection(COL).findOne({ _id: new ObjectId(id) });
  } catch {
    return null;
  }
}

async function verifyPassword(username, password) {
  const doc = await findByUsername(username);
  if (!doc) return { ok: false, reason: 'invalid' };
  if (doc.blocked) return { ok: false, reason: 'blocked', user: doc };
  const pwd = String(password || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  // Site login: Mongo bcrypt only (Devil + Admin-created friends)
  const match = await bcrypt.compare(pwd, doc.passwordHash || '');
  if (!match) return { ok: false, reason: 'invalid' };
  return { ok: true, user: doc };
}

async function listUsers() {
  const db = getDb();
  if (!db) return [];
  const rows = await db.collection(COL).find({}).sort({ createdAt: -1 }).toArray();
  return rows.map(publicUser);
}

async function createUser({ username, password, modules, kiteApiKey, note }) {
  const db = getDb();
  if (!db) {
    const err = new Error('Mongo required for users');
    err.status = 503;
    throw err;
  }
  const u = String(username || '').trim();
  if (!u || u.length < 2) {
    const err = new Error('username required');
    err.status = 400;
    throw err;
  }
  if (u.toLowerCase() === 'angel' || u.toLowerCase() === 'admin') {
    const err = new Error('reserved username');
    err.status = 400;
    throw err;
  }
  const existing = await findByUsername(u);
  if (existing) {
    const err = new Error('username already exists');
    err.status = 409;
    throw err;
  }
  const pwd = String(password || '');
  if (pwd.length < 6) {
    const err = new Error('password min 6 chars');
    err.status = 400;
    throw err;
  }
  const now = new Date().toISOString();
  const role = u === OWNER_SEED.username ? 'owner' : 'friend';
  const doc = {
    username: u,
    passwordHash: await bcrypt.hash(pwd, 10),
    role,
    modules: normalizeModules(modules, role),
    blocked: false,
    kiteApiKey: String(kiteApiKey || '').trim(),
    note: String(note || '').trim().slice(0, 200),
    createdAt: now,
    updatedAt: now,
  };
  const res = await db.collection(COL).insertOne(doc);
  doc._id = res.insertedId;
  return publicUser(doc);
}

async function updateUser(id, patch) {
  const db = getDb();
  if (!db) {
    const err = new Error('Mongo required');
    err.status = 503;
    throw err;
  }
  const doc = await findById(id);
  if (!doc) {
    const err = new Error('user not found');
    err.status = 404;
    throw err;
  }
  const $set = { updatedAt: new Date().toISOString() };
  if (patch.modules != null) {
    $set.modules = normalizeModules(patch.modules, doc.role);
  }
  if (patch.blocked != null) $set.blocked = !!patch.blocked;
  if (patch.kiteApiKey != null) $set.kiteApiKey = String(patch.kiteApiKey).trim();
  if (patch.note != null) $set.note = String(patch.note).trim().slice(0, 200);
  if (patch.password) {
    if (String(patch.password).length < 6) {
      const err = new Error('password min 6 chars');
      err.status = 400;
      throw err;
    }
    $set.passwordHash = await bcrypt.hash(String(patch.password), 10);
  }
  await db.collection(COL).updateOne({ _id: doc._id }, { $set });
  return publicUser({ ...doc, ...$set });
}

module.exports = {
  ensureOwnerSeed,
  findByUsername,
  findById,
  verifyPassword,
  listUsers,
  createUser,
  updateUser,
  publicUser,
  normalizeModules,
  FRIEND_MODULES,
  ALL_MODULES,
};
