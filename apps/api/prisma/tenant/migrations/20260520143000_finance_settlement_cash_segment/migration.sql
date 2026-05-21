-- Segmento de fornecedor (filtros / relatórios)
ALTER TABLE "Supplier" ADD COLUMN "segment" TEXT;

-- Baixa de contas a pagar: forma, valor liquidado, caixa, observações
ALTER TABLE "AccountPayable" ADD COLUMN "paymentMethod" "PaymentMethod";
ALTER TABLE "AccountPayable" ADD COLUMN "settledAmount" DECIMAL(14,2);
ALTER TABLE "AccountPayable" ADD COLUMN "cashSessionId" TEXT;
ALTER TABLE "AccountPayable" ADD COLUMN "paymentNotes" TEXT;

ALTER TABLE "AccountPayable" ADD CONSTRAINT "AccountPayable_cashSessionId_fkey"
  FOREIGN KEY ("cashSessionId") REFERENCES "CashRegisterSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Baixa de contas a receber
ALTER TABLE "AccountReceivable" ADD COLUMN "paymentMethod" "PaymentMethod";
ALTER TABLE "AccountReceivable" ADD COLUMN "settledAmount" DECIMAL(14,2);
ALTER TABLE "AccountReceivable" ADD COLUMN "cashSessionId" TEXT;
ALTER TABLE "AccountReceivable" ADD COLUMN "paymentNotes" TEXT;

ALTER TABLE "AccountReceivable" ADD CONSTRAINT "AccountReceivable_cashSessionId_fkey"
  FOREIGN KEY ("cashSessionId") REFERENCES "CashRegisterSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
