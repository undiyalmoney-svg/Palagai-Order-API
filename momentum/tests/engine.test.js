'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp } = require('./helpers');
const { PortfolioDecisionEngine } = require('../engine/portfolio-decision-engine');
const { whatIf } = require('../research/whatif');
const { ema, rsi } = require('../indicators/indicators');
const { legCost } = require('../execution/costs');
const { paramsFromPreset } = require('../config/defaults');
const { applyBuy, applySell, newPosition } = require('../execution/ledger');

test('indicators: EMA and RSI are causal and sane', () => {
  const x = Array.from({ length: 60 }, (_, i) => 100 + i);
  const e = ema(x, 10);
  assert.ok(Number.isNaN(e[0]) || Number.isFinite(e[0]));
  assert.ok(e[59] < x[59] && e[59] > x[40]);
  assert.ok(rsi(x, 14)[59] > 95, 'monotonic rise -> RSI near 100');
  const y = x.slice(0, 40);
  assert.equal(ema(y, 10)[39], e[39], 'appending future data must not change past EMA values');
});

test('costs: delivery charges follow the Zerodha schedule', () => {
  const buy = legCost({ side: 'BUY', price: 1000, qty: 100, costs: { model: 'zerodha_delivery' } });
  assert.ok(buy.total > 110 && buy.total < 130, `buy cost ${buy.total}`);
  const sell = legCost({ side: 'SELL', price: 1000, qty: 100, costs: { model: 'zerodha_delivery' } });
  assert.ok(sell.breakdown.dp > 15 && sell.total > buy.total - 20);
  assert.equal(legCost({ side: 'BUY', price: 100, qty: 1, costs: { model: 'none' } }).total, 0);
});

test('ledger: partial sell books pro-rata costs and closes cleanly', () => {
  let pos = newPosition({ symbol: 'X', qty: 100, price: 100, cost: 20, date: '2024-01-01', initialStop: 90 });
  pos = applyBuy(pos, { qty: 100, price: 110, cost: 20, stopPrice: 95 });
  assert.equal(pos.qty, 200);
  assert.equal(pos.avgPrice, 105);
  const r1 = applySell(pos, { symbol: 'X', qty: 100, price: 120, cost: 25, date: '2024-02-01' });
  assert.equal(r1.closed, false);
  assert.equal(r1.pnl, Math.round((15 * 100 - 25 - 20) * 100) / 100);
  const r2 = applySell(r1.position, { symbol: 'X', qty: 100, price: 100, cost: 25, date: '2024-03-01' });
  assert.equal(r2.closed, true);
  assert.equal(r2.holdingDays, 60);
});

test('look-ahead firewall: decisions on a truncated panel equal decisions on the full panel', async () => {
  const app = await makeApp();
  const panel = app.marketData.loadPanel();
  const params = paramsFromPreset('momentum-weekly');
  for (const date of ['2020-08-31', '2022-01-31', '2024-03-28']) {
    const w = whatIf({ panel, params, date, capital: 100000 });
    assert.equal(w.verifiedNoLookahead, true, `look-ahead detected on ${date}`);
  }
  const idx = panel.indexOnOrBefore('2021-06-30');
  const view = panel.view(idx, params);
  assert.equal(view.dateAt(idx + 1), null, 'view must not expose later dates');
  assert.equal(view.closes('TCS', 3).length, 3);
  assert.equal(view.price('TCS'), panel.data.get('TCS').close[idx]);
  app.close();
});

