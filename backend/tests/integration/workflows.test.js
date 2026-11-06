/**
 * Integration / system tests: complete ExpenseMate workflows driven through the real HTTP API
 * (routes -> controllers -> services -> repositories -> database), no mocks.
 *
 * All data created here uses the description prefix "IT-" and the year 2031, so it can never be
 * confused with real data and is removed again afterwards. Tests marked "PostgreSQL only" depend on
 * real SQL behaviour (foreign keys, aggregation) and return early when the app runs on the in-memory
 * fallback database (they are not meaningful there).
 */
const request = require('supertest');
const app = require('../../server');
const { database, query, close } = require('../../db/connection');

const YEAR = 2031;
const MONTH = 7;
const CURRENCY = 'EUR';

let categoryId; // name -> id, looked up once so the tests do not depend on seed ordering

const post = (path, body) => request(app).post(path).send(body);
const expense = (description, amount, category, extra = {}) => ({
  date: `${YEAR}-0${MONTH}-15`,
  description: `IT-${description}`,
  amount,
  type: 'expense',
  category_id: category,
  currency: CURRENCY,
  ...extra
});
const findTransactions = async (search, extraQuery = '') =>
  (await request(app).get(`/api/transactions?search=${encodeURIComponent(search)}${extraQuery}`)).body.data;
const budgetRow = async (category, currency = CURRENCY) => {
  const res = await request(app).get(`/api/budgets?month=${MONTH}&year=${YEAR}&currency=${currency}`);
  return res.body.data.find((b) => b.category_id === category);
};

/** Removes this suite's own data (also run first, in case an earlier run was interrupted). */
const cleanUp = async () => {
  await query("DELETE FROM transactions WHERE description LIKE 'IT-%'");
  await query(`DELETE FROM budgets WHERE year = ${YEAR}`);
};

beforeAll(async () => {
  await app.ready;
  await cleanUp();
  const categories = (await request(app).get('/api/categories')).body.data;
  categoryId = Object.fromEntries(categories.map((c) => [c.name, c.id]));
});

afterAll(async () => {
  await cleanUp();
  await close();
});

describe('Workflow 1: expense lifecycle (add -> find -> edit -> delete)', () => {
  test('a transaction can be added, found by search, edited, deleted, and is then gone', async () => {
    const created = await post('/api/transactions', expense('W1 Team lunch', 1250, categoryId.Food, { payment_method: 'Mobile Wallet' }));
    expect(created.statusCode).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.payment_method).toBe('Mobile Wallet');

    const found = await findTransactions('IT-W1');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id, description: 'IT-W1 Team lunch', category_name: 'Food' });

    const edited = await request(app).put(`/api/transactions/${id}`).send(
      expense('W1 Team lunch (edited)', 1300, categoryId.Transport, { payment_method: 'Credit Card' })
    );
    expect(edited.statusCode).toBe(200);
    const [afterEdit] = await findTransactions('IT-W1');
    expect(Number(afterEdit.amount)).toBe(1300);
    expect(afterEdit).toMatchObject({ category_name: 'Transport', payment_method: 'Credit Card' });

    expect((await request(app).delete(`/api/transactions/${id}`)).statusCode).toBe(200);
    expect(await findTransactions('IT-W1')).toHaveLength(0);
    expect((await request(app).delete(`/api/transactions/${id}`)).statusCode).toBe(404);
  });
});

describe('Workflow 2: monthly budget warning ladder', () => {
  test('spending moves a budget through NORMAL -> WARNING -> CRITICAL -> EXCEEDED, and deleting spending moves it back', async () => {
    const food = categoryId.Food;
    const set = await post('/api/budgets', { category_id: food, month: MONTH, year: YEAR, amount: 1000, currency: CURRENCY });
    expect(set.statusCode).toBe(201);

    expect(await budgetRow(food)).toMatchObject({ spent: 0, percentage: 0, status: 'NORMAL' });

    const first = await post('/api/transactions', expense('W2 groceries', 800, food));
    expect(await budgetRow(food)).toMatchObject({ spent: 800, percentage: 80, status: 'WARNING' });

    await post('/api/transactions', expense('W2 more groceries', 100, food));
    expect(await budgetRow(food)).toMatchObject({ spent: 900, percentage: 90, status: 'CRITICAL' });

    const last = await post('/api/transactions', expense('W2 even more groceries', 100, food));
    expect(await budgetRow(food)).toMatchObject({ spent: 1000, percentage: 100, status: 'EXCEEDED', remaining: 0 });

    await request(app).delete(`/api/transactions/${last.body.data.id}`);
    expect(await budgetRow(food)).toMatchObject({ spent: 900, status: 'CRITICAL' });

    // Raising the limit re-evaluates the same spending (upsert: same key, new amount)
    await post('/api/budgets', { category_id: food, month: MONTH, year: YEAR, amount: 2000, currency: CURRENCY });
    expect(await budgetRow(food)).toMatchObject({ amount: 2000, spent: 900, percentage: 45, status: 'NORMAL' });
    expect(first.statusCode).toBe(201);
  });
});

describe('Workflow 3: automatic categorisation end to end', () => {
  test('a transaction created without a category gets one from the classifier and is findable by it', async () => {
    const created = await post('/api/transactions', {
      date: `${YEAR}-0${MONTH}-10`, description: 'IT-W3 Uber ride to campus', amount: 800, type: 'expense', currency: CURRENCY
    });
    expect(created.statusCode).toBe(201);
    expect(created.body.data.category_id).toBe(categoryId.Transport);

    const inCategory = await findTransactions('IT-W3', `&category_id=${categoryId.Transport}`);
    expect(inCategory.map((t) => t.description)).toContain('IT-W3 Uber ride to campus');
  });

  test('words that merely contain a keyword are not misclassified ("Concert" is not Education)', async () => {
    const created = await post('/api/transactions', {
      date: `${YEAR}-0${MONTH}-10`, description: 'IT-W3 Concert tickets', amount: 5000, type: 'expense', currency: CURRENCY
    });
    expect(created.body.data.category_id).toBe(categoryId.Entertainment);
  });
});

