const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const ctrl = require('../controllers/kiteOrders.controller');
const pnlRoutes = require('../pnl/pnl.routes');
const authRoutes = require('../auth/auth.routes');
const { getMomentumRouter } = require('../momentum/instance');
const { getResearchService } = require('../research/instance');
const { createResearchRouter } = require('../research/api/routes');

const router = express.Router();

/**
 * Same path shapes as Kite Connect / existing Palagai proxy:
 * UNCHANGED — do not alter these handlers.
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

router.use('/auth', authRoutes);
router.use('/pnl', pnlRoutes);
router.use('/momentum', (req, res, next) => getMomentumRouter()(req, res, next));

let researchRouter = null;
function researchHandler(req, res, next) {
  if (!researchRouter) researchRouter = createResearchRouter(getResearchService());
  return researchRouter(req, res, next);
}
router.use('/research', researchHandler);

module.exports = router;
