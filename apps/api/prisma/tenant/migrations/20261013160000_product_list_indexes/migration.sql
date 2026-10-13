-- Índices da listagem e da busca de produtos (cadastros com milhares de SKUs).
CREATE INDEX "Product_isActive_controlNumber_idx" ON "Product"("isActive", "controlNumber");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");
CREATE INDEX "ProductVariant_barcode_idx" ON "ProductVariant"("barcode");
