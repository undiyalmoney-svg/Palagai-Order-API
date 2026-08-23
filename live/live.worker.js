/**
 * Server Live strategy worker — Nifty 50 Paper≡Live desk:
 * 1) Nifty Trap (one-leg, option-₹ day lock). Bank Nifty & Crude are hard-off.
 * Paper path rejects estimated premiums + fill friction (same as broker skips).
 * Places orders via live-broker → kite.service (does NOT touch kiteOrders.controller).
 */
const {
  NIFTY_50_INSTRUMENT,
  BANK_NIFTY_INSTRUMENT,
  createTrapStrategyV2,
  replayPaperOnIndex,
  effectiveProtectiveStop,
} = require('./strategy-core.cjs');
const { fetchInstruments, fetchHistorical5m } = require('./kite-market');
const { LiveBroker } = require('./live-broker');
const { indexDayRiskOverrides, riskStatusLabels, deskRiskLots, profitLockMoneyRs, greenProtectMoneyRs, strictStopMoneyRs } = require('./daily-desk-defaults');
const {
  ingestReplayTrades,
  applyBrokerFill,
  moneyTotals,
  publicTrades,
} = require('./live-trades');
const { LIVE_GREEN_DNA, liveGreenTrapExtras, clampMaxTradesToDna } = require('./dna-live-green');
const { livePathReplayOpts, isEstimatedOrSynthetic } = require('./live-path');
const { archiveInstruments } = require('./instrument-archive');

const LOOKBACK_DAYS = 12;

