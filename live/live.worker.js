/**
 * Server Live strategy worker — multi-strategy Paper≡Live desk:
 * 1) Nifty Trap + Bank Trap (one-leg, option-₹ day lock)
 * 2) Crude LIVE_CRUDE_GREEN after NSE close (second session)
 * Paper path rejects estimated premiums + fill friction (same as broker skips).
 * Places orders via live-broker → kite.service (does NOT touch kiteOrders.controller).
 */
const {
  NIFTY_50_INSTRUMENT,
  BANK_NIFTY_INSTRUMENT,
  CRUDE_OIL_MINI_INSTRUMENT,
  createTrapStrategy,
  createGenieStrategy,
  replayPaperOnIndex,
  replayPaperOnCrude,
  resolveCrudeStrategyProfile,
  resolveCrudeProfileDayLossPts,
  resolveCrudeOilMiniFuturesToken,
  effectiveProtectiveStop,
} = require('./strategy-core.cjs');
const { fetchInstruments, fetchHistorical5m } = require('./kite-market');
const { LiveBroker } = require('./live-broker');
const { indexDayRiskOverrides, riskStatusLabels } = require('./daily-desk-defaults');
const {
  ingestReplayTrades,
  applyBrokerFill,
  moneyTotals,
  publicTrades,
} = require('./live-trades');
const {
  LIVE_GREEN_DNA,
  liveGreenTrapExtras,
  liveGreenBankTrapExtras,
} = require('./dna-live-green');
const {
  LIVE_CRUDE_GREEN_DNA,
  liveCrudeGreenProfileOverrides,
} = require('./dna-live-crude-green');
const { livePathReplayOpts, isEstimatedOrSynthetic } = require('./live-path');
const {
  summarizeIndexDay,
  summarizeDeskDay,
  indexEntryGate,
  bankEntryGate,
  bookKind,
} = require('./desk-day-policy');

const CRUDE_EXIT_BY = '23:10';
const LOOKBACK_DAYS = 12;

/** One trade = placed + closed (has entryTime and exitTime). */
function countClosedTradesByBook(trades, today) {
  const day = String(today || '').slice(0, 10);
  const counts = { nifty: 0, bank: 0, crude: 0, other: 0, total: 0 };
  for (const t of trades || []) {
    if (String(t.entryTime || '').slice(0, 10) !== day) continue;
    if (!t.exitTime) continue;
    if (t.optionPnlRs == null && t.netOptionPnlRs == null) continue;
    const k = bookKind(t.instrumentId);
    counts[k] = (counts[k] || 0) + 1;
    counts.total += 1;
  }
  return counts;
}

const tradeNetRsOf = (t) =>
  Number(t?.netOptionPnlRs != null ? t.netOptionPnlRs : t?.optionPnlRs || 0) || 0;

/**
 * Per-book closed-trade stats today: count, net ₹, last exit epoch ms.
 * Used by the anti-churn guard so live can't re-enter every 60s tick.
 */
function bookDayStats(trades, book, today) {
  const day = String(today || '').slice(0, 10);
  let count = 0;
  let net = 0;
  let lastExitMs = 0;
  for (const t of trades || []) {
    if (String(t.entryTime || '').slice(0, 10) !== day) continue;
    if (bookKind(t.instrumentId) !== book) continue;
    if (!t.exitTime) continue;
    if (t.optionPnlRs == null && t.netOptionPnlRs == null) continue;
    count += 1;
    net += tradeNetRsOf(t);
    const ms = Date.parse(t.exitTime);
    if (Number.isFinite(ms) && ms > lastExitMs) lastExitMs = ms;
  }
  return { count, net, lastExitMs };
}

/**
 * ANTI-CHURN defaults. Live re-runs every 60s and the real exchange SL fills
 * intra-bar, so a naive strategy re-enters many times per 5m bar (18 crude
 * round-trips on 2026-08-12, all bleeding spread+charges). These guards cap
 * trades/book/day, force a cooldown after every exit, and hard-stop a book or
 * the whole desk once the day loss crosses a floor.
 */
const ANTI_CHURN_DEFAULTS = {
  crudeCooldownMin: 20,
  indexCooldownMin: 12,
  crudeMaxTradesDay: 3,
  indexMaxTradesDay: 3,
  bookDayLossStopRs: 500,
  deskDayLossStopRs: 900,
};

