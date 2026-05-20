-- Controle de estoque ao nível do produto (mínimo entre variantes)
ALTER TABLE "Product" ADD COLUMN "inventoryControlMin" DECIMAL(18,4) NOT NULL DEFAULT 0;

UPDATE "Product" p
SET "inventoryControlMin" = COALESCE(v.min_agg, 0)
FROM (
  SELECT "productId", MIN("minStock") AS min_agg
  FROM "ProductVariant"
  GROUP BY "productId"
) v
WHERE p."id" = v."productId";
