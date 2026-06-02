-- Entrada NF-e: documento XML baixado + unicidade da chave em GoodsReceipt
CREATE TABLE "InboundNfeDocument" (
    "id" TEXT NOT NULL,
    "accessKey" VARCHAR(44) NOT NULL,
    "xmlPath" VARCHAR(512) NOT NULL,
    "xmlSha256" VARCHAR(64) NOT NULL,
    "nsu" VARCHAR(20),
    "sefazCStat" VARCHAR(3),
    "sefazMotivo" VARCHAR(512),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "goodsReceiptId" TEXT,

    CONSTRAINT "InboundNfeDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundNfeDocument_accessKey_key" ON "InboundNfeDocument"("accessKey");
CREATE UNIQUE INDEX "InboundNfeDocument_goodsReceiptId_key" ON "InboundNfeDocument"("goodsReceiptId");

ALTER TABLE "InboundNfeDocument" ADD CONSTRAINT "InboundNfeDocument_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "GoodsReceipt_nfeAccessKey_key" ON "GoodsReceipt"("nfeAccessKey");
