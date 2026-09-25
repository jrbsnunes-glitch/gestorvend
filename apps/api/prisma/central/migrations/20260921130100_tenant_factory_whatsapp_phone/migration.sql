ALTER TABLE "Tenant" ADD COLUMN "factoryWhatsappPhoneNumberId" VARCHAR(32);
CREATE UNIQUE INDEX "Tenant_factoryWhatsappPhoneNumberId_key" ON "Tenant"("factoryWhatsappPhoneNumberId");
