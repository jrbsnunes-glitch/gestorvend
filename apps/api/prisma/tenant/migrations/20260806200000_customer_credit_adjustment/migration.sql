-- Histórico de atualizações de saldo de crédito / valor de requisição
CREATE TABLE IF NOT EXISTS "CustomerCreditAdjustment" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "kind" "CreditKind" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "balanceAfter" DECIMAL(14,2) NOT NULL,
  "mode" VARCHAR(8) NOT NULL,
  "userId" TEXT,
  "userName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerCreditAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CustomerCreditAdjustment_customerId_kind_createdAt_idx"
  ON "CustomerCreditAdjustment"("customerId", "kind", "createdAt");

DO $$ BEGIN
  ALTER TABLE "CustomerCreditAdjustment"
    ADD CONSTRAINT "CustomerCreditAdjustment_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