describe('Workflow 4: CSV import (preview -> confirm -> visible in the list)', () => {
  const csv = [
    'Date,Description,Type,Amount,Currency',
    `${YEAR}-07-01,IT-W4 Concert tickets,expense,1500,${CURRENCY}`,
    `${YEAR}-07-02,IT-W4 Business revenue,income,5000,${CURRENCY}`,
    `${YEAR}-07-03,IT-W4 broken row,expense,-5,${CURRENCY}`
  ].join('\n');

  test('valid rows are categorised and imported, invalid rows are reported and skipped', async () => {
    const preview = await request(app).post('/api/import/preview').attach('file', Buffer.from(csv), 'it-import.csv');
    expect(preview.statusCode).toBe(200);
    expect(preview.body.summary).toEqual({ totalRows: 3, validCount: 2, invalidCount: 1 });
    expect(preview.body.invalidRecords[0].errors).toContain('Amount must be greater than zero');

    const byDescription = Object.fromEntries(preview.body.validRecords.map((r) => [r.description, r.category]));
    expect(byDescription['IT-W4 Concert tickets']).toBe('Entertainment');
    expect(byDescription['IT-W4 Business revenue']).toBe('Business');

    const confirm = await post('/api/import/confirm', { validRecords: preview.body.validRecords });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.body.importedCount).toBe(2);

    const imported = await findTransactions('IT-W4');
    expect(imported).toHaveLength(2);
    expect(imported.map((t) => t.category_name).sort()).toEqual(['Business', 'Entertainment']);
  });

  test('an unsupported file type is rejected with a clear message', async () => {
    const res = await request(app).post('/api/import/preview').attach('file', Buffer.from('x'), 'notes.txt');
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Unsupported file format/);
  });
});

describe('Workflow 5: currencies are kept apart', () => {
  test('spending in one currency does not affect a budget in another', async () => {
    const shopping = categoryId.Shopping;
    await post('/api/budgets', { category_id: shopping, month: MONTH, year: YEAR, amount: 100, currency: 'EUR' });
    await post('/api/budgets', { category_id: shopping, month: MONTH, year: YEAR, amount: 100, currency: 'USD' });
    await post('/api/transactions', expense('W5 shoes', 85, shopping, { currency: 'EUR' }));

    expect(await budgetRow(shopping, 'EUR')).toMatchObject({ spent: 85, status: 'WARNING' });
    expect(await budgetRow(shopping, 'USD')).toMatchObject({ spent: 0, status: 'NORMAL' });
  });
});

describe('Workflow 6: invalid input is rejected and nothing is stored', () => {
  test.each([
    ['negative amount', { amount: -5 }],
    ['zero amount', { amount: 0 }],
    ['bad date', { date: 'not-a-date' }],
    ['unknown type', { type: 'transfer' }],
    ['unknown payment method', { payment_method: 'Barter' }]
  ])('%s -> 400 and no row is created', async (_label, override) => {
    const res = await post('/api/transactions', { ...expense('W6 invalid', 10, categoryId.Food), ...override });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(await findTransactions('IT-W6')).toHaveLength(0);
  });

  test('a budget without a positive amount is rejected', async () => {
    expect((await post('/api/budgets', { category_id: categoryId.Food })).statusCode).toBe(400);
    expect((await post('/api/budgets', { category_id: categoryId.Food, amount: -4 })).statusCode).toBe(400);
  });
});

describe('Workflow 7: a database error is reported honestly (PostgreSQL only)', () => {
  test('a foreign-key failure returns an error and real data stays intact (no silent switch to fake data)', async () => {
    if (database.mode !== 'postgres') return;
    const kept = await post('/api/transactions', expense('W7 survivor', 77, categoryId.Food));
    expect(kept.statusCode).toBe(201);

    const bad = await post('/api/transactions', expense('W7 bad category', 10, 99999));
    expect(bad.statusCode).toBe(500);
    expect(bad.body).toEqual({ success: false, message: 'Unable to save transaction.' });

    expect(database.mode).toBe('postgres');
    const survivors = await findTransactions('IT-W7');
    expect(survivors.map((t) => t.description)).toEqual(['IT-W7 survivor']); // still real rows, bad one not stored
  });
});

describe('Workflow 8: dashboard and export reflect new data (PostgreSQL only)', () => {
  test('the monthly dashboard totals and the CSV export include a new transaction', async () => {
    if (database.mode !== 'postgres') return;
    await post('/api/transactions', expense('W8 spend', 400, categoryId.Bills));
    await post('/api/transactions', { ...expense('W8 pay', 1000, categoryId.Salary), type: 'income' });

    const dash = await request(app).get(`/api/dashboard?month=${MONTH}&year=${YEAR}&currency=${CURRENCY}`);
    expect(dash.statusCode).toBe(200);
    expect(dash.body.data).toMatchObject({ selectedCurrency: CURRENCY, selectedMonth: MONTH, selectedYear: YEAR });
    expect(dash.body.data.monthSpent).toBeGreaterThanOrEqual(400);
    expect(dash.body.data.monthIncome).toBeGreaterThanOrEqual(1000);
    expect(dash.body.data.recentTransactions.map((t) => t.description)).toEqual(expect.arrayContaining(['IT-W8 spend']));

    const exported = await request(app).get('/api/export/csv');
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toMatch(/text\/csv/);
    expect(exported.text).toContain('IT-W8 spend');
  });
});
