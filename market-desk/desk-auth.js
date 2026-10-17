'use strict';

const { PUBLIC_SESSION_KEY } = require('../auth/credentials');

function sessions() {
  const { getMomentumApp } = require('../momentum/instance');
  return getMomentumApp().momentum.sessions;
}

async function publicViewAuthorization() {
  try {
    const store = sessions();
    const shared = store.authorization(PUBLIC_SESSION_KEY);
    if (shared) return shared;
    const users = require('../auth/users.store');
    const pub = await users.findPublicUser();
    if (pub?._id) {
      const fromUser = store.authorization(String(pub._id));
      if (fromUser) return fromUser;
    }
    const owner = await users.findOwner();
    if (owner?._id) return store.authorization(String(owner._id)) || null;
  } catch {
    return null;
  }
  return null;
}

async function deskAuthorization(req, fallbackGet) {
  const header = req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] || '';
  if (req.user?.role === 'public') {
    return (await publicViewAuthorization()) || header || null;
  }
  if (/^token\s+[^:\s]+:\S+/i.test(String(header))) return header;
  if (typeof fallbackGet === 'function') {
    try {
      const fromUser = await fallbackGet(req.user?.id);
      if (fromUser) return fromUser;
    } catch {
      // fall through
    }
  }
  try {
    if (req.user?.id) return sessions().authorization(req.user.id) || header || null;
  } catch {
    return header || null;
  }
  return header || null;
}

module.exports = { publicViewAuthorization, deskAuthorization, PUBLIC_SESSION_KEY };
