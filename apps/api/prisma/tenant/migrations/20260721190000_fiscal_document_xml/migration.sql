-- Persistência do XML autorizado (nfeProc) na emissão de saída.
ALTER TABLE "FiscalDocument"
  ADD COLUMN IF NOT EXISTS "xmlPath" VARCHAR(512),
  ADD COLUMN IF NOT EXISTS "xmlSha256" VARCHAR(64);
