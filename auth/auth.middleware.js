const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_DAYS, ADMIN } = require('./credentials');
const users = require('./users.store');

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
      res.status(401).json({ status: 'error', message: 'User not found' });
      return;
    }
    if (doc.blocked) {
      res.status(403).json({
        status: 'error',
        message: 'Contact admin',
        code: 'BLOCKED',
      });
      return;
    }
    req.user = users.publicUser(doc);
    req.userDoc = doc;
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
    const mods = req.user?.modules || [];
    if (req.user?.role === 'owner' || mods.includes(moduleId)) {
      next();
      return;
    }
    res.status(403).json({ status: 'error', message: `No access to ${moduleId}` });
  };
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
  optionalSiteUser,
  bearer,
};
