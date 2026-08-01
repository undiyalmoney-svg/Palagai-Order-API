/**
 * Manual P/L records API — additive.
 * Does NOT modify /api/kite/* order routes.
 */
const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const ctrl = require('./pnl.controller');

const router = express.Router();

router.get('/', asyncHandler(ctrl.list));
router.put('/', asyncHandler(ctrl.upsert));
router.delete('/:date', asyncHandler(ctrl.remove));

module.exports = router;
