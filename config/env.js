require('dotenv').config();

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  port: Number(process.env.PORT || 3000),
  kiteApiBaseUrl: (process.env.KITE_API_BASE_URL || 'https://api.kite.trade').replace(/\/$/, ''),
  frontendUrls: splitCsv(
    process.env.FRONTEND_URLS ||
      process.env.FRONTEND_URL ||
      'https://palagai.app,http://localhost:4200,http://127.0.0.1:4200',
  ),
};

module.exports = { config };
