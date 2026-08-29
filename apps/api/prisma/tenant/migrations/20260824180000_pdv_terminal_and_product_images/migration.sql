-- PDV terminals + product images + sale.terminalId

CREATE TYPE "PdvTerminalMode" AS ENUM ('SELF_SERVICE', 'OPERATOR');

CREATE TABLE "PdvTerminal" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "mode" "PdvTerminalMode" NOT NULL DEFAULT 'SELF_SERVICE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "secretHash" VARCHAR(120) NOT NULL,
    "allowedMethods" JSONB NOT NULL DEFAULT '["PIX","CARD_CREDIT","CARD_DEBIT"]',
    "operatorUserId" TEXT,
    "activeDraftSaleId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdvTerminal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PdvTerminal_number_key" ON "PdvTerminal"("number");
CREATE UNIQUE INDEX "PdvTerminal_activeDraftSaleId_key" ON "PdvTerminal"("activeDraftSaleId");
CREATE INDEX "PdvTerminal_isActive_idx" ON "PdvTerminal"("isActive");
CREATE INDEX "PdvTerminal_operatorUserId_idx" ON "PdvTerminal"("operatorUserId");

ALTER TABLE "PdvTerminal" ADD CONSTRAINT "PdvTerminal_operatorUserId_fkey"
    FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Sale" ADD COLUMN "terminalId" TEXT;
CREATE INDEX "Sale_terminalId_idx" ON "Sale"("terminalId");
CREATE INDEX "Sale_terminalId_status_idx" ON "Sale"("terminalId", "status");

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_terminalId_fkey"
    FOREIGN KEY ("terminalId") REFERENCES "PdvTerminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PdvTerminal" ADD CONSTRAINT "PdvTerminal_activeDraftSaleId_fkey"
    FOREIGN KEY ("activeDraftSaleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Product" ADD COLUMN "imageVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "hasImage" BOOLEAN NOT NULL DEFAULT false;
