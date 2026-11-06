const { AppError } = require('../errors/AppError');

/**
 * Turns an error thrown by a service into the standard ExpenseMate error response.
 * Known application errors keep their status/message; anything else becomes a generic 500.
 */
function sendError(res, err, fallbackMessage) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  console.error('[controller] Unexpected error:', err);
  return res.status(500).json({ success: false, message: fallbackMessage });
}

/** Parses a route id; returns null when it is not a whole number. */
function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

module.exports = { sendError, parseId };
