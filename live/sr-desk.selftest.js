'use strict';
const assert = require('assert');
const { runSrDesk, mapTrade, applyOptionOhlc, overlayNseOptionOhlc, markLiveParity, resolveDeskCapital, ENGINE, BOOKS } = require('./sr-desk');
const { pickBarFlex, ohlcOf } = require('./sr-option-pnl');
const { nseWeeklyOptionSymbol } = require('./nse-option-intraday');
const { STRATEGY_ID } = require('./sr-strategy-config');

assert.deepStrictEqual(
  resolveDeskCapital({ capitalRs: 40000, capitalSource: 'mine', kiteFunds: { capitalRs: 61200 } }),
  { capital: 40000, capitalSource: 'mine' },
);
assert.deepStrictEqual(
  resolveDeskCapital({ capitalRs: 40000, capitalSource: 'actual', kiteFunds: { capitalRs: 61200 } }),
  { capital: 61200, capitalSource: 'actual' },
);
assert.deepStrictEqual(
  resolveDeskCapital({ capitalRs: 40000, capitalSource: 'mine', liveMoney: true, kiteFunds: { capitalRs: 61200 } }),
  { capital: 61200, capitalSource: 'actual' },
);
assert.strictEqual(
  resolveDeskCapital({ capitalRs: 40000, capitalSource: 'actual', kiteFunds: null }).capital,
  40000,
);

assert.strictEqual(ENGINE, 'sr-desk');
assert.strictEqual(STRATEGY_ID, 'sr-breakout');
assert.ok(BOOKS.nifty.token);
assert.ok(BOOKS.banknifty.token);

const mapped = mapTrade(
  {
    date: '2026-09-11',
    side: 'BUY',
    option: 'CE',
    entryTime: '10:15',
    exitTime: '10:45',
    exitReason: 'TARGET',
    entryPrice: 25000,
    exitPrice: 25020,
    points: 20,
  },
  BOOKS.nifty,
  1,
  65,
);
assert.strictEqual(mapped.direction, 'CE');
assert.strictEqual(mapped.selectedInstrument, 'Nifty 50 25000 CE');
assert.strictEqual(mapped.optionStrike, 25000);
assert.strictEqual(mapped.sideLabel, 'CE BUY');
assert.strictEqual(mapped.entryTime, '2026-09-11T10:15:00+0530');
assert.strictEqual(mapped.exitTime, '2026-09-11T10:45:00+0530');
assert.strictEqual(mapped.entryHm, '10:15:00');
assert.strictEqual(mapped.exitHm, '10:45:00');
assert.strictEqual(mapped.entryClock, '10:15:00 AM');
assert.strictEqual(mapped.exitClock, '10:45:00 AM');
assert.strictEqual(mapped.indexEntry, 25000);
assert.strictEqual(mapped.indexExit, 25020);
assert.ok(mapped.entryPrice > 20 && mapped.entryPrice < 800, `nifty premium ${mapped.entryPrice}`);
assert.ok(mapped.exitPrice > 20 && mapped.exitPrice < 900, `nifty exit prem ${mapped.exitPrice}`);
assert.notStrictEqual(mapped.entryPrice, 25000);
assert.strictEqual(mapped.premiumSource, 'bs_atm_weekly');
assert.ok(mapped.stopPts > 0, 'Nifty paper must carry the ₹5,000 index cut as stopPts');
assert.ok(mapped.indexStop < mapped.indexEntry, 'Nifty CE SL sits below index entry');
assert.ok(mapped.slTrigger > 0 && mapped.slTrigger < mapped.optionEntryPremium, `Nifty option SL ${mapped.slTrigger}`);
assert.strictEqual(mapped.slPrice, mapped.slTrigger);
assert.strictEqual(mapped.quantity, 65);

