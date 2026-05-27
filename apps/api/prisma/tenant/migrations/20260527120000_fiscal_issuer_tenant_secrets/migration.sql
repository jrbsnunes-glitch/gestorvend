-- Segredos de emissão fiscal por tenant (CSC + senha .pfx), com fallback opcional no .env da API.
ALTER TABLE "FiscalIssuerSettings" ADD COLUMN "certificatePassword" VARCHAR(512);
ALTER TABLE "FiscalIssuerSettings" ADD COLUMN "nfceCscId" VARCHAR(64);
ALTER TABLE "FiscalIssuerSettings" ADD COLUMN "nfceCsc" VARCHAR(512);
