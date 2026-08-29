-- Payment PSP integration (Getnet + Mercado Pago)

-- AlterEnum SaleStatus
ALTER TYPE "SaleStatus" ADD VALUE 'PENDING_PAYMENT';

-- CreateEnum
CREATE TYPE "PaymentPspProvider" AS ENUM ('GETNET', 'MERCADO_PAGO');
CREATE TYPE "PaymentPspEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');
CREATE TYPE "PaymentIntentMethod" AS ENUM ('PIX', 'CARD');
CREATE TYPE "PaymentIntentStatus" AS ENUM ('PENDING', 'PROCESSING', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'FAILED');

-- CreateTable PaymentProviderSettings
CREATE TABLE "PaymentProviderSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "activeProvider" "PaymentPspProvider",
    "getnetEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mercadoPagoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "environment" "PaymentPspEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "pixEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cardEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pixTimeoutSeconds" INTEGER NOT NULL DEFAULT 900,
    "pixKeyType" VARCHAR(16),
    "pixKey" VARCHAR(120),
    "getnetClientIdEnc" VARCHAR(512),
    "getnetClientSecretEnc" VARCHAR(512),
    "getnetChannel" VARCHAR(64),
    "getnetScope" VARCHAR(32),
    "getnetWebhookUser" VARCHAR(64),
    "getnetWebhookPasswordEnc" VARCHAR(512),
    "mercadoPagoAccessTokenEnc" VARCHAR(1024),
    "mercadoPagoPublicKey" VARCHAR(128),
    "mercadoPagoWebhookSecretEnc" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProviderSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentProviderSettings_companyId_key" ON "PaymentProviderSettings"("companyId");

ALTER TABLE "PaymentProviderSettings" ADD CONSTRAINT "PaymentProviderSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable PaymentIntent
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "method" "PaymentIntentMethod" NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "PaymentPspProvider" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "externalId" VARCHAR(128),
    "orderReference" VARCHAR(64) NOT NULL,
    "qrCode" TEXT,
    "expiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "saleId" TEXT,
    "metadata" JSONB,
    "webhookPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentIntent_status_expiresAt_idx" ON "PaymentIntent"("status", "expiresAt");
CREATE INDEX "PaymentIntent_externalId_provider_idx" ON "PaymentIntent"("externalId", "provider");
CREATE INDEX "PaymentIntent_orderReference_idx" ON "PaymentIntent"("orderReference");
CREATE INDEX "PaymentIntent_saleId_idx" ON "PaymentIntent"("saleId");

ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable SalePayment
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "externalTxnId" VARCHAR(128);
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "paymentIntentId" TEXT;

CREATE INDEX IF NOT EXISTS "SalePayment_paymentIntentId_idx" ON "SalePayment"("paymentIntentId");
CREATE INDEX IF NOT EXISTS "SalePayment_externalTxnId_idx" ON "SalePayment"("externalTxnId");

ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
