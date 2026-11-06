const BudgetRepository = require('../../repositories/budgetRepository');
const { makeFakeDb } = require('../helpers/fakes');

describe('BudgetRepository', () => {
  test('monthly limits are filtered by month, year and currency (in that order)', async () => {
    const db = makeFakeDb(() => ({ rows: [{ id: 1 }] }));
    const rows = await new BudgetRepository(db).findLimitsForMonth({ month: 9, year: 2026, currency: 'PKR' });
    expect(rows).toEqual([{ id: 1 }]);
    expect(db.calls[0].params).toEqual([9, 2026, 'PKR']);
    expect(db.calls[0].sql).toContain('b.month = $1 AND b.year = $2 AND b.currency = $3');
  });

  test('yearly limits are summed per category', async () => {
    const db = makeFakeDb();
    await new BudgetRepository(db).findLimitsForYear({ year: 2026, currency: 'USD' });
    expect(db.calls[0].params).toEqual([2026, 'USD']);
    expect(db.calls[0].sql).toContain('SUM(b.amount)');
    expect(db.calls[0].sql).toContain('GROUP BY');
  });

  test('monthly and yearly expense totals bind currency first', async () => {
    const db = makeFakeDb();
    const repo = new BudgetRepository(db);
    await repo.sumExpensesByCategoryForMonth({ month: 9, year: 2026, currency: 'PKR' });
    await repo.sumExpensesByCategoryForYear({ year: 2026, currency: 'PKR' });
    expect(db.calls[0].params).toEqual(['PKR', 9, 2026]);
    expect(db.calls[1].params).toEqual(['PKR', 2026]);
    expect(db.calls[0].sql).toContain("type = 'expense'");
  });

  test('returns raw rows only - no percentages or status are computed here', async () => {
    const raw = [{ category_id: 1, total_spent: '10.00' }];
    const db = makeFakeDb(() => ({ rows: raw }));
    const rows = await new BudgetRepository(db).sumExpensesByCategoryForMonth({ month: 1, year: 2026, currency: 'PKR' });
    expect(rows).toBe(raw);
  });

  test('findIdByKey returns the row or null', async () => {
    const hit = new BudgetRepository(makeFakeDb(() => ({ rows: [{ id: 3 }] })));
    expect(await hit.findIdByKey({ categoryId: 1, month: 9, year: 2026, currency: 'PKR' })).toEqual({ id: 3 });
    const miss = new BudgetRepository(makeFakeDb(() => ({ rows: [] })));
    expect(await miss.findIdByKey({ categoryId: 1, month: 9, year: 2026, currency: 'PKR' })).toBeNull();
  });

  test('insert, update and delete send the expected parameters', async () => {
    const db = makeFakeDb(() => ({ rows: [{ id: 7 }] }));
    const repo = new BudgetRepository(db);
    await repo.insert({ categoryId: 9, month: 11, year: 2026, amount: 5000, currency: 'PKR' });
    await repo.updateAmount(7, 6000);
    await repo.delete(7);
    expect(db.calls[0].params).toEqual([9, 11, 2026, 5000, 'PKR']);
    expect(db.calls[1].params).toEqual([6000, 7]);
    expect(db.calls[2].params).toEqual([7]);
  });
});
