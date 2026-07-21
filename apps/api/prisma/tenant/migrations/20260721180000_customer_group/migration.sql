-- Catálogo de grupos de clientes (inclusão em tempo real no cadastro).
CREATE TABLE IF NOT EXISTS "CustomerGroup" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerGroup_name_key" ON "CustomerGroup"("name");

-- Importa segmentos já usados em clientes.
INSERT INTO "CustomerGroup" ("id", "name", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text), t.seg, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT TRIM("segment") AS seg
  FROM "Customer"
  WHERE "segment" IS NOT NULL AND TRIM("segment") <> ''
) t
WHERE NOT EXISTS (
  SELECT 1 FROM "CustomerGroup" g WHERE lower(g."name") = lower(t.seg)
);
