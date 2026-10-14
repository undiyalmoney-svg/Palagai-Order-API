'use strict';

const { HeatmapService } = require('./service');
const { createHeatmapRouter } = require('./routes');

let service = null;
let authGet = null;

function applyHeatmapAuth(opts = {}) {
  if (typeof opts.getAuthorization === 'function') authGet = opts.getAuthorization;
  if (service) service.getAuthorization = deskAuthorization;
}

async function deskAuthorization() {
  if (typeof authGet === 'function') {
    const header = await authGet();
    if (header) return header;
  }
  try {
    const { getMomentumApp } = require('../momentum/instance');
    const sessions = getMomentumApp().momentum.sessions;
    return typeof sessions.latestAuthorization === 'function' ? sessions.latestAuthorization() : null;
  } catch {
    return null;
  }
}

function getHeatmapService() {
  if (!service) {
    service = new HeatmapService({ getAuthorization: deskAuthorization });
  }
  return service;
}

function getHeatmapRouter() {
  return createHeatmapRouter(getHeatmapService());
}

module.exports = { getHeatmapService, getHeatmapRouter, applyHeatmapAuth };
