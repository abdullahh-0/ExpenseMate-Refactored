const TransactionService = require('../../services/transactionService');
const { ValidationError, NotFoundError } = require('../../errors/AppError');

function build({ suggest = 'Other', existingCategory = null, repoOverrides = {} } = {}) {
  const transactionRepo = {
    findAll: jest.fn(async () => []),
    create: jest.fn(async (tx) => ({ id: 1, ...tx })),
    update: jest.fn(async (id, tx) => ({ id, ...tx })),
    delete: jest.fn(async () => true),
    deleteAll: jest.fn(async () => 5),
    ...repoOverrides
  };
  const categoryRepo = {
    findByName: jest.fn(async () => existingCategory),
    findByLowerName: jest.fn(async () => existingCategory),
    create: jest.fn(async () => ({ id: 77 }))
  };
  const categorizer = { suggestCategory: jest.fn(() => suggest) };
  return { service: new TransactionService({ transactionRepo, categoryRepo, categorizer }), transactionRepo, categoryRepo, categorizer };
}

const valid = { date: '2026-11-06', description: 'Lunch', amount: '1250.5', type: 'expense', categoryId: 3 };

describe('TransactionService.create', () => {
  test('rejects invalid input with one joined message and never touches the repositories', async () => {
    const { service, transactionRepo, categoryRepo } = build();
    await expect(service.create({ date: 'nope', description: ' ', amount: -5, type: 'x' })).rejects.toThrow(ValidationError);
    await expect(service.create({ date: 'nope', description: ' ', amount: -5, type: 'x' })).rejects.toThrow(
      'Description is required. Amount must be greater than zero. Please provide a valid date format (YYYY-MM-DD). Transaction type must be either income or expense.'
    );
    expect(transactionRepo.create).not.toHaveBeenCalled();
    expect(categoryRepo.findByName).not.toHaveBeenCalled();
  });

  test('rejects an unknown payment method', async () => {
    const { service } = build();
    await expect(service.create({ ...valid, paymentMethod: 'Barter' })).rejects.toThrow(/Payment method must be one of/);
  });

  test('uses the explicit category without consulting the categoriser', async () => {
    const { service, transactionRepo, categorizer, categoryRepo } = build();
    await service.create(valid);
    expect(categorizer.suggestCategory).not.toHaveBeenCalled();
    expect(categoryRepo.findByName).not.toHaveBeenCalled();
    expect(transactionRepo.create.mock.calls[0][0].categoryId).toBe(3);
  });

  test('auto-categorises into an existing category when none is chosen', async () => {
    const { service, transactionRepo, categoryRepo } = build({ suggest: 'Transport', existingCategory: { id: 2 } });
    await service.create({ ...valid, categoryId: undefined, description: 'Uber ride' });
    expect(categoryRepo.findByName).toHaveBeenCalledWith('Transport');
    expect(categoryRepo.create).not.toHaveBeenCalled();
    expect(transactionRepo.create.mock.calls[0][0].categoryId).toBe(2);
  });

  test('creates the suggested category when it does not exist yet (type defaults to expense)', async () => {
    const { service, transactionRepo, categoryRepo } = build({ suggest: 'Gadgets', existingCategory: null });
    await service.create({ ...valid, categoryId: undefined });
    expect(categoryRepo.create).toHaveBeenCalledWith({ name: 'Gadgets', type: 'expense' });
    expect(transactionRepo.create.mock.calls[0][0].categoryId).toBe(77);
  });

  test('uses the transaction type for a newly created category', async () => {
    const { service, categoryRepo } = build({ suggest: 'Side gig', existingCategory: null });
    await service.create({ ...valid, categoryId: undefined, type: 'income' });
    expect(categoryRepo.create).toHaveBeenCalledWith({ name: 'Side gig', type: 'income' });
  });

  test('normalises values: trims description, parses amount, defaults currency and payment method', async () => {
    const { service, transactionRepo } = build();
    await service.create({ ...valid, description: '  Lunch with team  ' });
    expect(transactionRepo.create).toHaveBeenCalledWith({
      date: '2026-11-06', description: 'Lunch with team', amount: 1250.5, type: 'expense',
      categoryId: 3, currency: 'PKR', paymentMethod: 'Cash'
    });
  });

  test('keeps an explicit currency and payment method', async () => {
    const { service, transactionRepo } = build();
    await service.create({ ...valid, currency: 'USD', paymentMethod: 'Mobile Wallet' });
    const saved = transactionRepo.create.mock.calls[0][0];
    expect(saved.currency).toBe('USD');
    expect(saved.paymentMethod).toBe('Mobile Wallet');
  });
});

