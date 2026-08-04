/**
 * Server Live strategy worker — Daily desk DNA: Trap + Selective Crude.
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
  };
}

function trapInitOverrides(config, instrumentId) {
  return (
    indexDayRiskOverrides({
      instrumentId,
      enableNifty: !!config.enableNifty,
      enableBank: !!config.enableBank,
      dayProfitLock: !!config.dayProfitLock,
      strictDayStop: !!config.strictDayStop,
    }) || {}
  );
}

class LiveWorker {
  constructor({ readAuth, pushEvent, heartbeat, getConfig }) {
    this.readAuth = readAuth;
    this.pushEvent = pushEvent;
    this.heartbeat = heartbeat;
    this.getConfig = getConfig;
    this.broker = new LiveBroker({ pushEvent, realOrders: false });
    this.instruments = [];
    this.instrumentsAt = 0;
    this.candles = {
      nifty: [],
      bank: [],
      crude: [],
    };
    this.crudeFuture = null;
    this.warmed = false;
    this.tickBusy = false;
    this.lastSignals = { nifty: '', bank: '', crude: '' };
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
        const strategy = createTrapStrategy();
        strategy.initialize(trapInitOverrides(config, NIFTY_50_INSTRUMENT.id));
        const replay = replayPaperOnIndex({
          instrumentId: NIFTY_50_INSTRUMENT.id,
          instrumentName: NIFTY_50_INSTRUMENT.name,
          kind: 'nifty',
          candles: this.candles.nifty,
          fromDate: today,
          toDate: today,
          instruments: this.instruments,
          optionCandlesByToken: emptyOpt,
          neededOptionTokens: needed,
          forceCloseOpen: now >= '15:15',
          lotsMultiplier: config.niftyLots || 1,
          strategy,
          enableKutty,
          kuttyAlone: !!config.kuttyAlone,
        });
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
        const strategy =
          config.bankStrategy === 'genie' ? createGenieStrategy() : createTrapStrategy();
        if (config.bankStrategy !== 'genie') {
          strategy.initialize(trapInitOverrides(config, BANK_NIFTY_INSTRUMENT.id));
        } else {
          strategy.initialize();
        }
        const replay = replayPaperOnIndex({
          instrumentId: BANK_NIFTY_INSTRUMENT.id,
          instrumentName: BANK_NIFTY_INSTRUMENT.name,
          kind: 'banknifty',
          candles: this.candles.bank,
          fromDate: today,
          toDate: today,
          instruments: this.instruments,
          optionCandlesByToken: emptyOpt,
          neededOptionTokens: needed,
          forceCloseOpen: now >= '15:15',
          lotsMultiplier: config.bankLots || 1,
          strategy,
          enableKutty,
          kuttyAlone: !!config.kuttyAlone,
        });
        await this.broker.syncInstrument({
          authorization,
          instrumentId: BANK_NIFTY_INSTRUMENT.id,
          instrumentName: `Bank ${config.bankStrategy === 'genie' ? 'Genie' : 'Trap'}`,
          open: toLiveOpen(replay.open),
          lots: config.bankLots || 1,
        });
        const bankSig =
          `Bank ${strategy.name} · ${replay.lastSignal}` +
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

  resetWarm() {
    this.warmed = false;
    this.broker.clear();
    this.lastSignals = { nifty: '', bank: '', crude: '' };
  }
}

module.exports = { LiveWorker };
