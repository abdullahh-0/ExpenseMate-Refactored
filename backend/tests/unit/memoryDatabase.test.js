const MemoryDatabase = require('../../db/MemoryDatabase');
const TransactionRepository = require('../../repositories/transactionRepository');
const CategoryRepository = require('../../repositories/categoryRepository');
const BudgetRepository = require('../../repositories/budgetRepository');

const fresh = () => new MemoryDatabase();
/** Adapts the synchronous engine to the async `db.query` contract the repositories expect. */
const asDb = (memory) => ({ query: async (sql, params) => memory.query(sql, params) });

describe('MemoryDatabase: categories', () => {
  test('selects by type and sorts by name when asked', () => {
    const { rows } = fresh().query('SELECT * FROM categories WHERE type = $1 ORDER BY name ASC', ['income']);
    expect(rows.map((c) => c.name)).toEqual(['Business', 'Freelance', 'Investment', 'Other Income', 'Salary']);
  });

  test('looks a category up by lower-cased name', () => {
    const { rows } = fresh().query('SELECT id, name, type FROM categories WHERE LOWER(name) = $1', ['food']);
    expect(rows).toEqual([{ id: 1, name: 'Food', type: 'expense' }]);
  });

  test('insert creates a new category with the next id', () => {
    const memory = fresh();
    const { rows } = memory.query('INSERT INTO categories (name, type) VALUES ($1, $2) RETURNING id', ['Pets', 'expense']);
    expect(rows[0]).toMatchObject({ id: 16, name: 'Pets', type: 'expense' });
  });

  test('insert of an existing name (any case) returns the existing row instead of a duplicate', () => {
    const memory = fresh();
    const { rows } = memory.query('INSERT INTO categories (name, type) VALUES ($1, $2) RETURNING id', ['FOOD', 'expense']);
    expect(rows[0].id).toBe(1);
    expect(memory.getStore().categories).toHaveLength(15);
  });
});

describe('MemoryDatabase: transactions (through the real TransactionRepository)', () => {
  const tx = (over = {}) => ({
    date: '2026-09-10', description: 'Lunch', amount: 500, type: 'expense',
    categoryId: 1, currency: 'PKR', paymentMethod: 'Cash', ...over
  });

  test('create stores the row and update/delete work on it', async () => {
    const repo = new TransactionRepository(asDb(fresh()));
    const created = await repo.create(tx());
    expect(created).toMatchObject({ id: 6, description: 'Lunch', amount: 500, payment_method: 'Cash' });

    const updated = await repo.update(6, tx({ description: 'Dinner', amount: 900 }));
    expect(updated).toMatchObject({ id: 6, description: 'Dinner', amount: 900 });

    expect(await repo.delete(6)).toBe(true);
    expect(await repo.delete(6)).toBe(false);
  });

  test('update of an unknown id returns null', async () => {
    const repo = new TransactionRepository(asDb(fresh()));
    expect(await repo.update(999, tx())).toBeNull();
  });

  test('findAll applies every filter the repository can send', async () => {
    const repo = new TransactionRepository(asDb(fresh()));
    await repo.create(tx({ description: 'Pizza night', amount: 1200, date: '2026-09-20' }));
    await repo.create(tx({ description: 'Salary bonus', amount: 9000, type: 'income', categoryId: 11, date: '2026-09-21' }));

    const names = async (filters) => (await repo.findAll(filters)).map((t) => t.description);

    expect(await names({ search: 'pizza' })).toEqual(['Pizza night']);
    expect(await names({ type: 'income', startDate: '2026-09-21' })).toEqual(['Salary bonus']);
    expect(await names({ categoryId: 11, currency: 'PKR' })).toEqual(['Salary bonus', 'Software Engineer Salary']);
    expect(await names({ endDate: '2026-09-02' })).toEqual(['Monthly Apartment Rent', 'Software Engineer Salary']);
  });

  test('findAll orders by date (default) or by amount, newest id first on ties, and adds category fields', async () => {
    const repo = new TransactionRepository(asDb(fresh()));
    const byDate = await repo.findAll();
    expect(byDate.map((t) => t.id)).toEqual([5, 4, 3, 2, 1]);

    const byAmount = await repo.findAll({ sortBy: 'amount' });
    expect(byAmount[0]).toMatchObject({ id: 1, amount: 150000, category_name: 'Salary', category_type: 'income' });
  });
});

