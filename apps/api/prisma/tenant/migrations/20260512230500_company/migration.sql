-- Cria a tabela Company (singleton por tenant). Os campos cobrem o que
-- aparece nos cabeçalhos de impressão e nos cadastros básicos da loja.
CREATE TABLE IF NOT EXISTS "Company" (
  "id"         TEXT PRIMARY KEY,
  "legalName"  TEXT NOT NULL,
  "tradeName"  TEXT NOT NULL,
  "cnpj"       TEXT NOT NULL,
  "ie"         TEXT,
  "im"         TEXT,
  "email"      TEXT,
  "phone"      TEXT,
  "address"    TEXT,
  "city"       TEXT,
  "state"      TEXT,
  "zip"        TEXT,
  "logoUrl"    TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "Company_cnpj_key" ON "Company"("cnpj");
