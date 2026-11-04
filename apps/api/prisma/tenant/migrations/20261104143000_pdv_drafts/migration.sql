-- Rascunhos PDV (reserva de estoque 24h) + parâmetro na empresa
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "pdvDraftsEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SaleReservation" ADD COLUMN IF NOT EXISTS "isPdvDraft" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SaleReservation" ADD COLUMN IF NOT EXISTS "pdvTerminalId" TEXT;
ALTER TABLE "SaleReservation" ADD COLUMN IF NOT EXISTS "pdvSurcharge" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "SaleReservation" ADD COLUMN IF NOT EXISTS "pdvSellerUserId" TEXT;

CREATE INDEX IF NOT EXISTS "SaleReservation_isPdvDraft_status_userId_idx"
  ON "SaleReservation"("isPdvDraft", "status", "userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SaleReservation_pdvTerminalId_fkey'
  ) THEN
    ALTER TABLE "SaleReservation"
      ADD CONSTRAINT "SaleReservation_pdvTerminalId_fkey"
      FOREIGN KEY ("pdvTerminalId") REFERENCES "PdvTerminal"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
