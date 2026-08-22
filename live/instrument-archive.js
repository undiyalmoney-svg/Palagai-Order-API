/**
 * Historical NFO Nifty instrument-token archive.
 *
 * Kite's /instruments snapshot only lists currently-listed (non-expired)
 * contracts. resolveAtmWeeklyOption (option-chain.util.ts) deliberately
 * only matches a contract whose expiry is within ~10 days of the historical
 * date being replayed — by design, so a backtest never binds an old signal
 * to whatever far-future weekly happens to still be live today. That means
 * a signal from N weeks ago needs the row that was actually front-week
 * back then, which drops out of today's /instruments once it expires.
 *
 * This archive captures each day's live NFO Nifty option/future rows so
 * that, once a contract has been seen here at least once while it was
 * still live, it stays resolvable for historical replay after it expires.
 * Forward-accumulating only — it cannot recover contracts that expired
 * before this archive started running.
 */
const { getDb } = require('./live.mongo');

const COLLECTION = 'nfo_instrument_archive';

/** In-memory fallback when Mongo isn't configured (session-only, no persistence). */
const memoryArchive = new Map();

function keyFor(row) {
  return String(row.tradingSymbol || '').toUpperCase();
}

function isNiftyNfoRow(row) {
  if (!row || row.exchange !== 'NFO') return false;
  const type = String(row.instrumentType || '').toUpperCase();
  if (type !== 'CE' && type !== 'PE' && type !== 'FUT') return false;
  const sym = String(row.tradingSymbol || '').toUpperCase();
  const name = String(row.name || '').toUpperCase();
  if (sym.startsWith('BANKNIFTY') || name === 'BANKNIFTY') return false;
  if (sym.startsWith('FINNIFTY') || name === 'FINNIFTY') return false;
  if (sym.startsWith('MIDCPNIFTY') || name === 'MIDCPNIFTY') return false;
  if (sym.startsWith('NIFTYNXT')) return false;
  return sym.startsWith('NIFTY') || name === 'NIFTY';
}

/** Upsert today's live Nifty NFO rows into the archive. Never throws. */
async function archiveInstruments(rows) {
  const niftyRows = (rows || []).filter(isNiftyNfoRow);
  if (!niftyRows.length) return { archived: 0 };
  try {
    const db = getDb();
    if (db) {
      const col = db.collection(COLLECTION);
      const ops = niftyRows.map((r) => ({
        updateOne: {
          filter: { tradingSymbol: r.tradingSymbol },
          update: { $set: { ...r, archivedAt: new Date() } },
          upsert: true,
        },
      }));
      const res = await col.bulkWrite(ops, { ordered: false });
      return { archived: (res.upsertedCount || 0) + (res.modifiedCount || 0) };
    }
    for (const r of niftyRows) {
      memoryArchive.set(keyFor(r), r);
    }
    return { archived: niftyRows.length };
  } catch (err) {
    console.warn('[instrument-archive] archive failed:', err.message);
    return { archived: 0, error: err.message };
  }
}

/**
 * Merge archived rows behind today's live rows (live wins on tradingSymbol
 * conflict) so resolveAtmWeeklyOption can match both current and
 * long-expired Nifty contracts by their real expiry date.
 */
async function instrumentsWithArchive(liveInstruments) {
  const seen = new Set((liveInstruments || []).map((r) => keyFor(r)));
  const merged = [...(liveInstruments || [])];
  try {
    const db = getDb();
    if (db) {
      const col = db.collection(COLLECTION);
      const archived = await col.find({}).toArray();
      for (const r of archived) {
        const k = keyFor(r);
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(r);
      }
    } else {
      for (const r of memoryArchive.values()) {
        const k = keyFor(r);
        if (seen.has(k)) continue;
        merged.push(r);
      }
    }
  } catch (err) {
    console.warn('[instrument-archive] merge failed, using live-only instruments:', err.message);
  }
  return merged;
}

module.exports = { archiveInstruments, instrumentsWithArchive, isNiftyNfoRow };
