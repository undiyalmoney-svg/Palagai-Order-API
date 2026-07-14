const app = require('./app');
const { config } = require('./config/env');

app.listen(config.port, '0.0.0.0', () => {
  console.log(`[palagai-order-api] listening on 0.0.0.0:${config.port}`);
  console.log(`[palagai-order-api] CORS origins: ${config.frontendUrls.join(', ')}`);
  console.log(`[palagai-order-api] Kite base: ${config.kiteApiBaseUrl}`);
});
