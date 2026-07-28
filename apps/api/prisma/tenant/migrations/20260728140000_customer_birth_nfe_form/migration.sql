-- Data de nascimento do cliente (validação de CPF na UI; nome permanece manual).
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "birthDate" DATE;

-- Vendas criadas pelo formulário de NF-e 55 (além de PDV / WhatsApp).
ALTER TYPE "SaleSource" ADD VALUE 'NFE_FORM';
