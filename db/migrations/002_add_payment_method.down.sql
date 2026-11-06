-- Rollback for 002. WARNING: payment_method values stored after the migration are lost.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS chk_transactions_payment_method;
ALTER TABLE transactions DROP COLUMN IF EXISTS payment_method;
