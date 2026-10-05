'use strict';

const path = require('path');
const { openDatabase, DEFAULT_PATH } = require('./db/database');
const { Store } = require('./db/store');
const { MarketDataService } = require('./services/market-data-service');
const { MomentumService } = require('./services/momentum-service');
const { ResearchService } = require('./services/research-service');
const { JobRunner } = require('./jobs/jobs');
const { SyntheticProvider } = require('./data/synthetic-provider');
const { KiteProvider } = require('./providers/kite-provider');
const { CORE_UNIVERSE, BOOK_ETFS } = require('./data/universe');

function defaultKiteTapePath(dbPath) {
  if (!dbPath || dbPath === ':memory:') return null;
  return path.join(path.dirname(dbPath), 'kite-tape.sqlite');
}

/**
 * Composition root. Everything takes its clock, provider and broker from here,
 * so tests build the same object graph with an in-memory database, a fixed
 * clock and a scripted broker.
 */
function createMomentumApp({
  dbPath = DEFAULT_PATH,
  kiteTapePath,
  clock = () => new Date(),
  provider = null,
  brokerOverride = null,
  log = () => {},
  coreOnly = false,
} = {}) {
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
    return new SyntheticProvider({
      now: clock,
      universe: coreOnly ? [...CORE_UNIVERSE, ...BOOK_ETFS] : undefined,
    });
  };
  const tapePath = kiteTapePath === undefined ? defaultKiteTapePath(dbPath) : kiteTapePath;
  const marketData = new MarketDataService({ store, providerFor, clock, kiteTapePath: tapePath });
  momentum = new MomentumService({ store, marketData, clock, providerFor, brokerOverride });
  momentum.paperProviderFor = async (userId) => {
    if (provider && provider.id === 'kite') return provider;
    const auth = userId ? momentum.sessions.authorization(userId) : null;
    if (!auth || !marketData.kiteTape) return null;
    return new KiteProvider({
      getAuthorization: async () => momentum.sessions.authorization(userId),
      now: clock,
    });
  };
  const research = new ResearchService({ store, marketData, momentum, dbPath });
  const jobs = new JobRunner({ store, marketData, momentum, research, providerFor, clock, log });
  return {
    db,
    store,
    marketData,
    momentum,
    research,
    jobs,
    close: () => {
      jobs.stop();
      marketData.close();
      db.close();
    },
  };
}

module.exports = { createMomentumApp, defaultKiteTapePath };