describe('TransactionService.update / remove', () => {
  test('update returns the stored row and passes the id through', async () => {
    const { service, transactionRepo } = build();
    const row = await service.update(5, { ...valid, categoryId: '2' });
    expect(transactionRepo.update.mock.calls[0][0]).toBe(5);
    expect(transactionRepo.update.mock.calls[0][1].categoryId).toBe(2);
    expect(row.id).toBe(5);
  });

  test('update throws NotFoundError when the id does not exist', async () => {
    const { service } = build({ repoOverrides: { update: jest.fn(async () => null) } });
    await expect(service.update(999, valid)).rejects.toThrow(NotFoundError);
    await expect(service.update(999, valid)).rejects.toThrow('Transaction record not found.');
  });

  test('update requires a numeric category', async () => {
    const { service, transactionRepo } = build();
    await expect(service.update(1, { ...valid, categoryId: undefined })).rejects.toThrow(ValidationError);
    expect(transactionRepo.update).not.toHaveBeenCalled();
  });

  test('update validates the body before touching the repository', async () => {
    const { service, transactionRepo } = build();
    await expect(service.update(1, { ...valid, amount: 0 })).rejects.toThrow(ValidationError);
    expect(transactionRepo.update).not.toHaveBeenCalled();
  });

  test('remove throws NotFoundError when nothing was deleted, otherwise resolves', async () => {
    const missing = build({ repoOverrides: { delete: jest.fn(async () => false) } });
    await expect(missing.service.remove(1)).rejects.toThrow(NotFoundError);
    const ok = build();
    await expect(ok.service.remove(1)).resolves.toBeUndefined();
  });
});

describe('TransactionService.list', () => {
  test('normalises filters before they reach the repository', async () => {
    const { service, transactionRepo } = build();
    await service.list({ search: '  LuNch ', type: 'expense', categoryId: '3', currency: 'pkr', startDate: '2026-01-01', endDate: '2026-12-31', sortBy: 'amount' });
    expect(transactionRepo.findAll).toHaveBeenCalledWith({
      search: 'lunch', type: 'expense', categoryId: 3, currency: 'PKR',
      startDate: '2026-01-01', endDate: '2026-12-31', sortBy: 'amount'
    });
  });

  test('drops blank search and unknown type; sort falls back to date', async () => {
    const { service, transactionRepo } = build();
    await service.list({ search: '   ', type: 'bogus', sortBy: 'hacker; DROP TABLE' });
    expect(transactionRepo.findAll).toHaveBeenCalledWith({ sortBy: 'date' });
  });

  test('rejects a non-numeric category filter', async () => {
    const { service } = build();
    await expect(service.list({ categoryId: 'abc' })).rejects.toThrow(ValidationError);
  });
});

describe('TransactionService.suggestCategory', () => {
  test('returns the stored category when it exists', async () => {
    const stored = { id: 2, name: 'Transport', type: 'expense' };
    const { service, categoryRepo } = build({ suggest: 'Transport', existingCategory: stored });
    const result = await service.suggestCategory('Uber ride');
    expect(categoryRepo.findByLowerName).toHaveBeenCalledWith('transport');
    expect(result).toEqual({ suggestedCategory: 'Transport', category: stored });
  });

  test('falls back to an unsaved expense category', async () => {
    const { service } = build({ suggest: 'Other', existingCategory: null });
    const result = await service.suggestCategory('qqq');
    expect(result).toEqual({ suggestedCategory: 'Other', category: { id: null, name: 'Other', type: 'expense' } });
  });
});

describe('TransactionService.clearAll', () => {
  test('refuses to run unless explicitly confirmed, and never touches the repository', async () => {
    const { service, transactionRepo } = build();
    await expect(service.clearAll()).rejects.toThrow(ValidationError);
    await expect(service.clearAll({})).rejects.toThrow(ValidationError);
    await expect(service.clearAll({ confirmed: false })).rejects.toThrow(ValidationError);
    await expect(service.clearAll({ confirmed: 'true' })).rejects.toThrow(/confirmed explicitly/);
    expect(transactionRepo.deleteAll).not.toHaveBeenCalled();
  });

  test('when confirmed, clears the history once and reports how many rows were removed', async () => {
    const { service, transactionRepo } = build();
    expect(await service.clearAll({ confirmed: true })).toEqual({ deleted: 5 });
    expect(transactionRepo.deleteAll).toHaveBeenCalledTimes(1);
  });

  test('clearing an already empty history is not an error', async () => {
    const { service } = build({ repoOverrides: { deleteAll: jest.fn(async () => 0) } });
    expect(await service.clearAll({ confirmed: true })).toEqual({ deleted: 0 });
  });
});
