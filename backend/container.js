/**
 * Composition root: the ONE place where layers are wired together.
 * Dependency direction at runtime: Controller -> Service -> Repository -> Database.
 */
const db = require('./db/connection');
const { suggestCategory } = require('./utils/categorizer');

const TransactionRepository = require('./repositories/transactionRepository');
const CategoryRepository = require('./repositories/categoryRepository');
const TransactionService = require('./services/transactionService');

const categoryRepo = new CategoryRepository(db);
const transactionRepo = new TransactionRepository(db);

const transactionService = new TransactionService({
  transactionRepo,
  categoryRepo,
  categorizer: { suggestCategory }
});

module.exports = { transactionService };
