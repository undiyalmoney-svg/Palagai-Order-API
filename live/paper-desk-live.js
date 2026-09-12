'use strict';
/**
 * Live worker for the paper desk. Same simulateDay as paper.
 * Kite ATM MIS orders are the only extra step. Late start does not chase.
 */

const { fetchInstruments, fetchHistorical5m, fetchQuotes } = require('./kite-market');
const { LiveBroker } = require('./live-broker');
const {
  BOOKS,
  sessionBars,
  simulateDay,
} = require('./paper-discover');
const {
  resolveAtmWeeklyOption,
  NIFTY_50_INSTRUMENT,
  BANK_NIFTY_INSTRUMENT,
  CRUDE_OIL_MINI_INSTRUMENT,
} = require('./strategy-core.cjs');

const BROKER_ID = {
  nifty: NIFTY_50_INSTRUMENT.id,
  bank: BANK_NIFTY_INSTRUMENT.id,
  crude: CRUDE_OIL_MINI_INSTRUMENT.id,
};

const ATM_KIND = { nifty: 'nifty', bank: 'banknifty' };
const SPOT_KEY = {
  nifty: 'NSE:NIFTY 50',
  bank: 'NSE:NIFTY BANK',
};

function istToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

class PaperDeskWorker {
  constructor({ readAuth, pushEvent, heartbeat, getConfig }) {
    this.readAuth = readAuth;
    this.pushEvent = pushEvent;
    this.heartbeat = heartbeat;
    this.getConfig = getConfig;
    this.broker = new LiveBroker({
      pushEvent,
      realOrders: false,
      onFill: () => {},
    });
    this.broker.setMaxOpenLegs(6);
    this.instruments = [];
    this.mcx = [];
    this.tickBusy = false;
    this.lastSig = '';
    this.startedMs = Date.now();
  }

  resetWarm() {
    const cfg = this.getConfig() || {};
    this.broker.realOrders = !!cfg.realOrders;
    this.broker.clear();
    this.broker.setMaxOpenLegs(6);
    this.lastSig = '';
    this.startedMs = Date.now();
    this.tickBusy = false;
  }

  moneySnapshot() {
    return { trades: [], totals: null };
  }

  authHeader() {
    const creds = this.readAuth();
    if (!creds?.apiKey || !creds?.accessToken) return null;
    return `token ${creds.apiKey}:${creds.accessToken}`;
  }

  async onTick() {
    if (this.tickBusy) return;
    this.tickBusy = true;
    try {
      await this.tickOnce();
    } finally {
      this.tickBusy = false;
    }
  }

  fundedBooks() {
    const plan = this.getConfig()?.deskPlan || {};
    const taken = plan.allocation?.taken || [];
    const books = plan.books || [];
    const out = [];
    const seen = new Set();
    for (const book of books) {
      if (book.sitOut || !book.spec) continue;
      if (book.id !== 'nifty' && book.id !== 'bank') continue;
      const row = taken.find((t) => t.bookId === book.id);
      out.push({ taken: row || { bookId: book.id, lots: 1 }, book });
      seen.add(book.id);
    }
    for (const t of taken) {
      if (seen.has(t.bookId)) continue;
      if (t.bookId === 'stocks' || String(t.bookId || '').startsWith('stock:')) continue;
      const book = books.find((b) => b.id === t.bookId);
      if (!book || book.sitOut || !book.spec) continue;
      out.push({ taken: t, book });
    }
    return out;
  }

