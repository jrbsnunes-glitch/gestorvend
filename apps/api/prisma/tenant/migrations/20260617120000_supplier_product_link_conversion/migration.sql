-- AlterTable Product: conversão de unidade na entrada NF-e
ALTER TABLE "Product" ADD COLUMN "conversion" VARCHAR(32);

-- CreateTable SupplierProductLink
CREATE TABLE "SupplierProductLink" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "supplierProductCode" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProductLink_pkey" PRIMARY KEY ("id")
);

-- AlterTable GoodsReceiptItem
ALTER TABLE "GoodsReceiptItem" ADD COLUMN "supplierProductCode" VARCHAR(60);
ALTER TABLE "GoodsReceiptItem" ADD COLUMN "invoiceUnit" VARCHAR(10);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProductLink_supplierId_supplierProductCode_key" ON "SupplierProductLink"("supplierId", "supplierProductCode");
CREATE INDEX "SupplierProductLink_variantId_idx" ON "SupplierProductLink"("variantId");

-- AddForeignKey
ALTER TABLE "SupplierProductLink" ADD CONSTRAINT "SupplierProductLink_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierProductLink" ADD CONSTRAINT "SupplierProductLink_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
