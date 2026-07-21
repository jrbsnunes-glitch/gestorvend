-- Inventário multi-produto (sessão + itens)

CREATE TYPE "StockInventoryStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

CREATE TABLE "StockInventory" (
  "id" TEXT NOT NULL,
  "controlNumber" SERIAL NOT NULL,
  "locationId" TEXT NOT NULL,
  "status" "StockInventoryStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "userId" TEXT,
  "postedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockInventory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockInventory_controlNumber_key" ON "StockInventory"("controlNumber");
CREATE INDEX "StockInventory_status_createdAt_idx" ON "StockInventory"("status", "createdAt");
CREATE INDEX "StockInventory_locationId_idx" ON "StockInventory"("locationId");

ALTER TABLE "StockInventory"
  ADD CONSTRAINT "StockInventory_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockInventory"
  ADD CONSTRAINT "StockInventory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StockInventoryItem" (
  "id" TEXT NOT NULL,
  "inventoryId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "systemQty" DECIMAL(18,4) NOT NULL,
  "countedQty" DECIMAL(18,4),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockInventoryItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockInventoryItem_inventoryId_variantId_key"
  ON "StockInventoryItem"("inventoryId", "variantId");
CREATE INDEX "StockInventoryItem_variantId_idx" ON "StockInventoryItem"("variantId");

ALTER TABLE "StockInventoryItem"
  ADD CONSTRAINT "StockInventoryItem_inventoryId_fkey"
  FOREIGN KEY ("inventoryId") REFERENCES "StockInventory"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockInventoryItem"
  ADD CONSTRAINT "StockInventoryItem_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
  ADD COLUMN IF NOT EXISTS "stockInventoryId" TEXT;

CREATE INDEX IF NOT EXISTS "StockMovement_stockInventoryId_idx"
  ON "StockMovement"("stockInventoryId");

ALTER TABLE "StockMovement"
  DROP CONSTRAINT IF EXISTS "StockMovement_stockInventoryId_fkey";

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_stockInventoryId_fkey"
  FOREIGN KEY ("stockInventoryId") REFERENCES "StockInventory"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
