const request = require('supertest');
const app = require('../server');

describe('ExpenseMate API Test Suite', () => {

  // Wait for migrations + seed before the first request (avoids a start-up race)
  beforeAll(async () => {
    await app.ready;
  });

  test('GET /api/categories - Should return list of default categories', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test('POST /api/transactions/suggest-category - Should suggest Transport for "Uber ride"', async () => {
    const res = await request(app)
      .post('/api/transactions/suggest-category')
      .send({ description: 'Uber ride to campus' });

    expect(res.body.statusCode || 200).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.suggestedCategory).toEqual('Transport');
  });

  test('POST /api/transactions - Should create a new transaction', async () => {
    const newTx = {
      amount: 1500,
      description: 'Grocery Shopping at Metro',
      category_id: 1,
      type: 'expense',
      date: '2026-09-25',
      payment_method: 'Credit Card',
      currency: 'PKR'
    };

    const res = await request(app)
      .post('/api/transactions')
      .send(newTx);

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.description).toEqual('Grocery Shopping at Metro');
  });

  test('GET /api/transactions - Should retrieve transactions', async () => {
    const res = await request(app).get('/api/transactions');
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('POST /api/budgets & GET /api/budgets - Should set and calculate budget status', async () => {
    // Set budget limit 200000
    await request(app)
      .post('/api/budgets')
      .send({
        category_id: 1,
        amount_limit: 200000,
        month: 9,
        year: 2026,
        currency: 'PKR'
      });

    const res = await request(app).get('/api/budgets?month=9&year=2026&currency=PKR');
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/dashboard - Should return complete financial metrics', async () => {
    const res = await request(app).get('/api/dashboard?month=9&year=2026&currency=PKR');
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('recentTransactions');
    expect(res.body.data).toHaveProperty('categoryExpenses');
  });

  // ---- Migration 002: payment_method is now persisted ----
  test('POST /api/transactions - Should persist the chosen payment method', async () => {
    const res = await request(app).post('/api/transactions').send({
      amount: 700, description: 'Payment method persistence check', category_id: 1,
      type: 'expense', date: '2026-09-26', currency: 'PKR', payment_method: 'Mobile Wallet'
    });
    expect(res.statusCode).toEqual(201);
    expect(res.body.data.payment_method).toEqual('Mobile Wallet');

    const list = await request(app).get('/api/transactions?search=Payment method persistence check');
    expect(list.body.data[0].payment_method).toEqual('Mobile Wallet');
  });

  test('POST /api/transactions - Should default payment method to Cash when omitted', async () => {
    const res = await request(app).post('/api/transactions').send({
      amount: 300, description: 'Default payment method check', category_id: 1,
      type: 'expense', date: '2026-09-26', currency: 'PKR'
    });
    expect(res.statusCode).toEqual(201);
    expect(res.body.data.payment_method).toEqual('Cash');
  });

  test('POST /api/transactions - Should reject an unknown payment method', async () => {
    const res = await request(app).post('/api/transactions').send({
      amount: 100, description: 'Bad payment method', category_id: 1,
      type: 'expense', date: '2026-09-26', currency: 'PKR', payment_method: 'Barter'
    });
    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
  });

  afterAll(async () => {
    const db = require('../db/connection');
    await db.query("DELETE FROM transactions WHERE description = 'Grocery Shopping at Metro'");
    await db.query("DELETE FROM transactions WHERE description IN ('Payment method persistence check', 'Default payment method check')");
    await db.close(); // release the connection pool so Jest can exit cleanly
  });
});