const withSeconds = mapTrade(
  {
    date: '2026-09-11',
    option: 'CE',
    entryTime: '10:15',
    exitTime: '10:45',
    entryAt: '2026-09-11T10:15:37+05:30',
    exitAt: '2026-09-11T10:45:08+05:30',
    exitReason: 'TARGET',
    entryPrice: 25000,
    exitPrice: 25020,
    points: 20,
  },
  BOOKS.nifty,
  1,
  65,
);
assert.strictEqual(withSeconds.entryHm, '10:15:37');
assert.strictEqual(withSeconds.exitHm, '10:45:08');
assert.strictEqual(withSeconds.entryClock, '10:15:37 AM');
assert.strictEqual(withSeconds.exitClock, '10:45:08 AM');
assert.strictEqual(withSeconds.entryTime, '2026-09-11T10:15:37+0530');
assert.strictEqual(withSeconds.exitTime, '2026-09-11T10:45:08+0530');
assert.strictEqual(mapped.pnlSource, 'option_x_lot_live');
assert.strictEqual(
  mapped.optionPnlRs,
  Math.round((mapped.optionExitPremium - mapped.optionEntryPremium) * 65),
);
assert.strictEqual(mapped.netOptionPnlRs, mapped.optionPnlRs - 20);
assert.ok(mapped.optionPnlRs !== 1300, '20 index pts × 65 must not be the paper rupees');
assert.ok(!/straddle/i.test(mapped.optionSymbol));
assert.deepStrictEqual(Object.keys(BOOKS).sort(), ['banknifty', 'nifty']);
assert.strictEqual(BOOKS.nifty.strikeStep, 50);
assert.strictEqual(BOOKS.banknifty.strikeStep, 100);

const nearAtm = mapTrade(
  {
    date: '2026-09-11',
    option: 'CE',
    entryTime: '10:15',
    exitTime: '10:45',
    exitReason: 'TARGET',
    entryPrice: 24024,
    exitPrice: 24044,
    points: 20,
  },
  BOOKS.nifty,
  1,
  65,
);
assert.strictEqual(nearAtm.optionStrike, 24000);
assert.strictEqual(nearAtm.selectedInstrument, 'Nifty 50 24000 CE');

const bankMapped = mapTrade(
  {
    date: '2026-09-11',
    option: 'PE',
    entryTime: '12:05',
    exitTime: '12:20',
    exitReason: 'TARGET',
    entryPrice: 51234.5,
    exitPrice: 51190,
    points: 20,
  },
  BOOKS.banknifty,
  1,
  30,
);
assert.strictEqual(bankMapped.optionStrike, 51200);
assert.strictEqual(bankMapped.selectedInstrument, 'Bank Nifty 51200 PE');
assert.strictEqual(bankMapped.sideLabel, 'PE BUY');
assert.strictEqual(bankMapped.entryClock, '12:05:00 PM');
assert.strictEqual(bankMapped.exitClock, '12:20:00 PM');
assert.strictEqual(bankMapped.entryHm, '12:05:00');
assert.strictEqual(bankMapped.exitHm, '12:20:00');
assert.ok(bankMapped.entryPrice < 5000, `bank premium must not be index, got ${bankMapped.entryPrice}`);
assert.strictEqual(bankMapped.stopPts, 3500 / 30, 'Bank 15.8 DNA uses a ₹3,500 index cut');
assert.ok(bankMapped.indexStop > bankMapped.indexEntry, 'Bank PE SL sits above index entry');
assert.ok(
  bankMapped.slTrigger > 0 && bankMapped.slTrigger < bankMapped.optionEntryPremium,
  `Bank option SL still parks below fill (${bankMapped.slTrigger})`,
);
assert.strictEqual(bankMapped.indexEntry, 51234.5);

const bankHigh = mapTrade(
  {
    date: '2026-09-11',
    option: 'CE',
    entryTime: '12:05',
    exitTime: '12:20',
    exitReason: 'TARGET',
    entryPrice: 56142,
    exitPrice: 56180,
    points: 20,
  },
  BOOKS.banknifty,
  1,
  30,
);
assert.strictEqual(bankHigh.optionStrike, 56100);
assert.ok(bankHigh.entryPrice !== 56142);
assert.ok(bankHigh.entryPrice > 50 && bankHigh.entryPrice < 2500, `bank 56142 premium ${bankHigh.entryPrice}`);
assert.strictEqual(bankHigh.indexEntry, 56142);

