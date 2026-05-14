-- Periodicidade para contas fixas (recorrentes) + vínculos com entrada e
-- número de controle para GoodsReceipt e StockMovement.

CREATE TYPE "Recurrence" AS ENUM ('NONE', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- Recorrência e vínculo com entrada (nota fiscal) em AccountPayable
ALTER TABLE "AccountPayable"
  ADD COLUMN IF NOT EXISTS "goodsReceiptId"    TEXT,
  ADD COLUMN IF NOT EXISTS "recurrence"        "Recurrence" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "recurrenceIndex"   INTEGER,
  ADD COLUMN IF NOT EXISTS "recurrenceCount"   INTEGER,
  ADD COLUMN IF NOT EXISTS "parentRecurringId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AccountPayable_goodsReceiptId_fkey'
  ) THEN
    ALTER TABLE "AccountPayable"
      ADD CONSTRAINT "AccountPayable_goodsReceiptId_fkey"
      FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AccountPayable_parentRecurringId_fkey'
  ) THEN
    ALTER TABLE "AccountPayable"
      ADD CONSTRAINT "AccountPayable_parentRecurringId_fkey"
      FOREIGN KEY ("parentRecurringId") REFERENCES "AccountPayable"("id") ON DELETE SET NULL;
  END IF;
END$$;

-- Recorrência em AccountReceivable
ALTER TABLE "AccountReceivable"
  ADD COLUMN IF NOT EXISTS "recurrence"        "Recurrence" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "recurrenceIndex"   INTEGER,
  ADD COLUMN IF NOT EXISTS "recurrenceCount"   INTEGER,
  ADD COLUMN IF NOT EXISTS "parentRecurringId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AccountReceivable_parentRecurringId_fkey'
  ) THEN
    ALTER TABLE "AccountReceivable"
      ADD CONSTRAINT "AccountReceivable_parentRecurringId_fkey"
      FOREIGN KEY ("parentRecurringId") REFERENCES "AccountReceivable"("id") ON DELETE SET NULL;
  END IF;
END$$;

-- Número de controle em GoodsReceipt e StockMovement
ALTER TABLE "GoodsReceipt"
  ADD COLUMN IF NOT EXISTS "controlNumber" SERIAL;
CREATE UNIQUE INDEX IF NOT EXISTS "GoodsReceipt_controlNumber_key"
  ON "GoodsReceipt"("controlNumber");

ALTER TABLE "StockMovement"
  ADD COLUMN IF NOT EXISTS "controlNumber" SERIAL;
CREATE UNIQUE INDEX IF NOT EXISTS "StockMovement_controlNumber_key"
  ON "StockMovement"("controlNumber");

-- Código de barras principal no Product (varchar(32))
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "defaultBarcode" VARCHAR(32);
