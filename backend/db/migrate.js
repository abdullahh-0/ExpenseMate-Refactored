/**
 * Minimal versioned migration runner for ExpenseMate.
 *
 * Migration files live in <repo>/db/migrations and are named NNN_description.sql
 * (optional rollback: NNN_description.down.sql). Applied versions are recorded in the
 * schema_migrations table together with a checksum, so every environment can be brought
 * to the same schema with one repeatable command.
 *
 *   node db/migrate.js up       apply all pending migrations (default)
 *   node db/migrate.js status   show applied / pending migrations
 *   node db/migrate.js down     roll back the most recently applied migration
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DIR = path.join(__dirname, '../../db/migrations');
const FILE_PATTERN = /^(\d+)_([a-z0-9_]+)\.sql$/;
const LOCK_KEY = 727274; // arbitrary constant for pg_advisory_lock

// Line endings are normalised so the checksum is identical on Windows (CRLF) and Linux (LF).
function checksum(sql) {
  return crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

function listMigrations(dir = DEFAULT_DIR) {
  const migrations = [];
  for (const file of fs.readdirSync(dir)) {
    const match = FILE_PATTERN.exec(file);
    if (!match) continue; // ignores *.down.sql and anything else
    const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
    migrations.push({ version: parseInt(match[1], 10), name: match[2], file, sql, checksum: checksum(sql) });
  }
  migrations.sort((a, b) => a.version - b.version);
  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i].version === migrations[i - 1].version) {
      throw new Error(`Duplicate migration version ${migrations[i].version}`);
    }
  }
  return migrations;
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INT PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      checksum   CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
}

async function getApplied(client) {
  const res = await client.query('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version');
  return new Map(res.rows.map((r) => [r.version, r]));
}

// Runs `fn(client)` while holding a DB-wide lock so two processes never migrate at once.
async function withLock(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureTable(client);
    return await fn(client);
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch (e) { /* connection already gone */ }
    client.release();
  }
}

async function runPending(pool, { dir = DEFAULT_DIR, log = () => {} } = {}) {
  const migrations = listMigrations(dir);
  return withLock(pool, async (client) => {
    const applied = await getApplied(client);

    for (const m of migrations) {
      const done = applied.get(m.version);
      if (done && done.checksum !== m.checksum) {
        throw new Error(`Migration ${m.file} was modified after it was applied. Create a new migration instead.`);
      }
    }

    const ran = [];
    for (const m of migrations.filter((x) => !applied.has(x.version))) {
      log(`Applying ${m.file} ...`);
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [m.version, m.name, m.checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.file} failed and was rolled back: ${err.message}`);
      }
      ran.push(m.file);
    }
    return ran;
  });
}

async function status(pool, { dir = DEFAULT_DIR } = {}) {
  const migrations = listMigrations(dir);
  return withLock(pool, async (client) => {
    const applied = await getApplied(client);
    return migrations.map((m) => ({
      version: m.version,
      file: m.file,
      state: applied.has(m.version) ? 'applied' : 'pending',
      applied_at: applied.has(m.version) ? applied.get(m.version).applied_at : null
    }));
  });
}

async function rollbackLast(pool, { dir = DEFAULT_DIR, log = () => {} } = {}) {
  return withLock(pool, async (client) => {
    const applied = await getApplied(client);
    if (applied.size === 0) return null;
    const last = Math.max(...applied.keys());
    const record = applied.get(last);
    const downFile = `${String(last).padStart(3, '0')}_${record.name}.down.sql`;
    const downPath = path.join(dir, downFile);
    if (!fs.existsSync(downPath)) throw new Error(`No rollback script found: ${downFile}`);
    log(`Rolling back ${downFile} ...`);
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(downPath, 'utf-8'));
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [last]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Rollback ${downFile} failed and was rolled back: ${err.message}`);
    }
    return downFile;
  });
}

// ---- command-line entry point ----
async function main() {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      `postgres://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'expensemate_db'}`
  });
  const command = process.argv[2] || 'up';
  try {
    if (command === 'up') {
      const ran = await runPending(pool, { log: console.log });
      console.log(ran.length ? `Applied ${ran.length} migration(s).` : 'Database is up to date.');
    } else if (command === 'status') {
      console.table(await status(pool));
    } else if (command === 'down') {
      const file = await rollbackLast(pool, { log: console.log });
      console.log(file ? `Rolled back ${file}.` : 'Nothing to roll back.');
    } else {
      console.error(`Unknown command "${command}". Use: up | status | down`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) main();

module.exports = { listMigrations, checksum, runPending, status, rollbackLast, FILE_PATTERN };
