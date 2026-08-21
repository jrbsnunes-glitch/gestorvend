-- CreateEnum
CREATE TYPE "TenantModuleAddon" AS ENUM ('SERVICE_ORDER');

-- CreateTable
CREATE TABLE "TenantModuleGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" "TenantModuleAddon" NOT NULL,
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantModuleGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantModuleGrant_module_idx" ON "TenantModuleGrant"("module");

-- CreateIndex
CREATE UNIQUE INDEX "TenantModuleGrant_tenantId_module_key" ON "TenantModuleGrant"("tenantId", "module");

-- AddForeignKey
ALTER TABLE "TenantModuleGrant" ADD CONSTRAINT "TenantModuleGrant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
