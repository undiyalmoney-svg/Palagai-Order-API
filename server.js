const app = require('./app');
const { config } = require('./config/env');
const { connectMongo } = require('./live/live.mongo');
const liveStore = require('./live/live.store');
const usersStore = require('./auth/users.store');

async function boot() {
  try {
    const mongo = await connectMongo();
    if (mongo?.db) {
      await liveStore.attachMongo(mongo.db);
      await usersStore.ensureOwnerSeed();
      await usersStore.ensureTestModuleForAll();
    }
  } catch (err) {
    console.error('[palagai-order-api] mongo attach failed (Kite order API still up):', err.message);
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[palagai-order-api] listening on 0.0.0.0:${config.port}`);
    console.log(`[palagai-order-api] CORS origins: ${config.frontendUrls.join(', ')}`);
    console.log(`[palagai-order-api] Kite base: ${config.kiteApiBaseUrl}`);
    console.log('[palagai-order-api] Auth/Admin/Vault/Live · /api/kite/* unchanged');
  });
}

boot();
