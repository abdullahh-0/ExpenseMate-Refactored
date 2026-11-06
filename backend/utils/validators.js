const PAYMENT_METHODS = ['Cash', 'Debit Card', 'Credit Card', 'Bank Transfer', 'Mobile Wallet'];

function validatePaymentMethod(method) {
  if (method === undefined || method === null || method === '') {
    return { valid: true, value: 'Cash' };
  }
  if (!PAYMENT_METHODS.includes(method)) {
    return { valid: false, message: 'Payment method must be one of: ' + PAYMENT_METHODS.join(', ') + '.' };
  }
  return { valid: true, value: method };
}

function validateAmount(amount) {
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) {
    return { valid: false, message: 'Amount must be greater than zero.' };
  }
  return { valid: true, value: num };
}

function validateDate(dateStr) {
  if (!dateStr) {
    return { valid: false, message: 'Please provide a valid date.' };
  }
  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())) {
    return { valid: false, message: 'Please provide a valid date format (YYYY-MM-DD).' };
  }
  return { valid: true, value: dateStr.toString().substring(0, 10) };
}

function validateTransactionType(type) {
  const t = (type || '').toLowerCase().trim();
  if (t !== 'income' && t !== 'expense') {
    return { valid: false, message: 'Transaction type must be either income or expense.' };
  }
  return { valid: true, value: t };
}

function validateTransactionInput(data) {
  const errors = [];

  if (!data.description || !data.description.trim()) {
    errors.push('Description is required.');
  }

  const amt = validateAmount(data.amount);
  if (!amt.valid) errors.push(amt.message);

  const dt = validateDate(data.date);
  if (!dt.valid) errors.push(dt.message);

  const tp = validateTransactionType(data.type);
  if (!tp.valid) errors.push(tp.message);

  const pm = validatePaymentMethod(data.payment_method);
  if (!pm.valid) errors.push(pm.message);

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateAmount,
  validateDate,
  validateTransactionType,
  validatePaymentMethod,
  validateTransactionInput,
  PAYMENT_METHODS
};
