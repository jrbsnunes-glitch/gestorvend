-- Número sequencial único por produto (PDV / listagem). Renumera cadastros existentes por ordem de criação.

ALTER TABLE "Product" ADD COLUMN "controlNumber" INTEGER;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "Product"
)
UPDATE "Product" AS p
SET "controlNumber" = n.rn
FROM numbered AS n
WHERE p.id = n.id;

ALTER TABLE "Product" ALTER COLUMN "controlNumber" SET NOT NULL;

CREATE SEQUENCE "Product_controlNumber_seq";

SELECT setval(
  '"Product_controlNumber_seq"',
  COALESCE((SELECT MAX("controlNumber") FROM "Product"), 0) + 1,
  false
);

ALTER TABLE "Product"
  ALTER COLUMN "controlNumber" SET DEFAULT nextval('"Product_controlNumber_seq"');

ALTER SEQUENCE "Product_controlNumber_seq" OWNED BY "Product"."controlNumber";

CREATE UNIQUE INDEX "Product_controlNumber_key" ON "Product"("controlNumber");
