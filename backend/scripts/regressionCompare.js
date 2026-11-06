/**
 * Regression check: does the refactored ExpenseMate still answer exactly like the Assignment 1 baseline?
 *
 * The script starts BOTH versions of the backend, each on its own freshly created PostgreSQL database,
 * sends them the same sequence of API requests (transactions, categories, budgets, dashboard) and
 * compares every response. Fields that legitimately differ between the versions are ignored:
 * `created_at` (timestamps) and `payment_method` (a column added by migration 002 in Assignment 2).
 *
 * Usage (from the backend folder of the refactored project):
 *   node scripts/regressionCompare.js <path-to-baseline-backend> [--edge]
 *   npm run regression:compare -- <path-to-baseline-backend> [--edge]
 *
 * --edge  also sends a few malformed requests that the baseline handled badly (for example a
 *         non-numeric id). Differences found there are listed as "intentional behaviour changes".
 *
 * Needs the same PostgreSQL credentials as the application (backend/.env or DATABASE_URL); it creates
 * and drops the databases expensemate_cmp_a1 and expensemate_cmp_a2.
 */
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { buildConnectionConfig } = require('../db/config');

const args = process.argv.slice(2);
const withEdge = args.includes('--edge');
const baselineDir = args.find((a) => !a.startsWith('--'));
const currentDir = path.join(__dirname, '..');

if (!baselineDir) {
  console.error('Usage: node scripts/regressionCompare.js <path-to-baseline-backend> [--edge]');
  process.exit(2);
}
if (typeof fetch !== 'function') {
  console.error('This script needs Node.js 18 or newer (global fetch).');
  process.exit(2);
}

const VERSIONS = [
  { name: 'A1 baseline', dir: path.resolve(baselineDir), db: 'expensemate_cmp_a1', port: 5101 },
  { name: 'A2 refactored', dir: currentDir, db: 'expensemate_cmp_a2', port: 5102 }
];

const baseUrl = new URL(buildConnectionConfig().connectionString);
const urlFor = (database) => {
  const u = new URL(baseUrl.href);
  u.pathname = `/${database}`;
  return u.href;
};

async function withAdmin(fn) {
  const client = new Client({ connectionString: urlFor('postgres') });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const recreateDatabases = () => withAdmin(async (c) => {
  for (const v of VERSIONS) {
    await c.query(`DROP DATABASE IF EXISTS ${v.db}`);
    await c.query(`CREATE DATABASE ${v.db}`);
  }
});
const dropDatabases = () => withAdmin(async (c) => {
  for (const v of VERSIONS) {
    for (let attempt = 1; attempt <= 6; attempt++) { // the server's connections may need a moment to close
      try { await c.query(`DROP DATABASE IF EXISTS ${v.db}`); break; } catch (e) {
        if (attempt === 6) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
});

function startServer(v) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(v.dir),
      env: { ...process.env, DATABASE_URL: urlFor(v.db), PORT: String(v.port) }
    });
    let output = '';
    const timer = setTimeout(() => reject(new Error(`${v.name} did not start in time:\n${output}`)), 30000);
    child.stdout.on('data', (d) => {
      output += d;
      if (output.includes('PostgreSQL not accessible')) { clearTimeout(timer); reject(new Error(`${v.name} could not reach PostgreSQL (it would use fake in-memory data).`)); }
      if (output.includes('EXPRESS SERVER RUNNING')) { clearTimeout(timer); resolve(child); }
    });
    child.stderr.on('data', (d) => { output += d; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`${v.name} exited early (code ${code}):\n${output}`)); });
  });
}

