-- Preferências de impressão do cupom não fiscal (PDV). O "hint" da impressora
-- é apenas referência operacional; o destino real é escolhido pelo SO/navegador na máquina do operador.
ALTER TABLE "Company" ADD COLUMN "saleReceiptAutoPrint" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "saleReceiptPrinterHint" TEXT;
