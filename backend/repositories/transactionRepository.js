/**
 * Data access for the transactions table. Contains SQL only - no business rules.
 * Inputs are already validated/normalised by the service layer.
 */
class TransactionRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {{search?:string, type?:string, categoryId?:number, currency?:string,
   *          startDate?:string, endDate?:string, sortBy?:string}} filters
   */
  async findAll(filters = {}) {
    let sql = `
      SELECT t.*, c.name as category_name, c.type as category_type
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (filters.search) {
      sql += ` AND LOWER(t.description) LIKE $${paramIndex++}`;
      params.push(`%${filters.search}%`);
    }
    if (filters.type) {
      sql += ` AND t.type = $${paramIndex++}`;
      params.push(filters.type);
    }
    if (filters.categoryId) {
      sql += ` AND t.category_id = $${paramIndex++}`;
      params.push(filters.categoryId);
    }
    if (filters.currency) {
      sql += ` AND t.currency = $${paramIndex++}`;
      params.push(filters.currency);
    }
    if (filters.startDate) {
      sql += ` AND t.date >= $${paramIndex++}`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND t.date <= $${paramIndex++}`;
      params.push(filters.endDate);
    }

    // Column comes from a fixed whitelist, never from user input.
    const sortColumn = filters.sortBy === 'amount' ? 't.amount' : 't.date';
    sql += ` ORDER BY ${sortColumn} DESC, t.id DESC`;

    const result = await this.db.query(sql, params);
    return result.rows;
  }

  /** Inserts a transaction and returns the stored row. */
  async create({ date, description, amount, type, categoryId, currency, paymentMethod }) {
    const result = await this.db.query(
      `
      INSERT INTO transactions (date, description, amount, type, category_id, currency, payment_method)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
      [date, description, amount, type, categoryId, currency, paymentMethod]
    );
    return result.rows[0];
  }

  /** Updates a transaction. Returns the stored row, or null when the id does not exist. */
  async update(id, { date, description, amount, type, categoryId, currency, paymentMethod }) {
    const result = await this.db.query(
      `
      UPDATE transactions
      SET date = $1, description = $2, amount = $3, type = $4, category_id = $5, currency = $6, payment_method = $7
      WHERE id = $8
      RETURNING *
    `,
      [date, description, amount, type, categoryId, currency, paymentMethod, id]
    );
    return result.rows[0] || null;
  }

  /** Deletes a transaction. Returns true when a row was removed. */
  async delete(id) {
    const result = await this.db.query('DELETE FROM transactions WHERE id = $1', [id]);
    return result.rowCount > 0;
  }
}

module.exports = TransactionRepository;
