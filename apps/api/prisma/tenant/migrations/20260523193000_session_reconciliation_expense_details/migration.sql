ALTER TABLE "CashRegisterSession"
  ADD COLUMN IF NOT EXISTS "reconciliationExpenseDetails" JSONB;
