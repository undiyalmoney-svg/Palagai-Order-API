'use strict';
/**
 * Live worker for the paper desk. Same simulateDay as paper.
 * Kite ATM MIS orders are the only extra step. Late start does not chase.
 */

const { fetchInstruments, fetchInstrumentsCsv, fetchHistorical5m, fetchQuotes } = require('./kite-market');
const { LiveBroker } = require('./live-broker');
const {
  BOOKS,
  sessionBars,
  simulateDay,
} = require('./paper-discover');
const {
  resolveAtmWeeklyOption,
  resolveAtmCrudeMiniOption,
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

function parseMcxOptions(csv) {
  const lines = String(csv || '').split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',');
    if (cols.length < 12) continue;
    const itype = String(cols[9] || '').replace(/"/g, '').toUpperCase();
    const exchange = String(cols[11] || '').replace(/"/g, '').toUpperCase();
    const sym = String(cols[2] || '').replace(/"/g, '');
    if (exchange !== 'MCX' || (itype !== 'CE' && itype !== 'PE')) continue;
    if (!/^CRUDEOILM/i.test(sym)) continue;
    out.push({
      instrumentToken: Number(String(cols[0] || '').replace(/"/g, '')) || 0,
      tradingSymbol: sym,
      name: String(cols[3] || '').replace(/"/g, ''),
      expiry: String(cols[5] || '').replace(/"/g, ''),
      strike: Number(String(cols[6] || '').replace(/"/g, '')) || 0,
      lotSize: Number(String(cols[8] || '').replace(/"/g, '')) || 1,
      instrumentType: itype,
      exchange: 'MCX',
    });
  }
  return out;
}

function cepeToBrokerDir(cepe) {
  return String(cepe).toUpperCase() === 'CE' ? 'BUY' : 'SELL';
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
    for (const t of taken) {
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
    if (!this.mcx.length && funded.some((f) => f.book.id === 'crude')) {
      try {
        const csv = await fetchInstrumentsCsv(authorization, 'MCX');
        this.mcx = parseMcxOptions(csv);
      } catch (err) {
        this.pushEvent('DATA', `MCX list failed: ${err.message || err}`);
      }
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
      let brokerOpen = null;
      if (openSim) {
        const entryMs = Date.parse(openSim.entryTime);
        if (Number.isFinite(entryMs) && entryMs + 2 * 60 * 1000 < this.startedMs) {
          this.pushEvent(
            'MISS',
            `${profile.name} signal already printed before live start — not chasing (paper still shows it)`,
          );
        } else {
          brokerOpen = await this.toBrokerOpen(authorization, row.book.id, openSim, dayBars);
        }
      }
      const brokerId = BROKER_ID[row.book.id];
      if (brokerId) {
        await this.broker.syncInstrument({
          authorization,
          instrumentId: brokerId,
          instrumentName: profile.name,
          open: brokerOpen,
          lots,
        });
      }
      bits.push(
        brokerOpen
          ? `${profile.name} ${openSim.spec?.mode || ''} ${openSim.dir > 0 ? 'CE' : 'PE'} ×${lots}`
          : `${profile.name} watching`,
      );
    }
    const sig = bits.join(' · ');
    this.heartbeat(`Paper desk live — ${sig}`);
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.pushEvent('SIGNAL', sig);
    }
  }

  async toBrokerOpen(authorization, bookId, openSim, dayBars) {
    const last = dayBars[dayBars.length - 1];
    const spot = Number(openSim.entryClose) || Number(last?.close) || 0;
    const direction = cepeToBrokerDir(openSim.dir > 0 ? 'CE' : 'PE');
    let resolved;
    if (bookId === 'crude') {
      resolved = resolveAtmCrudeMiniOption({
        instruments: this.mcx,
        direction,
        spot,
        asOfDateTime: new Date().toISOString(),
      });
    } else {
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
      resolved = resolveAtmWeeklyOption({
        instruments: this.instruments,
        kind: ATM_KIND[bookId] || 'nifty',
        direction,
        spot: liveSpot,
        asOfDateTime: new Date().toISOString(),
      });
    }
    const inst = resolved?.instrument || {};
    if (!inst.instrumentToken || resolved.source === 'synthetic') return null;
    const stopPts = Number(openSim.spec?.stopPts) || 0;
    return {
      direction: 'BUY',
      entryTime: openSim.entryTime,
      indexEntry: openSim.entryClose,
      indexStop: openSim.dir > 0 ? openSim.entryClose - stopPts : openSim.entryClose + stopPts,
      indexTarget:
        openSim.dir > 0
          ? openSim.entryClose + stopPts * (openSim.spec?.targetR || 2)
          : openSim.entryClose - stopPts * (openSim.spec?.targetR || 2),
      option: inst,
      optionEntryPremium: null,
      premiumEstimated: false,
      skipChargeGate: true,
      lotsMultiplier: 1,
    };
  }
}

module.exports = { PaperDeskWorker, parseMcxOptions, BROKER_ID };
