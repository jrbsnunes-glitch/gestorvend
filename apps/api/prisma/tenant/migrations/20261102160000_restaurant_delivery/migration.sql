-- Delivery do restaurante (comanda pública, taxa, impressão e pagamento)

CREATE TYPE "DeliveryPrintMode" AS ENUM ('DIRECT', 'COUNTER_THEN_KITCHEN');
CREATE TYPE "DeliveryStockMode" AS ENUM ('FULL', 'SALE_ONLY');
CREATE TYPE "ServiceTabFulfillment" AS ENUM ('SALON', 'DELIVERY', 'PICKUP');
CREATE TYPE "DeliveryPaymentMode" AS ENUM ('PICKUP', 'PIX_DELIVERER', 'PIX_ONLINE');
CREATE TYPE "DeliveryPrintStatus" AS ENUM ('PENDING_COUNTER', 'SENT_KITCHEN');
CREATE TYPE "DeliveryOrderStatus" AS ENUM (
  'AWAITING_PAYMENT',
  'RECEIVED',
  'PREPARING',
  'OUT_FOR_DELIVERY',
  'READY_PICKUP',
  'COMPLETED'
);

ALTER TYPE "SaleSource" ADD VALUE 'DELIVERY';

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "deliveryFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "deliveryFeeValue" DECIMAL(14, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "deliveryPrintMode" "DeliveryPrintMode" NOT NULL DEFAULT 'DIRECT',
  ADD COLUMN IF NOT EXISTS "deliveryStockMode" "DeliveryStockMode" NOT NULL DEFAULT 'FULL',
  ADD COLUMN IF NOT EXISTS "deliveryHoursJson" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryPayPickup" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "deliveryPayPixDeliverer" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "deliveryPayPixOnline" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "availableForDelivery" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Product_availableForDelivery_idx" ON "Product" ("availableForDelivery");

ALTER TABLE "ServiceTab"
  ADD COLUMN IF NOT EXISTS "fulfillment" "ServiceTabFulfillment" NOT NULL DEFAULT 'SALON',
  ADD COLUMN IF NOT EXISTS "deliveryAddress" VARCHAR(240),
  ADD COLUMN IF NOT EXISTS "deliveryNotes" VARCHAR(240),
  ADD COLUMN IF NOT EXISTS "deliveryPhone" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "deliveryFeeAmount" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "publicToken" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "paymentMode" "DeliveryPaymentMode",
  ADD COLUMN IF NOT EXISTS "deliveryPrintStatus" "DeliveryPrintStatus",
  ADD COLUMN IF NOT EXISTS "deliveryStatus" "DeliveryOrderStatus";

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceTab_publicToken_key" ON "ServiceTab" ("publicToken");
CREATE INDEX IF NOT EXISTS "ServiceTab_fulfillment_status_idx" ON "ServiceTab" ("fulfillment", "status");
CREATE INDEX IF NOT EXISTS "ServiceTab_deliveryStatus_status_idx" ON "ServiceTab" ("deliveryStatus", "status");
