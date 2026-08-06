-- Repasse opcional de taxa de cartão ao cliente + rastreio na venda.
ALTER TABLE "PaymentForm"
  ADD COLUMN IF NOT EXISTS "passAdminFeeToCustomer" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Sale"
  ADD COLUMN IF NOT EXISTS "cardFeeSurcharge" DECIMAL(14, 2) NOT NULL DEFAULT 0;
