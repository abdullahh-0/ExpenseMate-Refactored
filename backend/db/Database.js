/**
 * The application's single entry point to the data store.
 *
 * Responsibilities (and nothing else):
 *   - run queries on PostgreSQL, or on the in-memory fallback when PostgreSQL is unreachable
 *   - prepare the database once at start-up: connect, migrate, seed
 *
 * Collaborators (pool, memory engine, migration runner, file system, logger) are injected, so the
 * class can be unit-tested without a database server.
 *
 * Fail-over rule: the fallback to memory happens ONLY at start-up, and ONLY when the server cannot
 * be reached. A failing query (bad SQL, constraint violation, ...) is an ordinary error and is
 * thrown to the caller - it never silently moves the application onto fake data.
 */

// Error codes meaning "the server is not there / will not let us in", as opposed to "your query is wrong".
const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'EHOSTUNREACH',
  '28000', '28P01', // invalid authorisation / password authentication failed
  '3D000',          // database does not exist
  '57P01', '57P02', '57P03' // admin shutdown, crash shutdown, cannot connect now
]);

function isUnavailableError(err) {
  if (!err) return false;
  if (UNAVAILABLE_CODES.has(err.code)) return true;
  if (typeof err.code === 'string' && err.code.startsWith('08')) return true; // SQLSTATE class 08: connection exception
  if (Array.isArray(err.errors) && err.errors.some(isUnavailableError)) return true; // AggregateError (IPv4 + IPv6 attempts)
  return /timeout exceeded when trying to connect|connection terminated|ECONNREFUSED/i.test(String(err.message));
}

class Database {
  /**
   * @param {object} deps
   * @param {{query:Function, end?:Function}|null} deps.pool   PostgreSQL pool (null forces memory mode)
   * @param {{query:Function, getStore:Function}} deps.memory  in-memory engine
   * @param {(pool:object)=>Promise<any>} deps.migrate         brings the schema up to date
   * @param {string[]} [deps.seedPaths]                        candidate seed.sql locations (first that exists wins)
   * @param {{existsSync:Function, readFileSync:Function}} [deps.fs]
   * @param {{log:Function}} [deps.logger]
   */
  constructor({ pool, memory, migrate, seedPaths = [], fs = require('fs'), logger = console }) {
    this.pool = pool;
    this.memory = memory;
    this.migrate = migrate;
    this.seedPaths = seedPaths;
    this.fs = fs;
    this.logger = logger;
    this.useMemory = !pool;
  }

  /** 'postgres' or 'memory' - which engine is currently answering queries. */
  get mode() {
    return this.useMemory ? 'memory' : 'postgres';
  }

  /** Connects, migrates and seeds. Falls back to memory only if the server is unreachable. */
  async init() {
    if (this.useMemory) {
      this.logger.log('PostgreSQL not accessible. Running on Memory Fallback mode.');
      return;
    }

    try {
      await this.pool.query('SELECT 1');
    } catch (err) {
      if (!isUnavailableError(err)) throw err;
      this.useMemory = true;
      this.logger.log('PostgreSQL not accessible. Running on Memory Fallback mode.');
      return;
    }

    // From here on the server is reachable: a failure is a real problem and must be visible.
    await this.migrate(this.pool);
    await this.seedIfEmpty();
    this.logger.log('PostgreSQL Connected & Database Ready.');
  }

  /** Loads the seed script the first time, i.e. while the categories table is still empty. */
  async seedIfEmpty() {
    const seedPath = this.seedPaths.find((p) => this.fs.existsSync(p));
    if (!seedPath) return;

    const { rows } = await this.pool.query('SELECT COUNT(*) FROM categories');
    if (parseInt(rows[0].count, 10) === 0) {
      await this.pool.query(this.fs.readFileSync(seedPath, 'utf-8'));
    }
  }

  /** Runs one SQL statement on the active engine. Errors are thrown, never swallowed. */
  async query(text, params = []) {
    if (this.useMemory) return this.memory.query(text, params);
    return this.pool.query(text, params);
  }

  /** The in-memory tables (only meaningful in memory mode). */
  getMemoryStore() {
    return this.memory.getStore();
  }

  /** Releases the connection pool (lets scripts and test runners exit cleanly). */
  async close() {
    if (this.pool && typeof this.pool.end === 'function') await this.pool.end();
  }
}

module.exports = Database;
module.exports.isUnavailableError = isUnavailableError;
