const BudgetService = require('../../services/budgetService');
const { calculateBudgetStatus, DEFAULTS } = BudgetService;
const { ValidationError } = require('../../errors/AppError');

function build({ limits = [], spent = [], existing = null } = {}) {
  const budgetRepo = {
    findLimitsForMonth: jest.fn(async () => limits),
    findLimitsForYear: jest.fn(async () => limits),
    sumExpensesByCategoryForMonth: jest.fn(async () => spent),
    sumExpensesByCategoryForYear: jest.fn(async () => spent),
    findIdByKey: jest.fn(async () => existing),
    updateAmount: jest.fn(async (id, amount) => ({ id, amount })),
    insert: jest.fn(async (row) => ({ id: 50, ...row })),
    delete: jest.fn(async () => undefined)
  };
  return { service: new BudgetService({ budgetRepo }), budgetRepo };
}

describe('calculateBudgetStatus (warning thresholds)', () => {
  test.each([
    [79, 'NORMAL', 'success'],
    [80, 'WARNING', 'info'],
    [89, 'WARNING', 'info'],
    [90, 'CRITICAL', 'warning'],
    [99, 'CRITICAL', 'warning'],
    [100, 'EXCEEDED', 'danger'],
    [150, 'EXCEEDED', 'danger']
  ])('budget 100, spent %i -> %s', (spent, status, level) => {
    const r = calculateBudgetStatus(100, spent);
    expect(r.status).toBe(status);
    expect(r.warning_status).toBe(status);
    expect(r.level).toBe(level);
    expect(r.percentage).toBe(spent);
  });

  test('computes remaining, accepts numeric strings (as PostgreSQL returns them)', () => {
    const r = calculateBudgetStatus('1240000.00', '45000');
    expect(r.remaining).toBe(1195000);
    expect(r.spent).toBe(45000);
    expect(r.percentage).toBe(4);
    expect(r.amount_limit).toBe(1240000);
  });

  test('a zero or missing budget never divides by zero', () => {
    expect(calculateBudgetStatus(0, 50).percentage).toBe(0);
    expect(calculateBudgetStatus(null, null).status).toBe('NORMAL');
  });
});

describe('BudgetService.getSummary', () => {
  test('uses the default period (Sep 2026, PKR) when none is given', async () => {
    const { service, budgetRepo } = build();
    await service.getSummary({});
    expect(budgetRepo.findLimitsForMonth).toHaveBeenCalledWith({ month: DEFAULTS.month, year: DEFAULTS.year, currency: DEFAULTS.currency });
    expect(budgetRepo.sumExpensesByCategoryForMonth).toHaveBeenCalledWith({ month: 9, year: 2026, currency: 'PKR' });
  });

  test('monthly mode passes the requested month, year and currency', async () => {
    const { service, budgetRepo } = build();
    await service.getSummary({ month: '11', year: '2027', currency: 'USD' });
    expect(budgetRepo.findLimitsForMonth).toHaveBeenCalledWith({ month: 11, year: 2027, currency: 'USD' });
    expect(budgetRepo.findLimitsForYear).not.toHaveBeenCalled();
  });

  test.each(['overall', '0', 'all'])('month=%s switches to whole-year totals', async (month) => {
    const { service, budgetRepo } = build();
    await service.getSummary({ month, year: '2026', currency: 'PKR' });
    expect(budgetRepo.findLimitsForYear).toHaveBeenCalled();
    expect(budgetRepo.sumExpensesByCategoryForYear).toHaveBeenCalled();
    expect(budgetRepo.findLimitsForMonth).not.toHaveBeenCalled();
  });

  test('attaches spending and status to each budget; unspent categories count as 0', async () => {
    const { service } = build({
      limits: [
        { id: 1, category_id: 8, amount: '1000.00', category_name: 'Rent' },
        { id: 2, category_id: 1, amount: '500.00', category_name: 'Food' }
      ],
      spent: [{ category_id: 8, total_spent: '950.00' }]
    });
    const [rent, food] = await service.getSummary({});
    expect(rent).toMatchObject({ category_name: 'Rent', spent: 950, percentage: 95, status: 'CRITICAL' });
    expect(food).toMatchObject({ category_name: 'Food', spent: 0, percentage: 0, status: 'NORMAL' });
  });
});

describe('BudgetService.setBudget', () => {
  const input = { categoryId: '9', month: '11', year: '2026', amount: '5000', currency: 'PKR' };

  test.each([
    ['missing category', { ...input, categoryId: undefined }],
    ['missing amount', { ...input, amount: undefined }],
    ['zero amount', { ...input, amount: 0 }],
    ['negative amount', { ...input, amount: -4 }],
    ['non-numeric amount', { ...input, amount: 'abc' }]
  ])('rejects %s', async (_label, bad) => {
    const { service, budgetRepo } = build();
    await expect(service.setBudget(bad)).rejects.toThrow(ValidationError);
    await expect(service.setBudget(bad)).rejects.toThrow('Category and a positive budget amount are required.');
    expect(budgetRepo.insert).not.toHaveBeenCalled();
  });

  test('inserts a new budget when none exists for that category and period', async () => {
    const { service, budgetRepo } = build({ existing: null });
    const row = await service.setBudget(input);
    expect(budgetRepo.insert).toHaveBeenCalledWith({ categoryId: 9, month: 11, year: 2026, amount: 5000, currency: 'PKR' });
    expect(budgetRepo.updateAmount).not.toHaveBeenCalled();
    expect(row.id).toBe(50);
  });

  test('updates the amount when the budget already exists', async () => {
    const { service, budgetRepo } = build({ existing: { id: 21 } });
    const row = await service.setBudget({ ...input, amount: '7000' });
    expect(budgetRepo.updateAmount).toHaveBeenCalledWith(21, 7000);
    expect(budgetRepo.insert).not.toHaveBeenCalled();
    expect(row).toEqual({ id: 21, amount: 7000 });
  });

  test('falls back to default month, year and currency', async () => {
    const { service, budgetRepo } = build();
    await service.setBudget({ categoryId: 3, amount: 100 });
    expect(budgetRepo.findIdByKey).toHaveBeenCalledWith({ categoryId: 3, month: 9, year: 2026, currency: 'PKR' });
  });

  test('deleteBudget delegates to the repository', async () => {
    const { service, budgetRepo } = build();
    await service.deleteBudget(5);
    expect(budgetRepo.delete).toHaveBeenCalledWith(5);
  });
});
