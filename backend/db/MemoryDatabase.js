/**
 * In-memory stand-in for PostgreSQL, used only when no database server is reachable
 * (zero-dependency demos). It understands exactly the SQL statements ExpenseMate issues and
 * nothing more; any other statement yields an empty result instead of fake data.
 *
 * Design: every supported statement is a small handler in the HANDLERS table
 * { name, test: RegExp over the normalised SQL, run(state, params, sql) }. Adding support for a
 * new statement means adding one entry - no if/else chain to extend.
 */

/** Seed data that mirrors the baseline project's demo data. */
function createSeedData() {
  const now = new Date();
  const seed = {
    categories: [
      { id: 1, name: 'Food', type: 'expense' },
      { id: 2, name: 'Transport', type: 'expense' },
      { id: 3, name: 'Shopping', type: 'expense' },
      { id: 4, name: 'Bills', type: 'expense' },
      { id: 5, name: 'Education', type: 'expense' },
      { id: 6, name: 'Health', type: 'expense' },
      { id: 7, name: 'Entertainment', type: 'expense' },
      { id: 8, name: 'Rent', type: 'expense' },
      { id: 9, name: 'Utilities', type: 'expense' },
      { id: 10, name: 'Other', type: 'expense' },
      { id: 11, name: 'Salary', type: 'income' },
      { id: 12, name: 'Freelance', type: 'income' },
      { id: 13, name: 'Business', type: 'income' },
      { id: 14, name: 'Investment', type: 'income' },
      { id: 15, name: 'Other Income', type: 'income' }
    ],
    transactions: [
      { id: 1, date: '2026-09-01', description: 'Software Engineer Salary', amount: 150000.0, type: 'income', category_id: 11, currency: 'PKR', payment_method: 'Cash' },
      { id: 2, date: '2026-09-02', description: 'Monthly Apartment Rent', amount: 45000.0, type: 'expense', category_id: 8, currency: 'PKR', payment_method: 'Cash' },
      { id: 3, date: '2026-09-03', description: 'Grocery Supermarket', amount: 18500.0, type: 'expense', category_id: 1, currency: 'PKR', payment_method: 'Cash' },
      { id: 4, date: '2026-09-04', description: 'Fuel & Car Refill', amount: 8500.0, type: 'expense', category_id: 2, currency: 'PKR', payment_method: 'Cash' },
      { id: 5, date: '2026-09-05', description: 'Freelance Project Income', amount: 450.0, type: 'income', category_id: 12, currency: 'USD', payment_method: 'Cash' }
    ],
    budgets: [
      { id: 1, category_id: 8, month: 9, year: 2026, amount: 450000.0, currency: 'PKR' },
      { id: 2, category_id: 3, month: 9, year: 2026, amount: 250000.0, currency: 'PKR' },
      { id: 3, category_id: 5, month: 9, year: 2026, amount: 200000.0, currency: 'PKR' },
      { id: 4, category_id: 1, month: 9, year: 2026, amount: 200000.0, currency: 'PKR' },
      { id: 5, category_id: 2, month: 9, year: 2026, amount: 80000.0, currency: 'PKR' },
      { id: 6, category_id: 4, month: 9, year: 2026, amount: 70000.0, currency: 'PKR' },
      { id: 7, category_id: 8, month: 9, year: 2026, amount: 1500.0, currency: 'USD' },
      { id: 8, category_id: 1, month: 9, year: 2026, amount: 750.0, currency: 'USD' },
      { id: 9, category_id: 3, month: 9, year: 2026, amount: 450.0, currency: 'USD' },
      { id: 10, category_id: 2, month: 9, year: 2026, amount: 350.0, currency: 'USD' },
      { id: 11, category_id: 4, month: 9, year: 2026, amount: 350.0, currency: 'USD' },
      { id: 12, category_id: 5, month: 9, year: 2026, amount: 300.0, currency: 'USD' }
    ],
    nextTxId: 6,
    nextBudgetId: 13,
    nextCatId: 16
  };
  seed.transactions.forEach((t) => { t.created_at = now; });
  return seed;
}

// ---------------------------------------------------------------- small helpers

const result = (rows) => ({ rows, rowCount: rows.length });
const categoryOf = (state, id) => state.categories.find((c) => c.id === id);
const monthOf = (date) => parseInt(String(date).slice(5, 7), 10);
const yearOf = (date) => parseInt(String(date).slice(0, 4), 10);
const byAmountDesc = (a, b) => b.amount - a.amount;

/** Reads the value of the "$n" placeholder that follows `pattern` in the SQL, or undefined. */
function paramFor(sql, pattern, params) {
  const match = pattern.exec(sql);
  return match ? params[Number(match[1]) - 1] : undefined;
}

