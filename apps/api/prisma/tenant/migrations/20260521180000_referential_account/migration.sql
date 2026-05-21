-- Plano referencial RFB (importação versionada)
CREATE TABLE "ReferentialAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "parentCode" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "taxonomyCode" TEXT,
    "sourceVersion" TEXT NOT NULL DEFAULT 'RFB-sample-v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferentialAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferentialAccount_code_sourceVersion_key" ON "ReferentialAccount"("code", "sourceVersion");
CREATE INDEX "ReferentialAccount_code_idx" ON "ReferentialAccount"("code");
CREATE INDEX "ReferentialAccount_parentCode_idx" ON "ReferentialAccount"("parentCode");
CREATE INDEX "ReferentialAccount_sourceVersion_idx" ON "ReferentialAccount"("sourceVersion");
