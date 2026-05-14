-- AlterTable: estoque mínimo por variação (ponto de reposição) usado no PDV.
ALTER TABLE "ProductVariant"
  ADD COLUMN "minStock" DECIMAL(18, 4) NOT NULL DEFAULT 0;
