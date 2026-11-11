-- Permite vender com saldo insuficiente (estoque pode ficar negativo).

ALTER TABLE "Company" ADD COLUMN "pdvAllowSaleWithoutStock" BOOLEAN NOT NULL DEFAULT false;
