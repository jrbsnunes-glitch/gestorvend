-- Funcionário identificado na venda (independente do operador do caixa).
ALTER TABLE "Sale" ADD COLUMN "sellerUserId" TEXT;
ALTER TABLE "Sale" ADD COLUMN "sellerName" VARCHAR(160);

CREATE INDEX "Sale_sellerUserId_idx" ON "Sale"("sellerUserId");

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_sellerUserId_fkey"
  FOREIGN KEY ("sellerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
