-- Provisionamento automático: estado no catálogo central.

CREATE TYPE "TenantProvisioningStatus" AS ENUM ('PENDING', 'PROVISIONING', 'READY', 'FAILED');

ALTER TABLE "Tenant" ADD COLUMN "provisioningStatus" "TenantProvisioningStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Tenant" ADD COLUMN "provisioningError" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "provisioningUpdatedAt" TIMESTAMP(3);

UPDATE "Tenant"
SET
  "provisioningStatus" = 'READY',
  "provisioningUpdatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP);
