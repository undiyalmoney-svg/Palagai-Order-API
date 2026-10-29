'use strict';

const { walkSignal, sizeQty, BUY_POWER_MULT } = require('./simulate');
const { collectSignals, orCrosses, orbTrades, pdhSignals } = require('./signals');

function filterCrowd(signals, crowd, mode) {
  if (!mode) return signals;
  return (signals || []).filter((s) => {
    const dayCrowd = crowd[s.day];
    if (mode === 'skipShort' && dayCrowd === 'S') return false;
    if (mode === 'skipLong' && dayCrowd === 'L') return false;
    if (mode === 'follow') {
      if (dayCrowd === 'L') return s.side === 'L';
      if (dayCrowd === 'S') return s.side === 'S';
    }
    return true;
  });
}

function pickDay(signals, maxNames) {
  const ranked = [...(signals || [])].sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0) || a.symbol.localeCompare(b.symbol));
  const taken = [];
  const seen = new Set();
  for (const s of ranked) {
    if (seen.has(s.symbol)) continue;
    seen.add(s.symbol);
    taken.push(s);
    if (taken.length >= maxNames) break;
  }
  return taken;
}

/**
 * Fill remaining slots as each print arrives — same as the live worker if it
 * had been scanning from 09:45. A later wider stop cannot replace an earlier fill.
 */
function pickDaySequential(signals, maxNames) {
  const list = signals || [];
  const cap = Math.max(0, Math.floor(Number(maxNames) || 0));
  if (!cap) return [];
  const times = [...new Set(list.map((s) => s.signalT))].sort((a, b) => String(a).localeCompare(String(b)));
  const taken = [];
  const seen = new Set();
  for (const t of times) {
    if (taken.length >= cap) break;
    const pool = list.filter((s) => String(s.signalT) <= String(t) && !seen.has(s.symbol));
    const picks = pickDay(pool, cap - taken.length);
    for (const p of picks) {
      seen.add(p.symbol);
      taken.push(p);
    }
  }
  return taken;
}

function canLiveFill(sig, symbolBars, capital, candidate) {
  const bars5 = (symbolBars[sig.symbol] && symbolBars[sig.symbol][sig.day]) || [];
  const print = (bars5 || []).find((b) => b.t === sig.signalT);
  const fill = print && Number(print.c) > 0 ? Number(print.c) : sig.entryPx;
  return (
    sizeQty({
      side: sig.side,
      fill,
      stopPx: sig.stopPx,
      capital,
      maxStocks: candidate.maxStocksPerDay,
      sizing: candidate.sizing || 'risk',
      buyPower: capital * BUY_POWER_MULT,
    }) > 0
  );
}

async function simulateDesk(symbolBars, candidate, capital) {
  if (candidate.family === 'orb_two_low' || candidate.family === 'orb_winner' || candidate.family === 'orb_original') {
    return { trades: orbTrades(symbolBars, candidate, capital), signals: [] };
  }
  const crowd = orCrosses(symbolBars);
  const raw =
    candidate.family === 'pdh_break'
      ? pdhSignals(symbolBars, candidate)
      : await collectSignals(symbolBars, candidate);
  const crowdFiltered = filterCrowd(raw, crowd, candidate.crowdFilter || null);
  const filtered =
    candidate.family === 'pdh_break'
      ? crowdFiltered.filter((sig) => canLiveFill(sig, symbolBars, capital, candidate))
      : crowdFiltered;
  const byDay = {};
  for (const s of filtered) (byDay[s.day] ||= []).push(s);
  const trades = [];
  const selected = [];
  const cfg = {
    capital,
    maxStocksPerDay: candidate.maxStocksPerDay,
    sizing: candidate.sizing || 'risk',
    timeExit: candidate.timeExit || '15:15',
    entryEnd: candidate.entryEnd || '14:30',
    targetR: candidate.targetR,
    slippage: candidate.slippage,
    buyPower: capital * 5,
    allowOpen: !!candidate.allowOpen,
  };
  for (const [day, list] of Object.entries(byDay)) {
    const picked = candidate.matchLiveScan
      ? pickDaySequential(list, candidate.maxStocksPerDay)
      : pickDay(list, candidate.maxStocksPerDay);
    selected.push(...picked);
    for (const sig of picked) {
      const bars5 = (symbolBars[sig.symbol] && symbolBars[sig.symbol][day]) || [];
      const trade = walkSignal(bars5, sig, {
        ...cfg,
        entryFill: candidate.entryFill,
        slippage: candidate.entryFill === 'signalClose' ? 0 : candidate.slippage,
      });
      if (trade) trades.push(trade);
    }
  }
  trades.sort((a, b) => a.day.localeCompare(b.day) || a.entryT.localeCompare(b.entryT) || a.symbol.localeCompare(b.symbol));
  return { trades, signals: selected };
}

function dailyBooks(trades, signals, days, capital) {
  return (days || []).map((day) => {
    const dayTrades = (trades || []).filter((t) => t.day === day);
    const daySigs = (signals || []).filter((s) => s.day === day);
    const net = dayTrades.reduce((s, t) => s + t.netRs, 0);
    const costs = dayTrades.reduce((s, t) => s + t.chargesRs, 0);
    const allocated = dayTrades.reduce((s, t) => s + (t.allocatedRs || t.notionalRs || 0), 0);
    const wins = dayTrades.filter((t) => t.netRs > 0);
    const losses = dayTrades.filter((t) => t.netRs < 0);
    return {
      day,
      capital,
      stocks: dayTrades.map((t) => ({
        symbol: t.symbol,
        side: t.side,
        reason: t.reason,
        entryT: t.entryT,
        exitT: t.exitT,
        exitReason: t.exitReason,
        entryPx: t.entryPx,
        stopPx: t.stopPx,
        tgtPx: t.tgtPx,
        qty: t.qty,
        allocatedRs: t.allocatedRs || t.notionalRs,
        netRs: t.netRs,
        chargesRs: t.chargesRs,
        riskRs: t.riskRs != null ? t.riskRs : Math.round(Math.abs(t.entryPx - t.stopPx) * t.qty * 100) / 100,
        promisedRs: t.promisedRs || 0,
      })),
      skipped: daySigs.filter((s) => !dayTrades.some((t) => t.symbol === s.symbol)),
      trades: dayTrades.length,
      winners: wins.length,
      losers: losses.length,
      grossPnl: Math.round((net + costs) * 100) / 100,
      costs: Math.round(costs * 100) / 100,
      netPnl: Math.round(net * 100) / 100,
      allocatedRs: Math.round(allocated * 100) / 100,
      worstTrade: losses.sort((a, b) => a.netRs - b.netRs)[0] || null,
      note: dayTrades.length
        ? 'Simulated fills from 5-minute history. Risk and reward are estimates, not guarantees.'
        : 'No name qualified under this method on this session.',
    };
  });
}

module.exports = { simulateDesk, filterCrowd, pickDay, pickDaySequential, dailyBooks };
