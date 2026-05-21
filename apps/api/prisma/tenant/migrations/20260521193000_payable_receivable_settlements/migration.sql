-- Liquidações explícitas (parcial ou total) para diário e totais sem duplicar movimento de caixa.

CREATE TABLE "PayableSettlement" (
    "id" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "PaymentMethod",
    "cashSessionId" TEXT,
    "notes" VARCHAR(4000),

    CONSTRAINT "PayableSettlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReceivableSettlement" (
    "id" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "PaymentMethod",
    "cashSessionId" TEXT,
    "notes" VARCHAR(4000),

    CONSTRAINT "ReceivableSettlement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayableSettlement_payableId_idx" ON "PayableSettlement"("payableId");
CREATE INDEX "PayableSettlement_paidAt_idx" ON "PayableSettlement"("paidAt");
CREATE INDEX "ReceivableSettlement_receivableId_idx" ON "ReceivableSettlement"("receivableId");
CREATE INDEX "ReceivableSettlement_receivedAt_idx" ON "ReceivableSettlement"("receivedAt");

ALTER TABLE "PayableSettlement" ADD CONSTRAINT "PayableSettlement_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "AccountPayable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayableSettlement" ADD CONSTRAINT "PayableSettlement_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashRegisterSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReceivableSettlement" ADD CONSTRAINT "ReceivableSettlement_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "AccountReceivable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceivableSettlement" ADD CONSTRAINT "ReceivableSettlement_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashRegisterSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
