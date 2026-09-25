-- AlterEnum
ALTER TYPE "StockMovementSource" ADD VALUE IF NOT EXISTS 'MANUFACTURING';

-- AlterTable Company
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "factoryModuleEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "factoryIssuePctAtStart" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "factoryIssuePctDevelopment" DECIMAL(5,2) NOT NULL DEFAULT 50;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "factoryQuoteTermsText" TEXT;

-- AlterTable Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isManufacturedFinishedGood" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "manufacturingLeadTimeDays" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "showInPublicCatalog" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "Product_isManufacturedFinishedGood_idx" ON "Product"("isManufacturedFinishedGood");
CREATE INDEX IF NOT EXISTS "Product_showInPublicCatalog_idx" ON "Product"("showInPublicCatalog");

-- CreateEnum
CREATE TYPE "ManufacturingProjectStatus" AS ENUM ('PRODUCT_SELECTION', 'QUOTE', 'STARTED', 'IN_DEVELOPMENT', 'TESTING', 'FINISHED', 'CANCELLED');
CREATE TYPE "ManufacturingProjectSource" AS ENUM ('INTERNAL', 'CATALOG', 'WHATSAPP_LINK', 'INSTAGRAM', 'OTHER');
CREATE TYPE "ManufacturingConsumePhase" AS ENUM ('STARTED', 'IN_DEVELOPMENT', 'TESTING', 'FINISHED', 'MANUAL');

-- CreateTable
CREATE TABLE "ManufacturingProject" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "status" "ManufacturingProjectStatus" NOT NULL DEFAULT 'PRODUCT_SELECTION',
    "source" "ManufacturingProjectSource" NOT NULL DEFAULT 'INTERNAL',
    "externalRef" VARCHAR(120),
    "customerId" TEXT NOT NULL,
    "finishedVariantId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "title" VARCHAR(200),
    "customerBrief" TEXT,
    "technicalSpec" TEXT,
    "deliveryNotes" TEXT,
    "internalNotes" TEXT,
    "qualityNotes" TEXT,
    "quoteTotal" DECIMAL(14,2),
    "depositAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "promisedAt" TIMESTAMP(3),
    "quotedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "openedById" TEXT,
    "technicalResponsibleId" TEXT,
    "commercialResponsibleId" TEXT,
    "saleId" TEXT,
    "depositSaleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturingProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManufacturingProject_number_key" ON "ManufacturingProject"("number");
CREATE UNIQUE INDEX "ManufacturingProject_saleId_key" ON "ManufacturingProject"("saleId");
CREATE UNIQUE INDEX "ManufacturingProject_depositSaleId_key" ON "ManufacturingProject"("depositSaleId");
CREATE INDEX "ManufacturingProject_status_promisedAt_idx" ON "ManufacturingProject"("status", "promisedAt");
CREATE INDEX "ManufacturingProject_customerId_idx" ON "ManufacturingProject"("customerId");
CREATE INDEX "ManufacturingProject_finishedVariantId_idx" ON "ManufacturingProject"("finishedVariantId");

CREATE TABLE "ManufacturingBomLine" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ingredientVariantId" TEXT NOT NULL,
    "plannedQty" DECIMAL(18,4) NOT NULL,
    "scrapPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "issueAtStart" BOOLEAN NOT NULL DEFAULT false,
    "consumedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturingBomLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManufacturingBomLine_projectId_ingredientVariantId_key" ON "ManufacturingBomLine"("projectId", "ingredientVariantId");
CREATE INDEX "ManufacturingBomLine_projectId_idx" ON "ManufacturingBomLine"("projectId");

CREATE TABLE "ManufacturingMaterialReservation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bomLineId" TEXT,
    "ingredientVariantId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "ManufacturingMaterialReservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManufacturingMaterialReservation_projectId_active_idx" ON "ManufacturingMaterialReservation"("projectId", "active");
CREATE INDEX "ManufacturingMaterialReservation_ingredientVariantId_active_idx" ON "ManufacturingMaterialReservation"("ingredientVariantId", "active");

