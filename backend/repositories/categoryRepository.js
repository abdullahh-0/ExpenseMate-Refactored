/**
 * Data access for the categories table. Contains SQL only - no business rules.
 */
class CategoryRepository {
  constructor(db) {
    this.db = db;
  }

  /** Exact-name lookup. Returns { id } or null. */
  async findByName(name) {
    const result = await this.db.query('SELECT id FROM categories WHERE name = $1', [name]);
    return result.rows[0] || null;
  }

  /** Case-insensitive lookup by lower-cased name. Returns { id, name, type } or null. */
  async findByLowerName(lowerName) {
    const result = await this.db.query(
      'SELECT id, name, type FROM categories WHERE LOWER(name) = $1',
      [lowerName]
    );
    return result.rows[0] || null;
  }

  /** Inserts a category and returns { id }. */
  async create({ name, type }) {
    const result = await this.db.query(
      'INSERT INTO categories (name, type) VALUES ($1, $2) RETURNING id',
      [name, type]
    );
    return result.rows[0];
  }
}

module.exports = CategoryRepository;
