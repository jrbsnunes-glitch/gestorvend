-- Auto-lançamento de entrada a partir da caixa NF-e (Distribuição DF-e).
ALTER TABLE "FiscalIssuerSettings"
  ADD COLUMN IF NOT EXISTS "inboundAutoReceiptEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "inboundAutoReceiptPostStock" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "inboundAutoReceiptMinMatchPercent" INTEGER NOT NULL DEFAULT 100;
