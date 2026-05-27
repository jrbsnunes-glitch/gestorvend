-- CreateEnum
CREATE TYPE "PdvDocumentMode" AS ENUM ('NON_FISCAL_RECEIPT', 'ELECTRONIC_FISCAL_PLANNED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "pdvDocumentMode" "PdvDocumentMode" NOT NULL DEFAULT 'NON_FISCAL_RECEIPT';

-- CreateTable
CREATE TABLE "FiscalSituation" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ncm" VARCHAR(10),
    "exTipi" VARCHAR(10),
    "cest" VARCHAR(10),
    "fiscalOrigin" VARCHAR(2),
    "cstIcms" VARCHAR(4),
    "csosn" VARCHAR(4),
    "cstPis" VARCHAR(4),
    "cstCofins" VARCHAR(4),
    "cfopInternal" VARCHAR(5),
    "cfopInterstate" VARCHAR(5),
    "ibsTestRate" DECIMAL(8,4) NOT NULL DEFAULT 0.1,
    "cbsTestRate" DECIMAL(8,4) NOT NULL DEFAULT 0.9,
    "regulationNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalSituation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalSituation_code_key" ON "FiscalSituation"("code");

-- CreateIndex
CREATE INDEX "FiscalSituation_isActive_idx" ON "FiscalSituation"("isActive");

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "fiscalSituationId" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "fiscalIntegrationError" VARCHAR(1024);

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_fiscalSituationId_fkey" FOREIGN KEY ("fiscalSituationId") REFERENCES "FiscalSituation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
