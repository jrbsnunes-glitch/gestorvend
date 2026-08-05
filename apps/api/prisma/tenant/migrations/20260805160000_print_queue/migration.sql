-- Fila de impressao local (estacoes + jobs para agente desktop)

CREATE TYPE "PrintJobKind" AS ENUM ('KITCHEN', 'RECEIPT', 'PRECHECK');
CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'DONE', 'ERROR', 'CANCELLED');

CREATE TABLE "PrintStation" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "secretHash" VARCHAR(120) NOT NULL,
    "sectors" VARCHAR(255) NOT NULL DEFAULT 'COZINHA',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrintStation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "kind" "PrintJobKind" NOT NULL,
    "sector" VARCHAR(32) NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "stationId" TEXT,
    "tabId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "printedAt" TIMESTAMP(3),
    "error" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrintJob_status_createdAt_idx" ON "PrintJob"("status", "createdAt");
CREATE INDEX "PrintJob_sector_status_idx" ON "PrintJob"("sector", "status");
CREATE INDEX "PrintJob_tabId_idx" ON "PrintJob"("tabId");
CREATE INDEX "PrintJob_stationId_idx" ON "PrintJob"("stationId");

ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "PrintStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;