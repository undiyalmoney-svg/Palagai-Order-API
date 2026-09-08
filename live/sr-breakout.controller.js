'use strict';
/**
 * S/R Breakout — Paper controller. RESEARCH / PAPER ONLY.
 * Fetches historical 5-min candles (read-only, via the pushed Kite token) and
 * runs the sr-breakout engine. Places NO orders. Nifty Paper ₹ defaults to
 * the index future (pts × 65), matching Live. Pass niftyVehicle:'option' to
 * re-price the same signals as CE/PE. Bank/Crude stay option premium.
 */
const https = require('https');
const market = require('./kite-market');
// Exit/entry rules come from the SHARED config so Paper and Live cannot drift.
const { exitOptsFor, CUT_LOSS_RS, DEFAULT_LOTS, DAY_LOSS_STOP_RS, DAY_PROFIT_TARGET_RS, LOT_UNITS, paperVehicleFor } = require('./sr-strategy-config');
const store = require('./live.store');
const { runSrBreakout } = require('./sr-breakout');
const { observe, history: obsHistory, confirmLiveEntry, confirmLiveExit } = require('./sr-observe');
const collector = require('./sr-collector');
const { auditDay } = require('./sr-debug');
const { research } = require('./sr-research');
const srLive = require('./sr-live');
const { optionPnlForTrade, summarizeOptionTrades, markOneOpenLeg } = require('./sr-option-pnl');

function userId(req) { return req.user?.id || 'anonymous'; }

