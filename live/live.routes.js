/**
 * Server Live control plane — NEW paths only.
 * Requires site login + `auto` module (owner always allowed).
 */
const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const ctrl = require('./live.controller');
const srCtrl = require('./sr-breakout.controller');
const { requireSiteUser } = require('../auth/auth.middleware');

const router = express.Router();

function requireAutoModule(req, res, next) {
  if (req.user?.role === 'owner' || req.user?.modules?.includes('auto')) {
    next();
    return;
  }
  res.status(403).json({ status: 'error', message: 'Trade Bot not enabled for this account' });
}

router.get('/health', asyncHandler(ctrl.health));
router.get('/defaults', asyncHandler(ctrl.defaults));
router.use(requireSiteUser);
router.use(requireAutoModule);
router.get('/status', asyncHandler(ctrl.status));
router.get('/events', asyncHandler(ctrl.events));
router.get('/funds', asyncHandler(ctrl.funds));
router.post('/start', asyncHandler(ctrl.start));
router.post('/stop', asyncHandler(ctrl.stop));
router.post('/backtest', asyncHandler(ctrl.backtest));
router.post('/options/ohlc', asyncHandler(ctrl.optionOhlc));
router.post('/research/ee-wait', asyncHandler(ctrl.findEeWait));
router.get('/research/ee-wait', asyncHandler(ctrl.lastEeWait));
  router.post('/sr-breakout', asyncHandler(srCtrl.srBreakout));
  router.post('/sr-observe', asyncHandler(srCtrl.srObserve));
  router.post('/sr-breakout/debug', asyncHandler(srCtrl.srDebug));
  router.post('/sr-research', asyncHandler(srCtrl.srResearch));
  router.get('/sr-observe/status', asyncHandler(srCtrl.srObserveStatus));
  router.get('/sr-observe/history', asyncHandler(srCtrl.srObserveHistory));
  router.post('/sr-observe/confirm', asyncHandler(srCtrl.srLiveConfirm));
  router.post('/sr-observe/exit', asyncHandler(srCtrl.srLiveExit));
  router.post('/sr-breakout/live/start', asyncHandler(srCtrl.srLiveStart));
  router.post('/sr-breakout/live/stop', asyncHandler(srCtrl.srLiveStop));
  router.get('/sr-breakout/live/status', asyncHandler(srCtrl.srLiveStatus));
router.put('/auth', asyncHandler(ctrl.putAuth));

// S/R collector retired with the S/R Live desk.


module.exports = router;
