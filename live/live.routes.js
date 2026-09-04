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
  router.post('/sr-breakout', asyncHandler(srCtrl.srBreakout));
  router.post('/sr-observe', asyncHandler(srCtrl.srObserve));
  router.get('/sr-observe/status', asyncHandler(srCtrl.srObserveStatus));
  router.get('/sr-observe/history', asyncHandler(srCtrl.srObserveHistory));
  router.post('/sr-observe/confirm', asyncHandler(srCtrl.srLiveConfirm));
  router.post('/sr-observe/exit', asyncHandler(srCtrl.srLiveExit));
router.put('/auth', asyncHandler(ctrl.putAuth));

// Auto-start the read-only real-option collector at server boot (singleton-
// guarded, market-hours gated). Additive; does not touch the live-order worker.
try { require('./sr-collector').boot(); } catch (e) { console.error('[sr-collector] boot skipped:', e.message); }

module.exports = router;
