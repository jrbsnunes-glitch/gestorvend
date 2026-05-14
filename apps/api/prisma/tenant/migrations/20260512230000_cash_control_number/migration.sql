-- Adiciona um número de controle sequencial às sessões de caixa.
-- A sequence é criada implicitamente pelo SERIAL/identity; cada nova sessão
-- recebe um número crescente, único, usado nas impressões e na conferência.

ALTER TABLE "CashRegisterSession"
  ADD COLUMN "controlNumber" SERIAL;

-- Garante unicidade do número de controle (Prisma também espera o índice).
CREATE UNIQUE INDEX "CashRegisterSession_controlNumber_key"
  ON "CashRegisterSession"("controlNumber");