CREATE TABLE "ManufacturingMaterialIssue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bomLineId" TEXT,
    "ingredientVariantId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "phase" "ManufacturingConsumePhase" NOT NULL,
    "userId" TEXT,
    "stockMovementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManufacturingMaterialIssue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManufacturingMaterialIssue_stockMovementId_key" ON "ManufacturingMaterialIssue"("stockMovementId");
CREATE INDEX "ManufacturingMaterialIssue_projectId_idx" ON "ManufacturingMaterialIssue"("projectId");

CREATE TABLE "ManufacturingFinishedReceipt" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "stockMovementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManufacturingFinishedReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManufacturingFinishedReceipt_projectId_key" ON "ManufacturingFinishedReceipt"("projectId");
CREATE UNIQUE INDEX "ManufacturingFinishedReceipt_stockMovementId_key" ON "ManufacturingFinishedReceipt"("stockMovementId");

CREATE TABLE "ManufacturingStatusLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromStatus" "ManufacturingProjectStatus",
    "toStatus" "ManufacturingProjectStatus" NOT NULL,
    "userId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManufacturingStatusLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManufacturingStatusLog_projectId_createdAt_idx" ON "ManufacturingStatusLog"("projectId", "createdAt");

-- ForeignKeys
ALTER TABLE "ManufacturingProject" ADD CONSTRAINT "ManufacturingProject_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManufacturingProject" ADD CONSTRAINT "ManufacturingProject_finishedVariantId_fkey" FOREIGN KEY ("finishedVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManufacturingProject" ADD CONSTRAINT "ManufacturingProject_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManufacturingProject" ADD CONSTRAINT "ManufacturingProject_technicalResponsibleId_fkey" FOREIGN KEY ("technicalResponsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManufacturingProject" ADD CONSTRAINT "ManufacturingProject_commercialResponsibleId_fkey" FOREIGN KEY ("commercialResponsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManufacturingProject" ADD CONSTRAINT "ManufacturingProject_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManufacturingProject" ADD CONSTRAINT "ManufacturingProject_depositSaleId_fkey" FOREIGN KEY ("depositSaleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ManufacturingBomLine" ADD CONSTRAINT "ManufacturingBomLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ManufacturingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManufacturingBomLine" ADD CONSTRAINT "ManufacturingBomLine_ingredientVariantId_fkey" FOREIGN KEY ("ingredientVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManufacturingMaterialReservation" ADD CONSTRAINT "ManufacturingMaterialReservation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ManufacturingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManufacturingMaterialReservation" ADD CONSTRAINT "ManufacturingMaterialReservation_bomLineId_fkey" FOREIGN KEY ("bomLineId") REFERENCES "ManufacturingBomLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManufacturingMaterialReservation" ADD CONSTRAINT "ManufacturingMaterialReservation_ingredientVariantId_fkey" FOREIGN KEY ("ingredientVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManufacturingMaterialIssue" ADD CONSTRAINT "ManufacturingMaterialIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ManufacturingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManufacturingMaterialIssue" ADD CONSTRAINT "ManufacturingMaterialIssue_bomLineId_fkey" FOREIGN KEY ("bomLineId") REFERENCES "ManufacturingBomLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManufacturingMaterialIssue" ADD CONSTRAINT "ManufacturingMaterialIssue_ingredientVariantId_fkey" FOREIGN KEY ("ingredientVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManufacturingMaterialIssue" ADD CONSTRAINT "ManufacturingMaterialIssue_stockMovementId_fkey" FOREIGN KEY ("stockMovementId") REFERENCES "StockMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ManufacturingFinishedReceipt" ADD CONSTRAINT "ManufacturingFinishedReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ManufacturingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManufacturingFinishedReceipt" ADD CONSTRAINT "ManufacturingFinishedReceipt_stockMovementId_fkey" FOREIGN KEY ("stockMovementId") REFERENCES "StockMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ManufacturingStatusLog" ADD CONSTRAINT "ManufacturingStatusLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ManufacturingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