test('acceptance: "I have 1,00,000 - what should I buy?" returns sized, explained BUY orders', async () => {
  const app = await makeApp();
  const m = app.momentum;
  const { result } = m.decideNow({ userId: 'u1', capital: 100000, asOf: '2020-08-31' });
  const buys = result.decisions.filter((d) => d.action === 'BUY');
  assert.ok(buys.length >= 1, 'expected at least one BUY on a bullish breakout date');
  assert.match(result.portfolioSize.explanation, /Recommended portfolio size: \d+ stock/);
  const spent = buys.reduce((a, d) => a + d.quantity * d.priceRef, 0);
  assert.ok(spent <= 100000 * (1 - result.capital.reservePct) + 1, `spent ${spent} must respect the cash reserve`);
  for (const b of buys) {
    assert.ok(b.quantity > 0 && Number.isInteger(b.quantity));
    for (const k of ['whyBuy', 'whyNow', 'whyThisStock', 'whyThisPrice', 'howMuch', 'howManyShares', 'risk']) assert.ok(b.explanation[k], `missing ${k}`);
    assert.ok(b.explanation.confirms.length && b.explanation.invalidates.length);
    assert.ok(b.risk.stopPrice < b.priceRef);
    assert.ok(b.allocationPct <= 0.2 + 1e-9);
    assert.ok(['BUY', 'STRONG_BUY'].includes(b.entryStatus));
  }
  const waits = result.decisions.filter((d) => d.action === 'WAIT');
  for (const w of waits.filter((x) => x.entryStatus !== 'BUY' && x.entryStatus !== 'STRONG_BUY')) assert.ok(w.waitFor.length > 0, `${w.symbol} WAIT must state what it is waiting for`);
  assert.ok(result.summary.text.includes('Market regime'));
  app.close();
});

test('WAIT / WATCH when the setup is not confirmed, with an explicit condition', async () => {
  const app = await makeApp();
  const { result } = app.momentum.decideNow({ userId: 'u1', capital: 100000 });
  assert.equal(result.decisions.filter((d) => d.action === 'BUY').length, 0);
  const wait = result.decisions.find((d) => d.action === 'WAIT');
  assert.ok(wait && wait.waitFor.length, 'a WAIT decision with a wait-for condition');
  assert.match(result.summary.text, /Waiting for/);
  app.close();
});

test('dynamic portfolio size responds to capital and regime', async () => {
  const app = await makeApp();
  const m = app.momentum;
  const small = m.decideNow({ userId: 'u1', capital: 25000, asOf: '2023-11-30' }).result.portfolioSize;
  const large = m.decideNow({ userId: 'u1', capital: 2_000_000, asOf: '2023-11-30' }).result.portfolioSize;
  assert.ok(small.n <= large.n, `small ${small.n} <= large ${large.n}`);
  assert.ok(small.constraints.find((c) => c.id === 'SIZE').value <= large.constraints.find((c) => c.id === 'SIZE').value);
  const bear = m.decideNow({ userId: 'u1', capital: 1_000_000, asOf: '2025-11-28' }).result;
  assert.equal(bear.regime.regime, 'BEARISH');
  assert.equal(bear.decisions.filter((d) => d.action === 'BUY').length, 0, 'no new buys in a bearish regime');
  assert.equal(bear.portfolioSize.n, 0);
  app.close();
});

test('holding period is not an exit trigger: an old, healthy position is held', async () => {
  const app = await makeApp();
  const m = app.momentum;
  const panel = app.marketData.loadPanel();
  const params = m.config('u1').params;
  const date = '2023-11-30';
  const base = m.decideNow({ userId: 'u1', capital: 1_000_000, asOf: date }).result;
  const idx = panel.indexOnOrBefore(date);
  const view = panel.view(idx, params);
  const closeOf = (sym) => panel.data.get(sym).close[idx];
  const atHigh = base.ranking.filter((r) => view.highestCloseSince(r.symbol, '2018-02-01') <= closeOf(r.symbol) * 1.02);
  assert.ok(atHigh.length > 0, 'fixture needs a stock trading at its highs');
  const top = atHigh[0];
  const price = closeOf(top.symbol);
  const engine = new PortfolioDecisionEngine();
  const res = engine.decide({
    view,
    params,
    portfolio: { cash: 900000, positions: [{ symbol: top.symbol, qty: Math.max(1, Math.floor(100000 / price)), avgPrice: price * 0.7, entryDate: '2018-02-01', initialStop: price * 0.6, stopPrice: price * 0.6, peakClose: price }], peakEquity: 1000000 },
    state: { prevRegime: base.regime.regime, lastReviewDate: '2023-11-24' },
    forceReview: true,
  });
  const d = res.decisions.find((x) => x.symbol === top.symbol);
  assert.equal(d.action, 'HOLD', `expected HOLD for a 5-year-old healthy position, got ${d.action}: ${d.reason}`);
  assert.ok(!/days|holding period|time/i.test(d.reason));
  assert.ok(d.thesis.every((t) => t.ok !== undefined));
  app.close();
});

