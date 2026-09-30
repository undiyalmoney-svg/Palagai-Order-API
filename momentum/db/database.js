'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { SCHEMA } = require('./schema');

const DEFAULT_PATH = process.env.MOMENTUM_DB_PATH || path.join(__dirname, '..', '..', 'data', 'momentum', 'momentum.sqlite');

function openDatabase(file = DEFAULT_PATH) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

let shared = null;

function getDb() {
  if (!shared) shared = openDatabase();
  return shared;
}

function closeDb() {
  if (shared) {
    shared.close();
    shared = null;
  }
}

const json = (v) => (v === undefined ? null : JSON.stringify(v));
const parse = (s, fallback = null) => {
  if (s === null || s === undefined || s === '') return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

module.exports = { openDatabase, getDb, closeDb, json, parse, DEFAULT_PATH };
