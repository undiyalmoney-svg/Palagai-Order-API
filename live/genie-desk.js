'use strict';
/** Auto Bot desk is retired. Kept so leftover worker/backtest files do not crash on require. */
function retired() {
  throw new Error('Auto Bot is removed. Start a new desk from scratch.');
}
module.exports = {
  genieInitOverrides: retired,
  makeGenieStrategy: retired,
  DESK_STRATEGY_ID: 'retired',
};
