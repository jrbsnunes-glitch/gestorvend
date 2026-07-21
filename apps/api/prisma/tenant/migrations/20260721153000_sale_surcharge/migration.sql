-- Acréscimo comercial no total da venda (mapa fiscal: ICMSTot/vOutro).
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "surcharge" DECIMAL(14,2) NOT NULL DEFAULT 0;
