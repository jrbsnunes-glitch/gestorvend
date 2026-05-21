-- Conferência de caixa pelo gerente (valores apresentados + auditoria)

ALTER TABLE "CashRegisterSession"
  ADD COLUMN IF NOT EXISTS "reconciledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reconciledByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "reconciliationNotes" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CashRegisterSession_reconciledByUserId_fkey'
  ) THEN
    ALTER TABLE "CashRegisterSession"
      ADD CONSTRAINT "CashRegisterSession_reconciledByUserId_fkey"
      FOREIGN KEY ("reconciledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
