const { kiteService } = require('../services/kite.service');

function requireAuth(req) {
  const authorization = req.headers.authorization;
  if (!authorization || typeof authorization !== 'string') {
    const err = new Error('Missing Authorization header (token api_key:access_token)');
    err.status = 401;
    throw err;
  }
  return authorization;
}

function fieldsFromBody(body) {
  if (!body || typeof body !== 'object') {
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (value == null) continue;
    out[key] = Array.isArray(value) ? String(value[0] ?? '') : String(value);
  }
  return out;
}

function sendKite(res, axiosResponse) {
  const status = axiosResponse.status || 502;
  const data = axiosResponse.data;
  if (data != null && typeof data === 'object') {
    res.status(status).json(data);
    return;
  }
  res.status(status).send(data ?? '');
}

async function placeOrder(req, res) {
  const authorization = requireAuth(req);
  const variety = req.params.variety || 'regular';
  const fields = fieldsFromBody(req.body);
  console.log('[kite] PLACE', variety, fields.tradingsymbol || '', fields.transaction_type || '');
  const response = await kiteService.placeOrder(authorization, variety, fields);
  if (response.status >= 400) {
    console.error('[kite] PLACE failed', response.status, response.data);
  }
  sendKite(res, response);
}

async function modifyOrder(req, res) {
  const authorization = requireAuth(req);
  const { variety, orderId } = req.params;
  const fields = fieldsFromBody(req.body);
  console.log('[kite] MODIFY', variety, orderId);
  const response = await kiteService.modifyOrder(authorization, variety, orderId, fields);
  if (response.status >= 400) {
    console.error('[kite] MODIFY failed', response.status, response.data);
  }
  sendKite(res, response);
}

async function cancelOrder(req, res) {
  const authorization = requireAuth(req);
  const { variety, orderId } = req.params;
  console.log('[kite] CANCEL', variety, orderId);
  const response = await kiteService.cancelOrder(authorization, variety, orderId);
  if (response.status >= 400) {
    console.error('[kite] CANCEL failed', response.status, response.data);
  }
  sendKite(res, response);
}

async function getOrders(req, res) {
  const authorization = requireAuth(req);
  const response = await kiteService.getOrders(authorization);
  sendKite(res, response);
}

async function getOrderHistory(req, res) {
  const authorization = requireAuth(req);
  const response = await kiteService.getOrderHistory(authorization, req.params.orderId);
  sendKite(res, response);
}

async function getTrades(req, res) {
  const authorization = requireAuth(req);
  const response = await kiteService.getTrades(authorization);
  sendKite(res, response);
}

async function getOrderTrades(req, res) {
  const authorization = requireAuth(req);
  const response = await kiteService.getOrderTrades(authorization, req.params.orderId);
  sendKite(res, response);
}

async function getPositions(req, res) {
  const authorization = requireAuth(req);
  const response = await kiteService.getPositions(authorization);
  sendKite(res, response);
}

function health(_req, res) {
  res.json({ status: 'ok', service: 'palagai-order-api' });
}

module.exports = {
  placeOrder,
  modifyOrder,
  cancelOrder,
  getOrders,
  getOrderHistory,
  getTrades,
  getOrderTrades,
  getPositions,
  health,
};
