-- Produto composto (caixa): vínculo opcional para o SKU unitário de estoque.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "stockComponentVariantId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Product_stockComponentVariantId_fkey'
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_stockComponentVariantId_fkey"
      FOREIGN KEY ("stockComponentVariantId") REFERENCES "ProductVariant"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Product_stockComponentVariantId_idx"
  ON "Product"("stockComponentVariantId");