describe('MemoryDatabase: budgets (through the real BudgetRepository)', () => {
  test('limits for a month are filtered by month/year/currency and sorted by amount', async () => {
    const repo = new BudgetRepository(asDb(fresh()));
    const rows = await repo.findLimitsForMonth({ month: 9, year: 2026, currency: 'USD' });
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ category_name: 'Rent', amount: 1500 });
    expect(await repo.findLimitsForMonth({ month: 10, year: 2026, currency: 'USD' })).toEqual([]);
  });

  test('limits for a year are summed per category', async () => {
    const memory = fresh();
    const repo = new BudgetRepository(asDb(memory));
    await repo.insert({ categoryId: 8, month: 10, year: 2026, amount: 1000, currency: 'PKR' });
    await repo.insert({ categoryId: 8, month: 1, year: 2025, amount: 777, currency: 'PKR' }); // other year: must be ignored
    const rows = await repo.findLimitsForYear({ year: 2026, currency: 'PKR' });
    expect(rows.find((r) => r.category_id === 8)).toMatchObject({ category_name: 'Rent', amount: 451000, currency: 'PKR' });
  });

  test('expense totals per category, for a month and for a year', async () => {
    const repo = new BudgetRepository(asDb(fresh()));
    const month = await repo.sumExpensesByCategoryForMonth({ month: 9, year: 2026, currency: 'PKR' });
    expect(month).toEqual(expect.arrayContaining([
      { category_id: 8, total_spent: 45000 }, { category_id: 1, total_spent: 18500 }, { category_id: 2, total_spent: 8500 }
    ]));
    expect(await repo.sumExpensesByCategoryForMonth({ month: 1, year: 2026, currency: 'PKR' })).toEqual([]);
    expect(await repo.sumExpensesByCategoryForYear({ year: 2026, currency: 'PKR' })).toHaveLength(3);
  });

  test('find / update / insert / delete form a working upsert cycle (update used to return nothing)', async () => {
    const repo = new BudgetRepository(asDb(fresh()));
    const key = { categoryId: 6, month: 9, year: 2026, currency: 'PKR' };

    expect(await repo.findIdByKey(key)).toBeNull();
    const inserted = await repo.insert({ ...key, amount: 5000 });
    expect(inserted).toMatchObject({ id: 13, amount: 5000 });

    expect(await repo.findIdByKey(key)).toEqual({ id: 13 });
    expect(await repo.updateAmount(13, 7500)).toMatchObject({ id: 13, amount: 7500 });
    expect(await repo.updateAmount(999, 1)).toBeUndefined();

    await repo.delete(13);
    expect(await repo.findIdByKey(key)).toBeNull();
  });
});

describe('MemoryDatabase: general behaviour', () => {
  test('categories repository works against it', async () => {
    const repo = new CategoryRepository(asDb(fresh()));
    expect(await repo.findByName('Food')).toEqual({ id: 1, name: 'Food', type: 'expense' });
    expect(await repo.findByLowerName('rent')).toMatchObject({ id: 8 });
    expect(await repo.create({ name: 'Pets', type: 'expense' })).toMatchObject({ id: 16 });
  });

  test('unsupported SQL yields an empty result and is recorded, instead of returning fake rows', () => {
    const memory = fresh();
    const out = memory.query('SELECT SUM(amount) FROM transactions GROUP BY currency');
    expect(out).toEqual({ rows: [], rowCount: 0 });
    expect(memory.unsupported).toHaveLength(1);
  });

  test('each instance owns its data (no shared module-level state)', () => {
    const a = fresh();
    const b = fresh();
    a.query('DELETE FROM transactions WHERE id = $1', [1]);
    expect(a.getStore().transactions).toHaveLength(4);
    expect(b.getStore().transactions).toHaveLength(5);
  });

  test('every supported statement is registered by name', () => {
    expect(MemoryDatabase.HANDLER_NAMES).toEqual(expect.arrayContaining([
      'category.insert', 'transaction.list', 'budget.updateAmount', 'budget.delete'
    ]));
  });
});

describe('MemoryDatabase: clearing transactions', () => {
  test('DELETE FROM transactions without WHERE removes every row and reports the count', () => {
    const memory = fresh();
    const total = memory.query('SELECT t.*, c.name AS category_name, c.type AS category_type FROM transactions t LEFT JOIN categories c ON t.category_id = c.id WHERE 1=1 ORDER BY t.date DESC, t.id DESC').rows.length;
    expect(total).toBeGreaterThan(0);
    expect(memory.query('DELETE FROM transactions')).toEqual({ rows: [], rowCount: total });
    expect(memory.state.transactions).toEqual([]);
    expect(memory.unsupported).toEqual([]);
  });

  test('DELETE FROM transactions WHERE id = $1 still removes only that row', () => {
    const memory = fresh();
    const before = memory.state.transactions.length;
    const id = memory.state.transactions[0].id;
    expect(memory.query('DELETE FROM transactions WHERE id = $1', [id]).rowCount).toBe(1);
    expect(memory.state.transactions.length).toBe(before - 1);
  });
});
