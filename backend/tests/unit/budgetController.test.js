const { createBudgetController } = require('../../controllers/budgetController');
const { ValidationError } = require('../../errors/AppError');
const { makeRes } = require('../helpers/fakes');

function build(overrides = {}) {
  const service = {
    getSummary: jest.fn(async () => [{ id: 1 }]),
    setBudget: jest.fn(async (input) => ({ id: 2, ...input })),
    deleteBudget: jest.fn(async () => undefined),
    ...overrides
  };
  return { service, controller: createBudgetController(service) };
}

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('budget controller', () => {
  test('GET passes month, year and currency to the service and wraps the result', async () => {
    const { service, controller } = build();
    const res = makeRes();
    await controller.getBudgets({ query: { month: 'overall', year: '2026', currency: 'USD' } }, res);
    expect(service.getSummary).toHaveBeenCalledWith({ month: 'overall', year: '2026', currency: 'USD' });
    expect(res.body).toEqual({ success: true, data: [{ id: 1 }] });
  });

  test('POST returns 201; the legacy amount_limit field still works', async () => {
    const { service, controller } = build();
    const res = makeRes();
    await controller.createOrUpdateBudget({ body: { category_id: 6, amount_limit: 3000 } }, res);
    expect(service.setBudget.mock.calls[0][0]).toMatchObject({ categoryId: 6, amount: 3000 });
    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe('Budget ceiling set successfully.');
  });

  test('"amount" wins over the legacy "amount_limit"', async () => {
    const { service, controller } = build();
    await controller.createOrUpdateBudget({ body: { category_id: 6, amount: 10, amount_limit: 99 } }, makeRes());
    expect(service.setBudget.mock.calls[0][0].amount).toBe(10);
  });

  test('a ValidationError from the service becomes HTTP 400', async () => {
    const { controller } = build({ setBudget: jest.fn(async () => { throw new ValidationError('Category and a positive budget amount are required.'); }) });
    const res = makeRes();
    await controller.createOrUpdateBudget({ body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('unexpected errors become the generic message for that action', async () => {
    const { controller } = build({ getSummary: jest.fn(async () => { throw new Error('boom'); }) });
    const res = makeRes();
    await controller.getBudgets({ query: {} }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe('Failed to fetch budget status.');
  });

  test('DELETE succeeds for a numeric id and rejects a non-numeric one', async () => {
    const { service, controller } = build();
    const ok = makeRes();
    await controller.deleteBudget({ params: { id: '5' } }, ok);
    expect(service.deleteBudget).toHaveBeenCalledWith(5);
    expect(ok.body).toEqual({ success: true, message: 'Budget cap deleted.' });
    const bad = makeRes();
    await controller.deleteBudget({ params: { id: 'abc' } }, bad);
    expect(bad.statusCode).toBe(400);
  });
});
