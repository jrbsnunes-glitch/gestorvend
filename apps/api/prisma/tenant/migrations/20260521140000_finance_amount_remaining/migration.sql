-- Saldo em aberto (permite pagamento parcial sem baixa total)
ALTER TABLE "AccountPayable" ADD COLUMN "amountRemaining" DECIMAL(14,2);
UPDATE "AccountPayable" SET "amountRemaining" = "amount" WHERE "amountRemaining" IS NULL;
UPDATE "AccountPayable" SET "amountRemaining" = 0 WHERE "status" = 'PAID';
ALTER TABLE "AccountPayable" ALTER COLUMN "amountRemaining" SET NOT NULL;

ALTER TABLE "AccountReceivable" ADD COLUMN "amountRemaining" DECIMAL(14,2);
UPDATE "AccountReceivable" SET "amountRemaining" = "amount" WHERE "amountRemaining" IS NULL;
UPDATE "AccountReceivable" SET "amountRemaining" = 0 WHERE "status" = 'PAID';
ALTER TABLE "AccountReceivable" ALTER COLUMN "amountRemaining" SET NOT NULL;
