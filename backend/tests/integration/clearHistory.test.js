/**
 * Integration test for "clear transaction history": real routes, controller, service and repositories,
 * wired to a private in-memory database.
 *
 * Deliberately NOT run against PostgreSQL: the operation deletes every transaction, so it must never
 * be able to touch a developer's real data. The container (composition root) is replaced with one
 * that uses a MemoryDatabase instance, so the route file under test is the real one.
 */
jest.mock('../../container', () => {
  const MemoryDatabase = require('../../db/MemoryDatabase');
  const TransactionRepository = require('../../repositories/transactionRepository');
  const CategoryRepository = require('../../repositories/categoryRepository');
  const BudgetRepository = require('../../repositories/budgetRepository');
  const TransactionService = require('../../services/transactionService');
  const BudgetService = require('../../services/budgetService');
  const CategoryClassifier = require('../../services/categoryClassifier');

  const memory = new MemoryDatabase();
  const db = { query: async (sql, params) => memory.query(sql, params) };
  const transactionRepo = new TransactionRepository(db);
  const categoryRepo = new CategoryRepository(db);
  const budgetRepo = new BudgetRepository(db);
  return {
    transactionService: new TransactionService({ transactionRepo, categoryRepo, categorizer: new CategoryClassifier() }),
    budgetService: new BudgetService({ budgetRepo })
  };
});

const express = require('express');
const request = require('supertest');
const container = require('../../container');
const transactionRoutes = require('../../routes/transactions');

const app = express();
app.use(express.json());
app.use('/api/transactions', transactionRoutes);

const PERIOD = { month: 7, year: 2031, currency: 'EUR' };
const list = async () => (await request(app).get('/api/transactions')).body.data;

describe('clear transaction history (routes -> controller -> service -> repository -> memory db)', () => {
  beforeAll(async () => {
    // a budget for Food (category 1) and a spend that uses it
    await container.budgetService.setBudget({ categoryId: 1, ...PERIOD, amount: 500 });
    await request(app).post('/api/transactions').send({
      date: '2031-07-10', description: 'Groceries', amount: 200, type: 'expense', category_id: 1, currency: 'EUR'
    });
  });

  test('precondition: there are transactions, and the budget shows spending', async () => {
    expect((await list()).length).toBeGreaterThan(1);
    const food = (await container.budgetService.getSummary(PERIOD)).find((b) => b.category_id === 1);
    expect(food.amount).toBe(500);
    expect(food.spent).toBeGreaterThan(0);
  });

  test('DELETE without confirm=true is rejected with 400 and deletes nothing', async () => {
    const before = (await list()).length;
    const res = await request(app).delete('/api/transactions');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect((await list()).length).toBe(before);
  });

  test('DELETE with confirm=false is also rejected', async () => {
    const res = await request(app).delete('/api/transactions?confirm=false');
    expect(res.status).toBe(400);
  });

  test('DELETE ?confirm=true removes every transaction and reports how many', async () => {
    const before = (await list()).length;
    const res = await request(app).delete('/api/transactions?confirm=true');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, deleted: before });
    expect(await list()).toEqual([]);
  });

  test('budgets survive, but their spending drops to zero', async () => {
    const food = (await container.budgetService.getSummary(PERIOD)).find((b) => b.category_id === 1);
    expect(food).toBeDefined();
    expect(food.amount).toBe(500);
    expect(food.spent).toBe(0);
  });

  test('clearing an empty history succeeds and reports 0', async () => {
    const res = await request(app).delete('/api/transactions?confirm=true');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
  });

  test('the per-transaction DELETE /:id route still works (same route file)', async () => {
    const created = await request(app).post('/api/transactions').send({
      date: '2031-07-11', description: 'Lunch', amount: 10, type: 'expense', category_id: 1, currency: 'EUR'
    });
    const id = created.body.data.id;
    expect((await request(app).delete(`/api/transactions/${id}`)).status).toBe(200);
    expect((await request(app).delete('/api/transactions/999999')).status).toBe(404);
  });
});
