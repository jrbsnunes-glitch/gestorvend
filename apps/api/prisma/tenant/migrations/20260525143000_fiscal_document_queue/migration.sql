-- CreateEnum
CREATE TYPE "FiscalDocumentKind" AS ENUM ('NFC_E', 'NF_E');

-- CreateEnum
CREATE TYPE "FiscalDocumentStatus" AS ENUM ('QUEUED', 'BUILDING_XML', 'SENT', 'AUTHORIZED', 'REJECTED', 'ERROR');

-- CreateTable
CREATE TABLE "FiscalDocument" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "kind" "FiscalDocumentKind" NOT NULL,
    "status" "FiscalDocumentStatus" NOT NULL DEFAULT 'QUEUED',
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" VARCHAR(2048),
    "accessKey" VARCHAR(44),
    "protocol" VARCHAR(32),
    "sefazEnvironment" VARCHAR(16),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_saleId_key" ON "FiscalDocument"("saleId");

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
