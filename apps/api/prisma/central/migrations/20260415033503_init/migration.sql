-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('trial', 'active', 'suspended', 'expired');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "licenseStatus" "LicenseStatus" NOT NULL DEFAULT 'trial',
    "licenseExpiresAt" TIMESTAMP(3),
    "databaseName" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT '0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_cnpj_key" ON "Tenant"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_databaseName_key" ON "Tenant"("databaseName");
