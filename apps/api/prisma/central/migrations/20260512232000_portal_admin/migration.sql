-- Portal de licenciamento: SuperAdmin + campos auxiliares de licença no Tenant.

ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "licenseValidFrom"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "licenseLastValidatedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "SuperAdmin" (
  "id"           TEXT PRIMARY KEY,
  "email"        TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "SuperAdmin_email_key" ON "SuperAdmin"("email");