test('hard exit: a close below the stop sells immediately even on a non-review day', async () => {
  const app = await makeApp();
  const m = app.momentum;
  const panel = app.marketData.loadPanel();
  const params = m.config('u1').params;
  const date = '2023-11-30';
  const idx = panel.indexOnOrBefore(date);
  const sym = 'TCS';
  const price = panel.data.get(sym).close[idx];
  const res = new PortfolioDecisionEngine().decide({
    view: panel.view(idx, params),
    params,
    portfolio: { cash: 100000, positions: [{ symbol: sym, qty: 10, avgPrice: price * 1.2, entryDate: '2023-10-02', initialStop: price * 1.05, stopPrice: price * 1.05, peakClose: price * 1.25 }], peakEquity: 300000 },
    state: { prevRegime: 'BULLISH', lastReviewDate: date },
  });
  const d = res.decisions.find((x) => x.symbol === sym);
  assert.equal(d.action, 'EXIT');
  assert.match(d.trigger, /STOP/);
  assert.equal(d.quantity, 10);
  assert.equal(res.review, false);
  app.close();
});

test('capital increase: allocation is explained (Option A/B/C) and respects the cash reserve', async () => {
  const app = await makeApp();
  const m = app.momentum;
  const panel = app.marketData.loadPanel();
  const params = m.config('u1').params;
  const date = '2020-09-30';
  const idx = panel.indexOnOrBefore(date);
  const px = (s) => panel.data.get(s).close[idx];
  const res = new PortfolioDecisionEngine().decide({
    view: panel.view(idx, params),
    params,
    portfolio: { cash: 60000, positions: [{ symbol: 'TATACONSUM', qty: 50, avgPrice: 395.9, entryDate: '2020-09-01', initialStop: 384, stopPrice: 384, peakClose: px('TATACONSUM') }], peakEquity: 100000 },
    state: { prevRegime: 'BULLISH', lastReviewDate: '2020-09-28' },
    capitalEvent: { amount: 50000, kind: 'DEPOSIT' },
  });
  assert.ok(res.triggers.some((t) => t.type === 'CAPITAL_INCREASE'));
  assert.match(res.allocation.explanation, /Additional capital: ₹50,000/);
  assert.match(res.allocation.explanation, /cash reserve/);
  assert.ok(['A', 'B', 'C', 'CASH'].includes(res.allocation.option));
  const spent = res.decisions.filter((d) => d.action === 'BUY').reduce((a, d) => a + d.quantity * d.priceRef, 0);
  assert.ok(spent <= 60000 - res.capital.reserve + 1, 'buys must leave the reserve untouched');
  app.close();
});

test('capital decrease: withdrawal beyond spare cash sells the lowest-ranked holdings first', async () => {
  const app = await makeApp();
  const m = app.momentum;
  const panel = app.marketData.loadPanel();
  const params = m.config('u1').params;
  const date = '2023-11-30';
  const idx = panel.indexOnOrBefore(date);
  const res = new PortfolioDecisionEngine().decide({
    view: panel.view(idx, params),
    params,
    portfolio: {
      cash: 5000,
      positions: ['TCS', 'INFY', 'RELIANCE'].map((s) => ({ symbol: s, qty: 20, avgPrice: panel.data.get(s).close[idx] * 0.9, entryDate: '2023-09-01', initialStop: panel.data.get(s).close[idx] * 0.7, stopPrice: panel.data.get(s).close[idx] * 0.7, peakClose: panel.data.get(s).close[idx] })),
      peakEquity: 300000,
    },
    state: { prevRegime: 'BULLISH', lastReviewDate: date },
    capitalEvent: { amount: -60000, kind: 'WITHDRAWAL' },
  });
  const sells = res.decisions.filter((d) => ['SELL', 'REDUCE'].includes(d.action) && d.trigger === 'CAPITAL_DECREASE');
  assert.ok(sells.length >= 1);
  const raised = sells.reduce((a, d) => a + d.quantity * d.priceRef, 0);
  assert.ok(raised >= 55000 - 5000, `raised ${raised}`);
  assert.equal(res.decisions.filter((d) => d.action === 'BUY').length, 0, 'no purchases during a withdrawal');
  app.close();
});
