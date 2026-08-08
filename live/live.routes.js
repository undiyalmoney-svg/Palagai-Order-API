/**
 * Server Live control plane — NEW paths only.
 * Requires site login + `auto` module (owner always allowed).
 */
const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const ctrl = require('./live.controller');
const { requireSiteUser } = require('../auth/auth.middleware');

const router = express.Router();

function requireAutoModule(req, res, next) {
  if (req.user?.role === 'owner' || req.user?.modules?.includes('auto')) {
    next();
    return;
  }
  res.status(403).json({ status: 'error', message: 'Auto Trader not enabled for this account' });
}

router.get('/health', asyncHandler(ctrl.health));
router.get('/defaults', asyncHandler(ctrl.defaults));
router.use(requireSiteUser);
router.use(requireAutoModule);
router.get('/status', asyncHandler(ctrl.status));
router.get('/events', asyncHandler(ctrl.events));
router.post('/start', asyncHandler(ctrl.start));
router.post('/stop', asyncHandler(ctrl.stop));
router.post('/backtest', asyncHandler(ctrl.backtest));
router.put('/auth', asyncHandler(ctrl.putAuth));

module.exports = router;
