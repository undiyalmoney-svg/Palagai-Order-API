/**
 * Server Live control plane — NEW paths only.
 * DO NOT import or modify controllers/kiteOrders or /api/kite/* order flows.
 */
const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const ctrl = require('./live.controller');

const router = express.Router();

router.get('/health', asyncHandler(ctrl.health));
router.get('/status', asyncHandler(ctrl.status));
router.get('/events', asyncHandler(ctrl.events));
router.post('/start', asyncHandler(ctrl.start));
router.post('/stop', asyncHandler(ctrl.stop));
router.put('/auth', asyncHandler(ctrl.putAuth));

module.exports = router;
