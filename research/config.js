'use strict';

/**
 * Initial experimental parameters. They are not proven optimal values.
 * Changing them must not reset accounts or delete history.
 */
const DEFAULTS = {
  startingCapital: 20_000,
  strategyCount: 5,
  riskPerTrade: 0.005,
  maxOpenPositions: 3,
  maxTradesPerDay: 5,
  maxDailyLoss: 0.02,
  maxNotionalPct: 0.95,
  maxAggregateRiskPct: 0.02,
  minRewardRisk: 1.5,
  experimentWeeks: 10,
  timezone: 'Asia/Kolkata',
  mode: 'PAPER',
  slippageBps: 5,
  quoteStaleMs: 15_000,
  openingRangeMinutes: 15,
  entryCutoffMin: 15 * 60,
  squareOffMin: 15 * 60 + 15,
  sessionOpenMin: 9 * 60 + 15,
  sessionCloseMin: 15 * 60 + 30,
  maxPositionsPerSector: 2,
  atrPeriod: 14,
  atrMult: 1.5,
  rewardRisk: 2,
  adxPeriod: 14,
  adxTrend: 22,
  adxRange: 20,
  rsiPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
};

const STRATEGY_DEFS = [
  {
    strategyId: 'vwap-trend',
    name: 'VWAP trend following',
    version: 1,
    enabled: true,
    parameters: { emaFast: 9, emaSlow: 21 },
  },
  {
    strategyId: 'opening-range',
    name: 'Opening-range breakout',
    version: 1,
    enabled: true,
    parameters: { openingRangeMinutes: 15 },
  },
  {
    strategyId: 'ema-trend',
    name: 'EMA trend following',
    version: 1,
    enabled: true,
    parameters: { emaFast: 9, emaSlow: 21, adxMin: 22 },
  },
  {
    strategyId: 'rsi-reversion',
    name: 'RSI mean reversion',
    version: 1,
    enabled: true,
    parameters: { rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70, adxMax: 20 },
  },
  {
    strategyId: 'pdhl-retest',
    name: 'Previous-day-level retest',
    version: 1,
    enabled: true,
    parameters: {},
  },
];

const START_PHRASE = 'START PAPER EXPERIMENT';

module.exports = { DEFAULTS, STRATEGY_DEFS, START_PHRASE };