function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function istParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${parts.hour}:${parts.minute}`,
  };
}

function addDaysIso(isoDate, delta) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function mergeCandles(prev, next) {
  const map = new Map();
  for (const c of prev || []) map.set(c.date, c);
  for (const c of next || []) map.set(c.date, c);
  return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function toLiveOpen(replayOpen, trailExtras) {
  if (!replayOpen) return null;
  return {
    direction: replayOpen.direction,
    entryTime: replayOpen.entryTime,
    indexEntry: replayOpen.entry,
    indexStop: effectiveProtectiveStop(replayOpen),
    option: replayOpen.option,
    optionEntryPremium: replayOpen.optionEntryPremium ?? null,
    premiumEstimated: !!replayOpen.premiumEstimated,
    optionPeakMfeRs: replayOpen.optionPeakMfeRs ?? null,
    optionBarLow: replayOpen.optionBarLow ?? null,
    optionLotUnits: replayOpen.optionLotUnits ?? null,
    lotsMultiplier: replayOpen.lotsMultiplier ?? 1,
    trailExtras: trailExtras || liveGreenTrapExtras(),
  };
}

function trapInitOverrides(config, instrumentId) {
  const risk =
    indexDayRiskOverrides({
      instrumentId,
      enableNifty: !!config.enableNifty,
      enableBank: !!config.enableBank,
      dayProfitLock: !!config.dayProfitLock,
      strictDayStop: !!config.strictDayStop,
    }) || {};
  const bank = /bank/i.test(String(instrumentId || ''));
  const extras = bank ? liveGreenBankTrapExtras() : liveGreenTrapExtras();
  if (config.optionStandDownRs != null) {
    extras.optionStandDownRs = Number(config.optionStandDownRs);
  }
  const maxTrades = bank
    ? LIVE_GREEN_DNA.trap.bankMaxTradesPerDay || LIVE_GREEN_DNA.trap.maxTradesPerDay
    : LIVE_GREEN_DNA.trap.maxTradesPerDay;
  return {
    ...risk,
    maxTradesPerDay: maxTrades,
    targetRMultiple: LIVE_GREEN_DNA.trap.targetRMultiple,
    extras,
  };
}

class LiveWorker {
  constructor({ readAuth, pushEvent, heartbeat, getConfig }) {
    this.readAuth = readAuth;
    this.pushEvent = pushEvent;
    this.heartbeat = heartbeat;
    this.getConfig = getConfig;
    /** @type {object[]} strategy closes + broker fill overlays (money ledger) */
    this.liveTrades = [];
    this.broker = new LiveBroker({
      pushEvent,
      realOrders: false,
      onFill: (fill) => this.handleBrokerFill(fill),
    });
    this.instruments = [];
    this.instrumentsAt = 0;
    this.candles = {
      nifty: [],
      bank: [],
      crude: [],
    };
    this.crudeFuture = null;
    this.warmed = false;
    this.reconciled = false;
    this.tickBusy = false;
    this.lastSignals = { nifty: '', bank: '', crude: '' };
    /** Last TRADE_COUNT log signature (avoid spam). */
    this.lastTradeCountSig = '';
  }

  /**
   * Log each newly closed round-trip and a running day count.
   * Count rule: one trade = placed + closed.
   */
  noteClosedTrades(added, today) {
    const day = String(today || istParts().date).slice(0, 10);
    for (const t of added || []) {
      if (!t?.exitTime) continue;
      const book = bookKind(t.instrumentId);
      const net = Math.round(
        t.netOptionPnlRs != null ? t.netOptionPnlRs : t.optionPnlRs || 0,
      );
      const entry = String(t.entryTime || '').slice(11, 16);
      const exit = String(t.exitTime || '').slice(11, 16);
      this.pushEvent(
        'TRADE_CLOSED',
        `${book.toUpperCase()} ${entry}→${exit} · ₹${net} · ${String(t.exitReason || '').slice(0, 60)}`,
      );
    }
    const c = countClosedTradesByBook(this.liveTrades, day);
    const sig = `N${c.nifty}|B${c.bank}|C${c.crude}|T${c.total}`;
    if (sig !== this.lastTradeCountSig || (added && added.length)) {
      this.lastTradeCountSig = sig;
      this.pushEvent(
        'TRADE_COUNT',
        `Today closed (placed+closed): Nifty ${c.nifty} · Bank ${c.bank} · Crude ${c.crude} · total ${c.total}`,
      );
    }
    return c;
  }

  deskOps(config = {}) {
    const dna = LIVE_GREEN_DNA.liveOps || {};
    const lots = Math.max(1, Number(config.deskLots || config.niftyLots || 1) || 1);
    const bandMin1 = Number(dna.deskGreenLockRs) || 0;
    return {
      winStreakToBand:
        config.winStreakToBand != null
          ? !!config.winStreakToBand
          : dna.winStreakToBand === true,
      indexFirstWinLock:
        config.indexFirstWinLock != null
          ? !!config.indexFirstWinLock
          : dna.indexFirstWinLock === true,
      deskGreenLockRs:
        config.deskGreenLockRs != null
          ? Number(config.deskGreenLockRs)
          : bandMin1 * lots,
      bankOnlyAfterNifty:
        config.bankOnlyAfterNifty != null
          ? !!config.bankOnlyAfterNifty
          : dna.bankOnlyAfterNifty === true,
      bankOnlyAfterNiftyGreen:
        config.bankOnlyAfterNiftyGreen != null
          ? !!config.bankOnlyAfterNiftyGreen
          : dna.bankOnlyAfterNiftyGreen === true,
      crudeOnlyBelowBand:
        config.crudeOnlyBelowBand != null
          ? !!config.crudeOnlyBelowBand
          : dna.crudeOnlyBelowBand === true,
    };
  }

  indexDaySummary(today) {
    const base = summarizeIndexDay(this.liveTrades, today);
    return {
      ...base,
      niftyTaken: this.niftyTakenToday(today),
    };
  }

  antiChurnCfg(config = {}) {
    const d = ANTI_CHURN_DEFAULTS;
    // Loss stops scale with lots so worst-case daily loss is proportional and
    // predictable when you expand capital (never a fixed cap that gets sloppy).
    const lots = Math.max(1, Math.floor(Number(config.deskLots || config.niftyLots || 1)) || 1);
    return {
      crudeCooldownMin: numOr(config.crudeCooldownMin, d.crudeCooldownMin),
      indexCooldownMin: numOr(config.indexCooldownMin, d.indexCooldownMin),
      crudeMaxTradesDay: numOr(config.crudeMaxTradesDay, d.crudeMaxTradesDay),
      indexMaxTradesDay: numOr(config.indexMaxTradesDay, d.indexMaxTradesDay),
      bookDayLossStopRs: numOr(config.bookDayLossStopRs, d.bookDayLossStopRs) * lots,
      deskDayLossStopRs: numOr(config.deskDayLossStopRs, d.deskDayLossStopRs) * lots,
      lots,
    };
  }

  /**
   * Gate a NEW entry for one book. Existing open legs are always managed/exited
   * elsewhere — this only blocks fresh entries to stop 60s-tick churn + bleed.
   */
  entryGuard(book, today, config = {}) {
    const g = this.antiChurnCfg(config);
    const stats = bookDayStats(this.liveTrades, book, today);
    const deskNet = summarizeDeskDay(this.liveTrades, today).dayNet;

    if (g.deskDayLossStopRs > 0 && deskNet <= -g.deskDayLossStopRs) {
      return { allow: false, reason: `desk loss stop ₹${Math.round(deskNet)} (≥ −₹${g.deskDayLossStopRs})` };
    }
    if (g.bookDayLossStopRs > 0 && stats.net <= -g.bookDayLossStopRs) {
      return { allow: false, reason: `${book} loss stop ₹${Math.round(stats.net)} (≥ −₹${g.bookDayLossStopRs})` };
    }
    const maxT = book === 'crude' ? g.crudeMaxTradesDay : g.indexMaxTradesDay;
    if (maxT > 0 && stats.count >= maxT) {
      return { allow: false, reason: `${book} max ${maxT} trades/day done` };
    }
    const cdMin = book === 'crude' ? g.crudeCooldownMin : g.indexCooldownMin;
    if (cdMin > 0 && stats.lastExitMs > 0) {
      const mins = (Date.now() - stats.lastExitMs) / 60000;
      if (mins < cdMin) {
        return { allow: false, reason: `${book} cooldown ${Math.ceil(cdMin - mins)}m after exit` };
      }
    }
    return { allow: true, reason: '' };
  }

  handleBrokerFill(fill) {
    const row = applyBrokerFill(this.liveTrades, fill);
    if (!row) return;
    const px = Number(fill.premium);
    const pnl =
      row.netOptionPnlRs != null
        ? ` · net ₹${Math.round(row.netOptionPnlRs)}`
        : row.optionPnlRs != null
          ? ` · ₹${Math.round(row.optionPnlRs)}`
          : '';
    this.pushEvent(
      'FILL',
      `${fill.instrumentName || fill.instrumentId || ''}: ${String(fill.side).toUpperCase()} ${fill.tradingSymbol} @ ${px.toFixed(2)}${pnl}`.trim(),
    );
    // Exit fill completes a round-trip — bump day trade count in logs.
    if (String(fill.side || '').toLowerCase() !== 'entry' && row.exitTime) {
      const { date: today } = istParts();
      this.noteClosedTrades([row], today);
    }
  }

  /** Snapshot for GET /live/status — broker fills when real, else live-path paper. */
  moneySnapshot() {
    const real = !!this.getConfig()?.realOrders;
    const { date: today } = istParts();
    return {
      trades: publicTrades(this.liveTrades),
      totals: moneyTotals(this.liveTrades, { brokerOnly: real }),
      /** Closed round-trips today (placed + closed). */
      tradeCounts: countClosedTradesByBook(this.liveTrades, today),
    };
  }

  authHeader() {
    const creds = this.readAuth();
    if (!creds?.apiKey || !creds?.accessToken) return null;
    return `token ${creds.apiKey}:${creds.accessToken}`;
  }

  async ensureInstruments(authorization, force = false) {
    const age = Date.now() - this.instrumentsAt;
    if (!force && this.instruments.length && age < 6 * 60 * 60 * 1000) {
      return this.instruments;
    }
    this.instruments = await fetchInstruments(authorization);
    this.instrumentsAt = Date.now();
    this.crudeFuture = resolveCrudeOilMiniFuturesToken(this.instruments);
    this.pushEvent(
      'DATA',
      `Instruments loaded · ${this.instruments.length} rows` +
        (this.crudeFuture
          ? ` · crude fut ${this.crudeFuture.tradingSymbol}`
          : ' · crude fut missing'),
    );
    return this.instruments;
  }

  async warm(authorization) {
    const { date: today } = istParts();
    const from = addDaysIso(today, -LOOKBACK_DAYS);
    await this.ensureInstruments(authorization, true);

    this.candles.nifty = await fetchHistorical5m(
      authorization,
      NIFTY_50_INSTRUMENT.instrumentToken,
      from,
      today,
    );
    this.candles.bank = await fetchHistorical5m(
      authorization,
      BANK_NIFTY_INSTRUMENT.instrumentToken,
      from,
      today,
    );
    if (this.crudeFuture?.instrumentToken) {
      this.candles.crude = await fetchHistorical5m(
        authorization,
        this.crudeFuture.instrumentToken,
        from,
        today,
      );
    } else {
      this.candles.crude = [];
    }
    this.warmed = true;
    this.pushEvent(
      'DATA',
      `Warm OK · Nifty ${this.candles.nifty.length} · Bank ${this.candles.bank.length} · Crude ${this.candles.crude.length} bars`,
    );
  }

  async refreshToday(authorization) {
    const { date: today } = istParts();
    const [n, b] = await Promise.all([
      fetchHistorical5m(authorization, NIFTY_50_INSTRUMENT.instrumentToken, today, today),
      fetchHistorical5m(authorization, BANK_NIFTY_INSTRUMENT.instrumentToken, today, today),
    ]);
    this.candles.nifty = mergeCandles(this.candles.nifty, n);
    this.candles.bank = mergeCandles(this.candles.bank, b);
    if (this.crudeFuture?.instrumentToken) {
      const c = await fetchHistorical5m(
        authorization,
        this.crudeFuture.instrumentToken,
        today,
        today,
      );
      this.candles.crude = mergeCandles(this.candles.crude, c);
    }
  }

  async onTick() {
    if (this.tickBusy) return;
    this.tickBusy = true;
    try {
      const config = this.getConfig();
      if (!config) {
        this.heartbeat('No config');
        return;
      }
      const authorization = this.authHeader();
      if (!authorization) {
        this.heartbeat('Waiting for Kite auth — Push token from Auto Trader');
        this.pushEvent('AUTH_WAIT', 'No apiKey/accessToken — PUT /live/auth');
        return;
      }

      this.broker.setRealOrders(!!config.realOrders);
      this.broker.setMaxOpenLegs(
        config.maxOpenLegs != null
          ? config.maxOpenLegs
          : LIVE_GREEN_DNA.liveOps.maxOpenLegs,
      );

      // Restart safety: adopt any positions already open at the broker once,
      // so a mid-trade restart never places a duplicate entry.
      if (config.realOrders && !this.reconciled) {
        await this.broker.reconcileFromBroker(authorization);
        this.reconciled = true;
      }

      if (!this.warmed) {
        await this.warm(authorization);
      } else {
        await this.ensureInstruments(authorization, false);
        await this.refreshToday(authorization);
      }

      const { date: today, hhmm: now } = istParts();
      const indexSession = now >= '09:15' && now <= '15:30';
      const crudeSession = now >= '09:00' && now <= '23:15';
      const enableKutty = !!config.enableKutty;

      const livePath = livePathReplayOpts({
        rejectEstimatedPremium: true,
        fillFrictionPremium:
          config.fillFrictionPremium != null ? config.fillFrictionPremium : 0.5,
      });

      const deskOps = this.deskOps(config);
      const daySummary = this.indexDaySummary(today);
      const niftyGate = indexEntryGate(daySummary, deskOps);

      if (config.enableNifty && indexSession) {
        const replay = await this.replayIndexLive({
          authorization,
          instrument: NIFTY_50_INSTRUMENT,
          kind: 'nifty',
          candles: this.candles.nifty,
          lots: config.deskLots || config.niftyLots || 1,
          forceClose: now >= '15:15',
          enableKutty,
          kuttyAlone: !!config.kuttyAlone,
          today,
          livePath,
          makeStrategy: () => {
            const s = createTrapStrategy();
            s.initialize(trapInitOverrides(config, NIFTY_50_INSTRUMENT.id));
            return s;
          },
        });
        const niftyAdded = ingestReplayTrades(this.liveTrades, replay.trades, {
          rejectEstimated: true,
        });
        this.noteClosedTrades(niftyAdded, today);
        const niftyPos = this.broker.positions?.get(NIFTY_50_INSTRUMENT.id);
        const niftyAlreadyLive =
          niftyPos && (niftyPos.status === 'open' || niftyPos.status === 'exiting');
        let niftySyncOpen = this.liveOpenForSync(
          NIFTY_50_INSTRUMENT.id,
          replay.open,
          liveGreenTrapExtras(),
        );
        // Daily-band gate: still manage an already-open leg.
        if (niftySyncOpen && !niftyAlreadyLive && !niftyGate.allow) {
          niftySyncOpen = null;
        }
        // Anti-churn: block fresh Nifty entry on cooldown / caps / loss stop.
        let niftyChurn = { allow: true, reason: '' };
        if (niftySyncOpen && !niftyAlreadyLive) {
          niftyChurn = this.entryGuard('nifty', today, config);
          if (!niftyChurn.allow) niftySyncOpen = null;
        }
        await this.broker.syncInstrument({
          authorization,
          instrumentId: NIFTY_50_INSTRUMENT.id,
          instrumentName: 'Nifty Trap',
          open: niftySyncOpen,
          lots: config.deskLots || config.niftyLots || 1,
        });
        const niftySig =
          `Nifty Trap · ${replay.lastSignal}` +
          (niftySyncOpen ? ` · OPEN ${niftySyncOpen.direction}` : '') +
          (!niftyGate.allow && !niftyAlreadyLive ? ` · ${niftyGate.reason}` : '') +
          (!niftyChurn.allow && !niftyAlreadyLive ? ` · ${niftyChurn.reason}` : '');
        if (niftySig !== this.lastSignals.nifty) {
          this.lastSignals.nifty = niftySig;
          this.pushEvent('SIGNAL', niftySig);
        }
      }

      if (config.enableBank && indexSession) {
        const genie = config.bankStrategy === 'genie';
        // Recompute after Nifty ingest so Bank sees fresh day net / win flag.
        const bankSummary = this.indexDaySummary(today);
        const idxGate = indexEntryGate(bankSummary, deskOps);
        const bGate = bankEntryGate(bankSummary, deskOps);
        const bankAllowed = idxGate.allow && bGate.allow;
        const replay = await this.replayIndexLive({
          authorization,
          instrument: BANK_NIFTY_INSTRUMENT,
          kind: 'banknifty',
          candles: this.candles.bank,
          lots: config.deskLots || config.bankLots || 1,
          forceClose: now >= '15:15',
          enableKutty,
          kuttyAlone: !!config.kuttyAlone,
          today,
          livePath,
          makeStrategy: () => {
            const s = genie ? createGenieStrategy() : createTrapStrategy();
            if (genie) s.initialize();
            else s.initialize(trapInitOverrides(config, BANK_NIFTY_INSTRUMENT.id));
            return s;
          },
        });
        const bankAdded = ingestReplayTrades(this.liveTrades, replay.trades, {
          rejectEstimated: true,
        });
        this.noteClosedTrades(bankAdded, today);
        // Daily-band + Bank-after-Nifty-green: new entries only when gates allow.
        const bankOpen = this.liveOpenForSync(
          BANK_NIFTY_INSTRUMENT.id,
          replay.open,
          liveGreenBankTrapExtras(),
        );
        const bankPos = this.broker.positions?.get(BANK_NIFTY_INSTRUMENT.id);
        const bankAlreadyLive =
          bankPos && (bankPos.status === 'open' || bankPos.status === 'exiting');
        let bankSyncOpen = bankAlreadyLive || bankAllowed ? bankOpen : null;
        if (bankSyncOpen && !bankAlreadyLive && !bankAllowed) bankSyncOpen = null;
        // Anti-churn: block fresh Bank entry on cooldown / caps / loss stop.
        let bankChurn = { allow: true, reason: '' };
        if (bankSyncOpen && !bankAlreadyLive) {
          bankChurn = this.entryGuard('bank', today, config);
          if (!bankChurn.allow) bankSyncOpen = null;
        }
        await this.broker.syncInstrument({
          authorization,
          instrumentId: BANK_NIFTY_INSTRUMENT.id,
          instrumentName: `Bank ${genie ? 'Genie' : 'Trap'}`,
          open: bankSyncOpen,
          lots: config.deskLots || config.bankLots || 1,
        });
        const waitReason = !bGate.allow ? bGate.reason : !idxGate.allow ? idxGate.reason : '';
        const bankSig =
          `Bank ${genie ? 'Genie' : 'Trap'} · ${replay.lastSignal}` +
          (bankSyncOpen ? ` · OPEN ${bankSyncOpen.direction}` : '') +
          (waitReason && !bankAlreadyLive ? ` · ${waitReason}` : '') +
          (!bankChurn.allow && !bankAlreadyLive ? ` · ${bankChurn.reason}` : '');
        if (bankSig !== this.lastSignals.bank) {
          this.lastSignals.bank = bankSig;
          this.pushEvent('SIGNAL', bankSig);
        }
      }

      if (config.enableCrude && crudeSession && this.candles.crude.length) {
        // Hard floor: never open new Crude before 15:15 IST (user: 3:15pm).
        const CRUDE_NOT_BEFORE = '15:15';
        const dnaGate =
          LIVE_CRUDE_GREEN_DNA.liveOps.crudeAfterIndexCloseTime || CRUDE_NOT_BEFORE;
        const gateTime = dnaGate > CRUDE_NOT_BEFORE ? dnaGate : CRUDE_NOT_BEFORE;
        const deskDay = summarizeDeskDay(this.liveTrades, today);
        const bandMin = Math.max(0, Number(deskOps.deskGreenLockRs) || 0);
        const belowBand =
          !deskOps.crudeOnlyBelowBand || bandMin <= 0 || deskDay.dayNet < bandMin;
        const crudeEntryOk = now >= gateTime && belowBand;
        const crudeOpen = this.broker?.positions?.get(CRUDE_OIL_MINI_INSTRUMENT.id);
        const crudeOpenLive = crudeOpen?.status === 'open';

        if (crudeEntryOk || crudeOpenLive) {
          const crudeProfile = config.crudeStrategy || 'live-crude-green';
          let tradeParams = resolveCrudeStrategyProfile(crudeProfile);
          if (crudeProfile === 'live-crude-green') {
            tradeParams = { ...tradeParams, ...liveCrudeGreenProfileOverrides() };
          }
          const dayLossStopPts = resolveCrudeProfileDayLossPts(
            tradeParams,
            !!config.strictDayStop,
          );
          const futSym = this.crudeFuture?.tradingSymbol || 'CRUDEOILM';
          const crudeLabel =
            tradeParams.profileId === 'selective'
              ? 'Crude Selective'
              : `Crude ${tradeParams.label}`;
          // Two-pass like index: fetch real option 5m marks so live entry is
          // not stuck on premiumEstimated (broker SKIP / liveOpenForSync null).
          const crudeLots = config.deskLots || config.crudeLots || 1;
          const replay = await this.replayCrudeLive({
            candles: this.candles.crude,
            lots: crudeLots,
            forceClose: now >= CRUDE_EXIT_BY,
            today,
            authorization,
            futSym,
            dayLossStopPts,
            // New entries only after gate; still manage exits if already live.
            enableMorning: crudeEntryOk && tradeParams.defaultEnableMorning,
            enableEvening: crudeEntryOk && tradeParams.defaultEnableEvening,
            tradeParams,
          });
          const crudeAdded = ingestReplayTrades(this.liveTrades, replay.trades, {
            rejectEstimated: true,
          });
          this.noteClosedTrades(crudeAdded, today);
          let crudeSyncOpen = this.liveOpenForSync(
            CRUDE_OIL_MINI_INSTRUMENT.id,
            replay.open,
          );
          // Anti-churn: block fresh Crude entry on cooldown / caps / loss stop.
          let crudeChurn = { allow: true, reason: '' };
          if (crudeSyncOpen && !crudeOpenLive) {
            crudeChurn = this.entryGuard('crude', today, config);
            if (!crudeChurn.allow) {
              crudeSyncOpen = null;
              this.pushEvent('SKIP', `${crudeLabel}: ${crudeChurn.reason}`);
            }
          }
          if (replay.open && !crudeSyncOpen && crudeChurn.allow) {
            const why = isEstimatedOrSynthetic({
              option: replay.open.option,
              premiumEstimated: replay.open.premiumEstimated,
            })
              ? 'estimated/missing option premium'
              : 'maxOpenLegs / not tradeable';
            this.pushEvent(
              'SKIP',
              `${crudeLabel}: signal open but no live entry — ${why}`,
            );
          }
          await this.broker.syncInstrument({
            authorization,
            instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
            instrumentName: crudeLabel,
            open: crudeSyncOpen,
            lots: crudeLots,
          });
          const bandSkip =
            deskOps.crudeOnlyBelowBand &&
            bandMin > 0 &&
            deskDay.dayNet >= bandMin
              ? ` · band locked ₹${Math.round(deskDay.dayNet)}`
              : '';
          const crudeSig =
            `${crudeLabel} · ${replay.lastSignal}` +
            (crudeSyncOpen ? ` · OPEN ${crudeSyncOpen.direction}` : '') +
            (replay.open && !crudeSyncOpen ? ' · paper-only (no live entry)' : '') +
            (now < gateTime ? ` · gated until ${gateTime}` : '') +
            bandSkip;
          if (crudeSig !== this.lastSignals.crude) {
            this.lastSignals.crude = crudeSig;
            this.pushEvent('SIGNAL', crudeSig);
          }
        } else if (now >= gateTime && !belowBand) {
          const skip = `Crude · daily band locked ₹${Math.round(deskDay.dayNet)} (≥₹${bandMin})`;
          if (skip !== this.lastSignals.crude) {
            this.lastSignals.crude = skip;
            this.pushEvent('SIGNAL', skip);
          }
        }
      }

      const riskBits = riskStatusLabels(config);
      const riskTxt = riskBits.length ? ` · ${riskBits.join(' · ')}` : '';
      this.heartbeat(
        `Live tick · ${now} IST · real=${!!config.realOrders} · N${config.enableNifty ? 1 : 0}/B${config.enableBank ? 1 : 0}/C${config.enableCrude ? 1 : 0}${riskTxt}`,
      );
    } catch (err) {
      const msg = err?.message || String(err);
      this.pushEvent('ERROR', `Tick failed: ${msg}`);
      this.heartbeat(`Tick error: ${msg}`);
      console.error('[live-worker]', err);
    } finally {
      this.tickBusy = false;
    }
  }

  /** Best-effort 5m option candles for the discovered ATM tokens. Never throws. */
  async fetchOptionCandles(authorization, tokens, fromDate, toDate) {
    const map = new Map();
    for (const token of tokens) {
      if (!token || map.has(token)) continue;
      try {
        map.set(token, await fetchHistorical5m(authorization, token, fromDate, toDate));
      } catch (err) {
        map.set(token, []);
      }
    }
    return map;
  }

  /**
   * Two-pass Crude replay — same as index: discover ATM option token, fetch
   * 5m option candles, replay with marks so premiumEstimated is false when
   * history exists (required for live broker entry).
   */
  async replayCrudeLive({
    candles,
    lots,
    forceClose,
    today,
    authorization,
    futSym,
    dayLossStopPts,
    enableMorning,
    enableEvening,
    tradeParams,
  }) {
    const base = {
      instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
      instrumentName: `Crude Mini (${futSym || 'CRUDEOILM'})`,
      candles,
      fromDate: today,
      toDate: today,
      instruments: this.instruments,
      forceCloseOpen: forceClose,
      lotsMultiplier: lots,
      dayLossStopPts,
      enableMorning,
      enableEvening,
      tradeParams,
    };
    const needed = new Set();
    replayPaperOnCrude({
      ...base,
      optionCandlesByToken: new Map(),
      neededOptionTokens: needed,
    });
    let optionCandles = new Map();
    try {
      optionCandles = await this.fetchOptionCandles(authorization, needed, today, today);
    } catch (err) {
      optionCandles = new Map();
    }
    return replayPaperOnCrude({
      ...base,
      optionCandlesByToken: optionCandles,
      neededOptionTokens: new Set(),
    });
  }

  /**
   * Two-pass index replay (Trade Desk parity): discover the ATM option tokens,
   * fetch their 5m candles, then replay WITH them so the option-₹ peak-lock
   * exits fire exactly like Paper. Fail-safe: on any option-fetch error it
   * replays without option candles (current behaviour), so a tick never hangs.
   */
  async replayIndexLive({
    authorization,
    instrument,
    kind,
    candles,
    lots,
    makeStrategy,
    forceClose,
    enableKutty,
    kuttyAlone,
    today,
    livePath,
  }) {
    const base = {
      instrumentId: instrument.id,
      instrumentName: instrument.name,
      kind,
      candles,
      fromDate: today,
      toDate: today,
      instruments: this.instruments,
      forceCloseOpen: forceClose,
      lotsMultiplier: lots,
      enableKutty,
      kuttyAlone,
      livePath: livePath || null,
    };
    const needed = new Set();
    replayPaperOnIndex({
      ...base,
      optionCandlesByToken: new Map(),
      neededOptionTokens: needed,
      strategy: makeStrategy(),
    });
    let optionCandles = new Map();
    try {
      optionCandles = await this.fetchOptionCandles(authorization, needed, today, today);
    } catch (err) {
      optionCandles = new Map();
    }
    return replayPaperOnIndex({
      ...base,
      optionCandlesByToken: optionCandles,
      neededOptionTokens: new Set(),
      strategy: makeStrategy(),
    });
  }

  /** True once Nifty has an open/exiting broker leg or a closed trade today. */
  niftyTakenToday(today) {
    const niftyId = NIFTY_50_INSTRUMENT.id;
    const pos = this.broker?.positions?.get(niftyId);
    if (pos && (pos.status === 'open' || pos.status === 'exiting')) return true;
    for (const t of this.liveTrades || []) {
      if (t.instrumentId !== niftyId) continue;
      if (String(t.entryTime || '').slice(0, 10) === today) return true;
    }
    return false;
  }

  /**
   * Only sync an entry the broker would accept — no phantom paper legs when
   * another book already holds the one-leg slot or premium is estimated.
   */
  liveOpenForSync(instrumentId, replayOpen, trailExtras) {
    const open = toLiveOpen(replayOpen, trailExtras);
    if (!open) return null;
    if (isEstimatedOrSynthetic({ option: open.option, premiumEstimated: open.premiumEstimated })) {
      return null;
    }
    const current = this.broker.positions?.get(instrumentId);
    if (current && (current.status === 'open' || current.status === 'exiting')) {
      return open; // manage / exit path
    }
    if (this.broker.maxOpenLegs > 0 && this.broker.openLegCount() >= this.broker.maxOpenLegs) {
      return null;
    }
    return open;
  }

  resetWarm() {
    this.warmed = false;
    this.reconciled = false;
    this.broker.clear();
    this.liveTrades = [];
    this.lastSignals = { nifty: '', bank: '', crude: '' };
  }
}

module.exports = { LiveWorker };
