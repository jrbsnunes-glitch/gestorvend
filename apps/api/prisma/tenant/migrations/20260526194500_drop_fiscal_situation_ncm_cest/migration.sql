-- NCM / CEST passam a ser mantidos apenas no cadastro do produto.
ALTER TABLE "FiscalSituation" DROP COLUMN IF EXISTS "ncm";
ALTER TABLE "FiscalSituation" DROP COLUMN IF EXISTS "cest";