/** "NIFTY26AUG24200CE" -> "Nifty 24200 CE" for human-readable event logs. */
function niceOption(sym) {
  const s = String(sym || '').toUpperCase();
  const m = /^(BANKNIFTY|NIFTY)\w*?(\d{4,6})(CE|PE)$/.exec(s);
  if (!m) return sym || 'option';
  return `${m[1] === 'BANKNIFTY' ? 'Bank' : 'Nifty'} ${m[2]} ${m[3]}`;
}
function money(n) {
  return '\u20B9' + Math.round(Number(n) || 0).toLocaleString('en-IN');
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

/**
 * Only genuine live-only/UI overrides go here — everything else comes from
 * createTrapStrategyV2()'s own defaultSettings (single source: doc 51 RCA
 * fix). `maxTradesPerDay` defaults to the strategy's own cap (3) unless the
 * UI explicitly asks for a different budget; `optionStandDownRs` is a
 * user-tunable secondary soft check on top of the hard broker-side cap.
 */
function trapInitOverrides(config, instrumentId) {
  const risk =
    indexDayRiskOverrides({
      instrumentId,
      enableNifty: !!config.enableNifty,
      enableBank: !!config.enableBank,
      dayProfitLock: !!config.dayProfitLock,
      strictDayStop: !!config.strictDayStop,
    }) || {};
  const extras = liveGreenTrapExtras(instrumentId);
  if (config.optionStandDownRs != null) {
    extras.optionStandDownRs = Number(config.optionStandDownRs);
  }
  const bank = /bank/i.test(String(instrumentId || ''));
  const fromUi = bank ? config.bankMaxTradesDay : config.niftyMaxTradesDay;
  const overrides = { ...risk, extras };
  overrides.maxTradesPerDay = clampMaxTradesToDna(fromUi);
  return overrides;
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
    };
    this.warmed = false;
    this.reconciled = false;
    this.tickBusy = false;
    this.lastSignals = { nifty: '', bank: '' };
    this.lastDeskHalt = '';
  }

  handleBrokerFill(fill) {
    const row = applyBrokerFill(this.liveTrades, fill);
    if (!row) return;
    const px = Number(fill.premium);
    const opt = niceOption(fill.tradingSymbol);
    const side = String(fill.side || '').toLowerCase();

    // Entry: just say what was bought and at what price.
    if (side === 'entry') {
      this.pushEvent('FILL', `BOUGHT ${opt} at \u20B9${px.toFixed(2)}`);
      return;
    }

    // Exit / SL: show the whole trade (in -> out -> result) plus the day so far.
    const entry = row.optionEntryPremium;
    const net = row.netOptionPnlRs != null ? row.netOptionPnlRs : row.optionPnlRs;
    const priced =
      entry != null && entry > 0
        ? `bought \u20B9${Number(entry).toFixed(2)} \u2192 sold \u20B9${px.toFixed(2)}`
        : `sold \u20B9${px.toFixed(2)}`;
    const result =
      net != null
        ? ` \u00B7 ${net >= 0 ? 'PROFIT' : 'LOSS'} ${money(Math.abs(net))}`
        : '';
    this.pushEvent('FILL', `SOLD ${opt}: ${priced}${result}`);

    const { date: today } = istParts();
    const d = this.deskDayStats(today);
    if (d.trades > 0) {
      this.pushEvent(
        'DAY',
        `Today: ${d.net >= 0 ? '+' : '-'}${money(Math.abs(d.net))} ` +
          `(${d.wins} win${d.wins === 1 ? '' : 's'}, ${d.losses} loss${d.losses === 1 ? '' : 'es'}` +
          `, won ${money(d.won)} / lost ${money(d.lost)})`,
      );
    }
  }

  /** Snapshot for GET /live/status — broker fills when real, else live-path paper. */
  moneySnapshot() {
    const real = !!this.getConfig()?.realOrders;
    return {
      trades: publicTrades(this.liveTrades),
      totals: moneyTotals(this.liveTrades, { brokerOnly: real }),
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
    this.pushEvent(
      'DATA',
      `Option list loaded (${this.instruments.length.toLocaleString('en-IN')} contracts)`,
    );
    // Feeds the historical instrument archive so future backtests can
    // resolve this week's contracts by real expiry date after they expire.
    archiveInstruments(this.instruments).catch(() => {});
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
    // Only fetch Bank history when the Bank book is actually enabled — keeps
    // the tick cheap (and the 512MB droplet calm) on a Nifty-only desk.
    if (this.getConfig()?.enableBank) {
      this.candles.bank = await fetchHistorical5m(
        authorization,
        BANK_NIFTY_INSTRUMENT.instrumentToken,
        from,
        today,
      );
    }
    this.warmed = true;
    this.pushEvent(
      'DATA',
      `Ready — ${this.candles.nifty.length.toLocaleString('en-IN')} Nifty candles loaded` +
        (this.getConfig()?.enableBank
          ? ` and ${this.candles.bank.length.toLocaleString('en-IN')} Bank candles`
          : ''),
    );
  }

  async refreshToday(authorization) {
    const { date: today } = istParts();
    const n = await fetchHistorical5m(
      authorization,
      NIFTY_50_INSTRUMENT.instrumentToken,
      today,
      today,
    );
    this.candles.nifty = mergeCandles(this.candles.nifty, n);
    if (this.getConfig()?.enableBank) {
      const b = await fetchHistorical5m(
        authorization,
        BANK_NIFTY_INSTRUMENT.instrumentToken,
        today,
        today,
      );
      this.candles.bank = mergeCandles(this.candles.bank, b);
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
        this.pushEvent('AUTH_WAIT', 'Waiting for Kite token — press "Push Kite token to server"');
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
      const halt = this.deskHaltReason(today);
      if (halt && halt !== this.lastDeskHalt) {
        this.lastDeskHalt = halt;
        this.pushEvent('DESK_HALT', halt);
      }
      const indexSession = now >= '09:15' && now <= '15:30';
      const enableKutty = !!config.enableKutty;

      const livePath = livePathReplayOpts({
        rejectEstimatedPremium: true,
        fillFrictionPremium:
          config.fillFrictionPremium != null ? config.fillFrictionPremium : 0.5,
      });

      if (config.enableNifty && indexSession) {
        await this.runBook({
          authorization,
          book: 'nifty',
          instrument: NIFTY_50_INSTRUMENT,
          label: 'Nifty Trap',
          lots: config.niftyLots || config.deskLots || config.lots || 1,
          config,
          now,
          today,
          livePath,
          enableKutty,
        });
      }

      if (config.enableBank && indexSession) {
        await this.runBook({
          authorization,
          book: 'bank',
          instrument: BANK_NIFTY_INSTRUMENT,
          label: 'Bank Trap',
          lots: config.bankLots || config.deskLots || config.lots || 1,
          config,
          now,
          today,
          livePath,
          enableKutty,
        });
      }

      const d = this.deskDayStats(today);
      const pnlTxt =
        d.trades > 0
          ? `${d.net >= 0 ? '+' : '-'}${money(Math.abs(d.net))} on ${d.trades} trade${d.trades === 1 ? '' : 's'}`
          : 'no trades yet';
      this.heartbeat(
        `${now} IST \u00B7 ${config.realOrders ? 'LIVE money' : 'PAPER'} \u00B7 ` +
          `Nifty ${config.niftyLots || 1} lot${(config.niftyLots || 1) > 1 ? 's' : ''} \u00B7 ${pnlTxt}` +
          (halt ? ` \u00B7 STOPPED: ${halt}` : ''),
      );
    } catch (err) {
      const msg = err?.message || String(err);
      this.pushEvent('ERROR', `Something went wrong: ${msg}`);
      this.heartbeat(`Tick error: ${msg}`);
      console.error('[live-worker]', err);
    } finally {
      this.tickBusy = false;
    }
  }

  /**
   * Replay one index book and sync it to the broker.
   *
   * Books are independent strategy instances over their own candles; the desk's
   * maxOpenLegs (in liveOpenForSync / LiveBroker) is what decides whether Nifty
   * and Bank may hold legs at the same time. Lots come from the UI per book.
   */
  async runBook({
    authorization,
    book,
    instrument,
    label,
    lots,
    config,
    now,
    today,
    livePath,
    enableKutty,
  }) {
    const replay = await this.replayIndexLive({
      authorization,
      instrument,
      kind: book === 'bank' ? 'banknifty' : 'nifty',
      candles: this.candles[book],
      lots,
      forceClose: now >= '15:15',
      enableKutty,
      kuttyAlone: !!config.kuttyAlone,
      today,
      livePath,
      makeStrategy: () => {
        const s = createTrapStrategyV2();
        s.initialize(trapInitOverrides(config, instrument.id));
        return s;
      },
    });
    ingestReplayTrades(this.liveTrades, replay.trades, { rejectEstimated: true });
    await this.broker.syncInstrument({
      authorization,
      instrumentId: instrument.id,
      instrumentName: label,
      open: this.liveOpenForSync(instrument.id, replay.open),
      lots,
    });
    // replay.lastSignal is engine-speak ("Waiting swing lookback", "S/R trap
    // confirm BUY · 3.5R"). Surface only what a person needs: are we in a
    // trade, or waiting.
    const sig = replay.open
      ? `IN TRADE — ${replay.open.direction === 'BUY' ? 'Call' : 'Put'} ` +
        `${niceOption(replay.open.option?.tradingSymbol)} (Nifty ${Math.round(replay.open.entry)})`
      : `Watching for a setup — ${String(replay.lastSignal || '').replace(/\s*·\s*[\d.]+R$/, '')}`;
    if (sig !== this.lastSignals[book]) {
      this.lastSignals[book] = sig;
      this.pushEvent('SIGNAL', sig);
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

  /**
   * Closed-trade desk P&L for IST `today` (paper ledger, charges-aware).
   */
  deskDayStats(today) {
    let net = 0;
    let trades = 0;
    let wins = 0;
    let losses = 0;
    let won = 0;
    let lost = 0;
    for (const t of this.liveTrades || []) {
      if (String(t.entryTime || '').slice(0, 10) !== today) continue;
      if (t.premiumEstimated) continue;
      const n =
        t.netOptionPnlRs != null
          ? Number(t.netOptionPnlRs)
          : t.optionPnlRs != null
            ? Number(t.optionPnlRs)
            : null;
      if (n == null || !Number.isFinite(n)) continue;
      net += n;
      trades += 1;
      if (n > 0) {
        wins += 1;
        won += n;
      } else if (n < 0) {
        losses += 1;
        lost += Math.abs(n);
      }
    }
    return { net, trades, wins, losses, won, lost };
  }

  /**
   * Stop new entries once ₹1k is banked, stop is hit, or 3 trades are done.
   * Open legs still manage/exit via liveOpenForSync.
   */
  deskHaltReason(today) {
    const config = this.getConfig() || {};
    const lots = deskRiskLots(config);
    const lock = config.dayProfitLock !== false ? profitLockMoneyRs(lots) : 0;
    const protect =
      config.deskGreenProtectRs != null
        ? Math.max(0, Number(config.deskGreenProtectRs) || 0) * lots
        : greenProtectMoneyRs(lots);
    const stop = config.strictDayStop === true ? strictStopMoneyRs(lots) : 0;
    const maxT =
      config.deskMaxTradesDay != null
        ? Math.max(0, Math.floor(Number(config.deskMaxTradesDay)) || 0)
        : LIVE_GREEN_DNA.liveOps.deskMaxTradesDay != null
          ? Math.max(0, Math.floor(Number(LIVE_GREEN_DNA.liveOps.deskMaxTradesDay)) || 0)
          : 0;
    const { net, trades } = this.deskDayStats(today);
    const { hhmm: now } = istParts();
    const pe = LIVE_GREEN_DNA.trap.peSession;
    const inPe =
      LIVE_GREEN_DNA.liveOps.peSessionIgnoresHalt &&
      pe &&
      pe.enabled !== false &&
      now >= (pe.entryTimeStart || '14:15') &&
      now <= (pe.entryTimeEnd || '14:45');
    if (inPe) {
      if (this.peTakenToday(today)) return `PE session done`;
      const peBelow = Number(LIVE_GREEN_DNA.liveOps.peSessionOnlyIfBelowRs) || 0;
      if (peBelow > 0 && net >= peBelow) {
        return `PE skip — morning already ₹${Math.round(net)} (≥ ₹${peBelow})`;
      }
      if (peBelow <= 0 && LIVE_GREEN_DNA.liveOps.peSessionOnlyIfNotGreen === true && net > 0) {
        return `PE skip — morning already green (net ₹${Math.round(net)})`;
      }
      return null;
    }
    const haltAfterRed =
      config.deskHaltAfterRed != null
        ? !!config.deskHaltAfterRed
        : LIVE_GREEN_DNA.liveOps.deskHaltAfterRed === true;
    if (haltAfterRed && trades > 0 && net < 0) {
      return `desk red — no repair (net ₹${Math.round(net)})`;
    }
    if (protect > 0 && net >= protect) {
      if (protect <= 1) {
        return `desk green — halt new entries (net ₹${Math.round(net)})`;
      }
      return `desk protect +₹${protect.toLocaleString('en-IN')} (50% · net ₹${Math.round(net)})`;
    }
    if (lock > 0 && net >= lock) {
      return `desk lock +₹${lock.toLocaleString('en-IN')} (net ₹${Math.round(net)})`;
    }
    if (stop > 0 && net <= -stop) {
      return `desk stop −₹${stop.toLocaleString('en-IN')} (net ₹${Math.round(net)})`;
    }
    if (maxT > 0 && trades >= maxT && now < '15:15') {
      return `desk max ${maxT} trades (done ${trades})`;
    }
    return null;
  }

  /** Closed Nifty 50 option ₹ today. */
  indexDayNet(today) {
    const ids = new Set([NIFTY_50_INSTRUMENT.id]);
    let net = 0;
    for (const t of this.liveTrades || []) {
      if (!ids.has(t.instrumentId)) continue;
      if (String(t.entryTime || '').slice(0, 10) !== today) continue;
      if (t.premiumEstimated) continue;
      const n =
        t.netOptionPnlRs != null
          ? Number(t.netOptionPnlRs)
          : t.optionPnlRs != null
            ? Number(t.optionPnlRs)
            : null;
      if (n == null || !Number.isFinite(n)) continue;
      net += n;
    }
    return net;
  }

  niftyGreenToday(today) {
    const niftyId = NIFTY_50_INSTRUMENT.id;
    let net = 0;
    let closed = false;
    for (const t of this.liveTrades || []) {
      if (t.instrumentId !== niftyId) continue;
      if (String(t.entryTime || '').slice(0, 10) !== today) continue;
      if (t.premiumEstimated) continue;
      const n =
        t.netOptionPnlRs != null
          ? Number(t.netOptionPnlRs)
          : t.optionPnlRs != null
            ? Number(t.optionPnlRs)
            : null;
      if (n == null || !Number.isFinite(n)) continue;
      net += n;
      closed = true;
    }
    return closed && net > 0;
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
  liveOpenForSync(instrumentId, replayOpen) {
    const open = toLiveOpen(replayOpen);
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
    const { date: today, hhmm: now } = istParts();
    const pe = LIVE_GREEN_DNA.trap.peSession;
    const cut = LIVE_GREEN_DNA.trap.sessionCutTime || '';
    const openTm = String(open.entryTime || '').match(/T(\d{2}:\d{2})/)?.[1] || now;
    const inPe =
      pe &&
      pe.enabled === true &&
      openTm >= (pe.entryFillStart || pe.entryTimeStart || '') &&
      openTm <= (pe.entryTimeEnd || '14:45');
    if (inPe) {
      const peDir = String(pe.allowDirection || 'SELL').toUpperCase();
      if (peDir === 'SELL' && open.direction === 'BUY') return null;
      if (peDir === 'BUY' && open.direction === 'SELL') return null;
      if (this.peTakenToday(today)) return null;
      return open;
    }
    if (this.deskHaltReason(today)) return null;
    if (cut && openTm >= cut) return null;
    const allowDir = String(LIVE_GREEN_DNA.trap.allowDirection || '').toUpperCase();
    if (allowDir === 'SELL' && open.direction === 'BUY') return null;
    if (allowDir === 'BUY' && open.direction === 'SELL') return null;
    return open;
  }

  peTakenToday(today) {
    const pe = LIVE_GREEN_DNA.trap.peSession;
    if (!pe || pe.enabled === false) return false;
    const start = pe.entryFillStart || pe.entryTimeStart || '14:15';
    const niftyId = NIFTY_50_INSTRUMENT.id;
    for (const t of this.liveTrades || []) {
      if (t.instrumentId !== niftyId) continue;
      if (String(t.entryTime || '').slice(0, 10) !== today) continue;
      const tm = String(t.entryTime || '').match(/T(\d{2}:\d{2})/)?.[1] || '';
      if (tm >= start && t.direction === (pe.allowDirection || 'SELL')) return true;
    }
    return false;
  }

  resetWarm() {
    this.warmed = false;
    this.reconciled = false;
    this.broker.clear();
    this.liveTrades = [];
    this.lastSignals = { nifty: '', bank: '' };
    this.lastDeskHalt = '';
  }
}

module.exports = { LiveWorker };
