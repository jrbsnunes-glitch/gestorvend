-- Campos adicionais na Situação Fiscal para emissão NF-e / NFC-e (NT 2025.002 e layout 4.00)

ALTER TABLE "FiscalSituation" ADD COLUMN "cstIpi" VARCHAR(2);
ALTER TABLE "FiscalSituation" ADD COLUMN "ipiEnquadramento" VARCHAR(3);
ALTER TABLE "FiscalSituation" ADD COLUMN "cstIbsCbs" VARCHAR(3);
ALTER TABLE "FiscalSituation" ADD COLUMN "cClassTrib" VARCHAR(6);
ALTER TABLE "FiscalSituation" ADD COLUMN "modBcIcms" VARCHAR(1);
ALTER TABLE "FiscalSituation" ADD COLUMN "redBcIcms" DECIMAL(8,4) NOT NULL DEFAULT 0;
ALTER TABLE "FiscalSituation" ADD COLUMN "codBeneficio" VARCHAR(10);
ALTER TABLE "FiscalSituation" ADD COLUMN "aliqFcp" DECIMAL(8,4) NOT NULL DEFAULT 0;
