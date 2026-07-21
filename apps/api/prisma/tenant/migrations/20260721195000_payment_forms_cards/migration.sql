-- Formas de pagamento cadastráveis + metadados de cartão em SalePayment

CREATE TYPE "PaymentFormKind" AS ENUM ('CASH', 'CARD', 'PIX', 'CREDIT', 'OTHER');
CREATE TYPE "CardBrand" AS ENUM (
  'VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'CABAL', 'DINERS',
  'SOROCRED', 'ALELO', 'VR', 'TICKET', 'OTHER'
);
CREATE TYPE "CardOperation" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "CardSettlementStatus" AS ENUM ('OPEN', 'SETTLED');

CREATE TABLE "PaymentForm" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "kind" "PaymentFormKind" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "cardBrand" "CardBrand",
  "cardOperation" "CardOperation",
  "adminFeePercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "adminFeeFixed" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "settlementDays" INTEGER NOT NULL DEFAULT 1,
  "maxInstallments" INTEGER NOT NULL DEFAULT 1,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentForm_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentForm_kind_isActive_idx" ON "PaymentForm"("kind", "isActive");
CREATE INDEX "PaymentForm_sortOrder_name_idx" ON "PaymentForm"("sortOrder", "name");

ALTER TABLE "SalePayment"
  ADD COLUMN "paymentFormId" TEXT,
  ADD COLUMN "cardBrand" "CardBrand",
  ADD COLUMN "cardOperation" "CardOperation",
  ADD COLUMN "adminFeeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "netAmount" DECIMAL(14,2),
  ADD COLUMN "settlementStatus" "CardSettlementStatus",
  ADD COLUMN "settledAt" TIMESTAMP(3),
  ADD COLUMN "expectedSettleAt" TIMESTAMP(3),
  ADD COLUMN "authCode" VARCHAR(40),
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "SalePayment_method_createdAt_idx" ON "SalePayment"("method", "createdAt");
CREATE INDEX "SalePayment_settlementStatus_expectedSettleAt_idx" ON "SalePayment"("settlementStatus", "expectedSettleAt");
CREATE INDEX "SalePayment_cardBrand_idx" ON "SalePayment"("cardBrand");
CREATE INDEX "SalePayment_paymentFormId_idx" ON "SalePayment"("paymentFormId");

ALTER TABLE "SalePayment"
  ADD CONSTRAINT "SalePayment_paymentFormId_fkey"
  FOREIGN KEY ("paymentFormId") REFERENCES "PaymentForm"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Formas padrão (não-cartão). Cartões o usuário cadastra com bandeira/taxas.
INSERT INTO "PaymentForm" ("id", "name", "kind", "isActive", "sortOrder", "updatedAt")
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'Dinheiro', 'CASH', true, 10, CURRENT_TIMESTAMP),
  ('a1000000-0000-4000-8000-000000000002', 'Pix', 'PIX', true, 20, CURRENT_TIMESTAMP),
  ('a1000000-0000-4000-8000-000000000003', 'Crediário', 'CREDIT', true, 30, CURRENT_TIMESTAMP),
  ('a1000000-0000-4000-8000-000000000004', 'Outro', 'OTHER', true, 90, CURRENT_TIMESTAMP);
