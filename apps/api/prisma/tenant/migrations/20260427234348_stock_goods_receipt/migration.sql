-- CreateEnum
CREATE TYPE "StockMovementSource" AS ENUM ('SALE', 'GOODS_RECEIPT', 'MANUAL_OUT', 'ADJUSTMENT', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "GoodsReceiptMode" AS ENUM ('WITH_NFE_KEY', 'WITHOUT_NFE');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('DRAFT', 'POSTED');

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "goodsReceiptId" TEXT,
ADD COLUMN     "outboundReason" TEXT,
ADD COLUMN     "source" "StockMovementSource" NOT NULL DEFAULT 'OTHER';

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "mode" "GoodsReceiptMode" NOT NULL,
    "nfeAccessKey" VARCHAR(44),
    "supplierId" TEXT,
    "documentNumber" TEXT,
    "series" TEXT,
    "issueDate" TIMESTAMP(3),
    "natureOperation" TEXT,
    "totalValue" DECIMAL(14,2),
    "notes" TEXT,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptItem" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "ncm" TEXT,
    "cfop" TEXT,
    "description" TEXT,

    CONSTRAINT "GoodsReceiptItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
