-- Quantidade de itens unitários por produto composto (caixa/pack).
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "packItemQty" DECIMAL(18, 4);
