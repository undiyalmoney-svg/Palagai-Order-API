/**
 * Shared Mongo for additive features (Live + P/L records).
 * Does not affect /api/kite order routes.
 */
let cached = null;

async function connectMongo() {
  if (cached?.db) {
    return cached;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('[mongo] MONGODB_URI not set — Live/P&L using in-memory where supported');
    return null;
  }
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri);
  await client.connect();
  const dbName = process.env.MONGODB_DB || 'palagai';
  const db = client.db(dbName);
  cached = { client, db };
  console.log(`[mongo] connected db=${dbName}`);
  return cached;
}

function getDb() {
  return cached?.db || null;
}

module.exports = { connectMongo, getDb };
