-- Company: módulo restaurante + balança
CREATE TYPE "ScaleCaptureMode" AS ENUM ('MANUAL', 'SERIAL_DIRECT', 'AGENT', 'BARCODE_LABEL');

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "restaurantModuleEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "scaleMode" "ScaleCaptureMode" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "scaleProfile" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "barcodeWeightPattern" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "scaleAutoConfirmMs" INTEGER NOT NULL DEFAULT 700,
  ADD COLUMN IF NOT EXISTS "scaleHint" TEXT,
  ADD COLUMN IF NOT EXISTS "kitchenPrinterHint" TEXT;

-- Product: tara + ficha técnica
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "tareKg" DECIMAL(18, 4);

CREATE TABLE IF NOT EXISTS "ProductRecipe" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductRecipe_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductRecipe_productId_key" ON "ProductRecipe"("productId");

DO $$ BEGIN
  ALTER TABLE "ProductRecipe"
    ADD CONSTRAINT "ProductRecipe_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ProductRecipeItem" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "ingredientVariantId" TEXT NOT NULL,
  "quantity" DECIMAL(18, 4) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductRecipeItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductRecipeItem_recipeId_ingredientVariantId_key"
  ON "ProductRecipeItem"("recipeId", "ingredientVariantId");
CREATE INDEX IF NOT EXISTS "ProductRecipeItem_ingredientVariantId_idx"
  ON "ProductRecipeItem"("ingredientVariantId");

DO $$ BEGIN
  ALTER TABLE "ProductRecipeItem"
    ADD CONSTRAINT "ProductRecipeItem_recipeId_fkey"
    FOREIGN KEY ("recipeId") REFERENCES "ProductRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductRecipeItem"
    ADD CONSTRAINT "ProductRecipeItem_ingredientVariantId_fkey"
    FOREIGN KEY ("ingredientVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SaleSource RESTAURANT
ALTER TYPE "SaleSource" ADD VALUE IF NOT EXISTS 'RESTAURANT';

-- Domínio salão / comanda
CREATE TYPE "DiningTableStatus" AS ENUM ('FREE', 'OCCUPIED', 'RESERVED');
CREATE TYPE "ServiceTabStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');
CREATE TYPE "ServiceTabItemStatus" AS ENUM ('ORDERED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED');

CREATE TABLE IF NOT EXISTS "DiningArea" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiningArea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DiningTable" (
  "id" TEXT NOT NULL,
  "areaId" TEXT NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "label" TEXT,
  "capacity" INTEGER,
  "status" "DiningTableStatus" NOT NULL DEFAULT 'FREE',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiningTable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DiningTable_areaId_code_key" ON "DiningTable"("areaId", "code");
CREATE INDEX IF NOT EXISTS "DiningTable_status_idx" ON "DiningTable"("status");

DO $$ BEGIN
  ALTER TABLE "DiningTable"
    ADD CONSTRAINT "DiningTable_areaId_fkey"
    FOREIGN KEY ("areaId") REFERENCES "DiningArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ServiceTab" (
  "id" TEXT NOT NULL,
  "number" SERIAL NOT NULL,
  "status" "ServiceTabStatus" NOT NULL DEFAULT 'OPEN',
  "tableId" TEXT,
  "openedById" TEXT,
  "customerId" TEXT,
  "notes" TEXT,
  "saleId" TEXT,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceTab_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceTab_number_key" ON "ServiceTab"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceTab_saleId_key" ON "ServiceTab"("saleId");
CREATE INDEX IF NOT EXISTS "ServiceTab_status_createdAt_idx" ON "ServiceTab"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ServiceTab_tableId_idx" ON "ServiceTab"("tableId");

DO $$ BEGIN
  ALTER TABLE "ServiceTab"
    ADD CONSTRAINT "ServiceTab_tableId_fkey"
    FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ServiceTab"
    ADD CONSTRAINT "ServiceTab_openedById_fkey"
    FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ServiceTab"
    ADD CONSTRAINT "ServiceTab_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ServiceTab"
    ADD CONSTRAINT "ServiceTab_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ServiceTabItem" (
  "id" TEXT NOT NULL,
  "tabId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "quantity" DECIMAL(18, 4) NOT NULL,
  "unitPrice" DECIMAL(14, 4) NOT NULL,
  "discount" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "totalLine" DECIMAL(14, 2) NOT NULL,
  "notes" TEXT,
  "status" "ServiceTabItemStatus" NOT NULL DEFAULT 'ORDERED',
  "weightGross" DECIMAL(18, 4),
  "weightTare" DECIMAL(18, 4),
  "printSector" VARCHAR(32),
  "kitchenPrintedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceTabItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ServiceTabItem_tabId_status_idx" ON "ServiceTabItem"("tabId", "status");
CREATE INDEX IF NOT EXISTS "ServiceTabItem_variantId_idx" ON "ServiceTabItem"("variantId");

DO $$ BEGIN
  ALTER TABLE "ServiceTabItem"
    ADD CONSTRAINT "ServiceTabItem_tabId_fkey"
    FOREIGN KEY ("tabId") REFERENCES "ServiceTab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ServiceTabItem"
    ADD CONSTRAINT "ServiceTabItem_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
