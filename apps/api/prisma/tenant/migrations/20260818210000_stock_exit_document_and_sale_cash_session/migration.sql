-- Saída manual de estoque como documento (1 saída, N produtos) com cancelamento,
-- e vínculo explícito de venda com caixa (requisição lançada fora do PDV).

CREATE TYPE "StockExitStatus" AS ENUM ('POSTED', 'CANCELLED');

CREATE TABLE "StockExit" (
  "id" TEXT NOT NULL,
  "controlNumber" SERIAL NOT NULL,
  "locationId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "reference" TEXT,
  "status" "StockExitStatus" NOT NULL DEFAULT 'POSTED',
  "userId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancellationNotes" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockExit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockExit_controlNumber_key" ON "StockExit"("controlNumber");
CREATE INDEX "StockExit_status_createdAt_idx" ON "StockExit"("status", "createdAt");
CREATE INDEX "StockExit_locationId_idx" ON "StockExit"("locationId");

ALTER TABLE "StockExit"
  ADD CONSTRAINT "StockExit_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockExit"
  ADD CONSTRAINT "StockExit_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StockExitItem" (
  "id" TEXT NOT NULL,
  "exitId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockExitItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockExitItem_exitId_variantId_key"
  ON "StockExitItem"("exitId", "variantId");
CREATE INDEX "StockExitItem_variantId_idx" ON "StockExitItem"("variantId");

ALTER TABLE "StockExitItem"
  ADD CONSTRAINT "StockExitItem_exitId_fkey"
  FOREIGN KEY ("exitId") REFERENCES "StockExit"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockExitItem"
  ADD CONSTRAINT "StockExitItem_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
  ADD COLUMN IF NOT EXISTS "stockExitId" TEXT;

CREATE INDEX IF NOT EXISTS "StockMovement_stockExitId_idx"
  ON "StockMovement"("stockExitId");

ALTER TABLE "StockMovement"
  DROP CONSTRAINT IF EXISTS "StockMovement_stockExitId_fkey";

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_stockExitId_fkey"
  FOREIGN KEY ("stockExitId") REFERENCES "StockExit"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Requisição lançada fora do PDV: origem própria e caixa alvo do lançamento.
ALTER TYPE "SaleSource" ADD VALUE IF NOT EXISTS 'REQUISITION';

ALTER TABLE "Sale"
  ADD COLUMN IF NOT EXISTS "cashSessionId" TEXT;

CREATE INDEX IF NOT EXISTS "Sale_cashSessionId_idx" ON "Sale"("cashSessionId");

ALTER TABLE "Sale"
  DROP CONSTRAINT IF EXISTS "Sale_cashSessionId_fkey";

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_cashSessionId_fkey"
  FOREIGN KEY ("cashSessionId") REFERENCES "CashRegisterSession"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
