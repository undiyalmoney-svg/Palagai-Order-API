const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const ctrl = require('./auth.controller');
const { requireSiteUser, requireAdmin } = require('./auth.middleware');

const router = express.Router();

/** Site users (Devil + friends) */
router.post('/login', asyncHandler(ctrl.siteLogin));
router.get('/me', requireSiteUser, asyncHandler(ctrl.siteMe));

/** Admin portal (angel) — separate from site login */
router.post('/admin/login', asyncHandler(ctrl.adminLogin));
router.get('/admin/users', requireAdmin, asyncHandler(ctrl.adminListUsers));
router.post('/admin/users', requireAdmin, asyncHandler(ctrl.adminCreateUser));
router.patch('/admin/users/:id', requireAdmin, asyncHandler(ctrl.adminUpdateUser));

/** Vault — owner site user only (role owner + module vault) */
router.post(
  '/vault/list',
  requireSiteUser,
  asyncHandler(async (req, res, next) => {
    if (req.user.role !== 'owner' && !req.user.modules?.includes('vault')) {
      res.status(403).json({ status: 'error', message: 'Owner vault only' });
      return;
    }
    return ctrl.vaultList(req, res, next);
  }),
);
router.put(
  '/vault',
  requireSiteUser,
  asyncHandler(async (req, res, next) => {
    if (req.user.role !== 'owner' && !req.user.modules?.includes('vault')) {
      res.status(403).json({ status: 'error', message: 'Owner vault only' });
      return;
    }
    return ctrl.vaultUpsert(req, res, next);
  }),
);
router.delete(
  '/vault/:key',
  requireSiteUser,
  asyncHandler(async (req, res, next) => {
    if (req.user.role !== 'owner' && !req.user.modules?.includes('vault')) {
      res.status(403).json({ status: 'error', message: 'Owner vault only' });
      return;
    }
    return ctrl.vaultRemove(req, res, next);
  }),
);
router.post(
  '/vault/seed',
  requireSiteUser,
  asyncHandler(async (req, res, next) => {
    if (req.user.role !== 'owner' && !req.user.modules?.includes('vault')) {
      res.status(403).json({ status: 'error', message: 'Owner vault only' });
      return;
    }
    return ctrl.vaultSeed(req, res, next);
  }),
);

module.exports = router;
