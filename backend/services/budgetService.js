const { ValidationError } = require('../errors/AppError');

// The app's current reporting period and currency (previously hard-coded inside the controller).
const DEFAULTS = { month: 9, year: 2026, currency: 'PKR' };
const OVERALL_MONTH_VALUES = ['overall', '0', 'all'];

/** Evaluates how much of a budget has been used and which warning level applies. */
function calculateBudgetStatus(budgetAmount, actualSpent) {
  const budget = parseFloat(budgetAmount) || 0;
  const spent = parseFloat(actualSpent) || 0;
  const remaining = budget - spent;
  const percentage = budget > 0 ? Math.round((spent / budget) * 100) : 0;

  let status = 'normal';
  let statusLabel = 'Normal';
  let level = 'success';

  if (percentage >= 100) {
    status = 'exceeded';
    statusLabel = 'Exceeded Limit';
    level = 'danger';
  } else if (percentage >= 90) {
    status = 'critical';
    statusLabel = 'Critical Limit';
    level = 'warning';
  } else if (percentage >= 80) {
    status = 'warning';
    statusLabel = 'Warning';
    level = 'info';
  }

  return {
    budgetAmount: budget,
    amount_limit: budget,
    amount: budget,
    spent,
    actual_spent: spent,
    remaining,
    remaining_budget: remaining,
    percentage,
    percentage_used: percentage,
    status: status.toUpperCase(),
    warning_status: status.toUpperCase(),
    statusLabel,
    level
  };
}

/** Business rules for budgets: period defaults, usage/status calculation, upsert. */
class BudgetService {
  constructor({ budgetRepo }) {
    this.budgetRepo = budgetRepo;
  }

  /** Budget limits for a month (or the whole year) with spending and warning status attached. */
  async getSummary({ month, year, currency } = {}) {
    const isOverall = OVERALL_MONTH_VALUES.includes(String(month));
    const period = {
      month: isOverall ? 0 : parseInt(month, 10) || DEFAULTS.month,
      year: parseInt(year, 10) || DEFAULTS.year,
      currency: currency || DEFAULTS.currency
    };

    const [limits, spentRows] = isOverall
      ? await Promise.all([
          this.budgetRepo.findLimitsForYear(period),
          this.budgetRepo.sumExpensesByCategoryForYear(period)
        ])
      : await Promise.all([
          this.budgetRepo.findLimitsForMonth(period),
          this.budgetRepo.sumExpensesByCategoryForMonth(period)
        ]);

    const spentByCategory = {};
    spentRows.forEach((row) => {
      spentByCategory[row.category_id] = parseFloat(row.total_spent);
    });

    return limits.map((budget) => ({
      ...budget,
      ...calculateBudgetStatus(budget.amount, spentByCategory[budget.category_id] || 0)
    }));
  }

  /** Creates a budget cap, or updates the amount when one already exists for that category/period. */
  async setBudget({ categoryId, month, year, amount, currency }) {
    const categoryIdNum = parseInt(categoryId, 10);
    const amountNum = parseFloat(amount);
    if (!categoryIdNum || !amount || !(amountNum > 0)) {
      throw new ValidationError('Category and a positive budget amount are required.');
    }

    const key = {
      categoryId: categoryIdNum,
      month: parseInt(month, 10) || DEFAULTS.month,
      year: parseInt(year, 10) || DEFAULTS.year,
      currency: currency || DEFAULTS.currency
    };

    const existing = await this.budgetRepo.findIdByKey(key);
    if (existing) {
      return this.budgetRepo.updateAmount(existing.id, amountNum);
    }
    return this.budgetRepo.insert({ ...key, amount: amountNum });
  }

  async deleteBudget(id) {
    await this.budgetRepo.delete(id);
  }
}

module.exports = BudgetService;
module.exports.calculateBudgetStatus = calculateBudgetStatus;
module.exports.DEFAULTS = DEFAULTS;
