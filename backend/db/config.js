/**
 * Database connection settings, read from environment variables (see .env.example).
 * Kept separate from the Database class so the settings can be tested without a server.
 */
function buildConnectionConfig(env = process.env) {
  const user = env.DB_USER || 'postgres';
  const password = env.DB_PASSWORD || '1234';
  const host = env.DB_HOST || 'localhost';
  const port = env.DB_PORT || 5432;
  const name = env.DB_NAME || 'expensemate_db';

  const fallbackUrl = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;

  return {
    connectionString: env.DATABASE_URL || fallbackUrl,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  };
}

module.exports = { buildConnectionConfig };
