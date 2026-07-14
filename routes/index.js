const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const ctrl = require('../controllers/kiteOrders.controller');

const router = express.Router();

/**
 * Same path shapes as Kite Connect / existing Palagai proxy:
 * POST   /api/kite/orders/:variety
 * ...
 */
const kiteRouter = express.Router();

kiteRouter.get('/health', ctrl.health);
kiteRouter.post('/orders/:variety', asyncHandler(ctrl.placeOrder));
kiteRouter.put('/orders/:variety/:orderId', asyncHandler(ctrl.modifyOrder));
kiteRouter.delete('/orders/:variety/:orderId', asyncHandler(ctrl.cancelOrder));
kiteRouter.get('/orders', asyncHandler(ctrl.getOrders));
kiteRouter.get('/orders/:orderId/trades', asyncHandler(ctrl.getOrderTrades));
kiteRouter.get('/orders/:orderId', asyncHandler(ctrl.getOrderHistory));
kiteRouter.get('/trades', asyncHandler(ctrl.getTrades));
kiteRouter.get('/portfolio/positions', asyncHandler(ctrl.getPositions));

router.use('/api/kite', kiteRouter);
router.get('/health', ctrl.health);

module.exports = router;
