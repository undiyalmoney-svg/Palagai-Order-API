const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_DAYS, ADMIN, OWNER_SEED } = require('./credentials');
const users = require('./users.store');
const { getDb } = require('../lib/mongo');

function isSiteOwner(user) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  return String(user.username || '').toLowerCase() === String(OWNER_SEED.username).toLowerCase();
}

function userFromJwt(payload) {
  if (!payload?.sub || payload.role === 'admin') return null;
  return {
    id: String(payload.sub),
    username: payload.username,
    role: payload.role || 'friend',
    modules: Array.isArray(payload.modules) ? payload.modules : [],
  };
}

function signUserToken(userDoc) {
  const payload = {
    sub: String(userDoc._id),
    username: userDoc.username,
    role: userDoc.role || 'friend',
    modules: userDoc.modules || [],
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: `${JWT_DAYS}d` });
}

function signAdminToken() {
  return jwt.sign(
    { sub: 'admin', username: ADMIN.username, role: 'admin', modules: ['admin'] },
    JWT_SECRET,
    { expiresIn: `${JWT_DAYS}d` },
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

async function requireSiteUser(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) {
      res.status(401).json({ status: 'error', message: 'Login required' });
      return;
    }
    const payload = verifyToken(token);
    if (payload.role === 'admin') {
      res.status(403).json({ status: 'error', message: 'Use site login, not admin' });
      return;
    }
    const doc = await users.findById(payload.sub);
    if (!doc) {
      // JWT already carries id/role/modules. When Mongo is not attached the
      // momentum app still has to run (synthetic data, paper trading).
      const fallback = !getDb() ? userFromJwt(payload) : null;
      if (fallback) {
        if (!isSiteOwner(fallback)) {
          res.status(403).json({ status: 'error', message: 'This desk is limited to the site owner.' });
          return;
        }
        req.user = fallback;
        next();
        return;
      }
      res.status(401).json({ status: 'error', message: 'User not found' });
      return;
    }
    if (doc.blocked) {
      const msg = String(doc.adminMessage || '').trim();
      res.status(403).json({
        status: 'error',
        message: msg || 'Contact admin',
        code: 'BLOCKED',
        adminMessage: msg || '',
      });
      return;
    }
    req.user = users.publicUser(doc);
    req.userDoc = doc;
    if (!isSiteOwner(req.user)) {
      res.status(403).json({ status: 'error', message: 'This desk is limited to the site owner.' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ status: 'error', message: 'Invalid or expired session' });
  }
}

function requireAdmin(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) {
      res.status(401).json({ status: 'error', message: 'Admin login required' });
      return;
    }
    const payload = verifyToken(token);
    if (
      payload.role !== 'admin' ||
      String(payload.username || '').toLowerCase() !== String(ADMIN.username).toLowerCase()
    ) {
      res.status(403).json({ status: 'error', message: 'Admin only' });
      return;
    }
    req.admin = { username: ADMIN.username, role: 'admin' };
    next();
  } catch {
    res.status(401).json({ status: 'error', message: 'Invalid admin session' });
  }
}

function requireModule(moduleId) {
  return (req, res, next) => {
    if (req.user?.role === 'public') {
      res.status(403).json({ status: 'error', message: 'Public viewers can only use Charts.' });
      return;
    }
    const mods = req.user?.modules || [];
    if (req.user?.role === 'owner' || mods.includes(moduleId)) {
      next();
      return;
    }
    res.status(403).json({ status: 'error', message: `No access to ${moduleId}` });
  };
}

/** Charts / market-desk — the only live surface Public may call. */
function requireCharts(req, res, next) {
  if (req.user?.role === 'public' || req.user?.role === 'owner') {
    next();
    return;
  }
  const mods = req.user?.modules || [];
  if (mods.includes('auto')) {
    next();
    return;
  }
  res.status(403).json({ status: 'error', message: 'No access to Charts' });
}

/** Optional site user — attaches req.user when Bearer present. */
async function optionalSiteUser(req, _res, next) {
  try {
    const token = bearer(req);
    if (!token) {
      next();
      return;
    }
    const payload = verifyToken(token);
    if (payload.role === 'admin') {
      next();
      return;
    }
    const doc = await users.findById(payload.sub);
    if (doc && !doc.blocked) {
      req.user = users.publicUser(doc);
      req.userDoc = doc;
    }
  } catch {
    // ignore
  }
  next();
}

module.exports = {
  signUserToken,
  signAdminToken,
  verifyToken,
  requireSiteUser,
  requireAdmin,
  requireModule,
  requireCharts,
  optionalSiteUser,
  bearer,
  isSiteOwner,
};
