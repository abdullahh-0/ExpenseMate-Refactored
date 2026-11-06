const { ValidationError, NotFoundError } = require('../errors/AppError');
const { validateTransactionInput } = require('../utils/validators');

const VALID_TYPES = ['income', 'expense'];

/**
 * Business rules for transactions: validation, auto-categorisation, defaults.
 * Knows nothing about HTTP or SQL - repositories and the categoriser are injected.
 */
class TransactionService {
  constructor({ transactionRepo, categoryRepo, categorizer }) {
    this.transactionRepo = transactionRepo;
    this.categoryRepo = categoryRepo;
    this.categorizer = categorizer;
  }

  async list(query = {}) {
    const filters = {};

    if (query.search && query.search.trim()) {
      filters.search = query.search.trim().toLowerCase();
    }
    if (VALID_TYPES.includes(query.type)) {
      filters.type = query.type;
    }
    if (query.categoryId) {
      const categoryId = parseInt(query.categoryId, 10);
      if (Number.isNaN(categoryId)) throw new ValidationError('Category filter must be a number.');
      filters.categoryId = categoryId;
    }
    if (query.currency) {
      filters.currency = query.currency.toUpperCase();
    }
    if (query.startDate) filters.startDate = query.startDate;
    if (query.endDate) filters.endDate = query.endDate;
    filters.sortBy = query.sortBy === 'amount' ? 'amount' : 'date';

    return this.transactionRepo.findAll(filters);
  }

  async create(input) {
    this._validate(input);

    // Auto-categorisation fallback when the user did not pick a category
    const categoryId = input.categoryId || (await this._resolveCategoryId(input.description, input.type));

    return this.transactionRepo.create({
      date: input.date,
      description: input.description.trim(),
      amount: parseFloat(input.amount),
      type: input.type,
      categoryId,
      currency: input.currency || 'PKR',
      paymentMethod: input.paymentMethod || 'Cash'
    });
  }

  async update(id, input) {
    this._validate(input);
    const categoryId = parseInt(input.categoryId, 10);
    if (Number.isNaN(categoryId)) throw new ValidationError('A valid category is required.');

    const updated = await this.transactionRepo.update(id, {
      date: input.date,
      description: input.description.trim(),
      amount: parseFloat(input.amount),
      type: input.type,
      categoryId,
      currency: input.currency || 'PKR',
      paymentMethod: input.paymentMethod || 'Cash'
    });
    if (!updated) throw new NotFoundError('Transaction record not found.');
    return updated;
  }

  async remove(id) {
    const deleted = await this.transactionRepo.delete(id);
    if (!deleted) throw new NotFoundError('Transaction record not found.');
  }

  /**
   * Clears the whole transaction history. Destructive, so the caller must confirm explicitly.
   * Budgets are left untouched; their "spent" figures are derived from transactions and drop to zero.
   * @returns {Promise<{deleted:number}>}
   */
  async clearAll({ confirmed } = {}) {
    if (confirmed !== true) {
      throw new ValidationError('Clearing the transaction history must be confirmed explicitly.');
    }
    const deleted = await this.transactionRepo.deleteAll();
    return { deleted };
  }

  /** Suggests a category for a description; falls back to an unsaved expense category. */
  async suggestCategory(description) {
    const suggestedName = this.categorizer.suggestCategory(description);
    const found = await this.categoryRepo.findByLowerName(suggestedName.toLowerCase());
    const category = found || { id: null, name: suggestedName, type: 'expense' };
    return { suggestedCategory: category.name, category };
  }

  // ---- private helpers ----

  _validate(input) {
    const validation = validateTransactionInput({
      date: input.date,
      description: input.description,
      amount: input.amount,
      type: input.type,
      payment_method: input.paymentMethod
    });
    if (!validation.valid) throw new ValidationError(validation.errors.join(' '));
  }

  async _resolveCategoryId(description, type) {
    const name = this.categorizer.suggestCategory(description);
    const existing = await this.categoryRepo.findByName(name);
    if (existing) return existing.id;
    const created = await this.categoryRepo.create({ name, type: type || 'expense' });
    return created.id;
  }
}

module.exports = TransactionService;
