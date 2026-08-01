/**
 * Mongo users for site login (friends + owner).
 * passwordHash = bcrypt for /login
 * passwordPlain = visible/editable in Admin only (not returned on site /me)
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

/** Admin list/detail — includes plaintext password for editing */
function adminUser(doc) {
  if (!doc) return null;
  return {
    ...publicUser(doc),
    password: doc.passwordPlain || '',
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
  // Order Test is available to every site user (Devil + friends)
  set.add('test');
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
      passwordPlain: OWNER_SEED.password,
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
  // Existing owner: keep Admin-edited password; only enforce role/modules/no API key
  await db.collection(COL).updateOne(
    { _id: existing._id },
    {
      $set: {
        role: 'owner',
        modules: normalizeModules(OWNER_SEED.modules, 'owner'),
        blocked: false,
        kiteApiKey: '',
        updatedAt: now,
        ...(!existing.passwordPlain
          ? { passwordHash, passwordPlain: OWNER_SEED.password }
          : {}),
      },
    },
  );
  console.log('[auth] synced owner profile', OWNER_SEED.username);
}

async function ensureTestModuleForAll() {
  const db = getDb();
  if (!db) return;
  const rows = await db.collection(COL).find({}).toArray();
  for (const doc of rows) {
    const modules = normalizeModules(doc.modules || [], doc.role || 'friend');
    if ((doc.modules || []).includes('test') && modules.length === (doc.modules || []).length) {
      continue;
    }
    await db.collection(COL).updateOne(
      { _id: doc._id },
      { $set: { modules, updatedAt: new Date().toISOString() } },
    );
  }
  console.log('[auth] ensured test module for all users');
}

async function findByUsername(username) {
  const db = getDb();
  if (!db) return null;
  const u = String(username || '').trim();
  if (!u) return null;
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
  const match = await bcrypt.compare(pwd, doc.passwordHash || '');
  if (!match) return { ok: false, reason: 'invalid' };
  return { ok: true, user: doc };
}

async function listUsers() {
  const db = getDb();
  if (!db) return [];
  const rows = await db.collection(COL).find({}).sort({ createdAt: -1 }).toArray();
  return rows.map(adminUser);
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
  const pwd = String(password || '').trim();
  if (pwd.length < 6) {
    const err = new Error('password min 6 chars');
    err.status = 400;
    throw err;
  }
  const role = u === OWNER_SEED.username ? 'owner' : 'friend';
  const key = String(kiteApiKey || '').trim();
  if (role !== 'owner' && !key) {
    const err = new Error('Kite API key required for friends');
    err.status = 400;
    throw err;
  }
  const now = new Date().toISOString();
  const doc = {
    username: u,
    passwordHash: await bcrypt.hash(pwd, 10),
    passwordPlain: pwd,
    role,
    modules: normalizeModules(modules, role),
    blocked: false,
    kiteApiKey: role === 'owner' ? '' : key,
    note: String(note || '').trim().slice(0, 200),
    createdAt: now,
    updatedAt: now,
  };
  const res = await db.collection(COL).insertOne(doc);
  doc._id = res.insertedId;
  return adminUser(doc);
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

  if (patch.username != null) {
    const u = String(patch.username || '').trim();
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
    if (doc.role === 'owner' && u !== OWNER_SEED.username) {
      const err = new Error('cannot rename owner away from Devil');
      err.status = 400;
      throw err;
    }
    const clash = await findByUsername(u);
    if (clash && String(clash._id) !== String(doc._id)) {
      const err = new Error('username already exists');
      err.status = 409;
      throw err;
    }
    $set.username = u;
  }

  if (patch.modules != null) {
    $set.modules = normalizeModules(patch.modules, doc.role);
  }
  if (patch.blocked != null) $set.blocked = !!patch.blocked;
  if (doc.role === 'owner') {
    $set.kiteApiKey = '';
  } else if (patch.kiteApiKey != null) {
    const key = String(patch.kiteApiKey).trim();
    if (!key) {
      const err = new Error('Kite API key required for friends');
      err.status = 400;
      throw err;
    }
    $set.kiteApiKey = key;
  }
  if (patch.note != null) $set.note = String(patch.note).trim().slice(0, 200);
  if (patch.password != null && String(patch.password).length > 0) {
    const pwd = String(patch.password).trim();
    if (pwd.length < 6) {
      const err = new Error('password min 6 chars');
      err.status = 400;
      throw err;
    }
    $set.passwordHash = await bcrypt.hash(pwd, 10);
    $set.passwordPlain = pwd;
  }
  await db.collection(COL).updateOne({ _id: doc._id }, { $set });
  const updated = await findById(id);
  return adminUser(updated);
}

module.exports = {
  ensureOwnerSeed,
  ensureTestModuleForAll,
  findByUsername,
  findById,
  verifyPassword,
  listUsers,
  createUser,
  updateUser,
  publicUser,
  adminUser,
  normalizeModules,
  FRIEND_MODULES,
  ALL_MODULES,
};
