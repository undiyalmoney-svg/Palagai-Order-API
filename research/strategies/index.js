'use strict';

const vwap = require('./vwap');
const orb = require('./orb');
const ema = require('./ema');
const rsi = require('./rsi');
const pdhl = require('./pdhl');

const STRATEGIES = [vwap, orb, ema, rsi, pdhl];

function byId(id) {
  return STRATEGIES.find((s) => s.meta.strategyId === id) || null;
}

module.exports = { STRATEGIES, byId };
