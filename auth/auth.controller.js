const users = require('./users.store');
const vault = require('./vault.store');
const {
  ADMIN,
  OWNER_SEED,
  FRIEND_MODULES,
  ALL_MODULES,
} = require('./credentials');
const {
  signUserToken,
  signAdminToken,
} = require('./auth.middleware');

function readCreds(body) {
  const username = String(body?.username || '')
    .replace(/^\uFEFF/, '')
    .trim();
  // Trim ends only — mobile/autofill often leaves a trailing newline/space
  const password = String(body?.password || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  return { username, password };
}

async function siteLogin(req, res) {
  const { username, password } = readCreds(req.body);
  const result = await users.verifyPassword(username, password);
  if (!result.ok) {
    if (result.reason === 'blocked') {
      res.status(403).json({
        status: 'error',
        message: 'Contact admin',
        code: 'BLOCKED',
      });
      return;
    }
    res.status(401).json({ status: 'error', message: 'Invalid username or password' });
    return;
  }
  const token = signUserToken(result.user);
  res.json({
    status: 'ok',
    token,
    user: users.publicUser(result.user),
  });
}

async function siteMe(req, res) {
  res.json({ status: 'ok', user: req.user });
}

async function adminLogin(req, res) {
  const { username, password } = readCreds(req.body);
  const userOk = username.toLowerCase() === String(ADMIN.username).toLowerCase();
  // Accept admin password OR site-owner password (Badgoodu vs Goodbadu mix-ups)
  const passOk =
    password === ADMIN.password || password === OWNER_SEED.password;
  if (!userOk || !passOk) {
    res.status(401).json({
      status: 'error',
      message: 'Invalid admin credentials (user angel — check Badgoodu vs Goodbadu)',
    });
    return;
  }
  res.json({
    status: 'ok',
    token: signAdminToken(),
    admin: { username: ADMIN.username, role: 'admin' },
  });
}

async function adminListUsers(_req, res) {
  res.json({
    status: 'ok',
    users: await users.listUsers(),
    friendModules: FRIEND_MODULES,
    allModules: ALL_MODULES,
  });
}

async function adminCreateUser(req, res) {
  const user = await users.createUser(req.body || {});
  res.status(201).json({ status: 'ok', user });
}

async function adminUpdateUser(req, res) {
  const user = await users.updateUser(req.params.id, req.body || {});
  res.json({ status: 'ok', user });
}

async function vaultList(req, res) {
  const password = req.body?.password || req.headers['x-vault-password'];
  const secrets = await vault.listSecrets(password);
  res.json({ status: 'ok', secrets, logins: vault.loginCards() });
}

async function vaultUpsert(req, res) {
  const { password, key, value } = req.body || {};
  const out = await vault.upsertSecret(password, { key, value });
  res.json({ status: 'ok', ...out });
}

async function vaultRemove(req, res) {
  const password = req.body?.password || req.headers['x-vault-password'];
  await vault.removeSecret(password, req.params.key);
  res.json({ status: 'ok' });
}

async function vaultSeed(req, res) {
  const secrets = await vault.seedDefaults(req.body?.password);
  res.json({ status: 'ok', secrets, logins: vault.loginCards() });
}

module.exports = {
  siteLogin,
  siteMe,
  adminLogin,
  adminListUsers,
  adminCreateUser,
  adminUpdateUser,
  vaultList,
  vaultUpsert,
  vaultRemove,
  vaultSeed,
};
