-- Migration 002: persist the payment method chosen in the UI.
-- Before: the UI sent payment_method but the schema had no column, so it was dropped
--         and every transaction was displayed as 'Cash' by a front-end fallback.
-- After:  payment_method is stored per transaction. Existing rows are backfilled with
--         'Cash' (exactly what the UI already displayed for them).
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) NOT NULL DEFAULT 'Cash';

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS chk_transactions_payment_method;
ALTER TABLE transactions
    ADD CONSTRAINT chk_transactions_payment_method
    CHECK (payment_method IN ('Cash', 'Debit Card', 'Credit Card', 'Bank Transfer', 'Mobile Wallet'));
