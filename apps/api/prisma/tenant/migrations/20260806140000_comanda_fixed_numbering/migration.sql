-- Numeração fixa de comandas sem mesa (slots cadastrados).
CREATE TYPE "ComandaNumberingMode" AS ENUM ('DYNAMIC', 'FIXED');

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "comandaNumberingMode" "ComandaNumberingMode" NOT NULL DEFAULT 'DYNAMIC';

CREATE TABLE IF NOT EXISTS "ComandaStation" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "label" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ComandaStation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ComandaStation_code_key" ON "ComandaStation"("code");
CREATE INDEX IF NOT EXISTS "ComandaStation_sortOrder_code_idx" ON "ComandaStation"("sortOrder", "code");

ALTER TABLE "ServiceTab"
  ADD COLUMN IF NOT EXISTS "stationId" TEXT;

CREATE INDEX IF NOT EXISTS "ServiceTab_stationId_idx" ON "ServiceTab"("stationId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ServiceTab_stationId_fkey'
  ) THEN
    ALTER TABLE "ServiceTab"
      ADD CONSTRAINT "ServiceTab_stationId_fkey"
      FOREIGN KEY ("stationId") REFERENCES "ComandaStation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
