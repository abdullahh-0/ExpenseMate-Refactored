/**
 * Composition of the real data store: wires the PostgreSQL pool, the in-memory fallback and the
 * migration runner into one Database instance, and exposes the same functions the rest of the
 * application has always imported: query(), initDb() and getMemoryStore().
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { Pool } = require('pg');
const Database = require('./Database');
const MemoryDatabase = require('./MemoryDatabase');
const { buildConnectionConfig } = require('./config');
const { runPending } = require('./migrate');

const pool = new Pool(buildConnectionConfig());
// An idle client can fail (e.g. the server restarts); without a listener Node would crash the process.
pool.on('error', (err) => console.error('[db] idle PostgreSQL client error:', err.message));

const database = new Database({
  pool,
  memory: new MemoryDatabase(),
  migrate: runPending,
  seedPaths: [path.join(__dirname, '../../db/seed.sql'), path.join(__dirname, '../db/seed.sql')]
});

module.exports = {
  query: (text, params) => database.query(text, params),
  initDb: () => database.init(),
  getMemoryStore: () => database.getMemoryStore(),
  close: () => database.close(),
  database
};
