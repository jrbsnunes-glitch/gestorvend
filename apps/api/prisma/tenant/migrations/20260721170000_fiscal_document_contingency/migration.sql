-- Contingência: status + tpEmis para listagem / reenvio posterior.
ALTER TYPE "FiscalDocumentStatus" ADD VALUE 'CONTINGENCY';

ALTER TABLE "FiscalDocument"
  ADD COLUMN IF NOT EXISTS "tpEmis" INTEGER NOT NULL DEFAULT 1;
