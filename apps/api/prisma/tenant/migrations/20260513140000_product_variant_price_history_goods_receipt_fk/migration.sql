-- Depende de GoodsReceipt (20260427234348_stock_goods_receipt).
-- Idempotente: ambientes onde a coluna já existia falhavam com P3018.

ALTER TABLE "ProductVariantPriceHistory" ADD COLUMN IF NOT EXISTS "goodsReceiptId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ProductVariantPriceHistory_goodsReceiptId_fkey'
  ) THEN
    ALTER TABLE "ProductVariantPriceHistory"
      ADD CONSTRAINT "ProductVariantPriceHistory_goodsReceiptId_fkey"
      FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
