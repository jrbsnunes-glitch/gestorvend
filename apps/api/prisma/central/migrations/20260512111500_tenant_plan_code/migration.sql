-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('STANDARD', 'WHATSAPP');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "planCode" "PlanCode" NOT NULL DEFAULT 'STANDARD';
