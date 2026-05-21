-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'EXPENSE';

-- AlterTable
ALTER TABLE "CashMovement" ADD COLUMN "referentialAccountId" TEXT;

-- AlterTable
ALTER TABLE "PayableSettlement" ADD COLUMN "referentialAccountId" TEXT;

-- AlterTable
ALTER TABLE "ReceivableSettlement" ADD COLUMN "referentialAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_referentialAccountId_fkey" FOREIGN KEY ("referentialAccountId") REFERENCES "ReferentialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayableSettlement" ADD CONSTRAINT "PayableSettlement_referentialAccountId_fkey" FOREIGN KEY ("referentialAccountId") REFERENCES "ReferentialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivableSettlement" ADD CONSTRAINT "ReceivableSettlement_referentialAccountId_fkey" FOREIGN KEY ("referentialAccountId") REFERENCES "ReferentialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "CashMovement_referentialAccountId_idx" ON "CashMovement"("referentialAccountId");
CREATE INDEX IF NOT EXISTS "PayableSettlement_referentialAccountId_idx" ON "PayableSettlement"("referentialAccountId");
CREATE INDEX IF NOT EXISTS "ReceivableSettlement_referentialAccountId_idx" ON "ReceivableSettlement"("referentialAccountId");
