-- CreateEnum
CREATE TYPE "SaleSource" AS ENUM ('PDV', 'WHATSAPP');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "source" "SaleSource" NOT NULL DEFAULT 'PDV';
ALTER TABLE "Sale" ADD COLUMN "externalRef" VARCHAR(64);

-- CreateIndex
CREATE INDEX "Sale_source_idx" ON "Sale"("source");
CREATE INDEX "Sale_externalRef_idx" ON "Sale"("externalRef");
