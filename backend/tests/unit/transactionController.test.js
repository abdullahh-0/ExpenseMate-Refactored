const { createTransactionController } = require('../../controllers/transactionController');
const { ValidationError, NotFoundError } = require('../../errors/AppError');
const { makeRes } = require('../helpers/fakes');

function build(serviceOverrides = {}) {
  const service = {
    list: jest.fn(async () => [{ id: 1 }]),
    create: jest.fn(async (input) => ({ id: 10, ...input })),
    update: jest.fn(async (id) => ({ id })),
    remove: jest.fn(async () => undefined),
    suggestCategory: jest.fn(async () => ({ suggestedCategory: 'Food', category: { id: 1, name: 'Food', type: 'expense' } })),
    ...serviceOverrides
  };
  return { service, controller: createTransactionController(service) };
}

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('transaction controller', () => {
  test('GET maps HTTP query names (incl. snake_case dates) to the service', async () => {
    const { service, controller } = build();
    const res = makeRes();
    await controller.getTransactions({ query: { category_id: '3', sort_by: 'amount', start_date: '2026-01-01', endDate: '2026-02-01' } }, res);
    expect(service.list).toHaveBeenCalledWith({
      search: undefined, type: undefined, categoryId: '3', currency: undefined,
      sortBy: 'amount', startDate: '2026-01-01', endDate: '2026-02-01'
    });
    expect(res.body).toEqual({ success: true, data: [{ id: 1 }] });
  });

  test('POST returns 201 with the saved transaction', async () => {
    const { service, controller } = build();
    const res = makeRes();
    await controller.createTransaction({ body: { description: 'x', category_id: 2, payment_method: 'Cash' } }, res);
    expect(service.create.mock.calls[0][0]).toMatchObject({ categoryId: 2, paymentMethod: 'Cash' });
    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe('Transaction saved successfully.');
  });

  test('a ValidationError becomes HTTP 400 with its message', async () => {
    const { controller } = build({ create: jest.fn(async () => { throw new ValidationError('Description is required.'); }) });
    const res = makeRes();
    await controller.createTransaction({ body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Description is required.' });
  });

  test('an unexpected error becomes a generic 500 and is logged, not leaked', async () => {
    const { controller } = build({ create: jest.fn(async () => { throw new Error('connection refused at 10.0.0.5'); }) });
    const res = makeRes();
    await controller.createTransaction({ body: {} }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Unable to save transaction.' });
    expect(console.error).toHaveBeenCalled();
  });

  test('PUT with a non-numeric id is rejected as 400 before the service is called', async () => {
    const { service, controller } = build();
    const res = makeRes();
    await controller.updateTransaction({ params: { id: 'abc' }, body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
  });

  test('PUT for a missing record returns 404', async () => {
    const { controller } = build({ update: jest.fn(async () => { throw new NotFoundError('Transaction record not found.'); }) });
    const res = makeRes();
    await controller.updateTransaction({ params: { id: '99' }, body: {} }, res);
    expect(res.statusCode).toBe(404);
  });

  test('DELETE returns the success message; non-numeric id is 400', async () => {
    const { service, controller } = build();
    const ok = makeRes();
    await controller.deleteTransaction({ params: { id: '4' } }, ok);
    expect(service.remove).toHaveBeenCalledWith(4);
    expect(ok.body).toEqual({ success: true, message: 'Transaction deleted successfully.' });
    const bad = makeRes();
    await controller.deleteTransaction({ params: { id: 'x' } }, bad);
    expect(bad.statusCode).toBe(400);
  });

  test('suggest-category keeps the original response shape', async () => {
    const { controller } = build();
    const res = makeRes();
    await controller.autoCategorize({ body: { description: 'lunch' } }, res);
    expect(res.body).toEqual({ success: true, suggestedCategory: 'Food', category: { id: 1, name: 'Food', type: 'expense' } });
  });
});
