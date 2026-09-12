'use strict';
/**
 * Live start gate: prove Kite can answer before we arm real MIS orders.
 * Paper desk scan is not this check — a historical backtest must not
 * block Live after a process restart.
 */
const defaultMarket = require('./kite-market');

async function preflightLive(authorization, deps = {}) {
  const market = deps.market || defaultMarket;
  const checks = [];
  if (!authorization) {
    checks.push({
      id: 'token',
      ok: false,
      detail: 'Kite token missing. Get Token, then Start live.',
    });
    return { ok: false, checks };
  }
  checks.push({ id: 'token', ok: true, detail: 'Kite token is present.' });

  try {
    const funds = await market.fetchUserMargins(authorization);
    const cash = Math.floor(Number(funds?.capitalRs || funds?.equityCash) || 0);
    if (cash > 0) {
      checks.push({
        id: 'funds',
        ok: true,
        detail: `Kite available ₹${cash.toLocaleString('en-IN')}.`,
        capitalRs: cash,
      });
    } else {
      checks.push({
        id: 'funds',
        ok: false,
        detail: 'Kite available cash is ₹0. Live will not start.',
      });
    }
  } catch (err) {
    checks.push({
      id: 'funds',
      ok: false,
      detail: `Kite funds failed: ${err.message || err}`,
    });
  }

  try {
    const qmap = await market.fetchQuotes(authorization, ['NSE:NIFTY 50']);
    const px = Number(qmap?.['NSE:NIFTY 50']?.last_price);
    if (px > 0) {
      checks.push({ id: 'quote', ok: true, detail: `Nifty LTP ${px}.` });
    } else {
      checks.push({
        id: 'quote',
        ok: false,
        detail: 'Kite returned no Nifty quote. Token may be stale — Get Token again.',
      });
    }
  } catch (err) {
    checks.push({
      id: 'quote',
      ok: false,
      detail: `Kite quote failed: ${err.message || err}`,
    });
  }

  return { ok: checks.every((c) => c.ok), checks };
}

function firstFail(assistant) {
  return (assistant?.checks || []).find((c) => !c.ok) || null;
}

module.exports = { preflightLive, firstFail };
