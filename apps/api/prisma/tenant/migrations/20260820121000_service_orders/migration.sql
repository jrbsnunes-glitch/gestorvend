-- AlterEnum
ALTER TYPE "StockMovementSource" ADD VALUE 'SERVICE_ORDER';

-- AlterEnum
ALTER TYPE "SaleSource" ADD VALUE 'SERVICE_ORDER';

-- CreateEnum
CREATE TYPE "ServiceOrderBillingMode" AS ENUM ('PDV', 'INTERNAL', 'CHOICE_PER_ORDER');
CREATE TYPE "ServiceOrderStatus" AS ENUM ('DRAFT', 'QUOTE', 'APPROVED', 'IN_PROGRESS', 'WAITING_PARTS', 'READY', 'DELIVERED', 'BILLED', 'CANCELLED');
CREATE TYPE "ServiceOrderType" AS ENUM ('CORRECTIVE', 'PREVENTIVE', 'WARRANTY', 'INSTALLATION', 'INSPECTION', 'OTHER');
CREATE TYPE "ServiceOrderItemKind" AS ENUM ('PART', 'SERVICE', 'LABOR', 'OTHER');

-- AlterTable Company
ALTER TABLE "Company" ADD COLUMN "serviceOrderModuleEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "serviceOrderDefaultBillingMode" "ServiceOrderBillingMode" NOT NULL DEFAULT 'CHOICE_PER_ORDER';
ALTER TABLE "Company" ADD COLUMN "serviceOrderRequireEquipment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "serviceOrderAllowQuote" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Company" ADD COLUMN "serviceOrderTermsText" TEXT;

-- AlterTable Product
ALTER TABLE "Product" ADD COLUMN "isService" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable CustomerEquipment
CREATE TABLE "CustomerEquipment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "equipmentType" VARCHAR(64),
    "brand" VARCHAR(80),
    "model" VARCHAR(80),
    "serialNumber" VARCHAR(80),
    "plateOrTag" VARCHAR(40),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerEquipment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerEquipment_customerId_idx" ON "CustomerEquipment"("customerId");
CREATE INDEX "CustomerEquipment_serialNumber_idx" ON "CustomerEquipment"("serialNumber");
CREATE INDEX "CustomerEquipment_plateOrTag_idx" ON "CustomerEquipment"("plateOrTag");

ALTER TABLE "CustomerEquipment" ADD CONSTRAINT "CustomerEquipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable ServiceOrder
CREATE TABLE "ServiceOrder" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "status" "ServiceOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "type" "ServiceOrderType" NOT NULL DEFAULT 'CORRECTIVE',
    "customerId" TEXT NOT NULL,
    "equipmentId" TEXT,
    "assetDescription" TEXT,
    "problemReport" TEXT,
    "diagnosis" TEXT,
    "internalNotes" TEXT,
    "intakeChecklist" JSONB,
    "openedById" TEXT,
    "assignedToId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promisedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "saleId" TEXT,
    "depositAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "depositSaleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceOrder_number_key" ON "ServiceOrder"("number");
CREATE UNIQUE INDEX "ServiceOrder_saleId_key" ON "ServiceOrder"("saleId");
CREATE UNIQUE INDEX "ServiceOrder_depositSaleId_key" ON "ServiceOrder"("depositSaleId");
CREATE INDEX "ServiceOrder_status_openedAt_idx" ON "ServiceOrder"("status", "openedAt");
CREATE INDEX "ServiceOrder_customerId_idx" ON "ServiceOrder"("customerId");
CREATE INDEX "ServiceOrder_equipmentId_idx" ON "ServiceOrder"("equipmentId");
CREATE INDEX "ServiceOrder_assignedToId_idx" ON "ServiceOrder"("assignedToId");

ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "CustomerEquipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_depositSaleId_fkey" FOREIGN KEY ("depositSaleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable ServiceOrderItem
CREATE TABLE "ServiceOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "ServiceOrderItemKind" NOT NULL DEFAULT 'PART',
    "variantId" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalLine" DECIMAL(14,2) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceOrderItem_orderId_idx" ON "ServiceOrderItem"("orderId");
CREATE INDEX "ServiceOrderItem_variantId_idx" ON "ServiceOrderItem"("variantId");

ALTER TABLE "ServiceOrderItem" ADD CONSTRAINT "ServiceOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceOrderItem" ADD CONSTRAINT "ServiceOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable ServiceOrderStatusLog
CREATE TABLE "ServiceOrderStatusLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "ServiceOrderStatus",
    "toStatus" "ServiceOrderStatus" NOT NULL,
    "userId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceOrderStatusLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceOrderStatusLog_orderId_createdAt_idx" ON "ServiceOrderStatusLog"("orderId", "createdAt");

ALTER TABLE "ServiceOrderStatusLog" ADD CONSTRAINT "ServiceOrderStatusLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
