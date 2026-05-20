-- Piso cadastral ≥ 1 para mínimos de reposição / controle de produto

ALTER TABLE "ProductVariant" ALTER COLUMN "minStock" SET DEFAULT 1;
ALTER TABLE "Product" ALTER COLUMN "inventoryControlMin" SET DEFAULT 1;

UPDATE "ProductVariant" SET "minStock" = 1 WHERE COALESCE("minStock", 0) < 1;

UPDATE "Product" AS p
SET "inventoryControlMin" = sub.min_agg
FROM (
  SELECT "productId", MIN("minStock") AS min_agg
  FROM "ProductVariant"
  GROUP BY "productId"
) AS sub
WHERE p.id = sub."productId";

-- Produtos órfãos (sem variantes), se existirem por falha pontual — alinha piso cadastral
UPDATE "Product" SET "inventoryControlMin" = 1
WHERE NOT EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = "Product"."id");
