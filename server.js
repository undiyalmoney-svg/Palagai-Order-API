const app = require('./app');
const { config } = require('./config/env');
const { connectMongo } = require('./lib/mongo');
const usersStore = require('./auth/users.store');
const { getMomentumApp, startMomentumScheduler } = require('./momentum/instance');
const { start: startChartsProtect } = require('./charts-protect/worker');

async function boot() {
  try {
    const mongo = await connectMongo();
    if (mongo?.db) {
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
    console.log('[palagai-order-api] Auth/Admin/Vault/P&L · Momentum Portfolio Manager · /api/kite/* unchanged');
    startMomentumScheduler();
    startChartsProtect({
      getAuthorization: async (userId) => {
        if (!userId) return null;
        return getMomentumApp().momentum.sessions.authorization(userId);
      },
    });
  });
}

boot();