// ---------------------------------------------------------------------------- the request sequence
async function runSequence(base) {
  const results = [];
  const call = async (label, method, urlPath, body, edge = false) => {
    const res = await fetch(base + urlPath, {
      method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json;
    try { json = await res.json(); } catch (e) { json = '<non-json>'; }
    results.push({ label, edge, status: res.status, body: json });
    return json;
  };

  await call('list all', 'GET', '/api/transactions');
  await call('list filtered', 'GET', '/api/transactions?type=expense&currency=pkr&search=bulk&sort_by=amount');
  await call('list category + dates', 'GET', '/api/transactions?category_id=1&startDate=2026-02-01&endDate=2026-06-30');
  await call('list snake_case dates', 'GET', '/api/transactions?start_date=2026-02-01&end_date=2026-03-30&type=bogus');
  await call('categories (income)', 'GET', '/api/categories?type=income');

  const created = await call('create with category', 'POST', '/api/transactions', { date: '2026-11-06', description: '  Lunch with team  ', amount: '1250.5', type: 'expense', category_id: 1, currency: 'PKR' });
  const id = created.data && created.data.id;
  await call('create auto-categorised (Uber)', 'POST', '/api/transactions', { date: '2026-11-06', description: 'Uber ride to campus', amount: 800, type: 'expense' });
  await call('create auto-categorised (unknown)', 'POST', '/api/transactions', { date: '2026-11-06', description: 'zzz mystery spend', amount: 99, type: 'expense', currency: 'USD' });
  await call('create income (salary)', 'POST', '/api/transactions', { date: '2026-11-06', description: 'Monthly salary', amount: 150000, type: 'income' });
  await call('create invalid (all fields bad)', 'POST', '/api/transactions', { date: 'nope', description: ' ', amount: -5, type: 'x' });
  await call('update', 'PUT', `/api/transactions/${id}`, { date: '2026-11-07', description: 'Lunch edited', amount: 1300, type: 'expense', category_id: 2, currency: 'PKR' });
  await call('update unknown id', 'PUT', '/api/transactions/999999', { date: '2026-11-07', description: 'x', amount: 1, type: 'expense', category_id: 2 });
  await call('update invalid body', 'PUT', `/api/transactions/${id}`, { date: '', description: '', amount: 0, type: 'expense', category_id: 2 });
  await call('delete', 'DELETE', `/api/transactions/${id}`);
  await call('delete again', 'DELETE', `/api/transactions/${id}`);
  await call('suggest category (Uber)', 'POST', '/api/transactions/suggest-category', { description: 'Uber ride' });
  await call('suggest category (unknown)', 'POST', '/api/transactions/suggest-category', { description: 'qqq' });
  await call('suggest category (empty)', 'POST', '/api/transactions/suggest-category', {});

  await call('budgets: month', 'GET', '/api/budgets?month=9&year=2026&currency=PKR');
  await call('budgets: overall', 'GET', '/api/budgets?month=overall&year=2026&currency=PKR');
  await call('budgets: month=0 USD', 'GET', '/api/budgets?month=0&year=2026&currency=USD');
  await call('budgets: all', 'GET', '/api/budgets?month=all');
  await call('budgets: defaults', 'GET', '/api/budgets');
  await call('budgets: empty month', 'GET', '/api/budgets?month=11&year=2026&currency=PKR');
  const budget = await call('budget create', 'POST', '/api/budgets', { category_id: 9, month: 11, year: 2026, amount: 5000, currency: 'PKR' });
  await call('budget create (legacy amount_limit)', 'POST', '/api/budgets', { category_id: 6, month: 11, year: 2026, amount_limit: 3000 });
  await call('budget update (same key)', 'POST', '/api/budgets', { category_id: 9, month: 11, year: 2026, amount: 7000, currency: 'PKR' });
  await call('budget invalid (no amount)', 'POST', '/api/budgets', { category_id: 9 });
  await call('budget invalid (negative)', 'POST', '/api/budgets', { category_id: 9, amount: -4 });
  await call('budget invalid (no category)', 'POST', '/api/budgets', { amount: 100 });
  await call('budgets: after changes', 'GET', '/api/budgets?month=11&year=2026&currency=PKR');
  const budgetId = budget.data && budget.data.id;
  await call('budget delete', 'DELETE', `/api/budgets/${budgetId}`);
  await call('budget delete again', 'DELETE', `/api/budgets/${budgetId}`);

  // Warning thresholds: budget 100 per category, spending 79/80/89/90/99/100/150 (and a budget with no spending)
  for (const [cat, spent] of [[1, 79], [2, 80], [3, 89], [4, 90], [5, 99], [6, 100], [7, 150]]) {
    await call(`threshold budget (category ${cat})`, 'POST', '/api/budgets', { category_id: cat, month: 3, year: 2027, amount: 100, currency: 'EUR' });
    await call(`threshold spend ${spent}`, 'POST', '/api/transactions', { date: '2027-03-15', description: `boundary ${spent}`, amount: spent, type: 'expense', category_id: cat, currency: 'EUR' });
  }
  await call('threshold budget without spending', 'POST', '/api/budgets', { category_id: 8, month: 3, year: 2027, amount: 0.01, currency: 'EUR' });
  await call('threshold summary (month)', 'GET', '/api/budgets?month=3&year=2027&currency=EUR');
  await call('threshold summary (overall)', 'GET', '/api/budgets?month=overall&year=2027&currency=EUR');

  await call('dashboard', 'GET', '/api/dashboard?month=9&year=2026&currency=PKR');
  await call('health', 'GET', '/api/health');

  if (withEdge) {
    await call('edge: transaction payment method not allowed', 'POST', '/api/transactions', { date: '2026-11-06', description: 'x', amount: 1, type: 'expense', payment_method: 'Barter' }, true);
    await call('edge: delete transaction with non-numeric id', 'DELETE', '/api/transactions/abc', undefined, true);
    await call('edge: update transaction with non-numeric id', 'PUT', '/api/transactions/abc', { date: '2026-11-07', description: 'x', amount: 1, type: 'expense', category_id: 2 }, true);
    await call('edge: update transaction without category', 'PUT', '/api/transactions/1', { date: '2026-11-07', description: 'x', amount: 1, type: 'expense' }, true);
    await call('edge: list with non-numeric category filter', 'GET', '/api/transactions?category_id=abc', undefined, true);
    await call('edge: budget with non-numeric amount', 'POST', '/api/budgets', { category_id: 9, amount: 'abc' }, true);
    await call('edge: delete budget with non-numeric id', 'DELETE', '/api/budgets/abc', undefined, true);
  }
  return results;
}

// ---------------------------------------------------------------------------- comparison
const IGNORED_KEYS = new Set(['created_at', 'payment_method']);
// Canonical JSON: ignored fields removed and object keys sorted, because PostgreSQL does not guarantee
// the order of GROUP BY rows, so equal objects could otherwise be written with their keys in a different order.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().filter((k) => !IGNORED_KEYS.has(k)).reduce((out, k) => ({ ...out, [k]: canonical(value[k]) }), {});
  }
  return value;
}
const normalise = (value) => JSON.stringify(canonical(value));