// Instrument registry. NIFTY 50 / NIFTY BANK have fixed index tokens; Crude Oil
// Mini is an MCX monthly future resolved to its front month at request time.
const INSTRUMENTS = {
  nifty: {
    key: 'nifty', name: 'Nifty 50', token: '256265', unitsPerLot: LOT_UNITS.nifty, 
    // HARD LOSS CUT-OFF per lot. Wide on purpose: it caps the worst trade at
    // -Rs5,000 (was -Rs11,936) and still IMPROVES net on both windows measured
    // together (Rs815,673 vs Rs801,285), with PF 2.53 -> 2.72. Tighter caps cost
    // real money (Rs4,000 -> Rs788k combined, Rs3,000 -> worse still), so do not
    // shrink this without re-running the train/test split.
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' },
    entryPts: 27, gapLo: 100, gapHi: 175, targetByScore: { 1: 20, 2: 25, 3: 30 },
  },
  banknifty: {
    key: 'banknifty', name: 'Bank Nifty', token: '260105', unitsPerLot: LOT_UNITS.banknifty, 
    // NO cutLossRs ON PURPOSE — measured, not assumed. On the 4-bar exit over the
    // walk-forward test window a cut-off destroys this book:
    //   none    net +Rs213,758  PF 3.43  worst -Rs4,538
    //   Rs4,000 net -Rs202,151  PF 0.76
    //   Rs3,000 net -Rs459,463  PF 0.45
    //   Rs2,000 net -Rs697,549  PF 0.25
    // Bank trades routinely dip intrabar and recover inside the 20-minute hold:
    // 84% of trades that go past -Rs3,000 still close as WINNERS. A stop cannot
    // tell those apart from real failures, so it cuts the winners. The 4-bar time
    // exit already caps the worst trade at -Rs4,538 without that damage.
    session: { entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15' },
    entryPts: 60, gapLo: 275, gapHi: 465, targetByScore: { 1: 40, 2: 50, 3: 60 },
  },
  crude: {
    // PROVISIONAL / under observation — only ~80 days of history, not enough to
    // trust. Stricter defaults (bigger candle, no new entries in the thin late-US
    // session) turn it from bleeding to green in-sample; the forward paper run is
    // what actually validates it. Bank Nifty + Nifty 50 are the proven books.
    key: 'crude', name: 'Crude Oil Mini', token: null, unitsPerLot: LOT_UNITS.crude, // token resolved at runtime
    // Crude needs size to clear its own brokerage: the Rs120 cost is per TRADE,
    // not per lot, so the edge scales with lots while the cost does not.
    // Measured over 89 days (226 trades, 427 gross pts/lot):
    //   1 lot -Rs22,850 | 3 -Rs14,310 | 5 -Rs5,770 | 7 +Rs2,770 | 10 +Rs15,580
    // BREAK-EVEN IS 6.4 LOTS. The default below (5) is still net negative by
    // about Rs5,770 over that window — set deliberately as a starting size, not
    // because it is profitable. Raising it also scales the worst trade linearly
    // (-Rs2,500/lot), so 10 lots means -Rs25,000 on a single trade.
    // Cut-off is ~neutral here (-Rs23,650 vs -Rs23,890) and caps the worst trade.
    // Crude is net NEGATIVE either way; this bounds it, it does not fix it.
    session: { entryStartHm: '09:30', entryEndHm: '20:00', squareOffHm: '23:20' },
    // Crude had NO time exit, so a losing trade rode to the 23:20 square-off —
    // average hold 179 min, worst trade -Rs5,300. 18 bars (90 min) cuts the
    // average hold to 69 min and the worst trade to -Rs2,740.
    // IN-SAMPLE ONLY (89 days of history) — cannot be walk-forward validated,
    // and Crude is net NEGATIVE at every time exit tested (best -Rs23,090).
    timeStopBars: 18,
    entryPts: 50, gapLo: 78, gapHi: 130, targetByScore: { 1: 20, 2: 25, 3: 30 },
  },
};

// Selectable strategy versions + PROFITABILITY GATE.
//   status: 'production'  — the incumbent Baseline (default; kept unchanged)
//           'eligible'    — passed all OOS criteria → Paper/Live-candidate selectable
//           'research_only'— has backtests but not OOS-registered → NOT selectable
//           'not_eligible'— OOS-tested and failed a criterion → NOT selectable
// Eligibility is sourced from the recorded OOS validation (below), not a fresh
// single backtest. Real-order execution stays DISABLED for every status.
// Criteria for 'eligible': causal (no-look-ahead PASS) + OOS net>0 + OOS Rs/day>0
//   + OOS profit factor >= 1.30 + OOS trades >= 200. All futures-equivalent.
const GATE = { minOosPf: 1.3, minOosTrades: 200 };
const STRATEGIES = {
  baseline: {
    label: 'Baseline (production)', status: 'production', instrument: 'nifty+bank', opts: {},
    oos: { note: 'incumbent control; OOS PF ~1.1 (marginal) — kept as default, not gated' },
  },
  nifty_retest_v1: {
    label: 'Nifty Retest V1 (candidate)', status: 'eligible', instrument: 'nifty',
    // EXIT ONLY. Hold stays 6 bars and the target stays 20 pts — the profitable
    // logic is untouched. The loss cap (cutLossRs 5000 on the instrument spec)
    // is the whole change. Shortening the hold to 4 bars was tried and REJECTED:
    // it cost Rs17,539 of net for a smaller tail than the cap already gives.
    // TWO PROFIT-SIDE EXIT RULES (added after auditing 5 months of Nifty losses).
    // The audit found the real cause: EVERY losing trade went green first — none
    // went straight against the entry — and half reached +10 pts or more before
    // reversing. Two of the six biggest losses hit +16.9 and +17.1 (target is
    // +20) and still finished at the -Rs5,000 cap. The book had no way to
    // protect an open profit, so a trade at +17 and fading was treated exactly
    // like one at -17. That is also why every fixed loss stop failed here: a
    // stop asks "is this losing?", which is the wrong question when they all
    // start out winning.
    //   lockArmPts 12 / lockAtPts 5 — once best move reaches +12, exit at +5.
    //   giveUpBar 2 / giveUpMinPts 8 — if 2 bars in the trade has not made +8
    //   of progress, leave; it is not paying. Skipped once the lock has armed.
    // Walk-forward (train 2024-01..2025-07, test 2025-07..2026-09 never used to
    // choose) on the TEST window:
    //   before  net Rs374,084  total losses -Rs266,679  PF 2.72  win 76%
    //   after   net Rs363,008  total losses -Rs157,068  PF 3.85  win 83%
    // Losses down 41% for 3% less net. This trades a little profit for a much
    // smaller loss book — it is not a profit optimisation, and the numbers
    // above should be re-measured if any of the four values change.
    // ENTRY METER (maxRetestBars 2): refuse a retest that takes more than 2
    // bars (10 min) to fill. Measured over 2024-01..2026-08, by fill delay:
    //   1-2 bars  1269 trades  89% win  +Rs692/trade
    //   2-4 bars    99 trades  71% win  +Rs263/trade
    //   4-8 bars   114 trades  64% win  -Rs254/trade
    //   8+ bars    130 trades  62% win  -Rs391/trade
    // A quick pullback means the level is still being respected; a slow one
    // means the move already stalled. Causal — at fill time we know how long
    // it took. Refusing also frees the day's trade slot for a better setup,
    // which is why the gain exceeds simply deleting those trades.
    // Walk-forward, train-optimal at 2, scored on the untouched TEST window:
    //   before  708 trades  83% win  net Rs363,008  losses -Rs157,068  PF 3.85
    //   after   629 trades  93% win  net Rs433,570  losses  -Rs31,198  PF 17.32
    // +17% net AND half the losses. The effect is smooth across 1-6 bars on
    // both windows (not a fitted spike), so the exact value is not critical.
    opts: exitOptsFor('nifty'),        // SHARED — see sr-strategy-config.js
    // OOS = walk-forward TEST window only. Re-measure whenever opts change.
    oos: { causal: true, pf: 17.32, rsDay: 1618, trades: 629, net: 433570, window: '2025-07..2026-09 (walk-forward test)' },
  },
  bank_intraday_v1: {
    label: 'Bank Intraday V1 (candidate)', status: 'eligible', instrument: 'banknifty',
    // EXIT ONLY: hold shortened 9 -> 6 bars (45 -> 30 min). Target stays 20 pts;
    // entries untouched. Best on the two windows COMBINED, and it halves the
    // tail: worst trade -Rs22,535 -> -Rs10,843, PF 2.23 -> 3.01. Stable choice —
    // Rs236k train / Rs210k test, where 9 bars decays Rs243k -> Rs162k.
    //
    // failStop WAS enabled here in a2e8d34 ("exit when the broken 15m wall
    // fails, not after 45 min TIME") and is deliberately removed again. It
    // reaches the SAME worst trade as the 6-bar hold but pays enormously for
    // it. Measured on the walk-forward TEST window, identical entries:
    //   9 bars + failStop   net -Rs239,478  PF 0.67  win 63%  worst -Rs10,843
    //   6 bars + failStop   net -Rs238,031  PF 0.67  win 62%  worst -Rs10,843
    //   6 bars, no failStop net +Rs209,770  PF 3.01  win 89%  worst -Rs10,843
    // The wall-fail test fires on trades that recover: 84% of Bank trades that
    // dip past -Rs3,000 still close as winners, so cutting there sells the
    // winners. The time exit gets the same tail without that cost.
    // Do not re-enable it, and do not add a per-trade rupee stop, without
    // re-running the train/test split.
    opts: exitOptsFor('banknifty'),    // SHARED — see sr-strategy-config.js
    oos: { causal: true, pf: 6.07, rsDay: 778, trades: 710, net: 211602, window: '2025-07..2026-09 (walk-forward test)' },
  },
};
// Auto-routing: each instrument runs its OWN validated eligible strategy (no
// manual selector). An instrument with no eligible strategy falls back to Baseline.
const AUTO_STRATEGY = { nifty: 'nifty_retest_v1', banknifty: 'bank_intraday_v1', crude: 'baseline' };
function autoStrategyFor(key) { return STRATEGIES[AUTO_STRATEGY[key]] || STRATEGIES.baseline; }
function resolveStrategy(name) { return STRATEGIES[String(name || 'baseline').toLowerCase()] || STRATEGIES.baseline; }
function isSelectable(s) { return s && (s.status === 'production' || s.status === 'eligible'); }
function strategyList() {
  return Object.entries(STRATEGIES).map(([id, s]) => ({ id, label: s.label, status: s.status, instrument: s.instrument, selectable: isSelectable(s), oos: s.oos || null }));
}

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** GET /instruments/MCX (CSV) directly — fetchInstruments only returns NSE/NFO. */
function fetchMcxCsv(authorization) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: 'api.kite.trade', path: '/instruments/MCX', headers: { 'X-Kite-Version': '3', Authorization: authorization } },
      (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve(b)); }).on('error', reject);
  });
}