const bankPe = mapTrade(
  {
    date: '2026-09-11',
    option: 'PE',
    entryTime: '12:05',
    exitTime: '12:20',
    exitReason: 'TARGET',
    entryPrice: 56142,
    exitPrice: 56100,
    points: 20,
  },
  BOOKS.banknifty,
  1,
  30,
);
assert.strictEqual(bankPe.optionStrike, 56100);
assert.ok(
  bankPe.entryPrice >= 450 && bankPe.entryPrice <= 550,
  `11 Sep 2026 Bank PE should be ~₹500, got ${bankPe.entryPrice}`,
);
assert.ok(bankPe.entryPrice !== 56142);

const bankBar = {
  date: '2026-09-11T12:10:00+0530',
  open: 512.85,
  high: 531.80,
  low: 512.55,
  close: 524.00,
};
assert.strictEqual(pickBarFlex([bankBar], '12:05').close, 524);
assert.strictEqual(pickBarFlex([bankBar], '12:10').close, 524);
assert.strictEqual(pickBarFlex([bankBar], '12:05:00').close, 524);
assert.deepStrictEqual(ohlcOf(bankBar), { open: 512.85, high: 531.80, low: 512.55, close: 524 });

const nseMarked = applyOptionOhlc(
  { ...bankPe, open: false, exitHm: '12:20:00' },
  {
    ok: true,
    entryClose: 524,
    exitClose: 518.4,
    entryOhlc: ohlcOf(bankBar),
    exitOhlc: { open: 524, high: 526, low: 518, close: 518.4 },
    optionSymbol: 'BANKNIFTY2691556100PE',
    source: 'nse-5m',
  },
);
assert.strictEqual(nseMarked.entryPrice, 524);
assert.strictEqual(nseMarked.optionEntryPremium, 524);
assert.strictEqual(nseMarked.premiumSource, 'nse-5m');
assert.strictEqual(nseMarked.entryOhlc.open, 512.85);
assert.strictEqual(nseMarked.entryOhlc.high, 531.8);
assert.strictEqual(nseMarked.entryOhlc.low, 512.55);
assert.strictEqual(nseMarked.entryOhlc.close, 524);
assert.strictEqual(nseMarked.exitPrice, 518.4);
assert.ok(nseMarked.slTrigger > 0 && nseMarked.slTrigger < 524, `overlay must keep option SL below fill (${nseMarked.slTrigger})`);
assert.ok(
  Math.abs((nseMarked.optionEntryPremium - nseMarked.slTrigger) - (3500 / 30)) < 1,
  `Bank option SL must be full ₹3500/lot pts not 0.5× (${nseMarked.slTrigger})`,
);
assert.strictEqual(nseMarked.pnlSource, 'option_x_lot_live');
assert.strictEqual(nseMarked.optionPnlRs, Math.round((518.4 - 524) * 30));
assert.strictEqual(nseMarked.netOptionPnlRs, nseMarked.optionPnlRs - 20);

const juneStop = applyOptionOhlc(
  mapTrade(
    {
      date: '2026-06-12',
      option: 'CE',
      entryTime: '13:20',
      exitTime: '13:25',
      exitReason: 'STOP',
      entryPrice: 23350,
      exitPrice: 23323,
      points: -26.92,
    },
    BOOKS.nifty,
    2,
    130,
  ),
  {
    entryClose: 155.05,
    exitClose: 140.85,
    optionSymbol: 'NIFTY26JUN23350CE',
    source: 'nse-5m',
  },
);
assert.strictEqual(juneStop.lots, 2);
assert.strictEqual(juneStop.optionPnlRs, Math.round((140.85 - 155.05) * 65 * 2));
assert.strictEqual(juneStop.netOptionPnlRs, juneStop.optionPnlRs - 40);
assert.ok(juneStop.netOptionPnlRs !== -3540, 'must not print the index day-cap as option rupees');
assert.strictEqual(
  nseWeeklyOptionSymbol('BANKNIFTY', bankPe.expiry, bankPe.optionStrike, 'PE'),
  'BANKNIFTY2691556100PE',
);

