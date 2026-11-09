-- Devolução / troca de itens de venda.

ALTER TYPE "SaleSource" ADD VALUE 'RETURN';
ALTER TYPE "UserPermissionCode" ADD VALUE 'SALE_RETURN';
ALTER TYPE "StockMovementSource" ADD VALUE 'RETURN';

ALTER TABLE "FiscalDocument" ADD COLUMN "finNFe" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "FiscalDocument" ADD COLUMN "refAccessKey" VARCHAR(44);

CREATE TYPE "SaleReturnKind" AS ENUM ('RETURN', 'EXCHANGE');
CREATE TYPE "SaleReturnRefundMethod" AS ENUM ('CASH', 'CUSTOMER_CREDIT');
CREATE TYPE "SaleReturnFiscalAction" AS ENUM ('NONE', 'CANCELLED_ORIGINAL', 'RETURN_NFE_QUEUED', 'CANCEL_FAILED');

CREATE TABLE "SaleReturn" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "saleId" TEXT NOT NULL,
    "kind" "SaleReturnKind" NOT NULL,
    "refundMethod" "SaleReturnRefundMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "creditApplied" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashRefundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditRestoredAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "requisitionReduced" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "fiscalAction" "SaleReturnFiscalAction" NOT NULL DEFAULT 'NONE',
    "fiscalMessage" VARCHAR(500),
    "userId" TEXT,
    "cashSessionId" TEXT,
    "replacementSaleId" TEXT,
    "returnInvoiceSaleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleReturnItem" (
    "id" TEXT NOT NULL,
    "saleReturnId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "totalLine" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "SaleReturnItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SaleReturn_number_key" ON "SaleReturn"("number");
CREATE UNIQUE INDEX "SaleReturn_replacementSaleId_key" ON "SaleReturn"("replacementSaleId");
CREATE UNIQUE INDEX "SaleReturn_returnInvoiceSaleId_key" ON "SaleReturn"("returnInvoiceSaleId");
CREATE INDEX "SaleReturn_saleId_idx" ON "SaleReturn"("saleId");
CREATE INDEX "SaleReturnItem_saleReturnId_idx" ON "SaleReturnItem"("saleReturnId");
CREATE INDEX "SaleReturnItem_saleItemId_idx" ON "SaleReturnItem"("saleItemId");

ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_replacementSaleId_fkey" FOREIGN KEY ("replacementSaleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_returnInvoiceSaleId_fkey" FOREIGN KEY ("returnInvoiceSaleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
