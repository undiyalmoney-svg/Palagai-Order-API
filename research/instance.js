'use strict';

const { getDb } = require('../lib/mongo');
const { MemoryStore, MongoStore } = require('./store');
const { ResearchService } = require('./service');
const { KiteFeed } = require('./feed');
const { startResearchWorker } = require('./worker');
const { nifty50 } = require('./universe');

let service = null;
let worker = null;

function buildService() {
  const db = getDb();
  const store = db ? new MongoStore(db) : new MemoryStore();
  const feed = new KiteFeed({ instruments: nifty50(), store });
  return new ResearchService({ store, feed, log: (m) => console.log(m) });
}

function getResearchService() {
  if (!service) service = buildService();
  return service;
}

function applyResearchAuth(svc, opts = {}) {
  if (opts.getAuthorization && svc.feed) svc.feed.getAuthorization = opts.getAuthorization;
  if (opts.saveAuthorization) svc.saveAuthorization = opts.saveAuthorization;
}

function startResearchSupervisor(opts = {}) {
  const svc = getResearchService();
  applyResearchAuth(svc, opts);
  if (worker) return worker;
  worker = startResearchWorker(svc);
  if (svc.feed && typeof svc.feed.restoreSession === 'function') {
    void svc.feed.restoreSession().then((creds) => {
      if (creds) console.log('[research] restored Kite session from the saved broker token');
    });
  }
  return worker;
}

module.exports = { getResearchService, startResearchSupervisor, buildService, applyResearchAuth };
