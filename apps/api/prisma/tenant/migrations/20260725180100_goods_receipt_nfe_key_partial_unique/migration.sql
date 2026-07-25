-- Libera a chave NF-e para reimportação após cancelar a entrada
-- (unicidade só entre entradas não canceladas).
DROP INDEX IF EXISTS "GoodsReceipt_nfeAccessKey_key";
CREATE UNIQUE INDEX "GoodsReceipt_nfeAccessKey_active_key"
  ON "GoodsReceipt"("nfeAccessKey")
  WHERE "nfeAccessKey" IS NOT NULL AND "status" <> 'CANCELLED';
