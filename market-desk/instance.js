'use strict';

const { MarketDeskService } = require('./service');
const { createMarketDeskRouter } = require('./routes');

let service = null;
let authGet = null;

function applyMarketDeskAuth(opts = {}) {
  if (typeof opts.getAuthorization === 'function') authGet = opts.getAuthorization;
  if (service) service.getSessionAuthorization = userAuthorization;
}

async function userAuthorization(userId) {
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
    const sessions = getMomentumApp().momentum.sessions;
    if (typeof sessions.authorization === 'function') return sessions.authorization(userId) || null;
  } catch {
    return null;
  }
  return null;
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

module.exports = { getMarketDeskService, getMarketDeskRouter, applyMarketDeskAuth };
