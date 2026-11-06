const Database = require('../../db/Database');
const { isUnavailableError } = Database;
const { buildConnectionConfig } = require('../../db/config');

const SEED_PATH = '/app/db/seed.sql';

function build({ pool, seedExists = true, categoryCount = 0, migrate } = {}) {
  const calls = [];
  const realPool = pool || {
    query: jest.fn(async (sql) => {
      calls.push(sql);
      if (/COUNT/.test(sql)) return { rows: [{ count: String(categoryCount) }] };
      return { rows: [{ ok: 1 }] };
    }),
    end: jest.fn(async () => {})
  };
  const memory = { query: jest.fn(() => ({ rows: [{ from: 'memory' }], rowCount: 1 })), getStore: jest.fn(() => ({ tables: true })) };
  const fs = { existsSync: jest.fn((p) => seedExists && p === SEED_PATH), readFileSync: jest.fn(() => 'INSERT INTO categories ...') };
  const logger = { log: jest.fn() };
  const migrateFn = migrate || jest.fn(async () => {});
  const db = new Database({ pool: pool === null ? null : realPool, memory, migrate: migrateFn, seedPaths: ['/nowhere', SEED_PATH], fs, logger });
  return { db, pool: realPool, memory, fs, logger, migrate: migrateFn, calls };
}

const refused = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });

describe('Database.init', () => {
  test('connects, migrates, seeds an empty database and reports ready', async () => {
    const { db, pool, migrate, fs, logger } = build({ categoryCount: 0 });
    await db.init();

    expect(pool.query).toHaveBeenNthCalledWith(1, 'SELECT 1');
    expect(migrate).toHaveBeenCalledWith(pool);
    expect(fs.readFileSync).toHaveBeenCalledWith(SEED_PATH, 'utf-8');
    expect(pool.query).toHaveBeenCalledWith('INSERT INTO categories ...');
    expect(logger.log).toHaveBeenCalledWith('PostgreSQL Connected & Database Ready.');
    expect(db.mode).toBe('postgres');
  });

  test('does not seed when categories already exist', async () => {
    const { db, fs } = build({ categoryCount: 15 });
    await db.init();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  test('skips seeding when no seed file exists', async () => {
    const { db, pool } = build({ seedExists: false });
    await db.init();
    expect(pool.query.mock.calls.map(([sql]) => sql)).toEqual(['SELECT 1']);
  });

  test('falls back to memory when the server cannot be reached', async () => {
    const pool = { query: jest.fn(async () => { throw refused(); }) };
    const { db, migrate, logger } = build({ pool });
    await db.init();

    expect(db.mode).toBe('memory');
    expect(migrate).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('PostgreSQL not accessible. Running on Memory Fallback mode.');
  });

  test('is in memory mode from the start when no pool was supplied', async () => {
    const { db, logger } = build({ pool: null });
    expect(db.mode).toBe('memory');
    await db.init();
    expect(logger.log).toHaveBeenCalledWith('PostgreSQL not accessible. Running on Memory Fallback mode.');
  });

  test('a failing migration is a real error: it is thrown, not hidden behind the memory fallback', async () => {
    const migrate = jest.fn(async () => { throw new Error('syntax error in 003.sql'); });
    const { db } = build({ migrate });
    await expect(db.init()).rejects.toThrow('syntax error in 003.sql');
    expect(db.mode).toBe('postgres');
  });

  test('an unexpected error while connecting (not "unreachable") is thrown', async () => {
    const pool = { query: jest.fn(async () => { throw Object.assign(new Error('permission denied'), { code: '42501' }); }) };
    const { db } = build({ pool });
    await expect(db.init()).rejects.toThrow('permission denied');
  });
});

describe('Database.query', () => {
  test('uses PostgreSQL in postgres mode', async () => {
    const { db, pool } = build();
    await db.query('SELECT * FROM t WHERE id = $1', [7]);
    expect(pool.query).toHaveBeenCalledWith('SELECT * FROM t WHERE id = $1', [7]);
  });

  test('uses the memory engine in memory mode', async () => {
    const { db, memory } = build({ pool: null });
    const out = await db.query('SELECT 1', []);
    expect(memory.query).toHaveBeenCalledWith('SELECT 1', []);
    expect(out.rows[0].from).toBe('memory');
  });

  test('REGRESSION: a failing query throws and does NOT silently switch the app to the memory store', async () => {
    const failing = jest.fn(async () => { throw Object.assign(new Error('violates check constraint'), { code: '23514' }); });
    const { db, memory } = build({ pool: { query: failing } });

    await expect(db.query('INSERT INTO transactions ...')).rejects.toThrow('violates check constraint');
    expect(db.mode).toBe('postgres');

    await expect(db.query('SELECT 1')).rejects.toThrow(); // still PostgreSQL, still real errors
    expect(memory.query).not.toHaveBeenCalled();
  });

  test('exposes the in-memory tables and closes the pool', async () => {
    const { db, pool } = build();
    expect(db.getMemoryStore()).toEqual({ tables: true });
    await db.close();
    expect(pool.end).toHaveBeenCalled();
    await expect(build({ pool: null }).db.close()).resolves.toBeUndefined();
  });
});

describe('isUnavailableError', () => {
  test.each([
    ['connection refused', refused(), true],
    ['wrong password', Object.assign(new Error('password authentication failed'), { code: '28P01' }), true],
    ['database does not exist', Object.assign(new Error('database "x" does not exist'), { code: '3D000' }), true],
    ['SQLSTATE class 08', Object.assign(new Error('connection failure'), { code: '08006' }), true],
    ['pool connect timeout (message only)', new Error('timeout exceeded when trying to connect'), true],
    ['AggregateError wrapping a refusal', Object.assign(new Error(''), { errors: [refused()] }), true],
    ['constraint violation', Object.assign(new Error('duplicate key'), { code: '23505' }), false],
    ['syntax error', Object.assign(new Error('syntax error'), { code: '42601' }), false],
    ['nothing', null, false]
  ])('%s -> %s', (_label, err, expected) => {
    expect(isUnavailableError(err)).toBe(expected);
  });
});

describe('buildConnectionConfig', () => {
  test('uses DATABASE_URL when present', () => {
    expect(buildConnectionConfig({ DATABASE_URL: 'postgres://u:p@h:1/d' }).connectionString).toBe('postgres://u:p@h:1/d');
  });

  test('builds the URL from the individual settings, with the documented defaults', () => {
    expect(buildConnectionConfig({}).connectionString).toBe('postgres://postgres:1234@localhost:5432/expensemate_db');
    expect(buildConnectionConfig({ DB_USER: 'me', DB_PASSWORD: 'x', DB_HOST: 'db', DB_PORT: '6543', DB_NAME: 'n' }).connectionString)
      .toBe('postgres://me:x@db:6543/n');
  });

  test('URL-encodes credentials so special characters cannot break the connection string', () => {
    expect(buildConnectionConfig({ DB_PASSWORD: 'p@ss/word' }).connectionString).toContain('p%40ss%2Fword');
  });

  test('keeps the pool timeouts', () => {
    expect(buildConnectionConfig({})).toMatchObject({ idleTimeoutMillis: 30000, connectionTimeoutMillis: 2000 });
  });
});
