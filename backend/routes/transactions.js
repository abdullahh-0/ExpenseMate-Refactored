const express = require('express');
const router = express.Router();
const {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  clearTransactions,
  autoCategorize
} = require('../controllers/transactionController');

router.get('/', getTransactions);
router.post('/', createTransaction);
router.put('/:id', updateTransaction);
router.delete('/', clearTransactions);
router.delete('/:id', deleteTransaction);
router.post('/suggest-category', autoCategorize);

module.exports = router;
