-- CreateEnum
CREATE TYPE "StockLocationKind" AS ENUM ('NORMAL', 'SALES_RESERVATION');
CREATE TYPE "SaleReservationStatus" AS ENUM ('OPEN', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "StockLocation" ADD COLUMN "kind" "StockLocationKind" NOT NULL DEFAULT 'NORMAL';
CREATE INDEX "StockLocation_kind_idx" ON "StockLocation"("kind");

-- Local sistema das reservas (idempotente se o código já existir).
INSERT INTO "StockLocation" (id, code, name, "isDefault", kind, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'RESERVA', 'Reserva', false, 'SALES_RESERVATION', NOW(), NOW())
ON CONFLICT (code) DO UPDATE SET kind = 'SALES_RESERVATION';

-- CreateTable
CREATE TABLE "SaleReservation" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "status" "SaleReservationStatus" NOT NULL DEFAULT 'OPEN',
    "customerId" TEXT,
    "userId" TEXT,
    "saleId" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SaleReservation_number_key" ON "SaleReservation"("number");
CREATE UNIQUE INDEX "SaleReservation_saleId_key" ON "SaleReservation"("saleId");
CREATE INDEX "SaleReservation_status_expiresAt_idx" ON "SaleReservation"("status", "expiresAt");
CREATE INDEX "SaleReservation_customerId_idx" ON "SaleReservation"("customerId");

CREATE TABLE "SaleReservationItem" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalLine" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "SaleReservationItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SaleReservationItem_reservationId_idx" ON "SaleReservationItem"("reservationId");
CREATE INDEX "SaleReservationItem_variantId_idx" ON "SaleReservationItem"("variantId");

CREATE TABLE "SaleReservationPayment" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "paymentFormId" TEXT,

    CONSTRAINT "SaleReservationPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SaleReservationPayment_reservationId_idx" ON "SaleReservationPayment"("reservationId");
CREATE INDEX "SaleReservationPayment_paymentFormId_idx" ON "SaleReservationPayment"("paymentFormId");

ALTER TABLE "SaleReservation" ADD CONSTRAINT "SaleReservation_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleReservation" ADD CONSTRAINT "SaleReservation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleReservation" ADD CONSTRAINT "SaleReservation_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SaleReservationItem" ADD CONSTRAINT "SaleReservationItem_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "SaleReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleReservationItem" ADD CONSTRAINT "SaleReservationItem_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleReservationPayment" ADD CONSTRAINT "SaleReservationPayment_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "SaleReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleReservationPayment" ADD CONSTRAINT "SaleReservationPayment_paymentFormId_fkey"
  FOREIGN KEY ("paymentFormId") REFERENCES "PaymentForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
