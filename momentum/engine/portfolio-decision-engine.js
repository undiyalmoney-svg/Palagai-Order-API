'use strict';

const { round, roundPrice, clamp } = require('../utils/math');
const { HORIZON_PRESETS } = require('../config/defaults');
const { featureSnapshot } = require('./features');
const { scoreFeatures, eligibility } = require('./scoring');
const { computeRegime } = require('./regime');
const { analyzeEntry, statusAtLeast } = require('./entry-timing');
const { analyzeExit } = require('./exit-timing');
const { recommendPortfolioSize, targetPositionValue, averageCorrelation } = require('./sizing');
const { checkBuy, portfolioStats } = require('./risk');
const { allocateCapital, planWithdrawal } = require('./capital-allocator');
const {
  isReviewDue,
  nextReviewLabel,
  detectTriggers,
  findConcentrated,
  findRiskBreach,
  drawdownState,
  evaluateReplacements,
} = require('./rebalance');
const { legCost } = require('../execution/costs');
const { explainBuy, explainSell, explainHold, explainWait, summarizeRun } = require('./explain');

/** Named flags plus the period numbers the screener dots look up (20/50/100/200 by default). */
function emaFlags(periods, trend) {
  const [pFast, pMid, pSlow, pLong] = periods;
  const flags = {
    fast: trend.aboveFast,
    mid: trend.aboveMid,
    slow: trend.aboveSlow,
    long: trend.aboveLong,
    stack: trend.stack,
  };
  flags[pFast] = trend.aboveFast;
  flags[pMid] = trend.aboveMid;
  flags[pSlow] = trend.aboveSlow;
  flags[pLong] = trend.aboveLong;
  return flags;
}

/**
 * PortfolioDecisionEngine - the single source of every trading decision.
 *
 * Live signals, paper trading, automated execution, backtests, the optimiser
 * and "what would have happened on date X" all call `decide()` with the same
 * arguments; only the MarketView (data up to the decision date) and the
 * execution adapter differ. The engine is pure: it never reads the clock,
 * database or broker, and it only sees market data through `view`, which
 * cannot return bars after the decision date.
 *
 * input:
 *   view          MarketView bound to the decision date (look-ahead firewall)
 *   params        resolved strategy + risk params
 *   portfolio     { cash, positions[], peakEquity }
 *   state         { prevRegime, lastReviewDate }
 *   capitalEvent  { amount } (+ deposit already in cash, - withdrawal planned)
 *   pendingOrders [{ symbol, side, qty, price }] not yet filled
 *   costs, slippageBps, forceReview, redeploy, now
 */

const WAIT_ROWS = 12;

