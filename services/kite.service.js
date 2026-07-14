const axios = require('axios');
const { config } = require('../config/env');

/**
 * Thin Kite Connect client for order-related endpoints only.
 * Always uses this machine's egress IP (DigitalOcean static IP).
 */
class KiteService {
  constructor() {
    this.client = axios.create({
      baseURL: config.kiteApiBaseUrl,
      timeout: 30_000,
      validateStatus: () => true,
    });
  }

  headers(authorization, contentType) {
    const h = {
      'X-Kite-Version': '3',
    };
    if (authorization) {
      h.Authorization = authorization;
    }
    if (contentType) {
      h['Content-Type'] = contentType;
    }
    return h;
  }

  async placeOrder(authorization, variety, fields) {
    const body = new URLSearchParams(fields).toString();
    return this.client.post(`/orders/${variety}`, body, {
      headers: this.headers(authorization, 'application/x-www-form-urlencoded'),
    });
  }

  async modifyOrder(authorization, variety, orderId, fields) {
    const body = new URLSearchParams(fields).toString();
    return this.client.put(`/orders/${variety}/${encodeURIComponent(orderId)}`, body, {
      headers: this.headers(authorization, 'application/x-www-form-urlencoded'),
    });
  }

  async cancelOrder(authorization, variety, orderId) {
    return this.client.delete(`/orders/${variety}/${encodeURIComponent(orderId)}`, {
      headers: this.headers(authorization),
    });
  }

  async getOrders(authorization) {
    return this.client.get('/orders', {
      headers: this.headers(authorization),
    });
  }

  async getOrderHistory(authorization, orderId) {
    return this.client.get(`/orders/${encodeURIComponent(orderId)}`, {
      headers: this.headers(authorization),
    });
  }

  async getTrades(authorization) {
    return this.client.get('/trades', {
      headers: this.headers(authorization),
    });
  }

  async getOrderTrades(authorization, orderId) {
    return this.client.get(`/orders/${encodeURIComponent(orderId)}/trades`, {
      headers: this.headers(authorization),
    });
  }

  async getPositions(authorization) {
    return this.client.get('/portfolio/positions', {
      headers: this.headers(authorization),
    });
  }
}

module.exports = { kiteService: new KiteService() };