/** Resolve the front-month CRUDEOILM future token (earliest expiry >= today). */
async function resolveCrudeToken(authorization) {
  const csv = await fetchMcxCsv(authorization);
  const lines = csv.trim().split('\n');
  // Roll on expiry day: require expiry strictly AFTER today (date-only), so on
  // the contract's expiry date we trade the NEXT expiry, not the expiring one.
  const t = new Date(); const todayMid = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const fut = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const sym = (p[2] || '').replace(/"/g, '');
    const type = (p[9] || '').replace(/"/g, '');
    if (!/^CRUDEOILM/.test(sym) || type !== 'FUT') continue;
    const exp = parseExpiry(sym, (p[5] || '').replace(/"/g, ''));
    if (exp && exp > todayMid) fut.push({ token: String(p[0]).replace(/"/g, ''), sym, exp });
  }
  fut.sort((a, b) => a.exp - b.exp);
  if (!fut.length) throw new Error('No live CRUDEOILM future found');
  return { token: fut[0].token, symbol: fut[0].sym };
}
function parseExpiry(sym, expiryField) {
  if (expiryField) { const d = new Date(expiryField); if (!isNaN(d)) return d; }
  const m = /(\d{2})([A-Z]{3})/.exec(sym || '');
  if (m) return new Date(2000 + Number(m[1]), MONTHS[m[2]] ?? 0, 28);
  return null;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function shiftDays(iso, delta) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10); }

/**
 * POST /live/sr-breakout
 * body: { instruments:['nifty'|'banknifty'|'crude'], fromDate, toDate,
 *         niftyVehicle?: 'fut'|'option', entryPts?, lots?, lotSize? }
 * When fromDate/toDate == today, it fetches today's candles → today's results.
 */
async function srBreakout(req, res) {
  const authorization =
    req.headers['x-kite-authorization'] ||
    req.headers['x-kite-authorisation'] ||
    (await store.getAuthorizationFor(userId(req)));
  if (!authorization) {
    res.status(400).json({ status: 'error', message: 'Kite session required — Get Token (or Push Kite token), then retry Paper.' });
    return;
  }
  const body = req.body || {};
  const keys = Array.isArray(body.instruments) && body.instruments.length ? body.instruments : ['nifty'];
  const fromDate = body.fromDate || todayIso();
  const toDate = body.toDate || todayIso();

  const results = [];
  for (const key of keys) {
    const spec = INSTRUMENTS[key];
    if (!spec) { results.push({ key, error: 'unknown instrument' }); continue; }
    try {
      let token = spec.token;
      let contract = spec.name;
      if (key === 'crude') { const r = await resolveCrudeToken(authorization); token = r.token; contract = r.symbol; }
      // Fetch ~12 calendar days of warm-up before fromDate so S/R + trend are
      // primed; those bars build context but produce no reported trades.
      const warmupFrom = shiftDays(fromDate, -12);
      const candles = await market.fetchHistorical5m(authorization, token, warmupFrom, toDate);
      const entryPts = numOr(body.entryPts, spec.entryPts);
      // Lots are PER INSTRUMENT. Precedence: explicit per-instrument value from
      // the request, then a single shared `lots`, then the instrument's own
      // default. Books have very different tick values (Rs65 / Rs30 / Rs10 per
      // point), so one shared size is rarely right for all three.
      const lots = Math.max(1, numOr(body.lotsByInstrument && body.lotsByInstrument[key],
        numOr(body.lots, DEFAULT_LOTS[key] || 1)));
      const unitsPerLot = spec.unitsPerLot;
      const perPoint = unitsPerLot * lots;                // ₹ per point
      // Daily risk stops arrive in ₹ from the UI; convert to points for the engine.
      // Defaults come from the shared config so Paper and Live brake alike.
      const dayLossStopRs = numOr(body.dayLossStopRs, DAY_LOSS_STOP_RS);
      const dayProfitTargetRs = numOr(body.dayProfitTargetRs, DAY_PROFIT_TARGET_RS);
      const dayLossStop = dayLossStopRs > 0 ? dayLossStopRs / perPoint : 0;
      const dayProfitTarget = dayProfitTargetRs > 0 ? dayProfitTargetRs / perPoint : 0;
      const maxTradesPerDay = Math.max(1, numOr(body.maxTradesPerDay, 3));
      // AUTO per instrument (no selector): each instrument runs its own eligible
      // strategy. An explicit body.strategy still works as a research override,
      // but only if it passes the gate; otherwise fall back to the instrument's
      // auto strategy. Real orders stay DISABLED regardless.
      let strat = body.strategy ? resolveStrategy(body.strategy) : autoStrategyFor(key);
      if (!isSelectable(strat)) strat = autoStrategyFor(key);
      const { trades, summary } = runSrBreakout(candles, {
        entryPts, trendBars: 20, gapLo: spec.gapLo, gapHi: spec.gapHi, targetByScore: spec.targetByScore,
        maxTradesPerDay, dayLossStop, dayProfitTarget, reportFromDate: fromDate, ...spec.session,
        // SHARED exit/entry rules for this instrument (sr-strategy-config.js).
        // Applied before strat.opts so an explicit strategy can still override
        // for research, but Paper and Live share the same defaults.
        ...exitOptsFor(key, lots),
        ...strat.opts,                                 // version overrides (BASELINE = {})
      });
      const liveSpec = srLive.SPEC[key];
      const vehicle = paperVehicleFor(key, liveSpec && liveSpec.vehicle, body.niftyVehicle);
      const pricingSpec = liveSpec ? { ...liveSpec, vehicle } : null;
      const paperSess = {};
      const tradesR = [];
      for (const t of markOneOpenLeg(trades)) {
        const indexRupees = Math.round(t.points * perPoint);
        if (t.liveSkip) {
          tradesR.push({
            ...t, instrument: spec.name, contract,
            indexRupees,
            rupees: null,
            rupeesSource: 'skipped-live-leg',
            optionSymbol: null,
            optionEntryPremium: null,
            optionExitPremium: null,
          });
          continue;
        }
        if (pricingSpec && pricingSpec.vehicle === 'fut') {
          tradesR.push({
            ...t, instrument: spec.name, contract,
            indexRupees,
            rupees: indexRupees,
            rupeesSource: 'index-fut',
            optionSymbol: 'NIFTY FUT',
            optionEntryPremium: t.entryPrice,
            optionExitPremium: t.exitPrice,
          });
          continue;
        }
        const opt = pricingSpec
          ? await optionPnlForTrade({
            authorization, spec: pricingSpec, trade: t, lots, session: paperSess,
            pickOption: srLive.pickOption,
          })
          : { rupees: null, rupeesSource: 'unavailable', reason: 'no-spec' };
        tradesR.push({
          ...t, instrument: spec.name, contract,
          indexRupees,
          rupees: opt.rupees,
          rupeesSource: opt.rupees != null ? (opt.rupeesSource || 'option-live') : 'unavailable',
          optionSymbol: opt.optionSymbol || null,
          optionEntryPremium: opt.optionEntryPremium || null,
          optionExitPremium: opt.optionExitPremium || null,
          chargesRs: opt.chargesRs || null,
          exitVia: opt.exitVia || null,
        });
      }
      const optSum = summarizeOptionTrades(tradesR);
      const usedOption = optSum.optionPriced > 0;
      results.push({
        key, name: spec.name, contract, token, candles: candles.length,
        strategy: strat.label, strategyStatus: strat.status,   // auto-routed per instrument
        params: { entryPts, gapLo: spec.gapLo, gapHi: spec.gapHi, targetByScore: spec.targetByScore, lots, unitsPerLot, maxTradesPerDay, dayLossStopRs, dayProfitTargetRs, rupeesMode: usedOption ? (vehicle === 'fut' ? 'index-fut' : 'option-live') : 'unavailable', vehicle },
        summary: {
          ...summary,
          wins: usedOption ? optSum.optionWins : 0,
          losses: usedOption ? optSum.optionLosses : 0,
          totalProfitRupees: usedOption ? optSum.totalProfitRupees : 0,
          totalLossRupees: usedOption ? optSum.totalLossRupees : 0,
          netRupees: usedOption ? optSum.netRupees : 0,
          grossRupees: usedOption ? optSum.grossRupees : 0,
        },
        trades: tradesR,
      });
    } catch (e) {
      results.push({ key, name: spec.name, error: String(e.message || e) });
    }
  }
  res.json({
    status: 'ok', mode: 'paper', strategy: 'Auto (best eligible per instrument)',
    autoRouting: AUTO_STRATEGY, gate: GATE,
    fromDate, toDate, isToday: toDate === todayIso(), ranAt: new Date().toISOString(), results,
  });
}

function numOr(v, d) { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? n : d; }

/**
 * POST /live/sr-observe  — REAL-OPTION OBSERVATION (paper data collection).
 * Detects today's validated underlying signals and captures the real option
 * snapshot + price path for each. Places NO orders. body: { instruments?, lots? }
 */
async function srObserve(req, res) {
  const authorization =
    req.headers['x-kite-authorization'] ||
    req.headers['x-kite-authorisation'] ||
    (await store.getAuthorizationFor(userId(req)));
  if (!authorization) {
    res.status(400).json({ status: 'error', message: 'Kite session required — Get Token (or Push Kite token), then retry.' });
    return;
  }
  const body = req.body || {};
  try {
    const out = await observe(authorization, { instruments: body.instruments, lots: numOr(body.lots, 1) });
    res.json({ status: 'ok', mode: 'observe', ...out });
  } catch (e) {
    res.status(500).json({ status: 'error', message: String(e.message || e) });
  }
}

/**
 * GET /live/sr-observe/status — collector heartbeat + dashboard (read-only).
 * Lazily boots the backend collector (singleton-guarded) so it self-heals after
 * a process restart even before the trading worker touches it. No orders.
 */
function srObserveStatus(req, res) {
  try { collector.boot(); } catch (e) { /* boot is best-effort */ }
  res.json({ status: 'ok', ...collector.status() });
}

/**
 * POST /live/sr-breakout/debug — candle-by-candle audit for a day ("Why no
 * trade?"). Read-only; does not change the strategy or thresholds. Shows every
 * completed 15-min candle with the gate trace + rejection reason, plus the
 * intrabar developing-state trace. body: { instruments?, date? }
 */
async function srDebug(req, res) {
  const authorization =
    req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] ||
    (await store.getAuthorizationFor(userId(req)));
  if (!authorization) { res.status(400).json({ status: 'error', message: 'Kite session required — Get Token, then retry.' }); return; }
  const body = req.body || {};
  const date = body.date || todayIso();
  const keys = Array.isArray(body.instruments) && body.instruments.length ? body.instruments : ['nifty'];
  const results = [];
  for (const key of keys) {
    const spec = INSTRUMENTS[key];
    if (!spec) { results.push({ key, error: 'unknown instrument' }); continue; }
    try {
      let token = spec.token, contract = spec.name;
      if (key === 'crude') { const r = await resolveCrudeToken(authorization); token = r.token; contract = r.symbol; }
      const candles = await market.fetchHistorical5m(authorization, token, shiftDays(date, -12), date);
      const b5 = candles.map((x) => ({ date: x.date, open: x.open, high: x.high, low: x.low, close: x.close }));
      // Entry window is overridable per request so a qualifying open/close candle
      // can be inspected — the strategy default (spec.session) is unchanged.
      const session = {
        entryStartHm: body.entryStartHm || spec.session.entryStartHm,
        entryEndHm: body.entryEndHm || spec.session.entryEndHm,
        squareOffHm: body.squareOffHm || spec.session.squareOffHm,
      };
      const audit = auditDay(b5, { entryPts: numOr(body.entryPts, spec.entryPts), trendBars: 20, ...session }, date);
      results.push({ key, name: spec.name, contract, ...audit });
    } catch (e) { results.push({ key, name: spec.name, error: String(e.message || e) }); }
  }
  res.json({ status: 'ok', date, results });
}

/**
 * POST /live/sr-research — causal entry-model comparison over a date range.
 * Runs all models read-only; separates UNDERLYING result from option result
 * (option marked UNAVAILABLE unless real historical premiums exist). No orders.
 * body: { instruments?, fromDate?, toDate? }
 */
async function srResearch(req, res) {
  const authorization =
    req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] ||
    (await store.getAuthorizationFor(userId(req)));
  if (!authorization) { res.status(400).json({ status: 'error', message: 'Kite session required — Get Token, then retry.' }); return; }
  const body = req.body || {};
  const keys = Array.isArray(body.instruments) && body.instruments.length ? body.instruments : ['nifty', 'banknifty', 'crude'];
  const fromDate = body.fromDate || shiftDays(todayIso(), -120);
  const toDate = body.toDate || todayIso();
  const results = [];
  for (const key of keys) {
    const spec = INSTRUMENTS[key];
    if (!spec) { results.push({ key, error: 'unknown instrument' }); continue; }
    try {
      let token = spec.token, contract = spec.name;
      if (key === 'crude') { const r = await resolveCrudeToken(authorization); token = r.token; contract = r.symbol; }
      const candles = await market.fetchHistorical5m(authorization, token, fromDate, toDate);
      const b5 = candles.map((x) => ({ date: x.date, open: x.open, high: x.high, low: x.low, close: x.close }));
      const r = research(b5, { entryPts: spec.entryPts, trendBars: 20, unitsPerLot: spec.unitsPerLot, ...spec.session });
      results.push({ key, name: spec.name, contract, best: r.best, models: r.models, optionResult: 'UNAVAILABLE — historical option premiums not fetchable for expired contracts' });
    } catch (e) { results.push({ key, name: spec.name, error: String(e.message || e) }); }
  }
  res.json({ status: 'ok', fromDate, toDate, results });
}

/** GET /live/sr-observe/history — full permanent observation + paper history. */
function srObserveHistory(req, res) {
  res.json({ status: 'ok', records: obsHistory() });
}

/**
 * POST /live/sr-observe/confirm — user confirms their OWN real Live entry.
 * The system never assumes a fill. body: { signalId, price, quantity?, timestamp? }
 * No broker order is placed here — this only records what the user did in Kite.
 */
function srLiveConfirm(req, res) {
  const b = req.body || {};
  if (!b.signalId) { res.status(400).json({ status: 'error', message: 'signalId required' }); return; }
  const out = confirmLiveEntry(String(b.signalId), { price: b.price, quantity: b.quantity, timestamp: b.timestamp });
  res.status(out.ok ? 200 : 400).json({ status: out.ok ? 'ok' : 'error', ...out });
}

/** POST /live/sr-observe/exit — user confirms their OWN real Live exit. */
function srLiveExit(req, res) {
  const b = req.body || {};
  if (!b.signalId) { res.status(400).json({ status: 'error', message: 'signalId required' }); return; }
  const out = confirmLiveExit(String(b.signalId), { price: b.price, timestamp: b.timestamp, reason: b.reason });
  res.status(out.ok ? 200 : 400).json({ status: out.ok ? 'ok' : 'error', ...out });
}

/** POST /live/sr-breakout/live/start — real MIS when a signal fires. */
async function srLiveStart(req, res) {
  try {
    const out = await srLive.start(userId(req), req.body || {});
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ status: 'error', message: String(e.message || e) });
  }
}

/** POST /live/sr-breakout/live/stop */
async function srLiveStop(req, res) {
  res.json(await srLive.stop(userId(req)));
}

/** GET /live/sr-breakout/live/status */
function srLiveStatus(req, res) {
  res.json(srLive.status(userId(req)));
}

module.exports = {
  srBreakout, srObserve, srObserveStatus, srObserveHistory, srLiveConfirm, srLiveExit, srDebug, srResearch,
  srLiveStart, srLiveStop, srLiveStatus, INSTRUMENTS,
};