class PortfolioDecisionEngine {
  decide(input) {
    const {
      view,
      params,
      portfolio,
      state = {},
      capitalEvent = null,
      pendingOrders = [],
      costs,
      slippageBps = 0,
      forceReview = false,
      redeploy = true,
      now = new Date(),
      waitRows: waitRowsIn = WAIT_ROWS,
      lean = false,
    } = input;
    const waitRows = lean ? 0 : waitRowsIn;
    const asOf = view.asOf;
    const timestamp = now instanceof Date ? now.toISOString() : String(now);
    const strategy = params.id || 'custom';

    const priceOf = (s) => {
      const p = view.price(s);
      return Number.isFinite(p) ? p : undefined;
    };
    const sectorOf = (s) => view.sector(s);
    const cash = portfolio.cash;
    const positions = (portfolio.positions || []).filter((p) => p.qty > 0).map((p) => ({ ...p }));
    const valueOf = (p) => (priceOf(p.symbol) ?? p.avgPrice) * p.qty;
    const invested0 = positions.reduce((a, p) => a + valueOf(p), 0);
    const equity = cash + invested0;
    const pendingBuys = pendingOrders.filter((o) => o.side === 'BUY');
    const pendingSells = new Set(pendingOrders.filter((o) => o.side === 'SELL').map((o) => o.symbol));
    const pendingBuySymbols = new Set(pendingBuys.map((o) => o.symbol));
    const pendingBuyValue = pendingBuys.reduce((a, o) => a + o.qty * (o.price || priceOf(o.symbol) || 0), 0);
    const withdrawal = capitalEvent && capitalEvent.amount < 0 ? -capitalEvent.amount : 0;
    const deposit = capitalEvent && capitalEvent.amount > 0 ? capitalEvent.amount : 0;
    const planEquity = Math.max(0, equity - withdrawal);

    const regime = computeRegime(view, params, state.prevRegime || null);
    const regimeChanged = !!state.prevRegime && state.prevRegime !== regime.regime;
    const dd = drawdownState({ equity, peakEquity: Math.max(portfolio.peakEquity || equity, equity), params });
    const policy = dd.halted ? { ...regime.policy, allowNewBuys: false } : regime.policy;
    const regimeView = dd.halted ? { ...regime, policy } : regime;

    const reviewDay =
      forceReview || isReviewDue({ horizon: params.horizon, asOf, lastReviewDate: state.lastReviewDate }) || regimeChanged || !!capitalEvent;
    const nextLabel = nextReviewLabel(params.horizon);

    // ---- 1. score the universe -------------------------------------------------
    const ctx = view.context();
    const evals = new Map();
    for (const symbol of view.symbols()) {
      const f = view.features(symbol);
      if (!f || !f.valid) continue;
      const sector = ctx.sectors.get(view.sector(symbol)) || null;
      const score = scoreFeatures(f, ctx, params, sector ? sector.ret3m : NaN);
      const elig = eligibility(f, view.barsAvailable(symbol), params);
      evals.set(symbol, { symbol, f, score, elig, sector, rank: 0 });
    }
    const ranked = [...evals.values()].sort((a, b) => b.score.total - a.score.total || a.symbol.localeCompare(b.symbol));
    ranked.forEach((e, i) => {
      e.rank = i + 1;
    });
    const universeSize = ranked.length;
    const rankCutoff = Math.max(params.maxPositions * 2, 6);

    // ---- 2. evaluate current holdings -----------------------------------------
    const decisions = [];
    const exitResults = new Map();
    const remaining = new Map();
    const sellQty = new Map();
    for (const p of positions) remaining.set(p.symbol, { ...p });

    const push = (d) => {
      decisions.push({
        symbol: d.symbol,
        name: view.name(d.symbol),
        sector: sectorOf(d.symbol),
        action: d.action,
        timing: d.timing || null,
        quantity: d.quantity || 0,
        priceRef: d.priceRef ?? priceOf(d.symbol) ?? null,
        allocationValue: round(d.allocationValue || 0, 2),
        allocationPct: planEquity > 0 ? round((d.allocationValue || 0) / planEquity, 4) : 0,
        reason: d.reason,
        reasons: d.reasons || [],
        strategy,
        risk: d.risk || null,
        score: d.score ?? null,
        confidence: d.confidence ?? null,
        rank: d.rank ?? null,
        trigger: d.trigger || null,
        entryStatus: d.entryStatus || null,
        waitFor: d.waitFor || [],
        explanation: d.explanation || null,
        checks: d.checks || null,
        thesis: d.thesis || null,
        components: d.components || null,
        snapshot: d.snapshot || null,
        kind: d.kind || null,
        asOf,
        timestamp,
        decisionKey: `${asOf}|${d.symbol}|${d.action}${d.kind ? `|${d.kind}` : ''}`,
      });
    };

    for (const p of positions) {
      const e = evals.get(p.symbol);
      const price = priceOf(p.symbol) ?? p.avgPrice;
      if (pendingSells.has(p.symbol)) {
        push({
          symbol: p.symbol,
          action: 'HOLD',
          timing: 'WAIT',
          reason: 'HOLD - a sell order for this position is already pending; no duplicate order created',
          reasons: ['Pending sell order exists (idempotency protection).'],
          priceRef: price,
        });
        continue;
      }
      if (!e) {
        push({
          symbol: p.symbol,
          action: 'HOLD',
          timing: 'WAIT',
          reason: 'HOLD - no usable market data today; cannot evaluate the thesis',
          reasons: ['Position kept until data is available; the protective stop remains in force at the broker/monitor.'],
          priceRef: price,
        });
        continue;
      }
      const peak = Math.max(p.peakClose || p.avgPrice, view.highestCloseSince(p.symbol, p.entryDate || asOf) || 0);
      const res = analyzeExit({
        position: p,
        f: e.f,
        score: e.score,
        rank: e.rank,
        rankCutoff,
        regime: regimeView,
        params,
        sector: e.sector,
        isReviewDay: reviewDay,
        nextReviewLabel: nextLabel,
        peakClose: peak,
      });
      exitResults.set(p.symbol, res);
      if (res.action === 'HOLD') continue;
      const qty = Math.min(p.qty, res.quantity);
      sellQty.set(p.symbol, qty);
      const r = remaining.get(p.symbol);
      r.qty = p.qty - qty;
      if (r.qty <= 0) remaining.delete(p.symbol);
      else {
        r.stopPrice = res.stopPrice;
        r.partials = { ...(p.partials || {}), reduced: true, tookProfit: res.trigger === 'TAKE_PROFIT' || p.partials?.tookProfit };
      }
      const conf = clamp(Math.round(60 + (res.trigger && res.trigger.includes('STOP') ? 30 : 15)), 0, 100);
      push({
        symbol: p.symbol,
        action: res.action,
        timing: 'SELL_NOW',
        quantity: qty,
        priceRef: price,
        allocationValue: qty * price,
        reason: res.headline,
        reasons: res.reasons,
        trigger: res.trigger,
        score: e.score.total,
        rank: e.rank,
        confidence: conf,
        risk: { stopPrice: res.stopPrice, stopType: res.stopType, rMultiple: res.rMultiple, gainPct: res.gainPct },
        thesis: res.thesis,
        explanation: explainSell(res.action, res, p, e.f),
        snapshot: featureSnapshot(e.f),
      });
    }

    // ---- 3. structural restructuring on remaining holdings --------------------
    const scoreOf = (s) => evals.get(s)?.score.total;
    const stopOf = (p) => exitResults.get(p.symbol)?.stopPrice ?? p.stopPrice ?? p.initialStop;
    const live = () => [...remaining.values()].filter((p) => !pendingSells.has(p.symbol));
    const withStops = () => live().map((p) => ({ ...p, stopPrice: stopOf(p) }));

    const trimPosition = (symbol, qty, action, trigger, headline, reasons) => {
      const r = remaining.get(symbol);
      if (!r || qty <= 0) return;
      const e = evals.get(symbol);
      const price = priceOf(symbol) ?? r.avgPrice;
      const q = Math.min(r.qty, qty);
      sellQty.set(symbol, (sellQty.get(symbol) || 0) + q);
      r.qty -= q;
      const full = r.qty <= 0;
      if (full) remaining.delete(symbol);
      const ex = exitResults.get(symbol);
      const existing = decisions.findIndex((d) => d.symbol === symbol && d.action === 'HOLD');
      if (existing >= 0) decisions.splice(existing, 1);
      push({
        symbol,
        action: full ? 'SELL' : 'REDUCE',
        timing: 'SELL_NOW',
        quantity: q,
        priceRef: price,
        allocationValue: q * price,
        reason: headline,
        reasons,
        trigger,
        score: e ? e.score.total : null,
        rank: e ? e.rank : null,
        confidence: 70,
        risk: ex ? { stopPrice: ex.stopPrice, stopType: ex.stopType, rMultiple: ex.rMultiple, gainPct: ex.gainPct } : null,
        thesis: ex ? ex.thesis : null,
        explanation: ex ? explainSell(full ? 'SELL' : 'REDUCE', { ...ex, reasons }, r, e && e.f) : null,
        snapshot: e ? featureSnapshot(e.f) : null,
      });
    };

    if (withdrawal > 0) {
      const wd = planWithdrawal({
        amount: withdrawal,
        cash,
        equity,
        positions: live(),
        scoreOf,
        priceOf,
        params,
      });
      for (const s of wd.sells) {
        trimPosition(s.symbol, s.qty, s.full ? 'SELL' : 'REDUCE', 'CAPITAL_DECREASE', `${s.full ? 'SELL' : 'REDUCE'} - raise cash for the requested withdrawal (lowest-ranked holding first)`, [wd.explanation]);
      }
    }

    let concentrated = [];
    if (reviewDay) {
      concentrated = findConcentrated({ positions: live(), priceOf, equity: planEquity, params });
      for (const c of concentrated) {
        trimPosition(c.symbol, c.trimQty, 'REDUCE', 'CONCENTRATION', `REDUCE - position is ${round(c.weight * 100, 1)}% of the portfolio, above the ${round(params.maxPositionPct * 100, 0)}% cap`, [
          `Trimming ${c.trimQty} share(s) brings the position back to about ${round(params.maxPositionPct * 100, 0)}% of the portfolio.`,
        ]);
      }
    }

    const breach = findRiskBreach({ positions: withStops(), priceOf, equity: planEquity, params, scoreOf });
    if (breach.breach) {
      for (const t of breach.trims) {
        trimPosition(t.symbol, t.qty, 'REDUCE', 'RISK_LIMIT_BREACH', 'REDUCE - portfolio open risk exceeds the configured cap', [
          `Open risk ${round((breach.total / planEquity) * 100, 2)}% of equity vs cap ${round(params.maxOpenRiskPct * 100, 1)}%.`,
        ]);
      }
    }

    // ---- 4. candidate entry analysis ------------------------------------------
    const heldNow = () => new Set([...live().map((p) => p.symbol), ...pendingBuySymbols]);
    const entryFor = (e) =>
      analyzeEntry({ f: e.f, score: e.score, elig: e.elig, regime: regimeView, params, sector: e.sector, horizonPresets: HORIZON_PRESETS });

    const candidates = [];
    for (const e of ranked) {
      if (candidates.length >= 30) break;
      if (remaining.has(e.symbol) || pendingBuySymbols.has(e.symbol) || sellQty.has(e.symbol)) continue;
      if (e.score.total < params.watchScore) continue;
      candidates.push({ ...e, entry: entryFor(e) });
    }
    const qualifying = candidates.filter((c) => c.entry.checks.filter((k) => k.critical).every((k) => k.pass));
    const liquidQualifying = qualifying.filter((c) => (c.f.liq.advValue || 0) * params.maxAdvParticipation >= params.minPositionValue);
    const sizeSymbols = [...live().map((p) => p.symbol), ...qualifying.map((c) => c.symbol)].filter((s) => view.has(s));
    const corr = averageCorrelation(view, sizeSymbols, params.corrLookback);
    const heldValidCount = live().length;
    const size = recommendPortfolioSize({
      equity: planEquity,
      heldValid: heldValidCount,
      qualifying: qualifying.length,
      liquidQualifying: liquidQualifying.length,
      rho: corr.rho,
      rhoMeasured: corr.measured,
      params,
      policy,
    });

    // ---- 5. regime-driven capacity trim (only holdings that would not be bought today)
    if (reviewDay && policy.positionsMult < 1 && live().length > size.n) {
      const buyBar = params.minScore + policy.scoreBonus;
      const weak = live()
        .filter((p) => (scoreOf(p.symbol) ?? 0) < buyBar)
        .sort((a, b) => (scoreOf(a.symbol) ?? 0) - (scoreOf(b.symbol) ?? 0));
      let excess = live().length - size.n;
      for (const p of weak) {
        if (excess <= 0) break;
        trimPosition(p.symbol, p.qty, 'SELL', 'REGIME_CAPACITY', `SELL - ${regime.regime} regime allows only ${size.n} position(s) and this is the weakest holding`, [
          `Score ${scoreOf(p.symbol)} is below the ${round(buyBar, 0)} bar for a fresh entry in a ${regime.regime} regime, and the portfolio holds more names than the ${size.n} the regime permits.`,
        ]);
        excess -= 1;
      }
    }

    // ---- 6. replacements (only when the portfolio cannot simply add) -----------
    const holdingsAfter = () => live();
    const swapInfo = new Map();
    let rejectedSwaps = [];
    const actionable = candidates.filter((c) => c.entry.actionable && (c.f.liq.advValue || 0) * params.maxAdvParticipation >= params.minPositionValue);
    const slotsBeforeSwap = Math.max(0, size.n - holdingsAfter().length - pendingBuySymbols.size);
    if (reviewDay && policy.allowNewBuys && actionable.length && slotsBeforeSwap === 0 && holdingsAfter().length) {
      const rep = evaluateReplacements({
        holdings: holdingsAfter().map((p) => ({ symbol: p.symbol, score: scoreOf(p.symbol) ?? 0, price: priceOf(p.symbol) ?? p.avgPrice, qty: p.qty })),
        candidates: actionable.map((c) => ({ symbol: c.symbol, score: c.score.total, status: c.entry.status })),
        params,
        costs,
        slippageBps,
      });
      rejectedSwaps = rep.rejected;
      for (const sw of rep.swaps) {
        const p = remaining.get(sw.sell);
        if (!p) continue;
        swapInfo.set(sw.buy, sw);
        trimPosition(sw.sell, p.qty, 'SELL', 'REPLACEMENT', `SELL - replaced by stronger candidate ${sw.buy}`, [sw.reason]);
      }
    }

    // ---- 7. capital allocation ---------------------------------------------------
    const reservePct = Math.max(params.minCashPct, policy.reservePct ?? policy.minCashPct);
    const reserve = planEquity * reservePct;
    const proceeds = redeploy
      ? [...sellQty.entries()].reduce((a, [sym, q]) => {
          const px = priceOf(sym) ?? 0;
          return a + q * px * (1 - slippageBps / 10_000) - legCost({ side: 'SELL', price: px, qty: q, costs }).total;
        }, 0)
      : 0;
    let simCash = cash + proceeds - withdrawal;
    const simPositions = () => live().map((p) => ({ ...p, stopPrice: stopOf(p) }));
    const investedNow = live().reduce((a, p) => a + valueOf(p), 0) + pendingBuyValue;
    const deployable = policy.allowNewBuys && withdrawal === 0 ? Math.max(0, Math.min(simCash - pendingBuyValue - reserve, size.investable - investedNow)) : 0;
    const slotsOpen = policy.allowNewBuys && withdrawal === 0 ? Math.max(0, size.n - live().length - pendingBuySymbols.size) : 0;

    const sizeFor = (c, n = size.n) =>
      targetPositionValue({
        price: c.f.price,
        riskPerShare: c.entry.risk.riskPerShare,
        equity: planEquity,
        n,
        investable: size.investable,
        advValue: c.f.liq.advValue,
        params,
        policy,
      });

    const newCands = actionable
      .filter((c) => !remaining.has(c.symbol) && !pendingBuySymbols.has(c.symbol))
      .map((c) => ({ symbol: c.symbol, price: c.f.price, targetValue: sizeFor(c).value, ref: c }));

    const topUps = [];
    if ((reviewDay || capitalEvent) && policy.allowNewBuys && withdrawal === 0) {
      for (const p of live()) {
        const e = evals.get(p.symbol);
        const ex = exitResults.get(p.symbol);
        if (!e || !ex || ex.action !== 'HOLD' || ex.timing === 'WAIT') continue;
        if (e.score.total < params.minScore) continue;
        const entry = entryFor(e);
        if (!entry.actionable) continue;
        const target = sizeFor({ f: e.f, entry }).value;
        topUps.push({ symbol: p.symbol, price: e.f.price, targetValue: target, currentValue: valueOf(p), ref: { ...e, entry } });
      }
      topUps.sort((a, b) => b.ref.score.total - a.ref.score.total);
    }

    const allocation = allocateCapital({
      deployable,
      equity: planEquity,
      newCandidates: newCands,
      topUps,
      slotsOpen,
      params,
      additionalCapital: deposit > 0 ? deposit : null,
    });

    const bought = new Set();
    const buyOne = (item, kind) => {
      const c = item.ref;
      const price = c.f.price;
      const sz = sizeFor(c);
      const desired = Math.floor(item.allocation / (price * (1 + slippageBps / 10_000)));
      const chk = checkBuy({
        symbol: c.symbol,
        sector: sectorOf(c.symbol),
        price,
        qty: desired,
        riskPerShare: c.entry.risk.riskPerShare,
        equity: planEquity,
        cash: simCash,
        positions: simPositions(),
        priceOf,
        sectorOf,
        params,
        policy,
        costs,
        slippageBps,
        advValue: c.f.liq.advValue,
        pendingBuyValue,
      });
      if (!chk.ok) return { ok: false, reasons: chk.reasons };
      const value = chk.qty * price;
      const eff = price * (1 + slippageBps / 10_000);
      simCash -= chk.qty * eff + legCost({ side: 'BUY', price: eff, qty: chk.qty, costs }).total;
      const riskAmount = chk.qty * c.entry.risk.riskPerShare;
      const existing = remaining.get(c.symbol);
      if (existing) existing.qty += chk.qty;
      else
        remaining.set(c.symbol, {
          symbol: c.symbol,
          qty: chk.qty,
          avgPrice: price,
          entryDate: asOf,
          initialStop: c.entry.risk.stop,
          stopPrice: c.entry.risk.stop,
        });
      bought.add(c.symbol);
      const sw = swapInfo.get(c.symbol);
      const trigger = kind === 'ADD' ? (capitalEvent ? 'CAPITAL_INCREASE' : 'TOP_UP') : sw ? 'REPLACEMENT' : capitalEvent && deposit > 0 ? 'CAPITAL_INCREASE' : reviewDay ? 'SCHEDULED_REVIEW' : 'ENTRY_TRIGGER';
      const sizing = {
        qty: chk.qty,
        value,
        equity: planEquity,
        basis: sz.basis,
        riskAmount,
        clipNotes: chk.reasons,
      };
      const explanation = explainBuy({
        symbol: c.symbol,
        entry: c.entry,
        score: c.score,
        f: c.f,
        regime: regimeView,
        params,
        sector: c.sector,
        sizing,
        rank: c.rank,
        universeSize,
        kind,
        trigger,
      });
      const conf = Math.round(0.6 * c.score.total + (0.4 * 100 * c.entry.checks.filter((k) => k.pass).length) / c.entry.checks.length);
      push({
        symbol: c.symbol,
        action: 'BUY',
        timing: 'BUY_NOW',
        quantity: chk.qty,
        priceRef: price,
        allocationValue: value,
        reason: `${c.entry.status.replace('_', ' ')} - ${c.entry.headline.split(' - ').slice(1).join(' - ') || c.entry.headline}${kind === 'ADD' ? ' (top-up)' : ''}`,
        reasons: [explanation.whyBuy, explanation.whyNow, ...chk.reasons],
        trigger,
        score: c.score.total,
        rank: c.rank,
        confidence: clamp(conf, 0, 100),
        entryStatus: c.entry.status,
        risk: {
          stopPrice: c.entry.risk.stop,
          stopType: c.entry.risk.stopType,
          target: c.entry.risk.target,
          rewardRisk: c.entry.risk.rewardRisk,
          riskPerShare: c.entry.risk.riskPerShare,
          riskAmount: round(riskAmount, 2),
          riskPctOfPortfolio: round(riskAmount / planEquity, 4),
        },
        explanation,
        checks: c.entry.checks,
        components: Object.fromEntries(Object.entries(c.score.components).map(([k, v]) => [k, v.score])),
        snapshot: featureSnapshot(c.f),
        kind,
      });
      return { ok: true };
    };

    const failedBuys = new Map();
    for (const item of allocation.newBuys) {
      const r = buyOne(item, 'NEW');
      if (!r.ok) failedBuys.set(item.symbol, r.reasons);
    }
    for (const item of allocation.adds) {
      const r = buyOne(item, 'ADD');
      if (!r.ok) failedBuys.set(item.symbol, r.reasons);
    }

    // ---- 8. HOLD decisions for untouched holdings --------------------------------
    for (const p of positions) {
      if (pendingSells.has(p.symbol)) continue;
      if (sellQty.has(p.symbol) || decisions.some((d) => d.symbol === p.symbol && d.action !== 'BUY')) continue;
      const ex = exitResults.get(p.symbol);
      const e = evals.get(p.symbol);
      if (!ex || !e) continue;
      push({
        symbol: p.symbol,
        action: 'HOLD',
        timing: ex.timing === 'WAIT' ? 'WAIT' : 'HOLD',
        quantity: 0,
        priceRef: e.f.price,
        allocationValue: valueOf(p),
        reason: ex.headline,
        reasons: [...ex.reasons, ...ex.warnings],
        score: e.score.total,
        rank: e.rank,
        confidence: clamp(Math.round(40 + 60 * (ex.thesis.filter((t) => t.ok).length / ex.thesis.length)), 0, 100),
        risk: { stopPrice: ex.stopPrice, stopType: ex.stopType, rMultiple: ex.rMultiple, gainPct: ex.gainPct, peakClose: ex.peakClose, peakR: ex.peakR },
        thesis: ex.thesis,
        explanation: explainHold(ex, p),
        snapshot: featureSnapshot(e.f),
      });
    }

    // ---- 9. WAIT / WATCH rows for candidates we did not buy ----------------------
    const waitList = candidates.filter((c) => !bought.has(c.symbol)).slice(0, waitRows);
    for (const c of waitList) {
      let note = null;
      const clipped = failedBuys.get(c.symbol);
      if (c.entry.actionable) {
        if (!policy.allowNewBuys) note = dd.halted ? 'Drawdown halt: no new purchases' : `${regime.regime} regime: new purchases paused`;
        else if (withdrawal > 0) note = 'Capital is being withdrawn; no new purchases';
        else if (clipped && clipped.length) note = clipped.join('; ');
        else if (slotsOpen === 0) note = `Qualifies (${c.entry.status.replace('_', ' ')}) but the recommended ${size.n}-stock portfolio is full`;
        else if (deployable < params.minPositionValue) note = `Qualifies but only ${round(deployable, 0)} is deployable after the cash reserve`;
        else note = 'Qualifies but capital was allocated to higher-ranked candidates';
      }
      const waitFor = c.entry.actionable ? [] : c.entry.waitFor;
      push({
        symbol: c.symbol,
        action: 'WAIT',
        timing: 'WAIT',
        priceRef: c.f.price,
        reason: note ? `WAIT - ${note}` : c.entry.headline,
        reasons: note ? [note, ...c.entry.waitFor] : c.entry.waitFor,
        score: c.score.total,
        rank: c.rank,
        confidence: null,
        entryStatus: c.entry.status,
        waitFor: note && c.entry.actionable ? [note] : waitFor,
        risk: { stopPrice: c.entry.risk.stop, target: c.entry.risk.target, rewardRisk: c.entry.risk.rewardRisk },
        explanation: explainWait(c.symbol, c.entry, c.score, note),
        checks: c.entry.checks,
        components: Object.fromEntries(Object.entries(c.score.components).map(([k, v]) => [k, v.score])),
        snapshot: featureSnapshot(c.f),
      });
    }

    // ---- 10. triggers, summary, result -------------------------------------------
    const exitsByTrigger = {};
    for (const d of decisions) {
      if (['SELL', 'EXIT', 'REDUCE'].includes(d.action) && d.trigger) {
        const key = d.trigger === 'MOMENTUM_DETERIORATION' ? 'BELOW_THRESHOLD' : d.trigger;
        exitsByTrigger[key] = (exitsByTrigger[key] || 0) + 1;
      }
    }
    const trig = detectTriggers({
      horizon: params.horizon,
      asOf,
      lastReviewDate: state.lastReviewDate,
      regime,
      prevRegime: state.prevRegime,
      capitalEvent,
      exitsByTrigger,
      concentrated,
      riskBreach: breach.breach ? `Open risk ${round((breach.total / planEquity) * 100, 2)}% exceeds cap ${round(params.maxOpenRiskPct * 100, 1)}%` : null,
      drawdownHalt: dd.halted ? `Drawdown ${round(dd.drawdown * 100, 1)}% reached the ${round(params.maxDrawdownHaltPct * 100, 0)}% halt level` : null,
      forceReview,
    });

    const order = { SELL: 0, EXIT: 0, REDUCE: 1, BUY: 2, HOLD: 3, WAIT: 4 };
    decisions.sort((a, b) => order[a.action] - order[b.action] || (b.score ?? 0) - (a.score ?? 0));

    const invested = live().reduce((a, p) => a + valueOf(p), 0);
    const summary = summarizeRun({
      asOf,
      equity,
      cash,
      invested: invested0,
      positionsCount: positions.length,
      regime,
      size,
      decisions,
      allocation,
      triggers: trig.triggers,
      capitalEvent,
      review: reviewDay,
      drawdown: dd,
      deployable,
    });
    if (rejectedSwaps.length) summary.lines.push(...rejectedSwaps.slice(0, 3));

    const rawStats = portfolioStats(simPositions(), priceOf, sectorOf, planEquity);
    const exposure = {
      invested: round(rawStats.invested, 2),
      openRisk: round(rawStats.openRisk, 2),
      openRiskPct: round(rawStats.openRiskPct, 4),
      positionsCount: rawStats.positionsCount,
      sectors: Object.fromEntries([...rawStats.sectorValue].map(([k, v]) => [k, round(v / (planEquity || 1), 4)])),
    };

    const ranking = lean ? [] : ranked.map((e) => ({
      rank: e.rank,
      symbol: e.symbol,
      name: view.name(e.symbol),
      sector: sectorOf(e.symbol),
      price: round(e.f.price, 2),
      score: e.score.total,
      eligible: e.elig.eligible,
      components: Object.fromEntries(Object.entries(e.score.components).map(([k, v]) => [k, v.score])),
      ret: { d1: round(e.f.ret.d1, 4), w1: round(e.f.ret.w1, 4), m1: round(e.f.ret.m1, 4), m3: round(e.f.ret.m3, 4), m6: round(e.f.ret.m6, 4), m12: round(e.f.ret.m12, 4) },
      rsVsIndex3m: round(e.f.rs.vsIndex3m, 4),
      relVolume: round(e.f.flow.rel, 2),
      rsi: round(e.f.tech.rsi, 1),
      adx: round(e.f.tech.adx, 1),
      atrPct: round(e.f.vol.atrPct, 4),
      aboveEma: emaFlags(params.emaPeriods, e.f.trend),
      breakout: e.f.tech.breakout,
      pctFromHigh52: round(e.f.tech.pctFromHigh52, 4),
      held: remaining.has(e.symbol) || sellQty.has(e.symbol) || positions.some((p) => p.symbol === e.symbol),
      status: candidates.find((c) => c.symbol === e.symbol)?.entry.status || null,
      ineligibleReasons: e.elig.reasons,
    }));

    return {
      asOf,
      strategy,
      horizon: params.horizon,
      review: reviewDay,
      triggers: trig.triggers,
      regime: { regime: regime.regime, score: regime.score, components: regime.components, metrics: regime.metrics, reasons: regime.reasons, policy: regime.policy },
      drawdown: dd,
      capital: {
        equity: round(equity, 2),
        planEquity: round(planEquity, 2),
        cash: round(cash, 2),
        invested: round(invested0, 2),
        deployable: round(deployable, 2),
        reserve: round(reserve, 2),
        reservePct: round(reservePct, 4),
        capitalEvent,
      },
      portfolioSize: size,
      allocation: {
        option: allocation.option,
        label: allocation.optionLabel,
        explanation: allocation.explanation,
        notes: allocation.notes,
        cashLeft: round(allocation.cashLeft, 2),
      },
      decisions,
      ranking,
      summary,
      stats: exposure,
      nextState: { regime: regime.regime, lastReviewDate: reviewDay ? asOf : state.lastReviewDate || null },
      universeSize,
      generatedAt: timestamp,
    };
  }
}

module.exports = { PortfolioDecisionEngine, statusAtLeast, roundPrice };
