const { sendError, parseId } = require('./helpers');
const { ValidationError } = require('../errors/AppError');

/**
 * HTTP adapter for transactions: reads the request, calls the service, writes the response.
 * No SQL and no business rules live here.
 */
function createTransactionController(service) {
  // Maps the HTTP body (snake_case) to the service's input shape
  const toInput = (body) => ({
    date: body.date,
    description: body.description,
    amount: body.amount,
    type: body.type,
    categoryId: body.category_id,
    currency: body.currency,
    paymentMethod: body.payment_method
  });

  // GET /api/transactions
  const getTransactions = async (req, res) => {
    try {
      const q = req.query;
      const data = await service.list({
        search: q.search,
        type: q.type,
        categoryId: q.category_id,
        currency: q.currency,
        sortBy: q.sort_by,
        startDate: q.startDate || q.start_date,
        endDate: q.endDate || q.end_date
      });
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err, 'Failed to fetch transactions.');
    }
  };

  // POST /api/transactions
  const createTransaction = async (req, res) => {
    try {
      const data = await service.create(toInput(req.body));
      return res.status(201).json({ success: true, message: 'Transaction saved successfully.', data });
    } catch (err) {
      return sendError(res, err, 'Unable to save transaction.');
    }
  };

  // PUT /api/transactions/:id
  const updateTransaction = async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) throw new ValidationError('Transaction id must be a number.');
      const data = await service.update(id, toInput(req.body));
      return res.json({ success: true, message: 'Transaction updated successfully.', data });
    } catch (err) {
      return sendError(res, err, 'Unable to update transaction.');
    }
  };

  // DELETE /api/transactions/:id
  const deleteTransaction = async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) throw new ValidationError('Transaction id must be a number.');
      await service.remove(id);
      return res.json({ success: true, message: 'Transaction deleted successfully.' });
    } catch (err) {
      return sendError(res, err, 'Unable to delete transaction.');
    }
  };

  // DELETE /api/transactions?confirm=true  (clears the whole history)
  const clearTransactions = async (req, res) => {
    try {
      const { deleted } = await service.clearAll({ confirmed: req.query.confirm === 'true' });
      return res.json({ success: true, message: 'Transaction history cleared.', deleted });
    } catch (err) {
      return sendError(res, err, 'Unable to clear transaction history.');
    }
  };

  // POST /api/transactions/suggest-category
  const autoCategorize = async (req, res) => {
    try {
      const { suggestedCategory, category } = await service.suggestCategory(req.body.description);
      return res.json({ success: true, suggestedCategory, category });
    } catch (err) {
      return sendError(res, err, 'Unable to suggest a category.');
    }
  };

  return { getTransactions, createTransaction, updateTransaction, deleteTransaction, clearTransactions, autoCategorize };
}

const handlers = createTransactionController(require('../container').transactionService);

module.exports = { ...handlers, createTransactionController };