const fillWick = {
  date: '2026-09-11T10:00:00+0530',
  open: 891.85,
  high: 930,
  low: 800,
  close: 923.4,
};
const targetBar = {
  date: '2026-09-11T10:05:00+0530',
  open: 927.7,
  high: 975,
  low: 923.5,
  close: 971.15,
};
const bankTarget = mapTrade(
  {
    date: '2026-09-11',
    option: 'CE',
    entryTime: '10:00',
    exitTime: '10:05',
    exitReason: 'TARGET',
    entryPrice: 52000,
    exitPrice: 52020,
    points: 20,
  },
  BOOKS.banknifty,
  1,
  30,
);

Promise.resolve()
  .then(() => overlayNseOptionOhlc(
    bankTarget,
    {
      date: '2026-09-11',
      option: 'CE',
      entryTime: '10:00',
      exitTime: '10:05',
      entryPrice: 52000,
      exitPrice: 52020,
      points: 20,
    },
    BOOKS.banknifty,
    {
      candlesByKey: { nifty: [], banknifty: [] },
      fetchOption5m: async () => [fillWick, targetBar],
    },
  ))
  .then((row) => {
    assert.strictEqual(row.entryPrice, 923.4);
    assert.strictEqual(row.exitPrice, 971.15);
    assert.notStrictEqual(row.exitVia, 'sl-limit');
    assert.strictEqual(row.netOptionPnlRs, Math.round((971.15 - 923.4) * 30) - 20);
    assert.ok(row.netOptionPnlRs > 0, 'TARGET must not book the fill-bar wick as SL');
    const fillCloseStop = {
      date: '2026-09-11T10:00:00+0530',
      open: 923.4,
      high: 930,
      low: 780,
      close: 790,
    };
    return overlayNseOptionOhlc(
      { ...bankTarget },
      {
        date: '2026-09-11',
        option: 'CE',
        entryTime: '10:00',
        exitTime: '10:05',
        entryPrice: 52000,
        exitPrice: 52020,
        points: 20,
      },
      BOOKS.banknifty,
      {
        candlesByKey: { nifty: [], banknifty: [] },
        fetchOption5m: async () => [fillCloseStop, targetBar],
      },
    ).then((stopped) => {
      assert.strictEqual(stopped.exitReason, 'SL');
      assert.strictEqual(stopped.exitVia, 'sl-limit-fill-close');
      assert.strictEqual(stopped.entryPrice, 923.4);
      assert.ok(stopped.netOptionPnlRs < 0, 'Live SL-M after fill books a loss when the fill bar closes through SL');
      assert.ok(stopped.exitPrice < stopped.entryPrice);
      return overlayNseOptionOhlc(
        { ...bankTarget },
        {
          date: '2026-09-11',
          option: 'CE',
          entryTime: '10:00',
          exitTime: '10:05',
          entryPrice: 52000,
          exitPrice: 52020,
          points: 20,
        },
        BOOKS.banknifty,
        {
          candlesByKey: { nifty: [], banknifty: [] },
          fetchOption5m: async () => [fillWick, {
            date: '2026-09-11T10:05:00+0530',
            open: 920,
            high: 922,
            low: 800,
            close: 810,
          }],
        },
      );
    }).then((laterStop) => {
      assert.strictEqual(laterStop.exitReason, 'SL');
      assert.strictEqual(laterStop.exitVia, 'sl-limit');
      assert.ok(laterStop.netOptionPnlRs < 0, 'bars after fill still stop on the low, same as Live SL-M');
      return overlayNseOptionOhlc(
    { ...bankPe },
    {
      date: '2026-09-11',
      option: 'PE',
      entryTime: '12:05',
      exitTime: '12:20',
      entryPrice: 56142,
      exitPrice: 56100,
      points: 20,
    },
    BOOKS.banknifty,
    {
      candlesByKey: { nifty: [], banknifty: [] },
      fetchOption5m: async ({ tradingSymbol, symbols }) => {
        assert.ok((symbols || []).includes('BANKNIFTY2691556100PE'));
        assert.ok((symbols || []).includes('BANKNIFTY26SEP56100PE'));
        assert.ok(tradingSymbol === 'BANKNIFTY2691556100PE' || tradingSymbol === 'BANKNIFTY26SEP56100PE');
        return [bankBar];
      },
    },
    );
    });
  })
  .then((row) => {
    assert.strictEqual(row.entryPrice, 524);
    assert.strictEqual(row.premiumSource, 'nse-5m');
    assert.strictEqual(row.entryOhlc.low, 512.55);
    assert.ok(
      row.optionSymbol === 'BANKNIFTY2691556100PE' || row.optionSymbol === 'BANKNIFTY26SEP56100PE',
      row.optionSymbol,
    );
    return runSrDesk(
      { authorization: 'token x', fromDate: '2026-09-11', toDate: '2026-09-11', lots: 1, capitalRs: 40000 },
      { candlesByKey: { nifty: [], banknifty: [] } },
    );
  })
  .then((out) => {
    assert.strictEqual(out.engine, ENGINE);
    assert.strictEqual(out.strategy, STRATEGY_ID);
    assert.ok(/wall-break|S\/R/i.test(out.note));
    assert.ok(/S\/R → breakout → confirm \(retest\) → enter ATM CE\/PE/i.test(out.note));
    assert.ok(/only Nifty 50 and Bank Nifty/i.test(out.note));
    assert.ok(/NSE 5-minute option OHLC/i.test(out.note));
    assert.ok(/weekly premium/i.test(out.note));
    assert.ok(out.instruments.every((r) => r.id === 'nifty' || r.id === 'bank'));
    assert.ok(!out.instruments.some((r) => r.id === 'crude'));
    assert.strictEqual(out.totals.netRs, 0);
    assert.ok(out.capitalSource === 'actual' || out.capitalSource === 'mine');
    assert.strictEqual(out.maxLots, 1);
    return runSrDesk(
      {
        authorization: 'token x',
        fromDate: '2026-09-11',
        toDate: '2026-09-11',
        lots: 9,
        capitalRs: 120000,
        capitalSource: 'mine',
      },
      { candlesByKey: { nifty: [], banknifty: [] } },
    );
  })
  .then((sized) => {
    const hist = markLiveParity(
      { liveWouldTake: false },
      { entryTime: '10:15', exitTime: '10:45', exitReason: 'TIME' },
      BOOKS.nifty,
      '2026-08-01',
      '2026-08-31',
    );
    assert.strictEqual(hist.liveWouldTake, true, 'historical months do not need live-skip noise');
    assert.ok(!hist.skipReason);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const done = markLiveParity(
      { liveWouldTake: true },
      { entryTime: '09:50', exitTime: '10:20', exitReason: 'TIME' },
      BOOKS.nifty,
      today,
      today,
    );
    assert.strictEqual(done.liveWouldTake, false, 'today TIME already done — Live would not enter');
    assert.ok(!done.skipReason || !/20 minutes/.test(done.skipReason));
    const openRow = markLiveParity(
      { liveWouldTake: false },
      { entryTime: '09:50', exitTime: '15:15', exitReason: 'CLOSE' },
      BOOKS.nifty,
      today,
      today,
    );
    const hmNow = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date());
    const [hh, mm] = hmNow.split(':').map(Number);
    const mins = hh * 60 + mm;
    if (mins >= 9 * 60 + 50 && mins < 15 * 60 + 15) {
      assert.strictEqual(openRow.liveWouldTake, true, 'today OPEN CLOSE row — Live would enter/hold');
    }
    assert.ok(!openRow.skipReason || !/20 minutes/.test(openRow.skipReason));
    assert.strictEqual(sized.capitalSource, 'mine');
    assert.strictEqual(sized.capitalRs, 120000);
    assert.strictEqual(sized.maxLots, 3);
    assert.ok(sized.coreBooks.length === 3);
    assert.ok(sized.books.some((b) => b.id === 'nifty'));
    assert.ok(sized.books.find((b) => b.id === 'crude').sitOut);
    console.log('sr-desk.selftest: ok', sized.engine, sized.strategyVersion || sized.strategy);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
