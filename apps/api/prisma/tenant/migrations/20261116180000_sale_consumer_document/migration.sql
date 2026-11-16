-- Identificação do consumidor na NFC-e (CPF do balcão ou documento do cadastro).
ALTER TABLE "Sale" ADD COLUMN "consumerDocument" VARCHAR(14);
