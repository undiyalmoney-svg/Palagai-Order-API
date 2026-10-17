'use strict';

const { MarketDeskService } = require('./service');
const { createMarketDeskRouter } = require('./routes');
const { publicViewAuthorization } = require('./desk-auth');

let service = null;
let authGet = null;

async function userAuthorization(userId, role) {
  if (role === 'public') return publicViewAuthorization();
  if (!userId) return null;
  if (typeof authGet === 'function') {
    try {
      const header = await authGet(userId);
      if (header) return header;
    } catch {
      // fall through
    }
  }
  try {
    const { getMomentumApp } = require('../momentum/instance');
    return getMomentumApp().momentum.sessions.authorization(userId) || null;
  } catch {
    return null;
  }
}

function applyMarketDeskAuth(opts = {}) {
  if (typeof opts.getAuthorization === 'function') authGet = opts.getAuthorization;
  if (service) service.getSessionAuthorization = userAuthorization;
}

function getMarketDeskService() {
  if (!service) {
    service = new MarketDeskService({ getSessionAuthorization: userAuthorization });
  }
  return service;
}

function getMarketDeskRouter() {
  return createMarketDeskRouter(getMarketDeskService());
}

module.exports = {
  getMarketDeskService,
  getMarketDeskRouter,
  applyMarketDeskAuth,
  userAuthorization,
  publicViewAuthorization,
};
