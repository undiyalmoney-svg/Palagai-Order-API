'use strict';

const { openDatabase, DEFAULT_PATH } = require('./db/database');
const { Store } = require('./db/store');
const { MarketDataService } = require('./services/market-data-service');
const { MomentumService } = require('./services/momentum-service');
const { ResearchService } = require('./services/research-service');
const { JobRunner } = require('./jobs/jobs');
const { SyntheticProvider } = require('./data/synthetic-provider');
const { KiteProvider } = require('./providers/kite-provider');

/**
 * Composition root. Everything takes its clock, provider and broker from here,
 * so tests build the same object graph with an in-memory database, a fixed
 * clock and a scripted broker.
 */
function createMomentumApp({ dbPath = DEFAULT_PATH, clock = () => new Date(), provider = null, brokerOverride = null, log = () => {} } = {}) {
  const db = openDatabase(dbPath);
  const store = new Store(db, { clock });
  store.failStaleRuns();
  let momentum = null;
  const providerFor = async () => {
    if (provider) return provider;
    if (String(process.env.MOMENTUM_PROVIDER || 'synthetic').toLowerCase() === 'kite') {
      const userId = process.env.MOMENTUM_DATA_USER;
      return new KiteProvider({ getAuthorization: async () => (userId ? momentum.sessions.authorization(userId) : null), now: clock });
    }
    return new SyntheticProvider({ now: clock });
  };
  const marketData = new MarketDataService({ store, providerFor, clock });
  momentum = new MomentumService({ store, marketData, clock, providerFor, brokerOverride });
  const research = new ResearchService({ store, marketData, momentum, dbPath });
  const jobs = new JobRunner({ store, marketData, momentum, research, providerFor, clock, log });
  return { db, store, marketData, momentum, research, jobs, close: () => { jobs.stop(); db.close(); } };
}

module.exports = { createMomentumApp };
