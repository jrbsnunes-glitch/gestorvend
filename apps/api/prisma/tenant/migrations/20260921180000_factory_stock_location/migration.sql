ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "factoryStockLocationId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Company"
    ADD CONSTRAINT "Company_factoryStockLocationId_fkey"
    FOREIGN KEY ("factoryStockLocationId") REFERENCES "StockLocation"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
