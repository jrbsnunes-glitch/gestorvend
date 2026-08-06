-- AlterEnum PaymentMethod
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'REQUISITION';

-- AlterEnum PaymentFormKind
ALTER TYPE "PaymentFormKind" ADD VALUE IF NOT EXISTS 'REQUISITION';

-- CreateEnum CreditKind
DO $$ BEGIN
  CREATE TYPE "CreditKind" AS ENUM ('CREDIT', 'REQUISITION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable Customer
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "requisitionLimit" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable AccountReceivable
ALTER TABLE "AccountReceivable" ADD COLUMN IF NOT EXISTS "creditKind" "CreditKind";
ALTER TABLE "AccountReceivable" ADD COLUMN IF NOT EXISTS "cashControlNote" VARCHAR(255);

CREATE INDEX IF NOT EXISTS "AccountReceivable_customerId_creditKind_status_idx"
  ON "AccountReceivable"("customerId", "creditKind", "status");

-- CreateTable AccountReceivableItem
CREATE TABLE IF NOT EXISTS "AccountReceivableItem" (
  "id" TEXT NOT NULL,
  "receivableId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(14,4) NOT NULL,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "totalLine" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountReceivableItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AccountReceivableItem_receivableId_idx"
  ON "AccountReceivableItem"("receivableId");

DO $$ BEGIN
  ALTER TABLE "AccountReceivableItem"
    ADD CONSTRAINT "AccountReceivableItem_receivableId_fkey"
    FOREIGN KEY ("receivableId") REFERENCES "AccountReceivable"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