async function main() {
  const servers = [];
  try {
    await recreateDatabases();
    for (const v of VERSIONS) servers.push(await startServer(v));
    console.log('Both versions are running on their own PostgreSQL databases.\n');

    const outcomes = [];
    for (const v of VERSIONS) outcomes.push(await runSequence(`http://localhost:${v.port}`));
    const [first, second] = outcomes;

    let core = 0, coreSame = 0;
    const intentional = [];
    first.forEach((x, i) => {
      const y = second[i];
      const same = x.status === y.status && normalise(x.body) === normalise(y.body);
      if (x.edge) {
        if (!same) intentional.push(`${x.label}: A1 returned ${x.status}, A2 returns ${y.status}`);
        return;
      }
      core++;
      if (same) coreSame++;
      console.log(`${same ? 'SAME' : 'DIFF'}  ${x.label}${same ? '' : `  (A1 ${x.status}, A2 ${y.status})`}`);
    });

    console.log(`\nCore requests: ${coreSame} of ${core} gave identical responses (status code and body).`);
    if (withEdge) {
      console.log(`\nEdge requests (malformed input) that now behave differently: ${intentional.length}`);
      intentional.forEach((line) => console.log(`  - ${line}`));
    }
    process.exitCode = coreSame === core ? 0 : 1;
  } finally {
    servers.forEach((s) => s.kill());
    await new Promise((r) => setTimeout(r, 500));
    try { await dropDatabases(); } catch (e) { /* best effort clean-up */ }
  }
}

main().catch((err) => { console.error(`\nRegression check could not run: ${err.message}`); process.exit(2); });