/** Sums `amount` per category_id for expense rows of one currency that pass `inPeriod`. */
function sumExpensesByCategory(state, currency, inPeriod) {
  const totals = new Map();
  state.transactions
    .filter((t) => t.type === 'expense' && t.currency === currency && inPeriod(t.date))
    .forEach((t) => totals.set(t.category_id, (totals.get(t.category_id) || 0) + t.amount));
  return [...totals].map(([category_id, total_spent]) => ({ category_id, total_spent }));
}

// ---------------------------------------------------------------- statement handlers

const HANDLERS = [
  // ---- categories
  {
    name: 'category.insert',
    test: /^INSERT INTO CATEGORIES\b/,
    run(state, params) {
      const [name, type] = params;
      const existing = state.categories.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
      if (existing) return result([existing]); // mimics "name is unique": the existing row is returned
      const created = { id: state.nextCatId++, name, type: type || 'expense' };
      state.categories.push(created);
      return result([created]);
    }
  },
  {
    name: 'category.select',
    test: /^SELECT .+ FROM CATEGORIES\b/,
    run(state, params, sql) {
      let rows = [...state.categories];
      if (params.length > 0) {
        const value = String(params[0]).toLowerCase();
        const byName = /\bLOWER\(NAME\) = \$1|\bNAME = \$1/.test(sql);
        rows = byName ? rows.filter((c) => c.name.toLowerCase() === value) : rows.filter((c) => c.type === value);
      }
      if (/ORDER BY NAME ASC/.test(sql)) rows.sort((a, b) => a.name.localeCompare(b.name));
      return result(rows);
    }
  },

  // ---- transactions
  {
    name: 'transaction.insert',
    test: /^INSERT INTO TRANSACTIONS\b/,
    run(state, params) {
      const [date, description, amount, type, categoryId, currency, paymentMethod] = params;
      const created = {
        id: state.nextTxId++,
        date,
        description,
        amount: parseFloat(amount),
        type,
        category_id: parseInt(categoryId, 10),
        currency: currency || 'PKR',
        payment_method: paymentMethod || 'Cash',
        created_at: new Date()
      };
      state.transactions.push(created);
      return result([created]);
    }
  },
  {
    name: 'transaction.update',
    test: /^UPDATE TRANSACTIONS\b/,
    run(state, params) {
      const [date, description, amount, type, categoryId, currency, paymentMethod, id] = params;
      const existing = state.transactions.find((t) => t.id === parseInt(id, 10));
      if (!existing) return result([]);
      Object.assign(existing, {
        date,
        description,
        amount: parseFloat(amount),
        type,
        category_id: parseInt(categoryId, 10),
        currency,
        payment_method: paymentMethod || existing.payment_method || 'Cash'
      });
      return result([existing]);
    }
  },
  {
    name: 'transaction.delete',
    test: /^DELETE FROM TRANSACTIONS\b/,
    run(state, params) {
      const before = state.transactions.length;
      state.transactions = state.transactions.filter((t) => t.id !== parseInt(params[0], 10));
      return { rows: [], rowCount: before - state.transactions.length };
    }
  },
  {
    // The filterable list query issued by TransactionRepository.findAll()
    name: 'transaction.list',
    test: /^SELECT T\.\*, C\.NAME AS CATEGORY_NAME, C\.TYPE AS CATEGORY_TYPE FROM TRANSACTIONS T LEFT JOIN CATEGORIES C\b/,
    run(state, params, sql) {
      const search = paramFor(sql, /LOWER\(T\.DESCRIPTION\) LIKE \$(\d+)/, params);
      const type = paramFor(sql, /T\.TYPE = \$(\d+)/, params);
      const categoryId = paramFor(sql, /T\.CATEGORY_ID = \$(\d+)/, params);
      const currency = paramFor(sql, /T\.CURRENCY = \$(\d+)/, params);
      const startDate = paramFor(sql, /T\.DATE >= \$(\d+)/, params);
      const endDate = paramFor(sql, /T\.DATE <= \$(\d+)/, params);
      const needle = search === undefined ? null : String(search).replace(/%/g, '').toLowerCase();

      const rows = state.transactions
        .filter((t) => needle === null || String(t.description).toLowerCase().includes(needle))
        .filter((t) => type === undefined || t.type === type)
        .filter((t) => categoryId === undefined || t.category_id === Number(categoryId))
        .filter((t) => currency === undefined || t.currency === currency)
        .filter((t) => startDate === undefined || String(t.date) >= String(startDate))
        .filter((t) => endDate === undefined || String(t.date) <= String(endDate))
        .map((t) => {
          const category = categoryOf(state, t.category_id);
          return { ...t, category_name: category ? category.name : 'Other', category_type: category ? category.type : t.type };
        });

      const sortByAmount = /ORDER BY T\.AMOUNT/.test(sql);
      rows.sort((a, b) => {
        const primary = sortByAmount ? b.amount - a.amount : String(b.date).localeCompare(String(a.date));
        return primary !== 0 ? primary : b.id - a.id; // same tie-break as "ORDER BY ..., t.id DESC"
      });
      return result(rows);
    }
  },

  // ---- budgets
  {
    name: 'budget.limitsForMonth',
    test: /^SELECT B\.\*, C\.NAME AS CATEGORY_NAME FROM BUDGETS B JOIN CATEGORIES C\b/,
    run(state, [month, year, currency]) {
      const rows = state.budgets
        .filter((b) => b.month === Number(month) && b.year === Number(year) && b.currency === currency)
        .map((b) => ({ ...b, category_name: (categoryOf(state, b.category_id) || { name: 'Other' }).name }))
        .sort(byAmountDesc);
      return result(rows);
    }
  },
  {
    name: 'budget.limitsForYear',
    test: /^SELECT B\.CATEGORY_ID AS ID, B\.CATEGORY_ID, C\.NAME AS CATEGORY_NAME, SUM\(B\.AMOUNT\) AS AMOUNT, B\.CURRENCY FROM BUDGETS B\b/,
    run(state, [year, currency]) {
      const totals = new Map();
      state.budgets
        .filter((b) => b.year === Number(year) && b.currency === currency)
        .forEach((b) => totals.set(b.category_id, (totals.get(b.category_id) || 0) + b.amount));
      const rows = [...totals]
        .map(([categoryId, amount]) => ({
          id: categoryId,
          category_id: categoryId,
          category_name: (categoryOf(state, categoryId) || { name: 'Other' }).name,
          amount,
          currency
        }))
        .sort(byAmountDesc);
      return result(rows);
    }
  },
  {
    name: 'budget.expensesForMonth',
    test: /^SELECT CATEGORY_ID, SUM\(AMOUNT\) AS TOTAL_SPENT FROM TRANSACTIONS WHERE .*EXTRACT\(MONTH FROM DATE\)/,
    run(state, [currency, month, year]) {
      return result(sumExpensesByCategory(state, currency, (d) => monthOf(d) === Number(month) && yearOf(d) === Number(year)));
    }
  },
  {
    name: 'budget.expensesForYear',
    test: /^SELECT CATEGORY_ID, SUM\(AMOUNT\) AS TOTAL_SPENT FROM TRANSACTIONS WHERE (?!.*EXTRACT\(MONTH)/,
    run(state, [currency, year]) {
      return result(sumExpensesByCategory(state, currency, (d) => yearOf(d) === Number(year)));
    }
  },
  {
    name: 'budget.findIdByKey',
    test: /^SELECT ID FROM BUDGETS WHERE CATEGORY_ID = \$1/,
    run(state, [categoryId, month, year, currency]) {
      const found = state.budgets.find(
        (b) => b.category_id === Number(categoryId) && b.month === Number(month) && b.year === Number(year) && b.currency === currency
      );
      return result(found ? [{ id: found.id }] : []);
    }
  },
  {
    name: 'budget.updateAmount',
    test: /^UPDATE BUDGETS SET AMOUNT = \$1 WHERE ID = \$2/,
    run(state, [amount, id]) {
      const existing = state.budgets.find((b) => b.id === Number(id));
      if (!existing) return result([]);
      existing.amount = parseFloat(amount);
      return result([existing]);
    }
  },
  {
    name: 'budget.insert',
    test: /^INSERT INTO BUDGETS\b/,
    run(state, [categoryId, month, year, amount, currency]) {
      const created = {
        id: state.nextBudgetId++,
        category_id: parseInt(categoryId, 10),
        month: parseInt(month, 10),
        year: parseInt(year, 10),
        amount: parseFloat(amount),
        currency: currency || 'PKR'
      };
      state.budgets.push(created);
      return result([created]);
    }
  },
  {
    name: 'budget.delete',
    test: /^DELETE FROM BUDGETS\b/,
    run(state, params) {
      const before = state.budgets.length;
      state.budgets = state.budgets.filter((b) => b.id !== parseInt(params[0], 10));
      return { rows: [], rowCount: before - state.budgets.length };
    }
  }
];

// ---------------------------------------------------------------- the class

class MemoryDatabase {
  /** @param {object} [seed] initial tables; defaults to the demo data */
  constructor(seed = createSeedData()) {
    this.state = seed;
    this.unsupported = []; // statements we could not answer (useful when debugging fallback mode)
  }

  /** Executes one SQL statement against the in-memory tables. Never throws for unknown SQL. */
  query(sql, params = []) {
    const normalised = String(sql).replace(/\s+/g, ' ').trim().toUpperCase();
    const handler = HANDLERS.find((h) => h.test.test(normalised));
    if (!handler) {
      this.unsupported.push(normalised.slice(0, 120));
      return result([]);
    }
    return handler.run(this.state, params, normalised);
  }

  /** The raw tables (kept for compatibility with the previous getMemoryStore()). */
  getStore() {
    return this.state;
  }
}

module.exports = MemoryDatabase;
module.exports.createSeedData = createSeedData;
module.exports.HANDLER_NAMES = HANDLERS.map((h) => h.name);
