-- CreateTable (FK para GoodsReceipt vem em migração posterior, após existir GoodsReceipt)
CREATE TABLE "ProductVariantPriceHistory" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "field" VARCHAR(16) NOT NULL,
    "previousValue" DECIMAL(14,4) NOT NULL,
    "newValue" DECIMAL(14,4) NOT NULL,
    "source" VARCHAR(24) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVariantPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductVariantPriceHistory_variantId_createdAt_idx" ON "ProductVariantPriceHistory"("variantId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductVariantPriceHistory" ADD CONSTRAINT "ProductVariantPriceHistory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
