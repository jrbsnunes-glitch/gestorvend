-- Observação do comprovante de venda. Não compõe a NF-e/NFC-e.
ALTER TABLE "Sale" ADD COLUMN "receiptNote" VARCHAR(500);
