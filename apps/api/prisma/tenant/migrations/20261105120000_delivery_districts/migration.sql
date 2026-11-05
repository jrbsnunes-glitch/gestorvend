-- CreateEnum
CREATE TYPE "DeliveryDistrictMode" AS ENUM ('OFF', 'ALLOWLIST', 'BLOCKLIST');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "deliveryDistrictMode" "DeliveryDistrictMode" NOT NULL DEFAULT 'OFF';
ALTER TABLE "Company" ADD COLUMN "deliveryDistrictsJson" TEXT;
ALTER TABLE "Company" ADD COLUMN "deliveryDistrictMessage" VARCHAR(500);
