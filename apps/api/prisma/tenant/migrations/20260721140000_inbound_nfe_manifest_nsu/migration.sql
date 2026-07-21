-- CreateEnum
CREATE TYPE "InboundNfeStatus" AS ENUM ('RESUMO', 'COMPLETO', 'PENDENTE_REVISAO', 'IMPORTADO');

-- AlterTable FiscalIssuerSettings: cursor NSU da Distribuição DF-e
ALTER TABLE "FiscalIssuerSettings" ADD COLUMN IF NOT EXISTS "inboundUltNsu" VARCHAR(20);

-- AlterTable InboundNfeDocument: status, manifestação e metadados
ALTER TABLE "InboundNfeDocument" ADD COLUMN IF NOT EXISTS "status" "InboundNfeStatus" NOT NULL DEFAULT 'COMPLETO';
ALTER TABLE "InboundNfeDocument" ADD COLUMN IF NOT EXISTS "manifestacaoEvento" VARCHAR(10);
ALTER TABLE "InboundNfeDocument" ADD COLUMN IF NOT EXISTS "manifestacaoProtocolo" VARCHAR(60);
ALTER TABLE "InboundNfeDocument" ADD COLUMN IF NOT EXISTS "emitterCnpj" VARCHAR(14);
ALTER TABLE "InboundNfeDocument" ADD COLUMN IF NOT EXISTS "emitterName" VARCHAR(200);
ALTER TABLE "InboundNfeDocument" ADD COLUMN IF NOT EXISTS "documentNumber" VARCHAR(20);
ALTER TABLE "InboundNfeDocument" ADD COLUMN IF NOT EXISTS "issueDate" TIMESTAMP(3);
ALTER TABLE "InboundNfeDocument" ADD COLUMN IF NOT EXISTS "totalValue" DECIMAL(14, 2);
ALTER TABLE "InboundNfeDocument" ADD COLUMN IF NOT EXISTS "itemCount" INTEGER;
ALTER TABLE "InboundNfeDocument" ADD COLUMN IF NOT EXISTS "unmatchedCount" INTEGER;
ALTER TABLE "InboundNfeDocument" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "InboundNfeDocument_status_fetchedAt_idx" ON "InboundNfeDocument"("status", "fetchedAt");
