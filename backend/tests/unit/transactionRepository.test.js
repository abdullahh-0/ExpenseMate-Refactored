const TransactionRepository = require('../../repositories/transactionRepository');
const CategoryRepository = require('../../repositories/categoryRepository');
const { makeFakeDb } = require('../helpers/fakes');

describe('TransactionRepository.findAll', () => {
  test('without filters: no extra conditions, newest first', async () => {
    const db = makeFakeDb(() => ({ rows: [{ id: 1 }] }));
    const rows = await new TransactionRepository(db).findAll({});
    expect(rows).toEqual([{ id: 1 }]);
    expect(db.calls[0].params).toEqual([]);
    expect(db.calls[0].sql).toContain('WHERE 1=1 ORDER BY t.date DESC, t.id DESC');
  });

  test('with every filter: numbered placeholders match the parameter order', async () => {
    const db = makeFakeDb();
    await new TransactionRepository(db).findAll({
      search: 'lunch', type: 'expense', categoryId: 3, currency: 'PKR', startDate: '2026-01-01', endDate: '2026-12-31', sortBy: 'date'
    });
    const { sql, params } = db.calls[0];
    expect(params).toEqual(['%lunch%', 'expense', 3, 'PKR', '2026-01-01', '2026-12-31']);
    ['$1', '$2', '$3', '$4', '$5', '$6'].forEach((p) => expect(sql).toContain(p));
    expect(sql).not.toContain('$7');
  });

  test('sorts by amount when asked', async () => {
    const db = makeFakeDb();
    await new TransactionRepository(db).findAll({ sortBy: 'amount' });
    expect(db.calls[0].sql).toContain('ORDER BY t.amount DESC, t.id DESC');
  });

  test('user text only ever travels as a bound parameter (no SQL injection through search)', async () => {
    const db = makeFakeDb();
    const evil = "x'; DROP TABLE transactions; --";
    await new TransactionRepository(db).findAll({ search: evil });
    expect(db.calls[0].sql).not.toContain('DROP TABLE');
    expect(db.calls[0].params[0]).toContain(evil);
  });
});

describe('TransactionRepository writes', () => {
  const tx = { date: '2026-11-06', description: 'Lunch', amount: 10, type: 'expense', categoryId: 1, currency: 'PKR', paymentMethod: 'Cash' };

  test('create sends the 7 values in column order and returns the stored row', async () => {
    const db = makeFakeDb(() => ({ rows: [{ id: 9 }] }));
    const row = await new TransactionRepository(db).create(tx);
    expect(db.calls[0].params).toEqual(['2026-11-06', 'Lunch', 10, 'expense', 1, 'PKR', 'Cash']);
    expect(row).toEqual({ id: 9 });
  });

  test('update puts the id last and returns null when no row matched', async () => {
    const db = makeFakeDb(() => ({ rows: [] }));
    const row = await new TransactionRepository(db).update(4, tx);
    expect(db.calls[0].params[7]).toBe(4);
    expect(row).toBeNull();
  });

  test('delete reports whether a row was removed', async () => {
    expect(await new TransactionRepository(makeFakeDb(() => ({ rowCount: 1 }))).delete(1)).toBe(true);
    expect(await new TransactionRepository(makeFakeDb(() => ({ rowCount: 0 }))).delete(1)).toBe(false);
  });
});

describe('CategoryRepository', () => {
  test('findByName returns the row or null', async () => {
    expect(await new CategoryRepository(makeFakeDb(() => ({ rows: [{ id: 2 }] }))).findByName('Food')).toEqual({ id: 2 });
    expect(await new CategoryRepository(makeFakeDb(() => ({ rows: [] }))).findByName('Nope')).toBeNull();
  });

  test('create inserts name and type and returns the new id', async () => {
    const db = makeFakeDb(() => ({ rows: [{ id: 16 }] }));
    expect(await new CategoryRepository(db).create({ name: 'Gadgets', type: 'expense' })).toEqual({ id: 16 });
    expect(db.calls[0].params).toEqual(['Gadgets', 'expense']);
  });
});