  async tickOnce() {
    const authorization = this.authHeader();
    const cfg = this.getConfig() || {};
    this.broker.realOrders = !!cfg.realOrders;
    if (!authorization) {
      this.heartbeat('Paper desk live — push Kite token');
      return;
    }
    const today = istToday();
    const funded = this.fundedBooks();
    if (!funded.length) {
      this.heartbeat('Paper desk live — capital sat out (same as paper)');
      if (this.lastSig !== 'sit') {
        this.lastSig = 'sit';
        this.pushEvent('DESK', 'Same as paper: no funded F&O book. Stocks stay paper.');
      }
      return;
    }

    if (!this.instruments.length) {
      this.instruments = await fetchInstruments(authorization);
    }

    const bits = [];
    for (const row of funded) {
      const profile = BOOKS[row.book.id];
      const token = Number(row.book.token) || profile.token;
      if (!token) {
        bits.push(`${row.book.id}: no token`);
        continue;
      }
      const candles = await fetchHistorical5m(authorization, token, today, today);
      const dayBars = sessionBars(candles, today, profile);
      const lots = Math.max(1, Number(row.taken.lots) || 1);
      const sim = simulateDay(dayBars, row.book.spec, lots, profile, {
        withOpen: true,
        flattenOpen: false,
      });
      const openSim = sim.open;
      const legs = [];
      if (openSim) {
        const entryMs = Date.parse(openSim.entryTime);
        if (Number.isFinite(entryMs) && entryMs + 2 * 60 * 1000 < this.startedMs) {
          this.pushEvent(
            'MISS',
            `${profile.name} signal already printed before live start — not chasing (paper still shows it)`,
          );
        } else {
          legs.push(...(await this.toBrokerLegs(authorization, row.book.id, openSim, dayBars)));
        }
      }
      for (const leg of legs) {
        await this.broker.syncInstrument({
          authorization,
          instrumentId: leg.instrumentId,
          instrumentName: `${profile.name} ${leg.optionType}`,
          open: leg.open,
          lots,
        });
      }
      if (!legs.length) {
        const brokerId = BROKER_ID[row.book.id];
        if (brokerId) {
          await this.broker.syncInstrument({
            authorization,
            instrumentId: `${brokerId}:CE`,
            instrumentName: profile.name,
            open: null,
            lots,
          });
          await this.broker.syncInstrument({
            authorization,
            instrumentId: `${brokerId}:PE`,
            instrumentName: profile.name,
            open: null,
            lots,
          });
        }
      }
      const brokerOpen = legs.length > 0;
      bits.push(
        brokerOpen
          ? openSim.straddle
            ? `${profile.name} ${openSim.straddle} straddle ×${lots}`
            : `${profile.name} ${openSim.dir > 0 ? 'CE' : 'PE'} ORB ×${lots}`
          : `${profile.name} watching 15m OR`,
      );
    }
    const sig = bits.join(' · ');
    this.heartbeat(`Paper desk live — ${sig}`);
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.pushEvent('SIGNAL', sig);
    }
  }

  async toBrokerLegs(authorization, bookId, openSim, dayBars) {
    const last = dayBars[dayBars.length - 1];
    const spot = Number(openSim.entryClose) || Number(last?.close) || 0;
    let liveSpot = spot;
    const key = SPOT_KEY[bookId];
    if (key) {
      try {
        const q = await fetchQuotes(authorization, [key]);
        liveSpot = Number(q[key]?.last_price || q[key]?.ohlc?.close) || spot;
      } catch {
        liveSpot = spot;
      }
    }
    const types = openSim.straddle || openSim.spec?.mode === 'straddle' ? ['CE', 'PE'] : [openSim.dir > 0 ? 'CE' : 'PE'];
    const txn = openSim.straddle === 'short' ? 'SELL' : 'BUY';
    const stopPts = Number(openSim.premiumPts || openSim.spec?.stopPts) || 0;
    const legs = [];
    for (const optionType of types) {
      const resolved = resolveAtmWeeklyOption({
        instruments: this.instruments,
        kind: ATM_KIND[bookId] || 'nifty',
        direction: optionType === 'CE' ? 'BUY' : 'SELL',
        spot: liveSpot,
        asOfDateTime: new Date().toISOString(),
      });
      const inst = resolved?.instrument || {};
      if (!inst.instrumentToken || resolved.source === 'synthetic') continue;
      const brokerId = `${BROKER_ID[bookId]}:${optionType}`;
      legs.push({
        instrumentId: brokerId,
        optionType,
        open: {
          direction: txn,
          entryTime: openSim.entryTime,
          indexEntry: openSim.entryClose,
          indexStop: txn === 'SELL' ? openSim.entryClose + stopPts : openSim.entryClose - stopPts,
          indexTarget: openSim.entryClose,
          option: inst,
          optionEntryPremium: null,
          premiumEstimated: false,
          skipChargeGate: true,
          lotsMultiplier: 1,
        },
      });
    }
    return legs;
  }
}

module.exports = { PaperDeskWorker, BROKER_ID };
