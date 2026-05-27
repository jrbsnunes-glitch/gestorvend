-- Emissor fiscal (configuração NFC-e / NF-e por empresa)
CREATE TYPE "FiscalSefazEnvironment" AS ENUM ('HOMOLOGACAO', 'PRODUCAO');

CREATE TABLE "FiscalIssuerSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sefazEnvironment" "FiscalSefazEnvironment" NOT NULL DEFAULT 'HOMOLOGACAO',
    "crt" INTEGER NOT NULL DEFAULT 1,
    "uf" VARCHAR(2) NOT NULL,
    "municipalityIbge" VARCHAR(7) NOT NULL,
    "nfceSerie" INTEGER NOT NULL DEFAULT 1,
    "nfeSerie" INTEGER NOT NULL DEFAULT 1,
    "nfceLastNumber" INTEGER NOT NULL DEFAULT 0,
    "nfeLastNumber" INTEGER NOT NULL DEFAULT 0,
    "certificatePath" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalIssuerSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalIssuerSettings_companyId_key" ON "FiscalIssuerSettings"("companyId");

ALTER TABLE "FiscalIssuerSettings" ADD CONSTRAINT "FiscalIssuerSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
