'use strict';

const { inr, round } = require('../utils/math');

/**
 * The "AI" layer explains and analyses - it never decides.
 *
 * Everything returned here is assembled from decisions and numbers the
 * deterministic engine already stored (signals, decision runs, trades). There
 * is no free-form generation, so it cannot invent a trade or a reason; if the
 * data is not in the database the answer says so. `source` is always
 * "deterministic-narrator" so the UI can label it honestly.
 */

const SOURCE = 'deterministic-narrator';

function signalStory(signal) {
  const d = signal.detail || {};
  const e = d.explanation || {};
  const lines = [];
  lines.push(`${signal.action} ${signal.symbol}${signal.quantity ? ` x${signal.quantity}` : ''} - decision of ${signal.asOf} (strategy ${signal.strategy}, trigger ${signal.trigger || 'n/a'}).`);
  if (signal.action === 'BUY') {
    for (const k of ['whyBuy', 'whyNow', 'whyThisStock', 'whyThisPrice', 'howMuch', 'howManyShares']) if (e[k]) lines.push(e[k]);
    if (e.confirms?.length) lines.push(`Confirmations: ${e.confirms.slice(0, 5).join(' | ')}`);
    if (e.invalidates?.length) lines.push(`Invalidated if: ${e.invalidates.join(' | ')}`);
    if (e.expectedHolding) lines.push(`Holding: ${e.expectedHolding}`);
    if (e.risk) lines.push(`Risk: ${e.risk}`);
  } else if (['SELL', 'EXIT', 'REDUCE'].includes(signal.action)) {
    lines.push(e.headline || signal.reason);
    if (e.whySell) lines.push(e.whySell);
    if (e.result) lines.push(e.result);
    if (e.thesis?.length) lines.push(`Thesis check: ${e.thesis.join(' | ')}`);
    if (e.nextStep) lines.push(e.nextStep);
  } else if (signal.action === 'HOLD') {
    lines.push(e.headline || signal.reason);
    if (e.whyHold) lines.push(e.whyHold);
    if (e.result) lines.push(e.result);
  } else {
    lines.push(signal.reason);
    if (d.waitFor?.length) lines.push(`Waiting for: ${d.waitFor.join(' | ')}`);
  }
  return lines.filter(Boolean);
}

function findSymbol(question, symbols) {
  const q = question.toUpperCase();
  return symbols.find((s) => new RegExp(`\\b${s}\\b`).test(q)) || null;
}

/**
 * ctx: { store, userId, portfolio, symbols[], decisionRun?, performance? }
 */
function ask(question, ctx) {
  const q = String(question || '').trim();
  const lower = q.toLowerCase();
  const symbol = findSymbol(q, ctx.symbols);
  const respond = (answer, evidence = []) => ({ source: SOURCE, question: q, answer, evidence });

  if (!q) return respond('Ask about a stock, a signal, or the portfolio - for example "Why did you buy TCS?".');

  if (/(why|reason|explain|what).*(buy|bought|purchase|entry|enter)/.test(lower)) {
    const sig = ctx.store.listSignals({ userId: ctx.userId, symbol, limit: 50 }).find((s) => s.action === 'BUY');
    if (!sig) return respond(symbol ? `No BUY decision for ${symbol} is stored in your history, so I cannot explain one.` : 'No BUY decision is stored in your history yet, so there is nothing to explain.');
    return respond(signalStory(sig).join('\n'), [`signal #${sig.id}`, `decision date ${sig.asOf}`]);
  }
  if (/(why|reason|explain).*(sell|sold|exit|reduce|trim)/.test(lower)) {
    const sig = ctx.store.listSignals({ userId: ctx.userId, symbol, limit: 50 }).find((s) => ['SELL', 'EXIT', 'REDUCE'].includes(s.action));
    if (!sig) return respond(symbol ? `No SELL/EXIT/REDUCE decision for ${symbol} is stored.` : 'No SELL/EXIT/REDUCE decision is stored yet.');
    return respond(signalStory(sig).join('\n'), [`signal #${sig.id}`]);
  }
  if (symbol && /(hold|keep|wait|should i|status|what about)/.test(lower)) {
    const sig = ctx.store.listSignals({ userId: ctx.userId, symbol, limit: 5 })[0];
    if (!sig) return respond(`There is no stored decision for ${symbol} yet. Run the Decision Center first.`);
    return respond(signalStory(sig).join('\n'), [`signal #${sig.id}`]);
  }
  if (/(what should i do|what now|today|do now)/.test(lower)) {
    const run = ctx.decisionRun;
    if (!run) return respond('No decision has been run yet. Open the Decision Center and press "Run decision".');
    const s = run.summary || run.result?.summary;
    return respond((s?.lines || []).join('\n'), [`decision run ${run.asOf}`]);
  }
  if (/(perform|return|profit|how am i|pnl|p&l)/.test(lower)) {
    const p = ctx.performance;
    if (!p) return respond('No performance data yet.');
    return respond(
      `Portfolio value ${inr(p.equity)} (cash ${inr(p.cash)}). Unrealised P&L ${inr(p.unrealized)}; ${p.tradesClosed} closed trade(s), win rate ${p.winRatePct}%. Realised P&L ${inr(p.realizedPnl)}.`,
      ['equity snapshots', 'trades'],
    );
  }
  if (/(regime|market)/.test(lower)) {
    const r = ctx.decisionRun?.result?.regime || ctx.decisionRun?.regime;
    if (!r) return respond('No regime reading stored yet.');
    return respond(`${r.regime || r} (score ${r.score ?? 'n/a'}). ${(r.reasons || []).join(' ')}`, ['market_regimes']);
  }
  return respond('I can explain stored decisions: try "Why did you buy <SYMBOL>?", "Why did you sell <SYMBOL>?", "Should I hold <SYMBOL>?", "What should I do today?" or "How am I performing?". I only report what the engine computed - I do not create trades.');
}

module.exports = { ask, signalStory, SOURCE, round };
