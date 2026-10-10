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

function startResearchSupervisor() {
  if (worker) return worker;
  worker = startResearchWorker(getResearchService());
  return worker;
}

module.exports = { getResearchService, startResearchSupervisor, buildService };
