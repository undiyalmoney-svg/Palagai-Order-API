'use strict';

const { HeatmapService } = require('./service');
const { createHeatmapRouter } = require('./routes');

let service = null;

function getHeatmapService() {
  if (!service) service = new HeatmapService();
  return service;
}

function getHeatmapRouter() {
  return createHeatmapRouter(getHeatmapService());
}

module.exports = { getHeatmapService, getHeatmapRouter };
