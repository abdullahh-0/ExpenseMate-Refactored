/**
 * Composition root: the ONE place where layers are wired together.
 * Dependency direction at runtime: Controller -> Service -> Repository -> Database.
 */
const db = require('./db/connection');

const TransactionRepository = require('./repositories/transactionRepository');
const CategoryRepository = require('./repositories/categoryRepository');
const BudgetRepository = require('./repositories/budgetRepository');
const TransactionService = require('./services/transactionService');
const BudgetService = require('./services/budgetService');
const CategoryClassifier = require('./services/categoryClassifier');

const categoryRepo = new CategoryRepository(db);
const transactionRepo = new TransactionRepository(db);
const budgetRepo = new BudgetRepository(db);

const transactionService = new TransactionService({
  transactionRepo,
  categoryRepo,
  categorizer: new CategoryClassifier()
});

const budgetService = new BudgetService({ budgetRepo });

module.exports = { transactionService, budgetService };
