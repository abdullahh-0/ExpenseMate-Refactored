/**
 * Data access for budgets (and the expense totals needed to compare against them).
 * SQL only - percentages, statuses and other business calculations belong in the service.
 */
class BudgetRepository {
  constructor(db) {
    this.db = db;
  }

  /** Budget limits for one month, largest first. */
  async findLimitsForMonth({ month, year, currency }) {
    const result = await this.db.query(
      `SELECT b.*, c.name as category_name
         FROM budgets b
         JOIN categories c ON b.category_id = c.id
         WHERE b.month = $1 AND b.year = $2 AND b.currency = $3
         ORDER BY b.amount DESC`,
      [month, year, currency]
    );
    return result.rows;
  }

  /** Budget limits summed across all months of a year, largest first. */
  async findLimitsForYear({ year, currency }) {
    const result = await this.db.query(
      `SELECT b.category_id as id, b.category_id, c.name as category_name, SUM(b.amount) as amount, b.currency
         FROM budgets b
         JOIN categories c ON b.category_id = c.id
         WHERE b.year = $1 AND b.currency = $2
         GROUP BY b.category_id, c.name, b.currency
         ORDER BY amount DESC`,
      [year, currency]
    );
    return result.rows;
  }

  /** Total expenses per category for one month: rows of { category_id, total_spent }. */
  async sumExpensesByCategoryForMonth({ month, year, currency }) {
    const result = await this.db.query(
      `SELECT category_id, SUM(amount) as total_spent
         FROM transactions
         WHERE type = 'expense' AND currency = $1
           AND EXTRACT(MONTH FROM date) = $2
           AND EXTRACT(YEAR FROM date) = $3
         GROUP BY category_id`,
      [currency, month, year]
    );
    return result.rows;
  }

  /** Total expenses per category for a whole year: rows of { category_id, total_spent }. */
  async sumExpensesByCategoryForYear({ year, currency }) {
    const result = await this.db.query(
      `SELECT category_id, SUM(amount) as total_spent
         FROM transactions
         WHERE type = 'expense' AND currency = $1
           AND EXTRACT(YEAR FROM date) = $2
         GROUP BY category_id`,
      [currency, year]
    );
    return result.rows;
  }

  /** Finds the budget row for a category/month/year/currency. Returns { id } or null. */
  async findIdByKey({ categoryId, month, year, currency }) {
    const result = await this.db.query(
      'SELECT id FROM budgets WHERE category_id = $1 AND month = $2 AND year = $3 AND currency = $4',
      [categoryId, month, year, currency]
    );
    return result.rows[0] || null;
  }

  async updateAmount(id, amount) {
    const result = await this.db.query('UPDATE budgets SET amount = $1 WHERE id = $2 RETURNING *', [amount, id]);
    return result.rows[0];
  }

  async insert({ categoryId, month, year, amount, currency }) {
    const result = await this.db.query(
      'INSERT INTO budgets (category_id, month, year, amount, currency) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [categoryId, month, year, amount, currency]
    );
    return result.rows[0];
  }

  async delete(id) {
    await this.db.query('DELETE FROM budgets WHERE id = $1', [id]);
  }
}

module.exports = BudgetRepository;
