/**
 * Server Live strategy worker — Trade Desk parity:
 * Trap pierce20/B40 · peak₹100 · max3 · 3.5R · lock ₹3k · strict stop.
 * Crude Selective only when enabled (OFF by default).
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
const { LIVE_GREEN_DNA, liveGreenTrapExtras } = require('./dna-live-green');

const CRUDE_EXIT_BY = '23:10';
const LOOKBACK_DAYS = 12;

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

function toLiveOpen(replayOpen) {
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
    trailExtras: liveGreenTrapExtras(),
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
  const extras = liveGreenTrapExtras();
  if (config.optionStandDownRs != null) {
    extras.optionStandDownRs = Number(config.optionStandDownRs);
  }
  return {
    ...risk,
    maxTradesPerDay: LIVE_GREEN_DNA.trap.maxTradesPerDay,
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
  }

  /** Snapshot for GET /live/status — broker fills when real, else paper marks. */
  moneySnapshot() {
    return {
      trades: publicTrades(this.liveTrades),
      totals: moneyTotals(this.liveTrades),
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
      const emptyOpt = new Map();
      const needed = new Set();
      const indexSession = now >= '09:15' && now <= '15:30';
      const crudeSession = now >= '09:00' && now <= '23:15';
      const enableKutty = !!config.enableKutty;

      if (config.enableNifty && indexSession) {
        const replay = await this.replayIndexLive({
          authorization,
          instrument: NIFTY_50_INSTRUMENT,
          kind: 'nifty',
          candles: this.candles.nifty,
          lots: config.niftyLots || 1,
          forceClose: now >= '15:15',
          enableKutty,
          kuttyAlone: !!config.kuttyAlone,
          today,
          makeStrategy: () => {
            const s = createTrapStrategy();
            s.initialize(trapInitOverrides(config, NIFTY_50_INSTRUMENT.id));
            return s;
          },
        });
        ingestReplayTrades(this.liveTrades, replay.trades);
        await this.broker.syncInstrument({
          authorization,
          instrumentId: NIFTY_50_INSTRUMENT.id,
          instrumentName: 'Nifty Trap',
          open: toLiveOpen(replay.open),
          lots: config.niftyLots || 1,
        });
        const niftySig =
          `Nifty Trap · ${replay.lastSignal}` +
          (replay.open ? ` · OPEN ${replay.open.direction}` : '');
        if (niftySig !== this.lastSignals.nifty) {
          this.lastSignals.nifty = niftySig;
          this.pushEvent('SIGNAL', niftySig);
        }
      }

      if (config.enableBank && indexSession) {
        const genie = config.bankStrategy === 'genie';
        const replay = await this.replayIndexLive({
          authorization,
          instrument: BANK_NIFTY_INSTRUMENT,
          kind: 'banknifty',
          candles: this.candles.bank,
          lots: config.bankLots || 1,
          forceClose: now >= '15:15',
          enableKutty,
          kuttyAlone: !!config.kuttyAlone,
          today,
          makeStrategy: () => {
            const s = genie ? createGenieStrategy() : createTrapStrategy();
            if (genie) s.initialize();
            else s.initialize(trapInitOverrides(config, BANK_NIFTY_INSTRUMENT.id));
            return s;
          },
        });
        ingestReplayTrades(this.liveTrades, replay.trades);
        await this.broker.syncInstrument({
          authorization,
          instrumentId: BANK_NIFTY_INSTRUMENT.id,
          instrumentName: `Bank ${genie ? 'Genie' : 'Trap'}`,
          open: toLiveOpen(replay.open),
          lots: config.bankLots || 1,
        });
        const bankSig =
          `Bank ${genie ? 'Genie' : 'Trap'} · ${replay.lastSignal}` +
          (replay.open ? ` · OPEN ${replay.open.direction}` : '');
        if (bankSig !== this.lastSignals.bank) {
          this.lastSignals.bank = bankSig;
          this.pushEvent('SIGNAL', bankSig);
        }
      }

      if (config.enableCrude && crudeSession && this.candles.crude.length) {
        const crudeProfile =
          config.crudeStrategy === 'all-green' ? 'all-green' : 'selective';
        const tradeParams = resolveCrudeStrategyProfile(crudeProfile);
        const dayLossStopPts = resolveCrudeProfileDayLossPts(
          tradeParams,
          !!config.strictDayStop,
        );
        const futSym = this.crudeFuture?.tradingSymbol || 'CRUDEOILM';
        const crudeLabel =
          tradeParams.profileId === 'selective' ? 'Crude Selective' : `Crude ${tradeParams.label}`;
        const replay = replayPaperOnCrude({
          instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
          instrumentName: `Crude Mini (${futSym})`,
          candles: this.candles.crude,
          fromDate: today,
          toDate: today,
          instruments: this.instruments,
          optionCandlesByToken: emptyOpt,
          neededOptionTokens: needed,
          forceCloseOpen: now >= CRUDE_EXIT_BY,
          lotsMultiplier: config.crudeLots || 1,
          dayLossStopPts,
          enableMorning: tradeParams.defaultEnableMorning,
          enableEvening: tradeParams.defaultEnableEvening,
          tradeParams,
        });
        ingestReplayTrades(this.liveTrades, replay.trades);
        await this.broker.syncInstrument({
          authorization,
          instrumentId: CRUDE_OIL_MINI_INSTRUMENT.id,
          instrumentName: crudeLabel,
          open: toLiveOpen(replay.open),
          lots: config.crudeLots || 1,
        });
        const crudeSig =
          `${crudeLabel} · ${replay.lastSignal}` +
          (replay.open ? ` · OPEN ${replay.open.direction}` : '');
        if (crudeSig !== this.lastSignals.crude) {
          this.lastSignals.crude = crudeSig;
          this.pushEvent('SIGNAL', crudeSig);
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

  resetWarm() {
    this.warmed = false;
    this.reconciled = false;
    this.broker.clear();
    this.liveTrades = [];
    this.lastSignals = { nifty: '', bank: '', crude: '' };
  }
}

module.exports = { LiveWorker };
