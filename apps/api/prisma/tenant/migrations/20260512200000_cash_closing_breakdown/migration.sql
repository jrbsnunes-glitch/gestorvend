-- Adiciona colunas para o detalhamento do fechamento de caixa por forma
-- de pagamento (closingByMethod) e observações do operador (closingNotes).
ALTER TABLE "CashRegisterSession"
  ADD COLUMN IF NOT EXISTS "closingByMethod" JSONB,
  ADD COLUMN IF NOT EXISTS "closingNotes" TEXT;
