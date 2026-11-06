const { sendError, parseId } = require('./helpers');
const { ValidationError } = require('../errors/AppError');

/**
 * HTTP adapter for budgets: reads the request, calls the service, writes the response.
 * No SQL and no business rules live here.
 */
function createBudgetController(service) {
  // GET /api/budgets
  const getBudgets = async (req, res) => {
    try {
      const data = await service.getSummary({
        month: req.query.month,
        year: req.query.year,
        currency: req.query.currency
      });
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err, 'Failed to fetch budget status.');
    }
  };

  // POST /api/budgets
  const createOrUpdateBudget = async (req, res) => {
    try {
      const body = req.body;
      const data = await service.setBudget({
        categoryId: body.category_id,
        month: body.month,
        year: body.year,
        amount: body.amount !== undefined ? body.amount : body.amount_limit, // legacy field name
        currency: body.currency
      });
      return res.status(201).json({ success: true, message: 'Budget ceiling set successfully.', data });
    } catch (err) {
      return sendError(res, err, 'Unable to set budget.');
    }
  };

  // DELETE /api/budgets/:id
  const deleteBudget = async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) throw new ValidationError('Budget id must be a number.');
      await service.deleteBudget(id);
      return res.json({ success: true, message: 'Budget cap deleted.' });
    } catch (err) {
      return sendError(res, err, 'Unable to delete budget.');
    }
  };

  return { getBudgets, createOrUpdateBudget, deleteBudget };
}

const handlers = createBudgetController(require('../container').budgetService);

module.exports = {
  ...handlers,
  createBudgetController,
  calculateBudgetStatus: require('../services/budgetService').calculateBudgetStatus // kept for backward compatibility
};
