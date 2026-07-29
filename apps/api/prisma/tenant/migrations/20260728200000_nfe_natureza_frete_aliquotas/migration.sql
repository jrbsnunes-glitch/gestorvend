-- Alíquotas na Situação Fiscal (DANFE / info complementar).
ALTER TABLE "FiscalSituation" ADD COLUMN IF NOT EXISTS "aliqIcms" DECIMAL(8,4) NOT NULL DEFAULT 0;
ALTER TABLE "FiscalSituation" ADD COLUMN IF NOT EXISTS "aliqIpi" DECIMAL(8,4) NOT NULL DEFAULT 0;
ALTER TABLE "FiscalSituation" ADD COLUMN IF NOT EXISTS "aliqPis" DECIMAL(8,4) NOT NULL DEFAULT 0;
ALTER TABLE "FiscalSituation" ADD COLUMN IF NOT EXISTS "aliqCofins" DECIMAL(8,4) NOT NULL DEFAULT 0;

-- Natureza da operação (natOp + CFOP).
CREATE TABLE IF NOT EXISTS "OperationNature" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "description" VARCHAR(60) NOT NULL,
    "cfop" VARCHAR(4) NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationNature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OperationNature_code_key" ON "OperationNature"("code");
CREATE INDEX IF NOT EXISTS "OperationNature_isActive_idx" ON "OperationNature"("isActive");
CREATE INDEX IF NOT EXISTS "OperationNature_cfop_idx" ON "OperationNature"("cfop");

-- Campos fiscais / logística na venda (formulário NF-e).
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "freightAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "freightMod" INTEGER NOT NULL DEFAULT 9;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "operationNatureId" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "deliveryVehiclePlate" VARCHAR(10);
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "deliveryDriverName" VARCHAR(120);
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "deductStock" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "Sale_operationNatureId_idx" ON "Sale"("operationNatureId");

DO $$ BEGIN
  ALTER TABLE "Sale" ADD CONSTRAINT "Sale_operationNatureId_fkey"
    FOREIGN KEY ("operationNatureId") REFERENCES "OperationNature"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
