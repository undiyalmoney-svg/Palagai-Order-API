/**
 * Boot-time guard against the Aug-18 failure mode (RCA doc 51): a stale
 * strategy-core.cjs silently trading a DNA that was never validated because
 * palagai-main was rebuilt/edited but the bundle copy into Order-API was
 * forgotten. Compares the bundle's exported version against what this
 * deploy expects and throws (loud failure at boot) on mismatch, rather than
 * letting the desk quietly run last week's parameters.
 */
const EXPECTED_STRATEGY_BUNDLE_VERSION = 'sr-trap-v2.2026-08-22.2';

function assertStrategyBundleVersion(strategyCore) {
  const actual = strategyCore && strategyCore.STRATEGY_BUNDLE_VERSION;
  if (actual !== EXPECTED_STRATEGY_BUNDLE_VERSION) {
    throw new Error(
      `strategy-core.cjs is stale: bundle version "${actual}" != expected ` +
        `"${EXPECTED_STRATEGY_BUNDLE_VERSION}". Run ` +
        `\`node scripts/server-live/build-strategy-core.cjs\` in palagai-main ` +
        'and redeploy before starting the live desk.',
    );
  }
}

module.exports = { assertStrategyBundleVersion, EXPECTED_STRATEGY_BUNDLE_VERSION };
