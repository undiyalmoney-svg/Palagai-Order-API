const app = require('./app');
const { config } = require('./config/env');
const { connectMongo } = require('./lib/mongo');
const usersStore = require('./auth/users.store');
const { getMomentumApp, startMomentumScheduler } = require('./momentum/instance');
const { startResearchSupervisor } = require('./research/instance');
const { start: startChartsProtect } = require('./charts-protect/worker');
const { start: startSlBuddy } = require('./sl-buddy/worker');
const { start: startPdhLive } = require('./pdh-live/worker');
const { applyMarketDeskAuth } = require('./market-desk/instance');

async function boot() {
  try {
    const mongo = await connectMongo();
    if (mongo?.db) {
      await usersStore.ensureOwnerSeed();
      await usersStore.ensurePublicSeed();
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
    startResearchSupervisor({
      getAuthorization: async () => {
        const sessions = getMomentumApp().momentum.sessions;
        try {
          const sl = require('./sl-buddy/store').load();
          if (sl.userId) {
            const header = sessions.authorization(sl.userId);
            if (header) return header;
          }
        } catch {
          // SL Buddy state is optional
        }
        try {
          const protect = require('./charts-protect/store').load();
          if (protect.userId) {
            const header = sessions.authorization(protect.userId);
            if (header) return header;
          }
        } catch {
          // Protect state is optional
        }
        return typeof sessions.latestAuthorization === 'function' ? sessions.latestAuthorization() : null;
      },
      saveAuthorization: (userId, apiKey, accessToken) => {
        if (!userId || !apiKey || !accessToken) return false;
        try {
          getMomentumApp().momentum.sessions.save(userId, apiKey, accessToken);
          return true;
        } catch {
          return false;
        }
      },
    });
    startChartsProtect({
      getAuthorization: async (userId) => {
        if (!userId) return null;
        return getMomentumApp().momentum.sessions.authorization(userId);
      },
    });
    startSlBuddy({
      getAuthorization: async (userId) => {
        if (!userId) return null;
        return getMomentumApp().momentum.sessions.authorization(userId);
      },
      saveAuthorization: (userId, apiKey, accessToken) => {
        if (!userId || !apiKey || !accessToken) return false;
        try {
          getMomentumApp().momentum.sessions.save(userId, apiKey, accessToken);
          return true;
        } catch {
          return false;
        }
      },
    });
    startPdhLive({
      getAuthorization: async (userId) => {
        if (!userId) return null;
        return getMomentumApp().momentum.sessions.authorization(userId);
      },
      saveAuthorization: (userId, apiKey, accessToken) => {
        if (!userId || !apiKey || !accessToken) return false;
        try {
          getMomentumApp().momentum.sessions.save(userId, apiKey, accessToken);
          return true;
        } catch {
          return false;
        }
      },
    });
    applyMarketDeskAuth({
      getAuthorization: async (userId) => {
        if (!userId) return null;
        return getMomentumApp().momentum.sessions.authorization(userId);
      },
    });
  });
}

boot();
