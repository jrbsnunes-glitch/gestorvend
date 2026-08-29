-- Vínculo terminal PDV GestorVend ↔ Mercado Pago Point (Smart POS)

ALTER TABLE "PdvTerminal" ADD COLUMN "mpPointTerminalId" VARCHAR(128);

CREATE INDEX "PdvTerminal_mpPointTerminalId_idx" ON "PdvTerminal"("mpPointTerminalId");
