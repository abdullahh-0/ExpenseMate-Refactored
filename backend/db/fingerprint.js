/**
 * Prints a fingerprint of the ORIGINAL transaction/budget columns so a migration
 * can be verified: run before and after, the "core" hashes must be identical.
 * Usage: node db/fingerprint.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'expensemate_db'}`
});

const HASH_SQL = {
  transactions: `SELECT COUNT(*)::int AS rows, COALESCE(SUM(amount),0)::text AS total_amount,
      md5(COALESCE(string_agg(id||'|'||date||'|'||description||'|'||amount||'|'||type||'|'||COALESCE(category_id::text,'')||'|'||currency, ';' ORDER BY id),'')) AS core_hash
    FROM transactions`,
  budgets: `SELECT COUNT(*)::int AS rows, COALESCE(SUM(amount),0)::text AS total_amount,
      md5(COALESCE(string_agg(id||'|'||category_id||'|'||month||'|'||year||'|'||amount||'|'||currency, ';' ORDER BY id),'')) AS core_hash
    FROM budgets`,
  categories: `SELECT COUNT(*)::int AS rows, '-' AS total_amount,
      md5(COALESCE(string_agg(id||'|'||name||'|'||type, ';' ORDER BY id),'')) AS core_hash
    FROM categories`
};

(async () => {
  try {
    const out = {};
    for (const [table, sql] of Object.entries(HASH_SQL)) {
      out[table] = (await pool.query(sql)).rows[0];
    }
    console.table(out);
  } catch (e) {
    console.error('Fingerprint failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
