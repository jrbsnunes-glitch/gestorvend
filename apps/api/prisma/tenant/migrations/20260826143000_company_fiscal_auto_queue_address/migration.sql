-- Auto-enfileiramento NFC-e + endereço emitente + IBGE destinatário

ALTER TABLE "Company" ADD COLUMN "addressNumber" VARCHAR(16);
ALTER TABLE "Company" ADD COLUMN "district" VARCHAR(80);
ALTER TABLE "Company" ADD COLUMN "autoQueueNfceOnSale" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Customer" ADD COLUMN "cityIbge" VARCHAR(7);
