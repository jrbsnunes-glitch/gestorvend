-- DRAFT (NF-e manual) + cartas de correção (CC-e)
ALTER TYPE "FiscalDocumentStatus" ADD VALUE IF NOT EXISTS 'DRAFT';

CREATE TABLE IF NOT EXISTS "FiscalCorrectionLetter" (
  "id" TEXT NOT NULL,
  "fiscalDocumentId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "correctionText" VARCHAR(1000) NOT NULL,
  "protocol" VARCHAR(32),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FiscalCorrectionLetter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FiscalCorrectionLetter_fiscalDocumentId_sequence_key"
  ON "FiscalCorrectionLetter"("fiscalDocumentId", "sequence");

CREATE INDEX IF NOT EXISTS "FiscalCorrectionLetter_fiscalDocumentId_idx"
  ON "FiscalCorrectionLetter"("fiscalDocumentId");

DO $$ BEGIN
  ALTER TABLE "FiscalCorrectionLetter"
    ADD CONSTRAINT "FiscalCorrectionLetter_fiscalDocumentId_fkey"
    FOREIGN KEY ("fiscalDocumentId") REFERENCES "FiscalDocument"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
