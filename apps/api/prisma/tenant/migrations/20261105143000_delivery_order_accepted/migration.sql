-- Fase "Pedido aceito" no fluxo delivery

ALTER TYPE "DeliveryOrderStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';

-- Pedidos no balcão aguardando cozinha passam a "aceito" (antes eram RECEIVED)
UPDATE "ServiceTab"
SET "deliveryStatus" = 'ACCEPTED'
WHERE "deliveryStatus" = 'RECEIVED'
  AND "deliveryPrintStatus" = 'PENDING_COUNTER'
  AND "fulfillment" IN ('DELIVERY', 'PICKUP');
