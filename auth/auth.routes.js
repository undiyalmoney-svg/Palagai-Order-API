const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const ctrl = require('./auth.controller');
const { requireSiteUser, requireAdmin } = require('./auth.middleware');

const router = express.Router();

/** Site users (Devil + friends) */
router.post('/login', asyncHandler(ctrl.siteLogin));
router.get('/me', requireSiteUser, asyncHandler(ctrl.siteMe));
router.post('/me/dismiss-message', requireSiteUser, asyncHandler(ctrl.siteDismissMessage));

/** Admin portal */
router.post('/admin/login', asyncHandler(ctrl.adminLogin));
router.get('/admin/users', requireAdmin, asyncHandler(ctrl.adminListUsers));
router.post('/admin/users', requireAdmin, asyncHandler(ctrl.adminCreateUser));
router.patch('/admin/users/:id', requireAdmin, asyncHandler(ctrl.adminUpdateUser));
router.delete('/admin/users/:id', requireAdmin, asyncHandler(ctrl.adminDeleteUser));

/** Vault — Admin portal only */
router.post('/vault/list', requireAdmin, asyncHandler(ctrl.vaultList));
router.put('/vault', requireAdmin, asyncHandler(ctrl.vaultUpsert));
router.delete('/vault/:key', requireAdmin, asyncHandler(ctrl.vaultRemove));
router.post('/vault/seed', requireAdmin, asyncHandler(ctrl.vaultSeed));

module.exports = router;
